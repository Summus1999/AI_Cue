use std::slice;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use windows::core::GUID;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    WAVEFORMATEX, WAVEFORMATEXTENSIBLE, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, WAVE_FORMAT_PCM,
};
use windows::Win32::Media::KernelStreaming::{KSDATAFORMAT_SUBTYPE_PCM, WAVE_FORMAT_EXTENSIBLE};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

use super::types::{AudioError, AudioFormat, CapturedAudio};

const IEEE_FLOAT_SUBTYPE: GUID = GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
const WAVE_FORMAT_IEEE_FLOAT: u32 = 3;
const LOOP_SLEEP: Duration = Duration::from_millis(10);
const BUFFER_DURATION_HNS: i64 = 2_000_000;

#[derive(Debug, Clone, Copy)]
enum SourceSampleType {
    I16,
    I32,
    F32,
}

#[derive(Debug, Clone, Copy)]
struct SourceAudioFormat {
    audio: AudioFormat,
    sample_type: SourceSampleType,
}

struct ComGuard;

impl ComGuard {
    fn initialize() -> Result<Self, AudioError> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|error| AudioError::Wasapi(format!("COM 初始化失败: {error}")))?;
        }

        Ok(Self)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

pub fn capture_default_loopback(
    ready_tx: mpsc::Sender<Result<AudioFormat, AudioError>>,
    stop_rx: mpsc::Receiver<()>,
) -> Result<CapturedAudio, AudioError> {
    let _com = ComGuard::initialize()?;

    let enumerator: IMMDeviceEnumerator = unsafe {
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|error| AudioError::Wasapi(format!("创建设备枚举器失败: {error}")))?
    };

    let device = unsafe {
        enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|_| AudioError::NoDefaultOutputDevice)?
    };

    let audio_client: IAudioClient = unsafe {
        device
            .Activate(CLSCTX_ALL, None)
            .map_err(|error| AudioError::Wasapi(format!("激活音频客户端失败: {error}")))?
    };

    let mix_format_ptr = unsafe {
        audio_client
            .GetMixFormat()
            .map_err(|error| AudioError::Wasapi(format!("读取混音格式失败: {error}")))?
    };

    let source_format = parse_source_format(mix_format_ptr)?;

    let initialize_result = unsafe {
        audio_client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            BUFFER_DURATION_HNS,
            0,
            mix_format_ptr,
            None,
        )
    };

    unsafe {
        CoTaskMemFree(Some(mix_format_ptr.cast()));
    }

    initialize_result
        .map_err(|error| AudioError::Wasapi(format!("初始化 loopback 客户端失败: {error}")))?;

    let capture_client: IAudioCaptureClient = unsafe {
        audio_client
            .GetService()
            .map_err(|error| AudioError::Wasapi(format!("获取捕获服务失败: {error}")))?
    };

    unsafe {
        audio_client
            .Start()
            .map_err(|error| AudioError::Wasapi(format!("启动录音失败: {error}")))?;
    }

    ready_tx
        .send(Ok(source_format.audio))
        .map_err(|error| AudioError::Synchronization(error.to_string()))?;

    let result = capture_packets(&audio_client, &capture_client, source_format, stop_rx);

    unsafe {
        let _ = audio_client.Stop();
    }

    result
}

fn capture_packets(
    _audio_client: &IAudioClient,
    capture_client: &IAudioCaptureClient,
    source_format: SourceAudioFormat,
    stop_rx: mpsc::Receiver<()>,
) -> Result<CapturedAudio, AudioError> {
    let mut samples = Vec::new();

    loop {
        match stop_rx.try_recv() {
            Ok(_) | Err(mpsc::TryRecvError::Disconnected) => break,
            Err(mpsc::TryRecvError::Empty) => {}
        }

        let mut packet_frames = unsafe {
            capture_client
                .GetNextPacketSize()
                .map_err(|error| AudioError::Wasapi(format!("读取包大小失败: {error}")))?
        };

        if packet_frames == 0 {
            thread::sleep(LOOP_SLEEP);
            continue;
        }

        while packet_frames > 0 {
            let mut data_ptr = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;

            unsafe {
                capture_client
                    .GetBuffer(&mut data_ptr, &mut frames, &mut flags, None, None)
                    .map_err(|error| AudioError::Wasapi(format!("读取缓冲区失败: {error}")))?;
            }

            let sample_count = frames as usize * usize::from(source_format.audio.channels);

            if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                samples.extend(std::iter::repeat(0.0).take(sample_count));
            } else {
                append_packet_samples(&mut samples, data_ptr, sample_count, source_format)?;
            }

            unsafe {
                capture_client
                    .ReleaseBuffer(frames)
                    .map_err(|error| AudioError::Wasapi(format!("释放缓冲区失败: {error}")))?;
            }

            packet_frames = unsafe {
                capture_client
                    .GetNextPacketSize()
                    .map_err(|error| AudioError::Wasapi(format!("读取后续包大小失败: {error}")))?
            };
        }
    }

    Ok(CapturedAudio {
        format: source_format.audio,
        samples,
    })
}

fn append_packet_samples(
    target: &mut Vec<f32>,
    data_ptr: *mut u8,
    sample_count: usize,
    source_format: SourceAudioFormat,
) -> Result<(), AudioError> {
    if data_ptr.is_null() {
        return Err(AudioError::Wasapi("捕获缓冲区为空指针".to_string()));
    }

    unsafe {
        match source_format.sample_type {
            SourceSampleType::I16 => {
                let slice = slice::from_raw_parts(data_ptr.cast::<i16>(), sample_count);
                target.extend(slice.iter().map(|sample| *sample as f32 / i16::MAX as f32));
            }
            SourceSampleType::I32 => {
                let slice = slice::from_raw_parts(data_ptr.cast::<i32>(), sample_count);
                target.extend(slice.iter().map(|sample| *sample as f32 / i32::MAX as f32));
            }
            SourceSampleType::F32 => {
                let slice = slice::from_raw_parts(data_ptr.cast::<f32>(), sample_count);
                target.extend_from_slice(slice);
            }
        }
    }

    Ok(())
}

fn parse_source_format(format_ptr: *const WAVEFORMATEX) -> Result<SourceAudioFormat, AudioError> {
    if format_ptr.is_null() {
        return Err(AudioError::UnsupportedFormat("混音格式为空".to_string()));
    }

    let format = unsafe { *format_ptr };

    let sample_type = match u32::from(format.wFormatTag) {
        WAVE_FORMAT_PCM => match format.wBitsPerSample {
            16 => SourceSampleType::I16,
            32 => SourceSampleType::I32,
            bits => {
                return Err(AudioError::UnsupportedFormat(format!(
                    "PCM 位深 {bits} 未支持"
                )))
            }
        },
        WAVE_FORMAT_IEEE_FLOAT => match format.wBitsPerSample {
            32 => SourceSampleType::F32,
            bits => {
                return Err(AudioError::UnsupportedFormat(format!(
                    "浮点位深 {bits} 未支持"
                )))
            }
        },
        WAVE_FORMAT_EXTENSIBLE => {
            let extensible = unsafe { format_ptr.cast::<WAVEFORMATEXTENSIBLE>().read_unaligned() };
            let sub_format = unsafe { std::ptr::addr_of!(extensible.SubFormat).read_unaligned() };
            if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
                match format.wBitsPerSample {
                    16 => SourceSampleType::I16,
                    32 => SourceSampleType::I32,
                    bits => {
                        return Err(AudioError::UnsupportedFormat(format!(
                            "扩展 PCM 位深 {bits} 未支持"
                        )))
                    }
                }
            } else if sub_format == IEEE_FLOAT_SUBTYPE {
                match format.wBitsPerSample {
                    32 => SourceSampleType::F32,
                    bits => {
                        return Err(AudioError::UnsupportedFormat(format!(
                            "扩展浮点位深 {bits} 未支持"
                        )))
                    }
                }
            } else {
                return Err(AudioError::UnsupportedFormat(
                    "当前设备混音子格式未支持".to_string(),
                ));
            }
        }
        tag => {
            return Err(AudioError::UnsupportedFormat(format!(
                "格式标签 {tag} 未支持"
            )))
        }
    };

    Ok(SourceAudioFormat {
        audio: AudioFormat {
            sample_rate: format.nSamplesPerSec,
            channels: format.nChannels,
        },
        sample_type,
    })
}
