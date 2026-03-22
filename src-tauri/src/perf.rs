//! 性能埋点模块
//! 
//! 后端统一性能埋点基础设施，用于记录启动链路、截图链路等关键时间点。

use serde::Serialize;
use std::time::Instant;
use std::collections::HashMap;

/// 埋点事件枚举
#[derive(Debug, Clone, Copy, Serialize)]
pub enum PerfEvent {
    // 后端启动链路
    RustSetupStart,
    Layer1StrongDepsStart,
    Layer1StrongDepsDone,
    Layer2EarlyAsyncStart,
    Layer2EarlyAsyncDone,
    LoggingInitDone,
    DatabaseInitDone,
    ProviderRegistryReady,
    DynamicProviderLoadStart,
    DynamicProviderLoadDone,
    
    // 截图链路
    CaptureFullScreenStart,
    CaptureFullScreenDone,
    CropScreenshotStart,
    CropScreenshotDone,
    CancelScreenshotStart,
    CancelScreenshotDone,
}

impl PerfEvent {
    pub fn as_str(&self) -> &'static str {
        match self {
            PerfEvent::RustSetupStart => "rust_setup_start",
            PerfEvent::Layer1StrongDepsStart => "layer1_strong_deps_start",
            PerfEvent::Layer1StrongDepsDone => "layer1_strong_deps_done",
            PerfEvent::Layer2EarlyAsyncStart => "layer2_early_async_start",
            PerfEvent::Layer2EarlyAsyncDone => "layer2_early_async_done",
            PerfEvent::LoggingInitDone => "logging_init_done",
            PerfEvent::DatabaseInitDone => "database_init_done",
            PerfEvent::ProviderRegistryReady => "provider_registry_ready",
            PerfEvent::DynamicProviderLoadStart => "dynamic_provider_load_start",
            PerfEvent::DynamicProviderLoadDone => "dynamic_provider_load_done",
            PerfEvent::CaptureFullScreenStart => "capture_full_screen_start",
            PerfEvent::CaptureFullScreenDone => "capture_full_screen_done",
            PerfEvent::CropScreenshotStart => "crop_screenshot_start",
            PerfEvent::CropScreenshotDone => "crop_screenshot_done",
            PerfEvent::CancelScreenshotStart => "cancel_screenshot_start",
            PerfEvent::CancelScreenshotDone => "cancel_screenshot_done",
        }
    }
}

/// 埋点记录
#[derive(Debug, Clone, Serialize)]
pub struct PerfRecord {
    pub event: String,
    pub elapsed_ms: f64,
    pub metadata: Option<HashMap<String, String>>,
}

/// 性能计时器
pub struct PerfTimer {
    start: Instant,
    event: PerfEvent,
    is_active: bool,
}

impl PerfTimer {
    pub fn new(event: PerfEvent) -> Self {
        Self {
            start: Instant::now(),
            event,
            is_active: true,
        }
    }
    
    /// 获取耗时（毫秒）
    pub fn elapsed_ms(&self) -> f64 {
        self.start.elapsed().as_secs_f64() * 1000.0
    }
    
    /// 停止计时并返回埋点记录
    pub fn finish(self) -> PerfRecord {
        PerfRecord {
            event: self.event.as_str().to_string(),
            elapsed_ms: self.elapsed_ms(),
            metadata: None,
        }
    }
    
    /// 停止计时并返回埋点记录（带元数据）
    pub fn finish_with_metadata(self, metadata: HashMap<String, String>) -> PerfRecord {
        PerfRecord {
            event: self.event.as_str().to_string(),
            elapsed_ms: self.elapsed_ms(),
            metadata: Some(metadata),
        }
    }
    
    /// 取消计时器（不产生记录）
    pub fn cancel(mut self) {
        self.is_active = false;
    }
}

impl Drop for PerfTimer {
    fn drop(&mut self) {
        // 如果计时器仍然激活且被 drop，则自动记录
        // （这主要是为了安全，但在 PerfTimer 中我们使用 finish() 明确记录）
    }
}

/// 全局性能记录器
static PERF_RECORDS: std::sync::OnceLock<PerfRecorder> = std::sync::OnceLock::new();

/// 性能记录器
#[derive(Debug)]
pub struct PerfRecorder {
    records: std::sync::Mutex<Vec<PerfRecord>>,
}

impl PerfRecorder {
    pub fn new() -> Self {
        Self {
            records: std::sync::Mutex::new(Vec::new()),
        }
    }
    
    pub fn add_record(&self, record: PerfRecord) {
        if let Ok(mut records) = self.records.lock() {
            records.push(record);
        }
    }
    
    pub fn get_records(&self) -> Vec<PerfRecord> {
        self.records.lock().map(|r| r.clone()).unwrap_or_default()
    }
    
    pub fn clear(&self) {
        if let Ok(mut records) = self.records.lock() {
            records.clear();
        }
    }
}

fn get_recorder() -> &'static PerfRecorder {
    PERF_RECORDS.get_or_init(|| PerfRecorder::new())
}

/// 记录性能事件
pub fn record(event: PerfEvent) -> PerfRecord {
    let timer = PerfTimer::new(event);
    let record = timer.finish();
    get_recorder().add_record(record.clone());
    tracing::debug!(event = record.event, elapsed_ms = record.elapsed_ms, "[PERF]");
    record
}

/// 记录性能事件（带计时器）
pub fn record_with_timer(event: PerfEvent) -> PerfTimer {
    PerfTimer::new(event)
}

/// 获取所有性能记录
pub fn get_all_records() -> Vec<PerfRecord> {
    get_recorder().get_records()
}

/// 清除所有性能记录
pub fn clear_all_records() {
    get_recorder().clear();
}

/// 便捷函数：记录截图捕获开始
pub fn perf_capture_start() -> PerfTimer {
    PerfTimer::new(PerfEvent::CaptureFullScreenStart)
}

/// 便捷函数：记录截图捕获完成
pub fn perf_capture_done() {
    record(PerfEvent::CaptureFullScreenDone);
}

/// 便捷函数：记录截图裁剪开始
pub fn perf_crop_start() -> PerfTimer {
    PerfTimer::new(PerfEvent::CropScreenshotStart)
}

/// 便捷函数：记录截图裁剪完成
pub fn perf_crop_done() {
    record(PerfEvent::CropScreenshotDone);
}

/// 便捷函数：记录截图取消开始
pub fn perf_cancel_start() -> PerfTimer {
    PerfTimer::new(PerfEvent::CancelScreenshotStart)
}

/// 便捷函数：记录截图取消完成
pub fn perf_cancel_done() {
    record(PerfEvent::CancelScreenshotDone);
}

/// 便捷函数：记录后端启动开始
pub fn perf_setup_start() -> PerfTimer {
    PerfTimer::new(PerfEvent::RustSetupStart)
}

/// 便捷函数：记录第一层强依赖初始化开始
pub fn perf_layer1_start() -> PerfTimer {
    PerfTimer::new(PerfEvent::Layer1StrongDepsStart)
}

/// 便捷函数：记录第一层强依赖初始化完成
pub fn perf_layer1_done() {
    record(PerfEvent::Layer1StrongDepsDone);
}

/// 便捷函数：记录第二层早期异步初始化开始
pub fn perf_layer2_start() -> PerfTimer {
    PerfTimer::new(PerfEvent::Layer2EarlyAsyncStart)
}

/// 便捷函数：记录第二层早期异步初始化完成
pub fn perf_layer2_done() {
    record(PerfEvent::Layer2EarlyAsyncDone);
}

/// 便捷函数：记录日志初始化完成
pub fn perf_logging_done() {
    record(PerfEvent::LoggingInitDone);
}

/// 便捷函数：记录数据库初始化完成
pub fn perf_database_done() {
    record(PerfEvent::DatabaseInitDone);
}

/// 便捷函数：记录 Provider 注册表就绪
pub fn perf_provider_registry_ready() {
    record(PerfEvent::ProviderRegistryReady);
}

/// 便捷函数：记录动态 Provider 加载开始
pub fn perf_dynamic_provider_start() -> PerfTimer {
    PerfTimer::new(PerfEvent::DynamicProviderLoadStart)
}

/// 便捷函数：记录动态 Provider 加载完成
pub fn perf_dynamic_provider_done() {
    record(PerfEvent::DynamicProviderLoadDone);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_perf_timer() {
        let timer = PerfTimer::new(PerfEvent::CaptureFullScreenStart);
        std::thread::sleep(std::time::Duration::from_millis(10));
        let record = timer.finish();
        
        assert_eq!(record.event, "capture_full_screen_start");
        assert!(record.elapsed_ms >= 10.0);
    }

    #[test]
    fn test_perf_record() {
        clear_all_records();
        let _ = record(PerfEvent::LoggingInitDone);
        let records = get_all_records();
        
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].event, "logging_init_done");
    }
}
