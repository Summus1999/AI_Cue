## Relevant Files

- `src-tauri/src/rag/mod.rs` - `RagEngine` 装配、EmbeddingProvider 配置、统一检索入口，以及知识库导入/重建进度透传。
- `src-tauri/src/rag/retriever.rs` - 消息向量检索、知识库向量检索、结果融合与结构化返回。
- `src-tauri/src/rag/context_builder.rs` - Prompt context 构建与 citation 元信息生成。
- `src-tauri/src/rag/parser.rs` - 文档解析、PDF 文本提取、OCR fallback 判断。
- `src-tauri/src/rag/ocr.rs` - OCR 抽象、错误模型、Windows OCR 运行时实现与默认引擎工厂。
- `src-tauri/Cargo.toml` - Rust 后端依赖声明，启用 Windows OCR / PDF / Imaging 所需 WinRT feature。
- `src-tauri/src/rag/knowledge_base.rs` - 知识库导入/重建编排、OCR 解析接线、分块持久化、embedding 入库、阶段进度事件与失败收口。
- `src-tauri/src/rag/integration_test.rs` - RAG 导入/删除/重导入等 Rust 集成测试。
- `src-tauri/src/rag/task_registry.rs` - 知识库导入/重建索引任务注册表，负责记录后台任务最新进度快照并提供查询能力。
- `src-tauri/src/database.rs` - 知识库表结构、迁移、CRUD、chunk/embedding 写入，以及文档预览所需的 chunk 明细查询。
- `src-tauri/src/commands.rs` - Tauri RAG 命令入口、知识库导入/重建进度事件发射、后台任务状态查询、文档 chunk 明细查询，以及 parse/chunk 路径 OCR 引擎接线。
- `src-tauri/src/lib.rs` - Tauri 命令注册。
- `src/services/ragService.ts` - 前端 RAG 服务层、知识库导入/重建进度监听封装、后台任务状态查询、文档 chunk 明细查询与类型定义。
- `src/services/ragRuntimeConfig.ts` - 将持久化的 RAG embedding provider 配置映射并去重同步到后端 `rag_configure` 运行时。
- `src/services/aiChat.ts` - 聊天请求构建、可选 retrieval context 注入，以及聊天发送前的 RAG runtime 配置兜底同步。
- `src/services/chatRetrieval.ts` - 聊天 RAG 检索策略与 fallback 判定的纯函数模块，供主流程与回归测试复用。
- `src/services/chatReplay.ts` - 继续生成 / 重试消息的请求准备纯函数模块，负责恢复原用户上下文与请求元数据。
- `src/services/__tests__/chatRetrieval.test.ts` - 覆盖 retrieval off / on / empty / failure fallback 的前端回归测试。
- `src/services/__tests__/chatReplay.test.ts` - 覆盖 continue generate / retry 请求准备逻辑的前端回归测试。
- `src/store/config.ts` - 前端 RAG 配置持久化。
- `src/store/rag.ts` - 前端 RAG store，现已补齐知识库列表、当前选中库/文档、导入任务、文档详情/分块、重建索引状态与错误状态。
- `src/store/__tests__/rag.test.ts` - RAG store 回归测试，覆盖知识库列表、文档详情/分块、任务快照与重建索引状态同步。
- `src/App.tsx` - 主聊天编排与消息渲染，现已增加知识库视图入口，并将知识库页面切换到独立面板组件。
- `src/components/KnowledgeBasePanel.tsx` - 知识库页面容器组件，承载知识库概览、库选择、导入区、删除知识库操作、文档列表与文档预览挂载点。
- `src/components/knowledge/KnowledgeDocumentList.tsx` - 当前知识库的文档列表组件，负责文档状态展示与当前文档选择。
- `src/components/knowledge/KnowledgeImportPanel.tsx` - 文档导入面板组件，负责文件选择、发起导入、乐观状态行、阶段进度与失败展示。
- `src/components/knowledge/KnowledgeDocumentPreview.tsx` - 当前文档的预览组件，负责展示文档详情、重建索引、删除文档与 chunk 明细。
- `src/components/MessageCitations.tsx` - 聊天回答下方的 citation 列表渲染组件。
- `src/bootstrap/bootstrapCoordinator.ts` - 前端启动编排，当前已在启动阶段同步 RAG runtime 配置。
- `src/components/SettingsPanel.tsx` - 当前设置面板，当前会在保存配置后同步 RAG runtime 配置。
- `Agent.md` - Agent 主约束文档，新增 skills 检查、code review 闭环、文档同步时机与 `/clear` 规则。
- `.cursor/rules/agent-harness.mdc` - 会话启动强制规则，新增 skills 加载与验证、review、文档同步、`/clear` 流程。
- `.github/workflows/build-windows.yml` - Windows CI workflow，新增 `npm run build` 与 `cargo test` 验证门禁。
- `package.json` - 新增 `npm test` 脚本，并引入前端回归测试所需的 `vitest`。
- `package-lock.json` - 同步前端测试依赖锁文件。
- `README.md` - 项目说明，当前尚未同步 RAG 真实状态。
- `TODO.md` - 进度文档，当前与 RAG 真实状态存在偏差。

### Notes

- 这份文件是基于当前仓库真实代码状态合并后的 RAG 清单，原始两份任务文件保留不动。
- 只有“当前仓库里已经存在实现，并且已接到可用入口或已有明确测试覆盖”的项，才标记为“已完成”。
- 仅有 TS 接口签名、未注册后端命令、未接入主流程、只存在 mock/默认不可用实现、或仍需人工串联的项，一律标记为“未完成”。
- 对于旧任务中“部分已做但未形成端到端能力”的内容，这里会拆成更贴近实际代码状态的新子项。

## Tasks

- ✅️ 0.0 稳固后端 RAG 基础能力
  - ✅️ 0.1 统一 `SearchResult` 的 `embedding_id`、`message_id`、`document_id`、`chunk_id`、`source_kind` 等身份字段
  - ✅️ 0.2 修正消息向量检索结果的 identity 映射，不再把 embedding id 当成 message id 使用
  - ✅️ 0.3 将消息向量存储与知识库文档向量检索边界拆开，知识库检索改为基于 `kb_embeddings` / `kb_chunks` 的独立数据库查询路径
  - ✅️ 0.4 让 `RagEngine` 支持可插拔 `EmbeddingProvider`，而不是硬编码单一实现
  - ✅️ 0.5 提供后端 `rag_configure` 命令与运行时 provider 配置类型，支持 Qwen / OpenAI Compatible embedding 选择
  - ✅️ 0.6 补齐 provider 配置、identity 映射、结果 hydration 的后端回归测试

- ✅️ 1.0 落地知识库 Schema 与基础 CRUD
  - ✅️ 1.1 新增 `knowledge_bases`、`kb_documents`、`kb_chunks`、`kb_embeddings` 表、索引与级联删除规则
  - ✅️ 1.2 完成数据库迁移并提升 `user_version`
  - ✅️ 1.3 实现知识库创建 / 列表 / 删除
  - ✅️ 1.4 实现知识库文档列表 / 详情 / 删除
  - ✅️ 1.5 持久化文档 fingerprint 元数据，包括绝对路径、文件大小、修改时间与内容哈希
  - ✅️ 1.6 持久化 `pending` / `indexing` / `ready` / `failed`、`last_error` 等索引状态字段
  - ✅️ 1.7 补齐 migration、重复文档保护、级联删除的数据库测试

- ✅️ 2.0 打通知识库导入与 Embedding 入库核心后端链路
  - ✅️ 2.1 新建知识库导入编排器，串联文档快照、解析、分块、chunk 落库、embedding 准备与 embedding 入库
  - ✅️ 2.2 导入链路会落库文档级元数据，并正确写入 source path、byte size、modified time、content hash、fingerprint 和 index state
  - ✅️ 2.3 导入链路会按顺序写入 `kb_chunks`，保留 heading path、page number、language、offset、block count 等元数据
  - ✅️ 2.4 导入链路复用现有 `EmbeddingProvider` 抽象进行 batch embedding
  - ✅️ 2.5 chunk embedding 会写入 `kb_embeddings`，并在成功后更新 `chunk_count`、`embedding_count`、`indexed_at` 与 `ready` 状态
  - ✅️ 2.6 embedding 失败或 embedding 持久化失败时，文档会进入 `failed` 状态并写入 `last_error`
  - ✅️ 2.7 Rust 集成测试已覆盖首次导入成功、重复导入同一路径拒绝、删除后级联清理、删除后重导入路径
  - ✅️ 2.8 通过 Tauri 命令把导入链路正式暴露给前端调用
  - ✅️ 2.9 提供真正的“重建索引”命令，而不是仅依赖“删除后再导入”的测试路径
  - ✅️ 2.10 为 parse / chunk / embed / finalize 阶段提供可供前端消费的进度事件

- ✅️ 3.0 在 parser 层补齐 OCR fallback 与引用元数据保留
  - ✅️ 3.1 新建 `ocr.rs`，定义 OCR trait、输入输出结构与统一错误模型
  - ✅️ 3.2 在 `parser.rs` 中增加页级判断逻辑，仅在文本提取不足时触发 OCR fallback
  - ✅️ 3.3 将 OCR 输出归一化为现有 `ParsedBlock` 结构
  - ✅️ 3.4 OCR 结果会保留 page number、source path、heading path 等可用于引用渲染的元数据
  - ✅️ 3.5 `ParseOptions.enableOcr` 已接入解析入口，未开启时仍走原始文本型 PDF 路径
  - ✅️ 3.6 已有 text PDF / scanned PDF / mixed PDF 的 parser 层回归测试
  - ✅️ 3.7 接入真正可用的 OCR 运行时实现；当前仓库已提供基于 `Windows.Media.Ocr` / `Windows.Data.Pdf` 的 Windows OCR 引擎，并接入命令层 parse/chunk 路径
  - ✅️ 3.8 让知识库导入主链路实际调用 `parse_document_with_ocr()`，使 OCR fallback 覆盖真实导入流程

- ✅️ 4.0 打通知识库检索与结构化 citation 返回
  - ✅️ 4.1 `retriever.rs` 已支持基于 `kb_embeddings` 和 `kb_chunks` 的知识库 chunk 检索
  - ✅️ 4.2 知识库检索结果已包含 `knowledge_base_id`、`document_id`、`chunk_id`、标题、页码、heading path、snippet 和 score
  - ✅️ 4.3 `context_builder.rs` 已把检索结果转换为 token 受控、顺序稳定的 prompt context
  - ✅️ 4.4 后端已能同时返回前端渲染所需的 citation 元信息，避免前端再用 `chunk_id` 二次查库
  - ✅️ 4.5 已新增 `rag_retrieve_with_citations` 命令，返回 `prompt context + citations`
  - ✅️ 4.6 已有空结果、低相似度过滤、不同来源排序、结构化 citation 的后端测试

- ✅️ 5.0 把后端 RAG 能力暴露成完整可用的前后端接口
  - ✅️ 5.1 `store/config.ts` 已新增 RAG 开关、检索范围、OCR 开关、Embedding Provider / Model、自动重建索引策略等配置字段
  - ✅️ 5.2 `ragService.ts` 已声明 retrieval with citations、知识库 CRUD、文档详情、导入、重建索引等前端接口签名
  - ✅️ 5.3 后端已实现并注册 `rag_import_knowledge_document` 命令
  - ✅️ 5.4 后端已实现并注册 `rag_reindex_knowledge_document` 命令
  - ✅️ 5.5 前端已在启动、设置保存、聊天发送及 RAG 服务调用前同步 `rag_configure`，embedding provider 配置会真正下发到后端 `RagEngine`
  - ✅️ 5.6 前端已可通过 `rag_list_knowledge_document_chunks` 拿到文档预览所需的 chunk / page / heading path 明细接口
  - ✅️ 5.7 当前接口层已补齐后台任务状态同步能力，可通过后端任务注册表和 `rag_list_knowledge_import_tasks` / `rag_get_knowledge_import_task` 查询 import / reindex 的最新快照

- ✅️ 6.0 接入聊天主流程，实现 RAG 增强对话
  - ✅️ 6.1 `aiChat.ts` 已为 `sendStream()` / `sendChat()` 增加可选 `retrievalContext` 注入能力
  - ✅️ 6.2 `App.tsx` 普通文本发送前已调用 retrieval，当前主发送链会先获取 retrieval context 再进入聊天请求
  - ✅️ 6.3 当 RAG 关闭、无 ready 知识库文档或 retrieval 失败时，主聊天流程已显式降级到普通聊天分支
  - ✅️ 6.4 assistant 模式与 interviewer 模式已实现不同的 retrieval 策略
  - ✅️ 6.5 `rag.retrievalScope` 已真实影响主聊天链路传给后端的检索来源与会话过滤策略
  - ✅️ 6.6 回答消息下方已渲染 citation 列表，仓库中已新增 `MessageCitations` 组件
  - ✅️ 6.7 继续生成、重试消息等路径已纳入 retrieval / citation 逻辑
  - ✅️ 6.8 已补齐 retrieval off / on / empty result / failure fallback / continue generate 的前端回归验证

- ❌️ 7.0 构建知识库管理 UI
  - ✅️ 7.1 `src/store/rag.ts` 已补齐知识库列表、当前知识库、导入任务进度、文档详情、重建索引状态和错误状态
  - ✅️ 7.2 `App.tsx` 已增加知识库视图入口，`currentView` 也已支持知识库面板状态
  - ✅️ 7.3 已新增 `src/components/KnowledgeBasePanel.tsx`，并替换 `App.tsx` 内联占位页
  - ✅️ 7.4 已新增 `src/components/knowledge/KnowledgeDocumentList.tsx`，并接入知识库面板展示当前库文档列表
  - ✅️ 7.5 已新增 `src/components/knowledge/KnowledgeDocumentPreview.tsx`，并接入文档详情与 chunk 预览
  - ✅️ 7.6 已接入文件选择、导入按钮、乐观状态行、阶段进度显示和失败可见性
  - ✅️ 7.7 已接入删除文档、重建索引、删除知识库操作，并依赖 store 即时刷新当前列表与选中状态
  - ❌️ 7.8 `SettingsPanel.tsx` 尚未增加 RAG 配置区块和知识库入口

- ❌️ 8.0 做增量索引、后台重试与运维加固
  - ❌️ 8.1 尚未基于 fingerprint 做 unchanged file 跳过策略
  - ❌️ 8.2 尚未提供单文档或整库级别的真实重建索引逻辑
  - ❌️ 8.3 尚未提供后台扫描 / 重试命令来处理 `pending` 或 `failed` 文档
  - ❌️ 8.4 尚未为 parse / OCR / embed / retrieve 全链路补齐结构化日志与耗时记录
  - ❌️ 8.5 尚未提供知识库维度的统计查询与展示，包括总文档数、总 chunk 数、总 embedding 数、存储占用和最近一次索引模型
  - ❌️ 8.6 尚未处理应用重启后 `indexing` 状态卡死恢复

- ❌️ 9.0 补齐测试、验收与文档同步
  - ✅️ 9.1 当前 Rust 侧已有较完整的 migration / CRUD / import / OCR parser / retrieval / context builder 测试覆盖
  - ✅️ 9.2 当前仓库已通过一次 `cargo test` 验证
  - ✅️ 9.3 当前仓库已通过一次 `npm run build` 验证
  - ❌️ 9.4 尚未补齐围绕真实导入命令、真实重建索引命令、fingerprint 跳过、启动恢复的集成测试
  - ❌️ 9.5 知识库 UI 的前端测试仍缺失；聊天 RAG 接入已补齐 retrieval fallback / continue generate 的前端回归 harness
  - ❌️ 9.6 `README.md` 尚未同步 RAG 架构、限制和使用方式
  - ❌️ 9.7 `TODO.md` 尚未同步为当前真实进度

- ✅️ 10.0 强化 Agent Harness 的 skills 与提交流程约束
  - ✅️ 10.1 `Agent.md` 已加入 skills 检查、`requesting-code-review` 审查闭环、`writing-guide` 文档时机与 `/clear` 规则
  - ✅️ 10.2 `.cursor/rules/agent-harness.mdc` 已同步 skills 加载、review 闭环和 `/clear` 重载流程
  - ✅️ 10.3 `.github/workflows/build-windows.yml` 已加入 `npm run build` 与 `cargo test` 验证门禁
