## Relevant Files

- `src-tauri/src/rag/mod.rs` - RAG 入口与组件装配；后续需要接入知识库导入、知识库检索和引用数据返回。
- `src-tauri/src/rag/embedder.rs` - EmbeddingProvider 抽象与具体实现；后续需要支撑批量嵌入、模型维度校验和失败语义统一。
- `src-tauri/src/rag/retriever.rs` - 当前检索逻辑主要面向消息向量；需要扩展到知识库文档 chunk 检索和结构化引用返回。
- `src-tauri/src/rag/context_builder.rs` - RAG 上下文构建；需要输出 token 受控的 prompt 上下文和前端可渲染的 citation 元信息。
- `src-tauri/src/rag/parser.rs` - 文档解析入口；需要补充扫描版 PDF 检测和 OCR fallback。
- `src-tauri/src/rag/chunker.rs` - 文档分块逻辑；需要确保 heading path、页码、offset、语言等元数据完整保留到入库链路。
- `src-tauri/src/rag/knowledge_base.rs` - 新文件；负责知识库导入编排，当前已完成文档快照落库、解析/分块、`kb_chunks` 持久化、基于 `EmbeddingProvider` 的批量 embedding 准备与 `kb_embeddings` 入库，并补齐 embedding/持久化失败后的恢复语义；后续继续补重建索引和阶段进度上报。
- `src-tauri/src/rag/ocr.rs` - 新文件；封装 OCR 抽象、实现和错误模型，避免 parser 直接耦合具体 OCR 库。
- `src-tauri/src/rag/integration_test.rs` - Rust 端集成测试；当前已覆盖知识库首次导入成功、重复导入同一路径拒绝、删除后的级联清理，以及基于“删除后重导入”的当前重建索引路径；后续继续补 OCR fallback、检索和失败回退。
- `src-tauri/src/database.rs` - 知识库 Schema、基础 CRUD 与 chunk/embedding 基础写入接口已就绪；后续需要补充 fingerprint 跳过、统计查询和更完整的导入/重建辅助接口。
- `src-tauri/src/commands.rs` - Tauri 命令入口；需要新增导入、重建索引、检索增强和后台扫描/重试命令。
- `src-tauri/src/lib.rs` - 应用启动入口；需要注册新增命令并初始化可能新增的 RAG 运行时组件。
- `src/services/ragService.ts` - 前端 RAG 服务层；目前只有基础搜索/解析接口，需要扩展知识库 CRUD、导入进度、文档详情、检索引用等接口。
- `src/services/aiChat.ts` - AI 对话服务；需要在聊天前注入检索上下文，并在检索失败时优雅回退到普通对话。
- `src/store/config.ts` - 应用配置持久化；需要新增 RAG 开关、检索策略、OCR 开关、自动重建索引策略等配置。
- `src/store/rag.ts` - 现有 RAG store 未接入主流程；需要扩展知识库列表、导入任务、检索结果、错误和统计状态。
- `src/App.tsx` - 主聊天编排；需要在发送消息前触发检索、在消息下方渲染引用，并增加知识库入口。
- `src/components/SettingsPanel.tsx` - 设置面板；需要新增 RAG 配置区块和知识库管理入口。
- `src/components/KnowledgeBasePanel.tsx` - 新文件；知识库管理全屏面板，承载文档列表、导入、筛选、重建索引和预览。
- `src/components/knowledge/KnowledgeDocumentList.tsx` - 新文件；展示文档列表、索引状态、筛选条件和操作按钮。
- `src/components/knowledge/KnowledgeDocumentPreview.tsx` - 新文件；展示文档元数据、解析摘要、chunk/页码/标题路径预览。
- `src/components/MessageCitations.tsx` - 新文件；渲染回答下方的知识来源引用。
- `README.md` - 需要在实现完成后同步更新 RAG 架构、限制和使用说明。
- `TODO.md` - 需要在实现完成后修正已完成/未完成项，避免与真实状态偏离。

### Notes

- 当前代码已完成知识库 Schema、迁移、基础 CRUD 和运行时 EmbeddingProvider 配置，这些不应再作为主任务重复拆解。
- 当前 `RagEngine` 仍主要面向消息向量检索，知识库文档的导入、嵌入、检索和引用链路尚未打通。
- 当前前端存在 `src/store/rag.ts` 和 `src/services/ragService.ts`，但尚未接入 `App.tsx` 主聊天流程。
- 当前仓库没有成体系的前端测试框架；前端改动至少应通过 `npm run build` 验证，Rust 改动应通过 `cargo test` 验证。
- OCR 需要用独立抽象层接入，避免把 `parser.rs` 绑死到某个 native OCR 依赖上。
- 大文件导入不应由单个同步命令阻塞 UI；解析、分块、嵌入、落库、完成态更新应分阶段上报进度。

## Instructions for Completing Tasks

**IMPORTANT:** As you complete each task, you must check it off in this markdown file by changing `- [ ]` to `- [x]`.

Update the file after completing each sub-task, not just after completing an entire parent task.

## Tasks

- [x] 0.0 Create feature branch
  - [x] 0.1 Create and checkout a new branch for this feature (for example `git checkout -b feature/rag-current-real-state`)

- [x] 1.0 打通知识库导入与 Embedding 入库主链路
  - [x] 1.1 新建 `src-tauri/src/rag/knowledge_base.rs`，定义导入编排器，串联 `parse_document()`、`chunk_document()`、文档记录初始化和最终状态收口
  - [x] 1.2 在导入链路中落库文档级元数据，复用现有 `kb_documents` 表，正确写入 source path、byte size、modified time、content hash、fingerprint 和 index state
  - [x] 1.3 将每个 chunk 按顺序写入 `kb_chunks`，确保 heading path、page number、language、start/end offset、block count 等元数据不丢失
  - [x] 1.4 为知识库文档实现批量 embedding 调用，优先复用现有 `EmbeddingProvider` 抽象，而不是再引入一套平行接口
  - [x] 1.5 将 chunk embedding 写入 `kb_embeddings`，并在成功后回填 `embedding_count`、`chunk_count`、`indexed_at` 和 `ready` 状态
  - [x] 1.6 为单批次 embedding 失败实现可恢复语义，至少保证文档状态进入 `failed`，并写入 `last_error`，避免半成功半失败的脏状态
  - [x] 1.7 增加导入、重建索引、删除后的集成测试，覆盖首次导入成功、重复导入同一文件、删除后级联清理和重建索引成功

- [ ] 2.0 补齐 OCR fallback，覆盖扫描版 PDF
  - [ ] 2.1 新建 `src-tauri/src/rag/ocr.rs`，定义 OCR trait、统一错误模型和首个可替换实现
  - [ ] 2.2 在 `parser.rs` 中增加页级检测逻辑，只在文本提取不足时才触发 OCR，而不是对所有 PDF 页统一走 OCR
  - [ ] 2.3 将 OCR 输出归一化为现有 `ParsedBlock` 结构，避免后续 chunker 和导入流水线需要分支处理
  - [ ] 2.4 确保扫描页经 OCR 后仍保留 page number、source path、heading path 或其他可用于引用渲染的元数据
  - [ ] 2.5 为 OCR 提供 feature flag 或配置开关，使没有 OCR 运行时依赖的环境仍可正常处理文本型 PDF
  - [ ] 2.6 增加 text PDF、scanned PDF、mixed PDF 的测试或夹具，验证不会回归已有文本型 PDF 路径

- [ ] 3.0 打通知识库检索与引用数据返回
  - [ ] 3.1 扩展 `retriever.rs`，支持基于 `kb_embeddings` 和 `kb_chunks` 的知识库 chunk 检索，而不是只检索消息向量
  - [ ] 3.2 为知识库检索结果定义稳定的数据结构，至少包含 `knowledge_base_id`、`document_id`、`chunk_id`、标题、页码或 heading path、snippet 和 score
  - [ ] 3.3 在 `context_builder.rs` 中将检索结果转换为 token 受控的 prompt 上下文，保证模型可消费且顺序稳定
  - [ ] 3.4 同时返回前端渲染所需的 citation 元信息，避免前端再用 `chunk_id` 二次查库拼装
  - [ ] 3.5 补一个后端 retrieval 命令，返回“prompt context + citations”组合结果，而不是只返回纯文本 context
  - [ ] 3.6 为空结果、低相似度过滤、不同来源排序和结构化引用返回增加测试

- [ ] 4.0 接入聊天主流程，实现 RAG 增强对话
  - [ ] 4.1 在 `store/config.ts` 中增加 RAG 配置项：总开关、检索作用范围、OCR 开关、Embedding Provider/Model、自动重建索引策略
  - [ ] 4.2 在 `ragService.ts` 中新增知识库相关接口：创建/列出/删除知识库、列出/查看/删除文档、导入、重建索引、retrieval with citations
  - [ ] 4.3 在 `aiChat.ts` 中为 `sendStream()` 和 `sendChat()` 增加可选 retrieval context 注入能力，保持 system prompt 注入格式确定且可控
  - [ ] 4.4 在 `App.tsx` 中发送消息前触发 retrieval，当 RAG 关闭、无已索引文档或检索失败时，明确走非阻塞 fallback
  - [ ] 4.5 为 assistant 模式和 interviewer 模式分别定义默认 retrieval 策略，避免面试官模式在未明确开启时被知识库内容污染
  - [ ] 4.6 在回答消息下方渲染 citation 列表，展示文档标题、页码或 heading path、片段摘要和必要的来源标识
  - [ ] 4.7 增加 retrieval off、retrieval on、empty result、retrieval failure fallback、continue generate 场景下的回归验证

- [ ] 5.0 构建知识库管理 UI
  - [ ] 5.1 扩展 `src/store/rag.ts`，增加知识库列表、当前知识库、导入任务进度、文档详情、重建索引状态和错误状态
  - [ ] 5.2 新建 `src/components/KnowledgeBasePanel.tsx`，复用现有全屏面板切页模式，作为知识库主入口
  - [ ] 5.3 新建 `src/components/knowledge/KnowledgeDocumentList.tsx`，展示文档列表、索引状态、文件类型、更新时间和操作按钮
  - [ ] 5.4 新建 `src/components/knowledge/KnowledgeDocumentPreview.tsx`，展示文档标题、路径、解析摘要、代表性 chunk、页码和 heading path
  - [ ] 5.5 在 UI 中实现文件导入流程，包括系统文件选择、乐观插入状态行、分阶段进度显示和失败可见性
  - [ ] 5.6 补齐知识库操作：删除文档、重建索引、删除知识库，并在操作后立即刷新相关列表与统计
  - [ ] 5.7 在 `SettingsPanel.tsx` 中增加 RAG 配置区块和知识库入口，保持现有设置页视觉和交互模式一致

- [ ] 6.0 做增量索引、后台重试与运维加固
  - [ ] 6.1 基于已存储 fingerprint 元数据实现 unchanged file 跳过策略，避免重复嵌入相同文件
  - [ ] 6.2 提供重建索引逻辑，允许用户对单个文档或整个知识库重新解析和重新嵌入
  - [ ] 6.3 新增后台扫描/重试命令，用于处理 `pending` 或 `failed` 文档，支撑未来批量导入
  - [ ] 6.4 为 parse、OCR、embed、retrieve 全链路增加结构化日志，记录耗时、模型、失败原因和重试信息
  - [ ] 6.5 增加统计查询与展示，包括总文档数、总 chunk 数、总 embedding 数、存储占用和最近一次索引使用的模型
  - [ ] 6.6 确保导入中断、应用重启后再次进入时，不会把旧的 `indexing` 状态永久卡死

- [ ] 7.0 补齐测试、验收与文档同步
  - [ ] 7.1 在 `src-tauri/src/rag/integration_test.rs` 中补齐导入、OCR fallback、检索、删除、重建索引、fingerprint 跳过和失败回退的集成测试
  - [ ] 7.2 为 `retriever.rs`、`context_builder.rs` 和 `knowledge_base.rs` 增加必要的模块级单元测试，覆盖边界条件和错误路径
  - [ ] 7.3 执行 `cargo test` 验证 Rust 端关键链路，修复因新命令、新表查询或 OCR 集成引入的回归
  - [ ] 7.4 执行 `npm run build` 验证前端类型、懒加载面板和主聊天流程改动没有破坏构建
  - [ ] 7.5 更新 `README.md`、`TODO.md` 和相关设计文档，明确当前 RAG 架构、已完成项、未完成项和环境约束
