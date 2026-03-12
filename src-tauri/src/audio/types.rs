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

#[derive(Debug)]
pub enum AudioError {
    AlreadyRecording,
    NotRecording,
    InitializationTimeout,
    NoDefaultOutputDevice,
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
            Self::UnsupportedFormat(message) => write!(f, "不支持的音频格式: {message}"),
            Self::Synchronization(message) => write!(f, "线程同步失败: {message}"),
            Self::WorkerThread(message) => write!(f, "录音线程失败: {message}"),
            Self::Wasapi(message) => write!(f, "WASAPI 调用失败: {message}"),
            Self::Encoding(message) => write!(f, "音频编码失败: {message}"),
        }
    }
}

impl std::error::Error for AudioError {}
