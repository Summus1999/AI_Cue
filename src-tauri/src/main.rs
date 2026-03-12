// AI Cue - Tauri 主入口
// 极简冰川主题桌面应用

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ai_cue_lib::run();
}
