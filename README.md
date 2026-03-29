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
- Windows OCR fallback 可处理扫描版 PDF 或文本提取不足的页面
- 支持千问、OpenAI 兼容 Embedding 模型向量化
- 普通发送、继续生成、重试消息都会接入 retrieval / citation 链路
- 回答附带引用来源标注（文档名、页码、标题路径、相关片段）

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

### RAG 设置

在设置面板中可配置：

| 参数 | 说明 |
| --- | --- |
| 启用 RAG 增强检索 | 控制聊天主链路是否注入 retrieval context |
| 检索范围 | `hybrid` / `knowledge_base` / `current_session` |
| 导入时启用 OCR fallback | 控制导入、重建索引时是否对 PDF 页面启用 OCR |
| Embedding Provider | 当前支持 `qwen` 与 `openai_compat` |
| Embedding 模型 | 例如 `text-embedding-v2`、`text-embedding-3-small` |
| 自动重建策略 | `manual` / `changed_files` / `on_startup` |

---

## 📚 RAG 当前实现

### 已接入的链路

- **运行时配置**：前端会在启动、设置保存、聊天发送、文档导入与重建索引前，把当前 RAG provider / model 配置同步到后端 `RagEngine`。
- **文档导入**：已接入真实导入链路，包含源文件快照、解析、OCR fallback、分块、embedding、`kb_documents` / `kb_chunks` / `kb_embeddings` 持久化。
- **任务进度**：导入、单文档重建、整库重建、异常文档重试都会产出阶段进度，并在前端展示解析 / 分块 / 向量化 / 收尾状态。
- **聊天检索**：主聊天链路会先做 retrieval，再把 `prompt context + citations` 注入对话请求；如果 RAG 不可用，会显式降级到普通聊天。
- **引用展示**：回答消息下方会展示 citation 列表，包含标题、片段、页码、标题路径和相似度来源。
- **运维补强**：支持同路径未变化文档跳过重复导入、单文档重建、整库重建、批量重试 `pending` / `failed` 文档，以及启动恢复卡在 `indexing` 的文档。

### 使用方式

1. 在设置面板的 `RAG 检索与知识库` 区块中，配置 Embedding Provider、Embedding 模型、检索范围、OCR 开关和自动重建策略。
2. 确保为当前选中的 Embedding Provider 配置了有效的 API Key；如果没有，聊天会自动降级为普通模式，知识库导入/重建也不会真正完成 embedding。
3. 在设置面板点击 `打开知识库`，进入知识库页面并选择一个现有知识库。
4. 在 `导入文档` 区块选择文件后开始导入；界面会先显示乐观状态行，再逐步切换到真实任务快照。
5. 文档进入 `ready` 后才会参与聊天检索；失败文档可以在知识库页直接执行单文档重建、整库重建或批量重试。
6. 回到聊天主界面后，普通发送、继续生成、重试消息都会尝试检索知识库，并在回答下方展示引用来源。

### 架构概览

- **配置层**：`SettingsPanel` 保存 `rag.enabled`、`retrievalScope`、`enableOcr`、`embeddingProvider`、`embeddingModel`、`autoReindexPolicy`，然后由前端 runtime 配置同步逻辑下发到后端。
- **导入层**：`rag_import_knowledge_document` / `rag_reindex_knowledge_document` 会调用真实解析与 embedding 链路；PDF 会在文本不足时走 OCR fallback。
- **检索层**：`rag_retrieve_with_citations` 会返回 `promptContext + citations`，聊天主流程只消费结构化结果，不再由前端二次查库拼引用。
- **状态层**：后端维护知识库任务注册表，前端通过任务快照同步导入、重建索引、异常重试的最新状态。
- **启动恢复**：当自动重建策略为 `on_startup` 时，启动编排会把上次异常中断、仍停留在 `indexing` 的文档统一恢复为 `failed`，避免状态长期卡死。

### 当前限制

- **知识库创建入口**：当前桌面 UI 主要覆盖“已有知识库”的管理、导入和运维；`createKnowledgeBase` 虽然后端与前端 store 已具备，但界面里还没有单独的新建知识库按钮。
- **Embedding Provider 范围**：聊天 Provider 可以选 Qwen / OpenAI Compatible / Claude，但 RAG 的 Embedding Provider 目前只支持 `qwen` 与 `openai_compat`，不支持 Claude embedding。
- **OCR 生效范围**：OCR 仅运行在 Windows 侧的导入 / 重建索引链路中；切换 OCR 开关不会回溯已导入文档，已有文档需要重新索引后才会生效。
- **自动重建策略现状**：`on_startup` 已真实接入启动恢复；`changed_files` 选项当前会被持久化，但还没有独立的后台扫描器去自动巡检所有知识库文件变化。
- **聊天降级策略**：当 RAG 被关闭、Embedding Provider 没有 API Key、当前没有 `ready` 文档、`current_session` 模式缺少可用 `sessionId`，或者 retrieval 失败时，聊天会继续工作，但不会注入 RAG 上下文。
- **检索来源差异**：`interviewer` 模式自带最近问答历史，因此混合检索下会更偏向知识库文档补充，不会重复消费会话消息检索结果。

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
