// 日志系统 - 基于 tracing crate 的统一日志管理

use std::path::PathBuf;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// 日志配置
#[derive(Debug, Clone)]
pub struct LogConfig {
    /// 日志目录
    pub log_dir: PathBuf,
    /// 最低日志级别
    pub level: LogLevel,
    /// 是否输出到控制台
    pub console_output: bool,
    /// 是否启用 JSON 格式
    pub json_format: bool,
}

#[derive(Debug, Clone, Copy)]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            log_dir: PathBuf::from("logs"),
            level: LogLevel::Info,
            console_output: cfg!(debug_assertions),
            json_format: false,
        }
    }
}

impl LogLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Trace => "trace",
            LogLevel::Debug => "debug",
            LogLevel::Info => "info",
            LogLevel::Warn => "warn",
            LogLevel::Error => "error",
        }
    }
}

/// 日志守护（保持 non-blocking writer 存活）
pub struct LogGuard {
    _guard: tracing_appender::non_blocking::WorkerGuard,
}

/// 初始化日志系统
pub fn init_logging(config: LogConfig) -> Result<LogGuard, String> {
    // 确保日志目录存在
    std::fs::create_dir_all(&config.log_dir).map_err(|e| format!("创建日志目录失败: {}", e))?;

    // 文件输出（按日轮转）
    let file_appender = RollingFileAppender::new(Rotation::DAILY, &config.log_dir, "ai-cue.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    // 构建过滤器
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("ai_cue={}", config.level.as_str())));

    // 文件层
    let file_layer = fmt::layer()
        .json()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true);

    // 控制台层（仅开发环境）
    let console_layer = if config.console_output {
        Some(
            fmt::layer()
                .with_target(true)
                .with_thread_ids(false)
                .pretty(),
        )
    } else {
        None
    };

    // 组合并初始化
    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer);

    if let Some(layer) = console_layer {
        registry.with(layer).init();
    } else {
        registry.init();
    }

    tracing::info!(
        log_dir = %config.log_dir.display(),
        level = config.level.as_str(),
        "日志系统初始化完成"
    );

    Ok(LogGuard { _guard: guard })
}

/// 敏感信息过滤器
pub fn sanitize_log_value(value: &str) -> String {
    // API Key 脱敏 (sk- 开头)
    let sanitized = regex::Regex::new(r"(sk-|Bearer\s+)[a-zA-Z0-9]{20,}")
        .map(|re| re.replace_all(value, "$1[REDACTED]").to_string())
        .unwrap_or_else(|_| value.to_string());

    // 密码脱敏
    let sanitized = regex::Regex::new(r#"("password"\s*:\s*")[^"]+""#)
        .map(|re| re.replace_all(&sanitized, r#"$1[REDACTED]""#).to_string())
        .unwrap_or(sanitized);

    // X-API-Key 脱敏
    let sanitized = regex::Regex::new(r#"("api[_-]?key"\s*[:=]\s*")[^"]+""#)
        .map(|re| re.replace_all(&sanitized, r#"$1[REDACTED]""#).to_string())
        .unwrap_or(sanitized);

    sanitized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_api_key() {
        let input = "Bearer sk-1234567890abcdefghij";
        let sanitized = sanitize_log_value(input);
        assert!(sanitized.contains("[REDACTED]"));
        assert!(!sanitized.contains("sk-1234567890abcdefghij"));
    }

    #[test]
    fn test_sanitize_password() {
        let input = r#"{"password": "secret123"}"#;
        let sanitized = sanitize_log_value(input);
        assert!(sanitized.contains("[REDACTED]"));
        assert!(!sanitized.contains("secret123"));
    }
}
