// Windows SAPI TTS 语音合成模块
// 使用 ISpVoice COM 接口实现离线语音朗读，无需网络请求
// 每条 TTS 请求在独立线程中执行，通过全局 AtomicBool 控制停止

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

use windows::core::GUID;
use windows::Win32::Media::Speech::{ISpVoice, SPF_ASYNC, SPF_PURGEBEFORESPEAK};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

// SpVoice CLSID: {96749377-3391-11D2-9EE3-00C04F797396}
const CLSID_SPVOICE: GUID = GUID::from_u128(0x96749377_3391_11d2_9ee3_00c04f797396);

// 取消标志：设为 false 时朗读线程应停止
static TTS_ACTIVE: AtomicBool = AtomicBool::new(false);

/// COM 初始化 RAII guard
struct ComGuard;

impl ComGuard {
    fn initialize() -> Result<Self, String> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|error| format!("CoInitializeEx 失敗: {error}"))?;
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

fn speak_internal(text: &str, rate: i32, volume: u16) -> Result<(), String> {
    let _com = ComGuard::initialize()?;

    // 通过 CoCreateInstance 创建 ISpVoice COM 对象
    let voice: ISpVoice = unsafe {
        CoCreateInstance(&CLSID_SPVOICE, None, CLSCTX_ALL)
            .map_err(|e| format!("创建 SpVoice 失敗: {e:?}"))?
    };

    // 设置语速 -10..10，默认 +2 稍快适合面试场景
    let clamped_rate = rate.clamp(-10, 10);
    unsafe {
        voice
            .SetRate(clamped_rate)
            .map_err(|e| format!("设置语速失敗: {e:?}"))?;
    }

    // 设置音量 0..100
    let clamped_vol = volume.clamp(0, 100) as u16;
    unsafe {
        voice
            .SetVolume(clamped_vol)
            .map_err(|e| format!("设置音量失敗: {e:?}"))?;
    }

    // 转换为 null-terminated UTF-16 宽字符串
    let wide_text: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();

    // 异步朗读，立即返回
    unsafe {
        voice
            .Speak(
                windows::core::PCWSTR::from_raw(wide_text.as_ptr()),
                SPF_ASYNC.0 as u32,
                None,
            )
            .map_err(|e| format!("朗读失敗: {e:?}"))?;
    }

    // 轮询等待朗读完成或被取消
    loop {
        if !TTS_ACTIVE.load(Ordering::Relaxed) {
            // 停止朗读：purge 当前缓冲区
            unsafe {
                voice
                    .Speak(
                        windows::core::PCWSTR::null(),
                        SPF_PURGEBEFORESPEAK.0 as u32,
                        None,
                    )
                    .ok();
            }
            return Ok(());
        }

        // 检查朗读状态，GetStatus 失败表示朗读已完成
        let status = unsafe { voice.GetStatus(std::ptr::null_mut(), std::ptr::null_mut()) };
        if status.is_err() {
            return Ok(());
        }

        thread::sleep(std::time::Duration::from_millis(80));
    }
}

/// SAPI 语音合成，在独立线程中异步执行
/// rate: 语速 -10(慢) 到 10(快)，默认 2
/// volume: 音量 0-100，默认 100
pub fn speak_sapi(text: String, rate: i32, volume: u16) -> Result<(), String> {
    // 先停止之前的朗读
    TTS_ACTIVE.store(false, Ordering::SeqCst);
    thread::sleep(std::time::Duration::from_millis(50));

    TTS_ACTIVE.store(true, Ordering::SeqCst);

    thread::spawn(move || {
        if let Err(e) = speak_internal(&text, rate, volume) {
            tracing::error!(error = %e, "TTS 朗读错误");
        }
        TTS_ACTIVE.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// 停止当前 TTS 朗读
pub fn stop_sapi() -> Result<(), String> {
    TTS_ACTIVE.store(false, Ordering::SeqCst);
    Ok(())
}

/// 检查是否正在朗读
pub fn is_speaking() -> bool {
    TTS_ACTIVE.load(Ordering::Relaxed)
}
