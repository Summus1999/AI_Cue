# AI Cue

> AI面试助手：基于语音智能分析，实时提供面试反馈与优化建议。精准提升表达力、增强自信，助您高效斩获心仪职位，让面试更从容。

[English](README_en.md) | 中文

---

## ✨ 功能特性

### 🎯 核心能力

- **智能对话**：支持流式输出的AI对话界面，可自定义Prompt
- **继续生成**：AI回答中断后可继续生成
- **语音输入**：一键语音录入，自动识别并转文字
- **截图题解**：屏幕截图选取区域，AI即时给出题解
- **代码增强**：自动识别代码题，内嵌Monaco Editor代码编辑器
- **上下文控制**：可配置上下文窗口大小（默认 5 轮），也可完全关闭历史上下文

### 📋 会话管理

- **历史持久化**：SQLite本地存储，消息实时自动保存
- **多会话管理**：支持新建、切换、搜索、删除会话
- **消息搜索**：全文搜索，高亮定位匹配消息
- **自动恢复**：启动时自动恢复上次会话

### 🎨 界面体验

- **透明窗口**：20%-100%透明度调节，悬停自动恢复
- **穿透模式**：可开启鼠标穿透，专注其他应用
- **紧凑模式**：一键切换为小悬浮窗，仅显示最新回答
- **窗口记忆**：自动记忆窗口位置和大小

### 🤖 多模型支持

- **千问 (Qwen)**：阿里云通义千问系列
- **OpenAI 兼容**：GPT、DeepSeek、Ollama 等
- **Claude**：Anthropic Claude 系列
- **自定义接入**：支持私有化部署模型

### 📚 RAG 知识库

- 支持导入 Markdown、PDF、纯文本、代码文件
- Windows OCR 自动识别扫描版 PDF
- 千问、OpenAI 兼容 Embedding 模型向量化
- 对话时自动检索相关文档片段
- 回答附带引用来源标注（文档名、页码、相关片段）

### 📊 面试复盘

- **AI评分维度**：自信度、专业度、技术深度、理论与实践结合、技术敏感度
- **趋势对比**：多次面试进步趋势横向对比
- **知识标注**：自动标注知识盲点，生成改进建议
- **报告导出**：复盘报告导出为PDF

### 📤 导出功能

- **Markdown导出**：保留问答时间线，适合笔记整理
- **PDF导出**：排版美观，适合存档分享
- **选择性导出**：勾选需要的问答对
- **元数据头**：包含面试时间、模型、Prompt模板

### 🔌 扩展能力

- 插件化 Provider 架构，支持动态加载自定义 AI 模型
- 结构化日志系统，支持导出用于问题排查
- 关键路径性能埋点（启动、聊天、截图等）

---

## 🛠️ 技术栈

### 前端

- **框架**：React 19 + TypeScript
- **构建**：Vite
- **样式**：Tailwind CSS
- **状态管理**：Zustand
- **Tauri**：Rust 后端

### 后端 (Rust)

- **数据库**：SQLite (rusqlite)
- **AI Provider**：Trait-based 多模型架构
- **系统集成**：Windows WASAPI 音频捕获

---

## 🚀 快速开始

### 环境要求

- Windows 10/11
- Node.js 18+
- Rust 1.70+

### 安装依赖

```bash
# 安装前端依赖
npm install

# 安装 Rust 依赖
cd src-tauri && cargo build
```

### 开发运行

```bash
npm run dev
```

### 构建发布

```bash
npm run build
```

---

## ⚙️ 配置说明

### 模型设置

在设置面板中可配置：

| 参数 | 说明 |
| --- | --- |
| 提供商 | 选择AI模型提供商 |
| 模型 | 选择具体模型版本 |
| API Key | 输入API密钥 |
| Base URL | 自定义API地址（私有部署） |

### 快捷键

| 功能 | 默认快捷键 |
| --- | --- |
| 语音录制 | Ctrl+Shift+R |
| 发送消息 | Ctrl+Enter |
| 截图 | Ctrl+Shift+S |

### 语音识别

- 支持调节语音识别控制阈值
- WebSocket断开自动重连

---

## 📁 项目结构

```text
src/
├── components/          # UI 组件
│   ├── export/          # 导出相关
│   ├── review/          # 复盘报告
│   └── lazy/            # 懒加载网关
├── services/            # 业务服务
│   ├── export/          # 导出服务
│   ├── screenshot/      # 截图服务
│   ├── ragService.ts    # RAG 知识库
│   ├── aiChat.ts        # AI 聊天
│   ├── reviewService.ts # 复盘服务
│   └── ...
├── store/               # Zustand 状态管理
│   ├── config.ts        # 全局配置
│   ├── rag.ts           # RAG 状态
│   └── review.ts        # 复盘状态
└── hooks/               # 自定义 Hooks

src-tauri/src/
├── ai/                  # 多模型 Provider（Claude、Qwen、OpenAI 兼容）
├── audio/               # Windows WASAPI 音频捕获
├── rag/                 # 知识库：解析、分块、Embedding、向量存储、检索
├── review/              # 面试复盘分析
├── logging.rs           # 结构化日志系统
├── perf.rs              # 性能埋点
├── database.rs          # SQLite 数据库
├── export.rs            # 导出功能
└── commands.rs          # Tauri 命令层
```

---

## 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

---

## 🙏 致谢

感谢所有为此项目贡献代码的朋友。

[![Star History Chart](https://api.star-history.com/svg?repos=summus-transformer/AI_Cue&type=Timeline)](https://star-history.com/#summus-transformer/AI_Cue&type=Timeline)
