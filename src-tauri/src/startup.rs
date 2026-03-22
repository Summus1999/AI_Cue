//! 后端启动管理模块
//!
//! 统一管理后端初始化阶段和启动时序，支持分层初始化策略：
//! - 第一层：强依赖初始化（日志、数据库、命令注册）
//! - 第二层：早期异步初始化（Provider 注册表、动态 Provider 加载）
//! - 第三层：惰性初始化（诊断能力、导出辅助）

use serde::Serialize;
use std::sync::Mutex;

/// 启动阶段状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupStage {
    /// 尚未开始
    Idle,
    /// 第一层：强依赖初始化中
    Layer1StrongDeps,
    /// 第一层：强依赖初始化完成
    Layer1Done,
    /// 第二层：早期异步初始化中
    Layer2EarlyAsync,
    /// 第二层：早期异步初始化完成
    Layer2Done,
    /// 第三层：惰性初始化中
    Layer3Lazy,
    /// 全部初始化完成
    Complete,
}

impl StartupStage {
    pub fn as_str(&self) -> &'static str {
        match self {
            StartupStage::Idle => "idle",
            StartupStage::Layer1StrongDeps => "layer1_strong_deps",
            StartupStage::Layer1Done => "layer1_done",
            StartupStage::Layer2EarlyAsync => "layer2_early_async",
            StartupStage::Layer2Done => "layer2_done",
            StartupStage::Layer3Lazy => "layer3_lazy",
            StartupStage::Complete => "complete",
        }
    }
}

impl Default for StartupStage {
    fn default() -> Self {
        StartupStage::Idle
    }
}

/// 动态 Provider 加载状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderLoadState {
    /// 尚未开始加载
    Idle,
    /// 正在异步加载
    Loading,
    /// 已完成加载
    Ready,
    /// 加载失败但主流程可用
    Degraded,
}

impl ProviderLoadState {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderLoadState::Idle => "idle",
            ProviderLoadState::Loading => "loading",
            ProviderLoadState::Ready => "ready",
            ProviderLoadState::Degraded => "degraded",
        }
    }
}

impl Default for ProviderLoadState {
    fn default() -> Self {
        ProviderLoadState::Idle
    }
}

/// 启动状态快照
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StartupState {
    /// 当前启动阶段
    #[serde(default)]
    pub stage: StartupStage,
    /// 动态 Provider 加载状态
    #[serde(default)]
    pub provider_load_state: ProviderLoadState,
    /// Provider 加载失败次数
    #[serde(default)]
    pub provider_load_failures: u32,
    /// 是否已完成首屏关键初始化
    #[serde(default)]
    pub first_screen_ready: bool,
    /// 错误信息（如果有）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 启动状态管理器（同步版本，用于 Tauri setup）
pub struct StartupManager {
    state: Mutex<StartupState>,
}

impl Clone for StartupManager {
    fn clone(&self) -> Self {
        let state_clone = self.get_state();
        Self {
            state: Mutex::new(state_clone),
        }
    }
}

impl StartupManager {
    /// 创建新的启动管理器
    pub fn new() -> Self {
        Self {
            state: Mutex::new(StartupState::default()),
        }
    }

    /// 获取当前状态快照（同步）
    pub fn get_state(&self) -> StartupState {
        self.state.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// 更新启动阶段（同步）
    pub fn set_stage(&self, stage: StartupStage) {
        if let Ok(mut state) = self.state.lock() {
            state.stage = stage;
            // 首屏就绪判断：当第一层完成后，首屏即可呈现
            if stage == StartupStage::Layer1Done {
                state.first_screen_ready = true;
            }
        }
    }

    /// 更新 Provider 加载状态（同步）
    pub fn set_provider_load_state(&self, load_state: ProviderLoadState) {
        if let Ok(mut state) = self.state.lock() {
            state.provider_load_state = load_state;
            // 失败时增加计数
            if load_state == ProviderLoadState::Degraded {
                state.provider_load_failures += 1;
            }
        }
    }

    /// 记录错误（同步）
    pub fn set_error(&self, error: String) {
        if let Ok(mut state) = self.state.lock() {
            state.error = Some(error);
        }
    }

    /// 清除错误（同步）
    pub fn clear_error(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.error = None;
        }
    }

    /// 检查是否可以继续初始化（同步）
    pub fn can_continue(&self) -> bool {
        if let Ok(state) = self.state.lock() {
            // 首屏关键路径不应被 Provider 加载失败阻塞
            return state.first_screen_ready || state.stage == StartupStage::Idle;
        }
        false
    }

    /// 获取 Provider 加载状态（同步）
    pub fn get_provider_load_state(&self) -> ProviderLoadState {
        self.state.lock().map(|r| r.provider_load_state).unwrap_or(ProviderLoadState::Idle)
    }

    /// 获取启动阶段（同步）
    pub fn get_stage(&self) -> StartupStage {
        self.state.lock().map(|r| r.stage).unwrap_or(StartupStage::Idle)
    }
}

impl Default for StartupManager {
    fn default() -> Self {
        Self::new()
    }
}
