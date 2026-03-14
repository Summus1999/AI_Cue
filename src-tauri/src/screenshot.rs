use image::ImageFormat;
use screenshots::Screen;
use serde::Serialize;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

const MIN_SELECTION_SIZE: u32 = 80;
const ACTIVE_SOURCE_FILE: &str = "active-main-screen.png";
const LATEST_DEBUG_FILE: &str = "latest-screenshot.png";

#[derive(Debug, Serialize)]
pub struct ScreenCaptureResult {
    source_path: String,
    screen_x: i32,
    screen_y: i32,
    logical_width: u32,
    logical_height: u32,
    physical_width: u32,
    physical_height: u32,
}

#[derive(Debug, Serialize)]
pub struct CropScreenshotResult {
    image_data: Vec<u8>,
    debug_path: String,
}

fn screenshot_temp_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("ai_cue");
    fs::create_dir_all(&dir).map_err(|e| format!("创建截图目录失败: {}", e))?;
    Ok(dir)
}

fn active_source_path() -> Result<PathBuf, String> {
    Ok(screenshot_temp_dir()?.join(ACTIVE_SOURCE_FILE))
}

fn latest_debug_path() -> Result<PathBuf, String> {
    Ok(screenshot_temp_dir()?.join(LATEST_DEBUG_FILE))
}

fn primary_screen() -> Result<Screen, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;
    screens
        .into_iter()
        .find(|screen| screen.display_info.is_primary)
        .or_else(|| Screen::all().ok()?.into_iter().next())
        .ok_or_else(|| "未找到主屏幕".to_string())
}

#[tauri::command]
pub fn capture_full_screen() -> Result<ScreenCaptureResult, String> {
    let screen = primary_screen()?;
    let display = screen.display_info;
    let image = screen.capture().map_err(|e| format!("截图失败: {}", e))?;
    let source_path = active_source_path()?;

    image
        .save(&source_path)
        .map_err(|e| format!("保存截图失败: {}", e))?;

    Ok(ScreenCaptureResult {
        source_path: source_path.to_string_lossy().to_string(),
        screen_x: display.x,
        screen_y: display.y,
        logical_width: display.width,
        logical_height: display.height,
        physical_width: image.width(),
        physical_height: image.height(),
    })
}

#[tauri::command]
pub fn crop_screenshot(
    source_path: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<CropScreenshotResult, String> {
    if width < MIN_SELECTION_SIZE || height < MIN_SELECTION_SIZE {
        return Err(format!(
            "选区太小，请至少选择 {}x{} 像素的区域",
            MIN_SELECTION_SIZE, MIN_SELECTION_SIZE
        ));
    }

    let source = PathBuf::from(&source_path);
    let img = image::open(&source).map_err(|e| format!("打开图片失败: {}", e))?;
    let img_width = img.width();
    let img_height = img.height();

    if x >= img_width || y >= img_height {
        return Err("选区起点超出截图范围".to_string());
    }

    let crop_width = width.min(img_width - x);
    let crop_height = height.min(img_height - y);
    if crop_width < MIN_SELECTION_SIZE || crop_height < MIN_SELECTION_SIZE {
        return Err(format!(
            "选区太小，请至少选择 {}x{} 像素的区域",
            MIN_SELECTION_SIZE, MIN_SELECTION_SIZE
        ));
    }

    let cropped = img.crop_imm(x, y, crop_width, crop_height);

    let debug_path = latest_debug_path()?;
    cropped
        .save(&debug_path)
        .map_err(|e| format!("保存调试截图失败: {}", e))?;

    let mut buffer = Vec::new();
    cropped
        .write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
        .map_err(|e| format!("编码图片失败: {}", e))?;

    let _ = fs::remove_file(source);

    Ok(CropScreenshotResult {
        image_data: buffer,
        debug_path: debug_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn cancel_screenshot(source_path: String) -> Result<(), String> {
    let path = PathBuf::from(source_path);
    if !path.exists() {
        return Ok(());
    }

    fs::remove_file(path).map_err(|e| format!("清理临时文件失败: {}", e))
}
