// 屏幕捕获检测模块
// 通过进程名检测已知会议/录屏软件是否在运行，并支持运行时切换 contentProtected

use once_cell::sync::Lazy;
use std::sync::Mutex;
use sysinfo::{ProcessesToUpdate, System};

use windows::core::PCWSTR;
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetWindowDisplayAffinity, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    WDA_NONE,
};

// 已知的会议/录屏软件进程名（小写比较）
const CAPTURE_PROCESS_NAMES: &[&str] = &[
    "meetingscreenshare", // 腾讯会议屏幕共享
    "wemeetapp",          // 腾讯会议
    "zoom",               // Zoom
    "feishu",             // 飞书
    "lark",               // 飞书国际版
    "dingtalk",           // 钉钉
    "teams",              // Microsoft Teams
    "obs64",              // OBS Studio 64-bit
    "obs32",              // OBS Studio 32-bit
    "vstudio",            // VMware
    "vmware",             // VMware
    "virtualbox",         // VirtualBox
];

static SYS_INFO: Lazy<Mutex<System>> = Lazy::new(|| Mutex::new(System::new_all()));

/// 检测当前是否有已知的会议/录屏软件在运行
pub fn detect_capture_processes() -> Vec<String> {
    let mut found = Vec::new();

    if let Ok(mut sys) = SYS_INFO.lock() {
        sys.refresh_processes(ProcessesToUpdate::All, true);

        for process in sys.processes().values() {
            let name = process.name().to_string_lossy().to_lowercase();
            for known in CAPTURE_PROCESS_NAMES {
                if name == *known {
                    if !found.iter().any(|n: &String| n == known) {
                        found.push(known.to_string());
                    }
                }
            }
        }
    }

    found
}

/// 获取当前 Tauri 窗口的 HWND
fn get_tauri_hwnd(window_title: &str) -> Result<windows::Win32::Foundation::HWND, String> {
    let title_wide: Vec<u16> = window_title
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let result = unsafe { FindWindowW(PCWSTR::null(), PCWSTR::from_raw(title_wide.as_ptr())) };

    match result {
        Ok(hwnd) if !hwnd.0.is_null() => Ok(hwnd),
        Ok(_) => Err("找不到 AI Cue 窗口".to_string()),
        Err(e) => Err(format!("FindWindowW 失败: {e:?}")),
    }
}

/// 运行时切换 contentProtected（防屏幕捕获）
/// 依赖 Windows 10 2004+ 的 SetWindowDisplayAffinity API
pub fn set_content_protected(window_title: &str, enabled: bool) -> Result<(), String> {
    let hwnd = get_tauri_hwnd(window_title)?;

    let affinity = if enabled {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };

    unsafe {
        SetWindowDisplayAffinity(hwnd, affinity)
            .map_err(|e| format!("SetWindowDisplayAffinity 失败: {e:?}"))?;
    }

    Ok(())
}

/// 查询当前 contentProtected 状态
pub fn is_content_protected(window_title: &str) -> Result<bool, String> {
    let hwnd = get_tauri_hwnd(window_title)?;

    let mut affinity: u32 = 0;
    unsafe {
        GetWindowDisplayAffinity(hwnd, &mut affinity)
            .map_err(|e| format!("GetWindowDisplayAffinity 失败: {e:?}"))?;
    }

    Ok(affinity == WDA_EXCLUDEFROMCAPTURE.0 as u32)
}
