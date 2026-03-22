use screenshots::image::ImageFormat;
use screenshots::Screen;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

use crate::perf;

const MIN_SELECTION_SIZE: u32 = 80;
const ACTIVE_SOURCE_FILE: &str = "active-main-screen.png";
const LATEST_DEBUG_FILE: &str = "latest-screenshot.png";

// 内存传输分辨率阈值
const MEMORY_THRESHOLD_WIDTH: u32 = 2560;
const MEMORY_THRESHOLD_HEIGHT: u32 = 1440;

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

// 预览数据结构 - 用于内存优先传输
#[derive(Debug, Serialize)]
pub struct PreviewData {
    pub capture_id: String,
    pub logical_width: u32,
    pub logical_height: u32,
    pub physical_width: u32,
    pub physical_height: u32,
    pub transport_type: String,  // "memory" 或 "disk"
    pub payload_ref: String,    // 内存传输：Base64；磁盘传输：文件路径
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
    let timer = perf::perf_capture_start();
    
    let screen = primary_screen()?;
    let image = screen.capture().map_err(|e| format!("截图失败: {}", e))?;
    let source_path = active_source_path()?;

    image
        .save(&source_path)
        .map_err(|e| format!("保存截图失败: {}", e))?;

    // 获取显示信息
    let logical_width = image.width();
    let logical_height = image.height();
    
    // 记录截图完成
    let mut metadata = HashMap::new();
    metadata.insert("logical_width".to_string(), logical_width.to_string());
    metadata.insert("logical_height".to_string(), logical_height.to_string());
    let record = timer.finish_with_metadata(metadata);
    tracing::debug!(
        event = record.event.as_str(),
        elapsed_ms = record.elapsed_ms,
        logical_width = logical_width,
        logical_height = logical_height,
        "[PERF] capture_full_screen"
    );
    perf::perf_capture_done();

    Ok(ScreenCaptureResult {
        source_path: source_path.to_string_lossy().to_string(),
        screen_x: 0,
        screen_y: 0,
        logical_width,
        logical_height,
        physical_width: logical_width,
        physical_height: logical_height,
    })
}

/// 执行截图并返回预览数据（内存优先策略）
#[tauri::command]
pub fn capture_with_preview() -> Result<PreviewData, String> {
    let timer = perf::perf_capture_start();
    
    let screen = primary_screen()?;
    let image = screen.capture().map_err(|e| format!("截图失败: {}", e))?;
    
    let logical_width = image.width();
    let logical_height = image.height();
    
    // 生成唯一 ID 用于追踪
    let capture_id = uuid::Uuid::new_v4().to_string();
    
    // 判断是否使用内存传输
    let use_memory = logical_width <= MEMORY_THRESHOLD_WIDTH 
        && logical_height <= MEMORY_THRESHOLD_HEIGHT;
    
    let (transport_type, payload_ref) = if use_memory {
        // 内存传输：将图片编码为 Base64
        let mut buffer = Vec::new();
        image.write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
            .map_err(|e| format!("编码图片失败: {}", e))?;
        let base64_data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buffer);
        ("memory".to_string(), base64_data)
    } else {
        // 磁盘传输：保存到临时文件
        let source_path = active_source_path()?;
        image.save(&source_path)
            .map_err(|e| format!("保存截图失败: {}", e))?;
        ("disk".to_string(), source_path.to_string_lossy().to_string())
    };
    
    // 记录截图完成
    let mut metadata = HashMap::new();
    metadata.insert("logical_width".to_string(), logical_width.to_string());
    metadata.insert("logical_height".to_string(), logical_height.to_string());
    metadata.insert("transport_type".to_string(), transport_type.clone());
    let record = timer.finish_with_metadata(metadata);
    tracing::debug!(
        event = record.event.as_str(),
        elapsed_ms = record.elapsed_ms,
        logical_width = logical_width,
        logical_height = logical_height,
        transport_type = transport_type,
        "[PERF] capture_with_preview"
    );
    perf::perf_capture_done();
    
    Ok(PreviewData {
        capture_id,
        logical_width,
        logical_height,
        physical_width: logical_width,
        physical_height: logical_height,
        transport_type,
        payload_ref,
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
    let timer = perf::perf_crop_start();
    
    if width < MIN_SELECTION_SIZE || height < MIN_SELECTION_SIZE {
        return Err(format!(
            "选区太小，请至少选择 {}x{} 像素的区域",
            MIN_SELECTION_SIZE, MIN_SELECTION_SIZE
        ));
    }

    let source = PathBuf::from(&source_path);
    let img = screenshots::image::open(&source).map_err(|e| format!("打开图片失败: {}", e))?;
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

    // 记录裁剪完成
    let record = timer.finish();
    tracing::debug!(
        event = record.event,
        elapsed_ms = record.elapsed_ms,
        crop_x = x,
        crop_y = y,
        crop_width = crop_width,
        crop_height = crop_height,
        "[PERF] crop_screenshot"
    );
    perf::perf_crop_done();

    Ok(CropScreenshotResult {
        image_data: buffer,
        debug_path: debug_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn cancel_screenshot(source_path: String) -> Result<(), String> {
    let _timer = perf::perf_cancel_start();
    let path = PathBuf::from(source_path);
    if !path.exists() {
        perf::perf_cancel_done();
        return Ok(());
    }

    fs::remove_file(path).map_err(|e| format!("清理临时文件失败: {}", e))?;
    perf::perf_cancel_done();
    Ok(())
}
