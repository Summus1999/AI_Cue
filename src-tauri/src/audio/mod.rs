mod recorder;
mod types;
#[cfg(target_os = "windows")]
mod windows_wasapi;

use std::io::Cursor;

use hound::{WavSpec, WavWriter};

#[cfg(test)]
pub(crate) use types::AudioFormat;
pub(crate) use types::{AudioError, CapturedAudio};

const TARGET_SAMPLE_RATE: u32 = 16_000;
const TARGET_CHANNELS: u16 = 1;

pub fn start_recording() -> Result<(), String> {
    recorder::start_recording().map_err(|error| error.to_string())
}

pub fn stop_recording() -> Result<Vec<u8>, String> {
    let captured = recorder::stop_recording().map_err(|error| error.to_string())?;

    encode_captured_audio_to_wav(&captured).map_err(|error| error.to_string())
}

fn encode_captured_audio_to_wav(_captured: &CapturedAudio) -> Result<Vec<u8>, AudioError> {
    let samples = to_mono_pcm16_16khz(_captured)?;
    let spec = WavSpec {
        channels: TARGET_CHANNELS,
        sample_rate: TARGET_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = WavWriter::new(&mut cursor, spec)
            .map_err(|error| AudioError::Encoding(error.to_string()))?;
        for sample in samples {
            writer
                .write_sample(sample)
                .map_err(|error| AudioError::Encoding(error.to_string()))?;
        }
        writer
            .finalize()
            .map_err(|error| AudioError::Encoding(error.to_string()))?;
    }

    Ok(cursor.into_inner())
}

fn to_mono_pcm16_16khz(captured: &CapturedAudio) -> Result<Vec<i16>, AudioError> {
    if captured.format.channels == 0 {
        return Err(AudioError::UnsupportedFormat("声道数不能为 0".to_string()));
    }
    if captured.format.sample_rate == 0 {
        return Err(AudioError::UnsupportedFormat("采样率不能为 0".to_string()));
    }

    let channels = usize::from(captured.format.channels);
    if captured.samples.len() % channels != 0 {
        return Err(AudioError::UnsupportedFormat(
            "输入样本数量与声道数不匹配".to_string(),
        ));
    }

    let mono_samples = captured
        .samples
        .chunks_exact(channels)
        .map(|frame| frame.iter().copied().sum::<f32>() / channels as f32)
        .collect::<Vec<_>>();

    let resampled = resample_to_target_rate(&mono_samples, captured.format.sample_rate);

    Ok(resampled.into_iter().map(clamp_to_pcm16).collect())
}

fn resample_to_target_rate(samples: &[f32], sample_rate: u32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    if sample_rate == TARGET_SAMPLE_RATE {
        return samples.to_vec();
    }

    let target_len =
        ((samples.len() as u64 * TARGET_SAMPLE_RATE as u64) / sample_rate as u64).max(1) as usize;
    let step = sample_rate as f64 / TARGET_SAMPLE_RATE as f64;

    (0..target_len)
        .map(|index| {
            let position = index as f64 * step;
            let left = position.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let fraction = (position - left as f64) as f32;
            let left_sample = samples[left];
            let right_sample = samples[right];
            left_sample + (right_sample - left_sample) * fraction
        })
        .collect()
}

fn clamp_to_pcm16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    (clamped * i16::MAX as f32).round() as i16
}

#[cfg(test)]
mod tests {
    use super::*;
    use hound::{SampleFormat, WavReader};

    fn stereo_capture_48khz() -> CapturedAudio {
        CapturedAudio {
            format: AudioFormat {
                sample_rate: 48_000,
                channels: 2,
            },
            samples: (0..480)
                .flat_map(|index| {
                    let left = index as f32 / 480.0;
                    let right = left * 0.5;
                    [left, right]
                })
                .collect(),
        }
    }

    #[test]
    fn converts_stereo_48khz_capture_to_mono_pcm16_16khz() {
        let pcm = to_mono_pcm16_16khz(&stereo_capture_48khz()).expect("conversion should succeed");

        assert_eq!(pcm.len(), 160);
        assert!(pcm.iter().any(|sample| *sample != 0));
    }

    #[test]
    fn encodes_capture_as_wav_with_target_format() {
        let wav_bytes = encode_captured_audio_to_wav(&stereo_capture_48khz())
            .expect("wav encoding should succeed");

        let mut reader = WavReader::new(Cursor::new(wav_bytes)).expect("wav should be readable");
        let spec = reader.spec();
        let samples = reader
            .samples::<i16>()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(spec.channels, TARGET_CHANNELS);
        assert_eq!(spec.sample_rate, TARGET_SAMPLE_RATE);
        assert_eq!(spec.bits_per_sample, 16);
        assert_eq!(spec.sample_format, SampleFormat::Int);
        assert_eq!(samples.len(), 160);
    }
}
