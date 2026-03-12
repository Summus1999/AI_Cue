# AI_Cue 技术选型详解

本文档介绍 AI_Cue 项目中使用的各项技术及其选型依据。

---

## 1. 项目概述

AI_Cue 是一款不被腾讯会议等屏幕捕获软件捕捉到的 AI 面试助手。用户可手动输入面试官提出的问题，由 AI 实时生成回答要点，在防捕获 overlay 窗口中显示，供面试时参考。

目标平台：仅 Windows。

---

## 2. 核心技术栈

| 层级 | 技术选型 | 版本/说明 |
|------|----------|-----------|
| 桌面框架 | Tauri | 2.x |
| 后端语言 | Rust | 2021 edition |
| 前端框架 | React | 19 |
| 前端语言 | TypeScript | 5.x |
| 构建工具 | Vite | 5.x |
| 样式方案 | Tailwind CSS | 3.x |
| UI 组件库 | shadcn/ui | 基于 Radix UI |
| Markdown 渲染 | react-markdown + rehype-highlight | 支持代码高亮 |
| 状态管理 | zustand | 轻量 |
| 配置存储 | tauri-plugin-store | 本地持久化 |

---

## 3. 屏幕捕获防护

### 3.1 核心机制

依赖 Tauri 的 `contentProtected: true` 配置，底层调用 Windows API：

```c
SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
```

- `WDA_EXCLUDEFROMCAPTURE` (0x00000011)：Windows 10 2004+ 支持，窗口在屏幕捕获时显示为透明
- 腾讯会议、Zoom、OBS、Windows 截图工具等均走系统截屏 API，该机制可有效排除本窗口

### 3.2 窗口配置

| 配置项 | 值 | 作用 |
|--------|-----|------|
| contentProtected | true | 核心防捕获 |
| transparent | true | 透明背景 |
| decorations | false | 无系统边框 |
| alwaysOnTop | true | 始终置顶，覆盖会议窗口 |
| skipTaskbar | true | 任务栏不显示 |
| focus | false | 不抢焦点，点击时会议窗口不失去焦点 |
| shadow | false | 无阴影 |

### 3.3 平台要求

- Windows 10 2004 及以上版本
- 旧版本使用 `WDA_MONITOR` 时窗口会显示为黑色，不推荐

---

## 4. LLM 与多模型架构

### 4.1 默认模型

千问（通义千问），阿里云 DashScope API。使用 OpenAI 兼容接口：

```
Base URL: https://dashscope.aliyuncs.com/compatible-mode/v1
```

### 4.2 多模型切换设计

抽象统一的 Provider 接口，支持后续扩展 DeepSeek、OpenAI、Claude 等：

| Provider | Base URL |
|----------|----------|
| 千问 | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| DeepSeek | https://api.deepseek.com/v1 |
| OpenAI | https://api.openai.com/v1 |

千问、DeepSeek、OpenAI 均兼容 OpenAI Chat Completions 格式，可复用同一套 HTTP 调用逻辑，仅需配置不同 endpoint 和 API Key。

### 4.3 流式输出

采用 Server-Sent Events (SSE) 流式接收 AI 回答，实现打字机效果，降低用户等待感知。

---

## 5. 配置持久化

使用 `tauri-plugin-store` 将配置写入本地：

```
存储路径: %APPDATA%/ai-cue/config.json
```

存储内容：

- providers：各 Provider 的 API Key、默认模型
- activeProvider / activeModel：当前选中的模型
- window：窗口位置、透明度
- systemPrompt：用户自定义 system prompt

---

## 6. 前端交互设计

### 6.1 核心 UI 结构

- 自定义标题栏：支持拖拽移动，最小化/关闭按钮
- AI 回答区域：Markdown 渲染，代码块高亮，自动滚动到底部
- 输入框：Enter 发送，Shift+Enter 换行
- 模型选择下拉框

### 6.2 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+Shift+Space | 显示/隐藏窗口 |
| Ctrl+Shift+H | 紧急隐藏（仅可通过快捷键恢复） |

### 6.3 窗口行为

- 半透明（默认 85%-90% 透明度，可调）
- 可拖拽、可调整大小
- 不抢焦点，点击时不影响腾讯会议窗口

---

## 7. 语音识别（后续规划）

MVP 阶段不包含语音识别，仅支持手动输入问题。后续扩展时采用：

- 阿里云实时语音识别：与千问同生态，中文识别精度高，支持实时流式 ASR API

---

## 8. MVP 范围

| 功能 | 状态 |
|------|------|
| 防捕获 overlay 窗口 | MVP |
| 手动输入问题 | MVP |
| 千问 API 流式对话 | MVP |
| 多模型 Provider 抽象与切换 | MVP |
| 配置持久化 | MVP |
| Markdown 回答渲染 | MVP |
| 全局快捷键 | MVP |
| 紧急隐藏 | MVP |
| 语音识别 | 后续 |

---

## 9. 依赖项

### Rust (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = ["devtools"] }
tauri-plugin-store = "2"
```

### Tauri 配置

```json
{
  "app": {
    "windows": [
      {
        "contentProtected": true,
        "transparent": true,
        "decorations": false,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "focus": false
      }
    ]
  }
}
```

### 前端

- react, react-dom
- react-markdown, rehype-highlight
- zustand
- @radix-ui/* (via shadcn/ui)
- tailwindcss
