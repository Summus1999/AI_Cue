# AI_Cue 开发者文档

> 本文档面向想参与开发、了解架构、或二次开发的读者。
> 如果你是使用者，请阅读 [用户指南](docs/USER_GUIDE.md)。

---

## 1. 项目概述

**AI_Cue** 是一款 Windows 桌面 AI 面试助手，核心卖点：窗口不被腾讯会议等屏幕捕获软件拍到。

- 目标平台：仅 Windows 10 2004+
- 当前版本：1.1.0
- 许可证：MIT

---

## 2. 技术栈

| 层级 | 选型 | 说明 |
| --- | --- | --- |
| 桌面框架 | Tauri 2.x | Rust 驱动，比 Electron 轻量得多 |
| 后端语言 | Rust (2021 edition) | 处理 AI 调用、数据库、音频、OCR |
| 前端框架 | React 19 + TypeScript 5.6 | 全部 UI |
| 构建 | Vite 6 | 比 Webpack 快 |
| 样式 | Tailwind CSS 3 | 原子化 CSS |
| 图标 | Lucide React | 轻量、SVG |
| 状态管理 | Zustand 5 | 比 Redux 简洁太多 |
| 配置存储 | tauri-plugin-store 2 | 本地 JSON 文件 |
| 数据库 | SQLite (rusqlite, bundled) | 嵌入到二进制，零配置 |
| HTTP | reqwest 0.12 (rustls-tls) | Rust 原生 HTTP |
| 测试 (前端) | Vitest + Testing Library | Vite 生态，快 |
| 测试 (后端) | Rust #[cfg(test)] | 原生测试框架 |
| 代码编辑器 | Monaco Editor | VS Code 同款内核 |
| 代码格式化 | Prettier (Web Worker) | 不阻塞主线程 |

---

## 3. 项目结构

```text
AI_Cue/
├── src/                          # 前端
│   ├── App.tsx                   # 主入口，编排所有视图和聊天流程
│   ├── components/               # React 组件
│   │   ├── SettingsPanel.tsx     # 最复杂的组件：模型/RAG/记忆/路由全在这里
│   │   ├── KnowledgeBasePanel.tsx # 知识库管理
│   │   ├── MemoryManagementPanel.tsx # 记忆 CRUD 面板
│   │   ├── CompactView.tsx       # 紧凑模式悬浮窗（含 cheat 模式渲染）
│   │   ├── CodeEditorPanel.tsx   # Monaco 编辑器外壳
│   │   ├── OnboardingDialog.tsx  # 5 步引导
│   │   ├── TrainingPlanPanel.tsx # 训练计划
│   │   ├── SmartRoutingSettings.tsx # 智能路由候选列表
│   │   ├── InterviewSetupDialog.tsx # 面试背景设置
│   │   ├── ShortcutSettingsPanel.tsx # 快捷键设置
│   │   ├── MessageSearchBar.tsx  # 消息搜索
│   │   ├── MessageCitations.tsx  # RAG/记忆引用渲染
│   │   ├── NetworkStatusIndicator.tsx # 网络状态灯
│   │   ├── WaveformVisualizer.tsx # 录音波形
│   │   ├── FriendlyErrorCard.tsx # 友好错误提示
│   │   ├── FeatureGate.tsx       # 功能开关组件
│   │   ├── knowledge/            # 知识库子组件（文档列表/导入/预览）
│   │   ├── review/               # 复盘子组件（报告/历史/趋势）
│   │   ├── export/               # 导出子组件（对话框/选择器）
│   │   └── lazy/                 # 懒加载网关
│   ├── services/                 # 纯逻辑，不含 React
│   │   ├── aiChat.ts             # 聊天请求构建与发送
│   │   ├── ragService.ts         # RAG 知识库 API 封装
│   │   ├── memoryService.ts      # 记忆 CRUD API 封装
│   │   ├── memoryExtraction.ts   # 记忆实时抽取触发
│   │   ├── chatRetrieval.ts      # 检索策略判定
│   │   ├── chatReplay.ts         # 继续生成/重试准备
│   │   ├── smartRouter.ts        # 智能路由选择
│   │   ├── speechRecognition.ts  # 阿里云语音识别
│   │   ├── speechSynthesis.ts    # TTS 朗读
│   │   ├── reviewService.ts      # 复盘分析
│   │   ├── captureDetector.ts    # 会议软件检测
│   │   ├── shortcutManager.ts    # 全局快捷键注册
│   │   ├── windowManager.ts      # 窗口控制
│   │   ├── interviewFlow.ts      # 面试流程（去重/阶段判断）
│   │   └── export/               # 导出服务（MD/PDF/JSON）
│   ├── store/                    # Zustand stores
│   │   ├── config.ts             # 全局配置（含 RAG/路由/功能开关）
│   │   ├── rag.ts                # 知识库状态
│   │   ├── review.ts             # 复盘状态
│   │   └── trainingPlan.ts       # 训练计划状态
│   ├── bootstrap/                # 启动编排
│   │   ├── bootstrapCoordinator.ts # 统一启动任务编排
│   │   └── runtimeConfigSnapshot.ts # 运行时配置快照
│   ├── types/                    # TypeScript 类型定义
│   └── workers/                  # Web Workers（Prettier）
│
├── src-tauri/                    # Rust 后端
│   ├── Cargo.toml                # 依赖声明
│   ├── tauri.conf.json           # Tauri 窗口配置
│   └── src/
│       ├── main.rs               # 入口
│       ├── lib.rs                # 所有 Tauri 命令注册
│       ├── commands.rs           # 命令实现（前后端桥梁，最大文件之一）
│       ├── database.rs           # SQLite 数据库（表结构/迁移/CRUD，最大文件之一）
│       ├── memory.rs             # 个人记忆生命周期（抽取/巩固/反思/衰减）
│       ├── ai/                   # AI Provider 体系
│       │   ├── traits.rs         # ChatProvider / EmbeddingProvider trait 定义
│       │   ├── types.rs          # 共享类型
│       │   ├── qwen.rs           # 千问 Provider
│       │   ├── openai_compat.rs  # OpenAI 兼容 Provider（覆盖 GPT/DeepSeek/Ollama）
│       │   ├── claude.rs         # Claude Provider
│       │   ├── stream.rs         # SSE 流解析
│       │   ├── cancellation.rs   # 取消机制
│       │   ├── configurable.rs   # 可配置 Provider 工厂
│       │   ├── loader.rs         # Provider 动态加载
│       │   └── security.rs       # API Key 安全
│       ├── audio/                # 音频捕获
│       │   ├── mod.rs            # 音频模块入口
│       │   ├── recorder.rs       # 录音器抽象
│       │   ├── types.rs          # 音频类型
│       │   └── windows_wasapi.rs # Windows WASAPI 实现
│       ├── rag/                  # RAG 知识库
│       │   ├── mod.rs            # RagEngine 装配、统一检索入口
│       │   ├── parser.rs         # 文档解析（MD/PDF/文本/代码）
│       │   ├── chunker.rs        # 智能分块
│       │   ├── embedder.rs       # Embedding 向量化
│       │   ├── vector_store.rs   # 向量存储（SQLite 扩展）
│       │   ├── retriever.rs      # 检索（消息/知识库/记忆三路融合）
│       │   ├── context_builder.rs # Prompt 上下文构建 + citation
│       │   ├── knowledge_base.rs # 知识库导入/重建/异常重试
│       │   ├── ocr.rs            # Windows OCR 引擎
│       │   ├── task_registry.rs  # 导入任务进度注册表
│       │   └── integration_test.rs # RAG 集成测试
│       ├── review/               # 面试复盘
│       │   ├── mod.rs            # 复盘模块入口
│       │   ├── analyzer.rs       # 分析器
│       │   ├── scorer.rs         # 五维评分
│       │   ├── report.rs         # 报告生成
│       │   ├── trend.rs          # 趋势对比
│       │   └── types.rs          # 复盘类型
│       ├── logging.rs            # 结构化日志（tracing）
│       ├── perf.rs               # 性能埋点
│       ├── export.rs             # 导出功能
│       ├── tts.rs                # TTS 语音合成（Windows SAPI）
│       ├── capture_detection.rs  # 屏幕捕获检测（进程扫描）
│       ├── screenshot.rs         # 截图功能
│       ├── startup.rs            # 启动恢复
│       └── nls.rs                # 自然语言搜索
│
├── tasks/
│   └── tasks-rag-merged-real-status.md  # 任务进度真值（唯一）
├── docs/
│   ├── USER_GUIDE.md             # 用户指南
│   └── plans/                    # 各模块设计文档
├── Agent.md                      # AI Agent 操作约束
└── README.md                     # 项目主页
```

---

## 4. 核心架构

### 4.1 前后端通信

```
React (TypeScript)  ←── invoke() ──→  Rust (Tauri commands)
                     ←── events ──→
```

- 前端通过 `@tauri-apps/api/core` 的 `invoke()` 调用后端
- 后端通过 Tauri events 向前端推送进度（如知识库导入进度）
- 所有通信走 IPC，不经过网络

### 4.2 AI Provider 架构

```
trait ChatProvider {
    async fn chat_stream(...) -> Stream<ChatDelta>;
    async fn chat(...) -> ChatResponse;
}

trait EmbeddingProvider {
    async fn embed(...) -> Vec<Vec<f32>>;
}
```

- `QwenProvider`：阿里云 DashScope
- `OpenAICompatProvider`：GPT / DeepSeek / Ollama 等兼容 OpenAI 格式的服务
- `ClaudeProvider`：Anthropic Messages API
- `ConfigurableProvider`：从用户配置动态创建实例
- 前端 `smartRouter.ts` 实现多模型优先级 + 健康检查 + 自动切换

### 4.3 数据库 Schema

SQLite 数据库包含以下主要表：

| 表名 | 用途 |
| --- | --- |
| `sessions` | 会话元数据 |
| `messages` | 消息记录 |
| `knowledge_bases` | 知识库 |
| `kb_documents` | 知识库文档（含 fingerprint、索引状态） |
| `kb_chunks` | 文档分块（含页码、标题路径） |
| `kb_embeddings` | 向量化存储 |
| `memories` | 个人记忆（情景/语义/画像/程序） |
| `memory_embeddings` | 记忆向量 |
| `reviews` | 复盘记录 |
| `training_tasks` | 训练计划任务 |
| `plugin_providers` | 自定义模型配置 |

### 4.4 记忆生命周期

```
抽取（每轮回答后）
  ↓
巩固（向量去重，相同内容不重复记）
  ↓
反思（达阈值 → LLM 总结出画像特征）
  ↓
衰减（低重要性超时 → 归档）
```

详见 `docs/plans/2026-06-08-assistant-memory-system-design.md`。

### 4.5 RAG 检索流程

```
用户提问
  ↓
向量化（Embedding）
  ↓
三路检索：
  ├── 当前会话消息（向量相似度）
  ├── 知识库文档（向量相似度）
  └── 个人记忆（relevance × recency × importance 三因子打分）
  ↓
结果融合 + 排序
  ↓
构建 prompt context（token 受控）
  ↓
注入 AI 请求
  ↓
AI 回答 + 引用标注
```

---

## 5. 开发指南

### 5.1 环境准备

- Windows 10/11
- Node.js 18+
- Rust 1.77+
- （可选）`cargo install tauri-cli`

### 5.2 常用命令

```bash
# 安装依赖
npm install
cd src-tauri && cargo build

# 开发（热更新）
npm run dev

# 构建前端
npm run build

# 构建 Tauri 应用
npm run tauri build

# 前端测试
npm run test

# 后端测试
cd src-tauri && cargo test
```

### 5.3 关键约定

1. **注释用中文**，代码标识符用英文
2. **奥卡姆剃刀**：代码简洁，不引入不必要的抽象
3. **改动前先读 `tasks/tasks-rag-merged-real-status.md`**，了解当前状态
4. **一次只做一件事**：每个子任务独立推进、验证、提交
5. **全量验证**：改完代码后先 `npm run build`，再 `cargo test`
6. **文档同步**：代码变更后必须同步更新 `tasks/tasks-rag-merged-real-status.md` 和相关 markdown
7. **Git 约定**：提交信息用英文，格式 `type: description`（如 `feat: add xxx`）
8. **Git 分支**：`main` 为稳定分支，开发在 feature 分支

### 5.4 添加新功能的标准流程

1. 在 `tasks/` 创建或更新任务条目
2. 后端：在 `src-tauri/src/` 实现逻辑 → `commands.rs` 暴露命令 → `lib.rs` 注册
3. 前端：在 `src/services/` 封装 API → `src/store/` 管理状态 → `src/components/` 渲染 UI
4. 跑 `npm run build` 和 `cargo test` 验证
5. 更新 `tasks/tasks-rag-merged-real-status.md` 标记完成
6. Git commit + push

### 5.5 配置结构

```typescript
// src/store/config.ts 定义了所有的配置字段
AppConfig {
  activeProvider, activeModel,           // 当前模型
  providerConfigs: {                     // 每个 Provider 的配置
    [key]: { apiKey, baseUrl, model }
  },
  systemPrompt,                          // 自定义 Prompt
  promptMode,                            // assistant | interviewer | cheat
  rag: {                                 // RAG 配置
    enabled, retrievalScope, enableOcr,
    embeddingProvider, embeddingModel, autoReindexPolicy
  },
  smartRouting: {                        // 智能路由
    enabled, entries[], latencyThreshold
  },
  featureGates: {                        // 功能开关
    rag, smartRouting, memoryManagement
  },
  shortcutConfig,                        // 快捷键
  windowTransparency,                    // 窗口透明度
  // ...
}
```

---

## 6. 屏幕捕获防护详解

### 技术原理

Tauri 配置 `contentProtected: true`，底层调用：

```c
SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
```

- Windows 10 2004 引入 `WDA_EXCLUDEFROMCAPTURE` (0x00000011)
- 任何使用 Desktop Duplication API 或 GDI 截屏的应用都无法捕获窗口内容
- 腾讯会议、Zoom、OBS 等均使用这些 API

### 窗口配置

```json
{
  "contentProtected": true,  // 防捕获
  "transparent": true,       // 透明背景
  "decorations": false,      // 无系统边框
  "alwaysOnTop": true,       // 始终置顶
  "skipTaskbar": true,       // 任务栏隐藏
  "focus": false,            // 不抢焦点
  "shadow": false            // 无阴影
}
```

### 自动隐身检测

`captureDetector.ts` 每 3 秒轮询检查已知会议软件进程（腾讯会议、Zoom、Teams 等），检测到后自动触发隐身。

---

## 7. 当前版本能力总览

| 功能模块 | 状态 | 关键文件 |
| --- | --- | --- |
| AI 流式对话 | ✅ | `ai/`、`aiChat.ts` |
| 多 Provider 架构 | ✅ 千问/OpenAI兼容/Claude | `ai/` |
| 语音识别 | ✅ 阿里云 ASR | `speechRecognition.ts`、`audio/` |
| 语音合成 (TTS) | ✅ Windows SAPI | `tts.rs`、`speechSynthesis.ts` |
| 截图题解 | ✅ | `screenshot.rs`、`screenshotController.ts` |
| 代码编辑器 | ✅ Monaco Editor | `CodeEditorPanel.tsx` |
| 防捕获保护 | ✅ | `captureDetection.rs`、`captureDetector.ts` |
| 紧急隐藏 | ✅ | `shortcutManager.ts` |
| 会话管理 | ✅ SQLite 持久化 | `database.rs`、`sessionManager.ts` |
| 窗口透明度/穿透/紧凑 | ✅ | `windowManager.ts`、`CompactView.tsx` |
| RAG 知识库 | ✅ 完整链路 | `rag/`、`ragService.ts` |
| 个人面试记忆 | ✅ 抽取/巩固/反思/衰减 | `memory.rs`、`memoryService.ts` |
| 记忆管理面板 | ✅ CRUD + 维护 | `MemoryManagementPanel.tsx` |
| 智能路由 | ✅ 多模型优先级/健康检查 | `smartRouter.ts`、`SmartRoutingSettings.tsx` |
| 面试复盘 | ✅ 五维评分 + 趋势 | `review/`、`reviewService.ts` |
| 导出 | ✅ MD/PDF 可选导出 | `export/` |
| 新手引导 | ✅ 5 步引导 | `OnboardingDialog.tsx` |
| 训练计划 | ✅ | `TrainingPlanPanel.tsx`、`trainingPlan.ts` |
| 功能开关 | ✅ | `FeatureGate.tsx`、`featureGates` |
| 日志系统 | ✅ tracing | `logging.rs`、`logger.ts` |
| 性能埋点 | ✅ | `perf.rs`、`perfInstrumentation.ts` |
| 启动编排 | ✅ | `bootstrapCoordinator.ts`、`startup.rs` |
| 填充词过滤 | ✅ | `fillerWordFilter.ts` |
| Agent 框架 | ❌ 未开始 | 3 期工程 |
| Web 搜索 | ❌ 未开始 | 3 期工程 |
| 代码沙箱执行 | ❌ 未开始 | 3 期工程 |
| 多 Agent 协作 | ❌ 未开始 | 3 期工程 |
