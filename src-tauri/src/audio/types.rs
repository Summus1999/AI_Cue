use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecorderState {
    Idle,
    Starting,
    Recording,
    Stopping,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioFormat {
    pub sample_rate: u32,
    pub channels: u16,
}

#[derive(Debug, Clone)]
pub struct CapturedAudio {
    pub format: AudioFormat,
    pub samples: Vec<f32>,
}

/// 音频电平事件，用于前端波形可视化
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AudioLevelEvent {
    /// RMS 音量值（0.0 ~ 1.0）
    pub rms: f32,
    /// 峰值（0.0 ~ 1.0）
    pub peak: f32,
    /// 波形采样点（降采样后，约 64 个点）
    pub waveform: Vec<f32>,
    /// 时间戳（毫秒）
    pub timestamp: u64,
    /// 音频源标识 ("microphone" | "system")
    pub source: String,
}

impl AudioLevelEvent {
    /// 从原始样本创建事件
    pub fn from_samples(samples: &[f32], source: &str, target_points: usize) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        // 计算 RMS
        let rms = if samples.is_empty() {
            0.0
        } else {
            let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
            (sum_sq / samples.len() as f32).sqrt().min(1.0)
        };

        // 计算 Peak
        let peak = samples
            .iter()
            .map(|s| s.abs())
            .fold(0.0f32, f32::max)
            .min(1.0);

        // 降采样生成波形点
        let waveform = Self::downsample(samples, target_points);

        Self {
            rms,
            peak,
            waveform,
            timestamp,
            source: source.to_string(),
        }
    }

    /// 降采样算法：将原始样本压缩到目标点数
    fn downsample(samples: &[f32], target_points: usize) -> Vec<f32> {
        if samples.is_empty() || target_points == 0 {
            return vec![0.0; target_points];
        }

        let chunk_size = (samples.len() / target_points).max(1);
        let mut result = Vec::with_capacity(target_points);

        for chunk in samples.chunks(chunk_size) {
            // 使用 RMS 作为该区间的代表值
            let sum_sq: f32 = chunk.iter().map(|s| s * s).sum();
            let rms = (sum_sq / chunk.len() as f32).sqrt();
            result.push(rms.min(1.0));
        }

        // 填充不足的部分
        while result.len() < target_points {
            result.push(0.0);
        }

        result.truncate(target_points);
        result
    }
}

#[derive(Debug)]
pub enum AudioError {
    AlreadyRecording,
    NotRecording,
    InitializationTimeout,
    NoDefaultOutputDevice,
    NoDefaultInputDevice,
    UnsupportedFormat(String),
    Synchronization(String),
    WorkerThread(String),
    Wasapi(String),
    Encoding(String),
}

impl Display for AudioError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyRecording => write!(f, "当前正在录音，请勿重复开始"),
            Self::NotRecording => write!(f, "当前未在录音"),
            Self::InitializationTimeout => write!(f, "录音初始化超时"),
            Self::NoDefaultOutputDevice => write!(f, "未找到默认播放设备"),
            Self::NoDefaultInputDevice => write!(f, "未找到默认麦克风设备"),
            Self::UnsupportedFormat(message) => write!(f, "不支持的音频格式: {message}"),
            Self::Synchronization(message) => write!(f, "线程同步失败: {message}"),
            Self::WorkerThread(message) => write!(f, "录音线程失败: {message}"),
            Self::Wasapi(message) => write!(f, "WASAPI 调用失败: {message}"),
            Self::Encoding(message) => write!(f, "音频编码失败: {message}"),
        }
    }
}

impl std::error::Error for AudioError {}
