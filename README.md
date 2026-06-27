# AI Cue

> AI面试助手：基于语音智能分析，实时提供面试反馈与优化建议。
> 窗口不被腾讯会议等软件捕获，面试时安心使用。
> 精准提升表达力、增强自信，助您高效斩获心仪职位。

[![Release](https://img.shields.io/github/v/release/Summus1999/AI_Cue?label=%E4%B8%8B%E8%BD%BD&style=flat-square&color=blue)](https://github.com/Summus1999/AI_Cue/releases)
![License](https://img.shields.io/github/license/Summus1999/AI_Cue?style=flat-square)

📥 **最新安装包下载**：[GitHub Releases](https://github.com/Summus1999/AI_Cue/releases/latest)

[English](README_en.md) | 中文

> 📖 初次使用？请阅读 [用户指南](docs/USER_GUIDE.md)，手把手教你从零开始。
> 🔧 开发者？请阅读 [开发者文档](detailed%20introduction%20of%20technologies.md)。

---

## ✨ 功能特性

### 🎯 核心对话

- **流式对话**：打字机效果实时输出，可随时打断继续
- **Prompt 自定义**：自由设定 AI 的角色、风格和回答策略
- **继续生成**：AI 回答中断后一键续写
- **上下文窗口**：可配置保留最近几轮对话作为背景（默认 5 轮），也可完全关闭

### 🎤 语音与截图

- **语音输入**：一键录音，自动转文字（阿里云语音识别）
- **填充词过滤**：自动去除"嗯""那个""就是"等口头禅
- **截图题解**：框选屏幕任意区域，AI 即时分析图中题目
- **代码编辑器**：自动识别代码题，内置 Monaco Editor，支持语法高亮和一键复制代码

### 🛡️ 防捕获保护（核心能力）

- **天然防捕获**：利用 Windows `contentProtected` API，窗口不会被腾讯会议、Zoom、OBS 等软件捕捉
- **紧急隐藏**：一键快捷键（默认 Ctrl+Shift+H）瞬间隐藏窗口
- **自动隐身**：检测到会议软件启动时自动进入隐身模式
- **答题模式**：专为面试作弊场景优化的 Prompt，回答更加精炼直接

### 📋 会话管理

- **历史保存**：所有对话自动存入本地数据库，永不丢失
- **多会话切换**：新建、切换、搜索、删除面试对话
- **消息搜索**：全文关键词搜索，高亮定位匹配消息
- **自动恢复**：启动时自动恢复上次未关闭的会话

### 🎨 界面体验

- **透明窗口**：20%-100% 透明度自由调节，鼠标悬停自动变清晰
- **穿透模式**：鼠标可穿透窗口操作下层应用
- **紧凑模式**：一键缩小为悬浮条，只显示最新回答
- **窗口记忆**：自动记住上次关闭时的位置和大小

### 🤖 多模型 & 智能路由

- **千问 (Qwen)**：阿里云通义千问系列
- **OpenAI 兼容**：GPT、DeepSeek、Ollama 等
- **Claude**：Anthropic Claude 系列
- **自定义接入**：支持私有化部署，填 Base URL 即可
- **智能路由**：配置多个备选模型，按优先级自动探测连通性，故障时自动切换——再也不怕 API 挂了

### ✍️ TTS 语音朗读

- **离线朗读**：基于 Windows SAPI，不依赖网络
- **一键播报**：AI 回答可朗读出来，方便面试时听答案
- **语速可调**：支持调速和音量控制

### 📚 RAG 知识库

- 支持导入 Markdown、PDF、纯文本、代码文件
- 扫描版 PDF 自动 OCR 识别文字
- 支持千问、OpenAI 兼容的 Embedding 模型
- AI 回答时可自动检索知识库，附上引用来源（文档名、页码、相关片段）
- 管理面板：查看、导入、重建索引、删除文档，全部图形化操作

### 🧠 个人面试记忆

- **自动学习**：每轮 AI 回答后自动提取你的面试经验，形成个人记忆库
- **四种记忆类型**：
  - 情景记忆：某道题你是怎么回答的
  - 语义记忆：你掌握的知识点
  - 画像记忆：AI 总结的你的长期特征和风格
  - 程序记忆：你惯用的话术模板
- **智能去重**：相同内容不会重复记忆
- **自动整理**：记忆积攒到一定数量会自动反思总结，过时的记忆会自动归档
- **记忆面板**：可浏览、搜索、编辑、删除全部记忆，手动触发整理
- **检索增强**：AI 回答时会参考你的历史记忆，让答案更贴合你的风格

### 📊 面试复盘

- **AI 评分**：自信度、专业度、技术深度、理论与实践结合、技术敏感度，五维打分
- **模拟面试**：AI 扮演面试官，根据你的岗位 JD 和简历提问
- **进步追踪**：多次面试成绩横向对比，看进步趋势
- **知识盲点**：自动标出薄弱环节，给出改进建议
- **报告导出**：复盘报告一键导出 PDF

### 📤 导出功能

- **Markdown**：保留问答时间线，适合笔记整理
- **PDF**：排版美观，适合存档和分享
- **选择性导出**：勾选需要的问答对，不用全部导出
- **元数据头**：自动附带面试时间、使用模型、Prompt 模板

### 🧭 新手引导 & 训练计划

- **首次引导**：启动后带你完成模型配置→知识库→模式选择，5 步上手
- **训练计划**：内置面试训练模板，可自定义计划，按步骤提升面试能力
- **功能开关**：可按需开启/关闭 RAG、智能路由等高级功能

### 🔌 扩展能力

- 插件化 Provider 架构，支持动态加载自定义 AI 模型
- 启动编排与恢复机制，统一管理启动任务
- 网络弹性管理，指数退避重试 + 连接状态监控
- 结构化日志系统，支持导出日志排查问题
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
- **RAG 系统**：文档解析、OCR fallback、智能分块、Embedding 向量化、相似度检索、引用溯源完整链路
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

千问问答默认关闭深度思考（enable_thinking=false）。qwen3.5/3.6/3.7 系列默认开启思考，会先输出大段思考内容再给正式答案，正式答案首字延迟可达十几到几十秒；面试场景追求即时反馈，因此默认直接输出答案，把首字延迟压回 1-3 秒。

### 快捷键

| 功能 | 默认快捷键 | 说明 |
| --- | --- | --- |
| 语音录制 | Ctrl+Shift+R | 开始/停止录音 |
| 发送消息 | Ctrl+Enter | 发送输入框中的内容 |
| 截图 | Ctrl+Shift+S | 框选屏幕区域截图 |
| 穿透模式 | Ctrl+Shift+P | 鼠标穿透窗口 |
| 紧凑模式 | Ctrl+Shift+C | 切换悬浮窗模式 |
| 紧急隐藏 | Ctrl+Shift+H | 瞬间隐藏窗口 |

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

## 📚 RAG 知识库 — 工作原理

### 你只需要知道这三件事

1. **导入文档**：在设置→知识库中把 PDF、Markdown、文本文件拖进去，AI 会自动消化理解
2. **AI 自动引用**：提问时 AI 会检索你的资料，回答中自动标注信息来自哪份文档的哪一页
3. **随时更新**：资料改了可以点击重建索引，AI 会重新学习

### 运维功能

- 扫描版 PDF（图片型）自动 OCR 识别
- 同文件未改动跳过重复导入，节省 API 费用
- 导入失败的文档可单独重试或批量重试
- 启动时自动恢复上次中断的索引任务
- 统计面板：总文档数、总信息量一目了然

### 当前限制

- 目前需先在别处创建知识库，再导入文档
- Embedding（文档理解）仅支持千问和 OpenAI 兼容模型
- OCR 仅 Windows 可用，切换 OCR 开关后需重新索引已有文档
- 查不到资料时 AI 自动退回到普通聊天模式，不会出错
- `changed_files` 自动监测文件变化的功能尚未接入

---

## 📁 项目结构

```text
src/                         # 前端代码（React + TypeScript）
├── components/              # UI 组件
│   ├── export/              # 导出对话框
│   ├── knowledge/           # 知识库管理组件
│   ├── review/              # 复盘报告组件
│   ├── lazy/                # 懒加载网关
│   ├── CodeEditorPanel.tsx  # Monaco 代码编辑器
│   ├── CompactView.tsx      # 紧凑模式悬浮窗
│   ├── KnowledgeBasePanel.tsx # 知识库管理面板
│   ├── MemoryManagementPanel.tsx # 个人记忆管理面板
│   ├── SettingsPanel.tsx    # 设置面板
│   ├── OnboardingDialog.tsx # 新手引导
│   ├── TrainingPlanPanel.tsx # 训练计划
│   ├── SmartRoutingSettings.tsx # 智能路由设置
│   └── ...
├── services/                # 业务逻辑层
│   ├── export/              # 导出服务（MD/PDF/JSON）
│   ├── screenshot/          # 截图控制
│   ├── aiChat.ts            # AI 聊天请求
│   ├── ragService.ts        # RAG 知识库服务
│   ├── memoryService.ts     # 个人记忆 CRUD 服务
│   ├── memoryExtraction.ts  # 记忆实时抽取
│   ├── reviewService.ts     # 复盘分析
│   ├── speechSynthesis.ts   # TTS 语音朗读
│   ├── speechRecognition.ts # 语音识别
│   ├── smartRouter.ts       # 智能路由
│   ├── captureDetector.ts   # 屏幕捕获检测
│   ├── shortcutManager.ts   # 快捷键管理
│   ├── windowManager.ts     # 窗口控制
│   ├── interviewFlow.ts     # 面试流程控制
│   └── ...
├── store/                   # Zustand 状态管理
│   ├── config.ts            # 全局配置（含功能开关）
│   ├── rag.ts               # 知识库状态
│   ├── review.ts            # 复盘状态
│   ├── trainingPlan.ts      # 训练计划状态
│   └── ...
├── hooks/                   # 自定义 Hooks
├── bootstrap/               # 启动编排与恢复
└── workers/                 # Web Workers

src-tauri/src/               # 后端代码（Rust）
├── ai/                      # 多模型 Provider（Claude、Qwen、OpenAI 兼容）
├── audio/                   # Windows WASAPI 音频捕获
├── rag/                     # 知识库：解析/分块/Embedding/向量存储/检索
├── review/                  # 面试复盘分析
├── logging.rs               # 结构化日志系统
├── memory.rs                # 个人记忆：抽取/巩固/反思/衰减
├── perf.rs                  # 性能埋点
├── database.rs              # SQLite 数据库（含迁移/CRUD）
├── export.rs                # 导出功能
├── tts.rs                   # TTS 语音合成
├── capture_detection.rs     # 屏幕捕获检测
├── screenshot.rs            # 截图功能
├── startup.rs               # 启动恢复
├── commands.rs              # Tauri 命令层（前后端桥梁）
└── lib.rs                   # 命令注册入口
```

---

## 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

---

## 🙏 致谢

感谢所有为此项目贡献代码的朋友。

[![Star History Chart](https://api.star-history.com/svg?repos=summus-transformer/AI_Cue&type=Timeline)](https://star-history.com/#summus-transformer/AI_Cue&type=Timeline)
