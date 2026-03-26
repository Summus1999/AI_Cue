## Relevant Files

- `src-tauri/src/rag/mod.rs` - RAG 引擎装配入口；需要把当前仅支持 `QwenEmbedding` 的实现收口成可配置的 Provider，并接入知识库导入/检索能力。
- `src-tauri/src/rag/embedder.rs` - EmbeddingProvider trait 与各 Provider 实现；需要补齐运行时选择、批量调用、模型维度校验和错误语义。
- `src-tauri/src/rag/retriever.rs` - 检索结果模型与混合检索逻辑；需要修复当前 `message_id`/`embedding_id` 混用问题，并返回可用于引用标注的结构化来源信息。
- `src-tauri/src/rag/vector_store.rs` - 向量存储 CRUD；需要扩展或拆分为知识库文档分块向量存储，支持 chunk 级别查询和删除。
- `src-tauri/src/rag/parser.rs` - 文档解析入口；需要新增扫描版 PDF 检测和 OCR fallback，而不破坏现有文本型 PDF 路径。
- `src-tauri/src/rag/chunker.rs` - 文档分块逻辑；需要保证入库后的 chunk 元数据足够支持来源定位、预览和重建索引。
- `src-tauri/src/rag/context_builder.rs` - RAG Prompt 构建；需要输出 token 受控的上下文片段和可供前端渲染的引用元信息。
- `src-tauri/src/rag/integration_test.rs` - Rust 集成测试；应覆盖导入、检索、删除、重建索引、fallback 等关键路径。
- `src-tauri/src/rag/ocr.rs` - 新文件；封装 OCR 抽象和首个 OCR 实现，避免解析层直接绑定具体库。
- `src-tauri/src/rag/knowledge_base.rs` - 新文件；编排知识库文档导入、分块、向量化、入库和重建索引流程。
- `src-tauri/src/database.rs` - 数据库迁移与 CRUD；需要新增知识库表结构和对应的数据访问函数。
- `src-tauri/src/commands.rs` - Tauri 命令入口；需要新增知识库 CRUD、导入、重建索引、检索增强等命令。
- `src-tauri/src/lib.rs` - 应用启动入口；需要初始化可配置的 RAG 组件并注册新命令。
- `src/store/config.ts` - 前端配置持久化；需要新增 RAG 开关、Embedding Provider/模型、OCR 开关、检索策略等配置项。
- `src/services/ragService.ts` - 前端 RAG 服务层；需要扩展知识库 CRUD、导入进度、文档详情、检索引用等接口。
- `src/services/aiChat.ts` - AI 对话服务；需要在发起聊天前注入检索上下文，并在失败时优雅回退到普通对话。
- `src/store/rag.ts` - 前端 RAG 状态管理；需要保存知识库列表、文档导入进度、检索结果、错误状态和用户开关。
- `src/App.tsx` - 主界面对话编排；需要在发送消息前触发检索、在回答后展示来源引用、接入知识库页面入口。
- `src/components/SettingsPanel.tsx` - 设置页面；需要增加 RAG 配置区块和知识库入口。
- `src/components/KnowledgeBasePanel.tsx` - 新文件；新增知识库管理全屏面板，复用现有 settings/session 的切页模式。
- `src/components/knowledge/KnowledgeDocumentList.tsx` - 新文件；展示文档列表、导入状态、筛选和操作按钮。
- `src/components/knowledge/KnowledgeDocumentPreview.tsx` - 新文件；展示文档元数据、解析预览、chunk/页码/标题路径信息。

### Notes

- 当前仓库没有前端测试框架；前端改动至少要通过 `npm run build` 验证类型和打包。
- Rust 端优先使用模块内测试和 `src-tauri/src/rag/integration_test.rs`，并用 `cargo test` 验证数据库迁移、导入和检索路径。
- OCR 实现建议通过独立抽象层接入，避免 `parser.rs` 直接耦合某个 native 依赖，方便后续替换实现。
- 知识库文档向量不要直接复用当前消息向量的语义模型，否则删除、去重、来源标注和增量更新都会变得混乱。
- 大文件导入不要用单个同步命令阻塞 UI；解析、分块、Embedding、落库应分阶段上报进度。

## Instructions for Completing Tasks

**IMPORTANT:** As you complete each task, you must check it off in this markdown file by changing `- [ ]` to `- [x]`.

Update the file after completing each sub-task, not just after completing an entire parent task.

## Tasks

- [ ] 0.0 Create feature branch
  - [ ] 0.1 Create and checkout a new branch for this feature (for example `git checkout -b feature/rag-knowledge-base-followups`)

- [x] 1.0 Stabilize the backend RAG foundation before adding new features
  - [x] 1.1 Audit the current `SearchResult` and `VectorStore` identity model, and define canonical fields for `embedding_id`, `message_id`, `document_id`, `chunk_id`, and `source_kind`
  - [x] 1.2 Fix `vector_search()` so it returns the correct chunk identity instead of using `vec_embeddings.id` as `message_id`
  - [x] 1.3 Decide whether to extend the existing `VectorStore` or add a dedicated knowledge-base store layer, then reflect that boundary in types and comments
  - [x] 1.4 Change `RagEngine` to hold a pluggable `EmbeddingProvider` (trait object or provider enum) instead of `Option<QwenEmbedding>`
  - [x] 1.5 Implement a real `rag_configure` or startup configuration path so Qwen/OpenAI embedding models can be selected at runtime
  - [x] 1.6 Add regression tests covering engine configuration, vector identity mapping, and search result hydration

- [x] 2.0 Add persistent knowledge-base schema and backend CRUD
  - [x] 2.1 Design tables for `knowledge_bases`, `kb_documents`, `kb_chunks`, and `kb_embeddings`, with indexes and cascade delete rules
  - [x] 2.2 Add a new migration in `database.rs` to create the knowledge-base tables and bump `user_version`
  - [x] 2.3 Implement database CRUD for creating/listing/deleting knowledge bases and listing/getting/deleting documents
  - [x] 2.4 Store document fingerprint metadata such as absolute path, byte size, modified time, and content hash for dedupe and reindex decisions
  - [x] 2.5 Add index state fields such as `pending`, `indexing`, `ready`, and `failed`, plus `last_error`, so the UI can render retries and failure states
  - [x] 2.6 Add tests for migration success, duplicate-document protection, and cascade delete behavior

- [ ] 3.0 Implement the document import and embedding ingestion pipeline
  - [ ] 3.1 Create a knowledge-base import orchestrator that runs `parse_document()` and `chunk_document()` for a selected file
  - [ ] 3.2 Persist parsed document metadata and every chunk while preserving heading path, page number, language, and offset information
  - [ ] 3.3 Batch-call the configured embedder and write chunk embeddings into the knowledge-base vector tables
  - [ ] 3.4 Add chunk-level retry and failure handling so one failed embedding batch does not silently corrupt the document state
  - [ ] 3.5 Emit progress updates for parse, chunk, embed, and finalize phases from Rust to the frontend
  - [ ] 3.6 Add Tauri commands for import, reindex, list documents, get document detail, and delete document
  - [ ] 3.7 Add integration tests covering import success, reindex, delete, and repeated import of the same file

- [ ] 4.0 Add OCR fallback for scanned PDFs without regressing text PDFs
  - [ ] 4.1 Introduce a dedicated `ocr.rs` abstraction with one concrete implementation and a clear error model
  - [ ] 4.2 Add page-level heuristics in `parser.rs` to detect “text extraction insufficient” cases instead of sending every PDF page through OCR
  - [ ] 4.3 For scanned pages, rasterize the page and run OCR, then normalize the OCR output into the existing `ParsedBlock` structure
  - [ ] 4.4 Preserve page numbers and citation metadata even when the content comes from OCR
  - [ ] 4.5 Gate OCR behind config or feature flags so environments without OCR runtime support still work for text-only PDFs
  - [ ] 4.6 Add tests and sample fixtures for text-PDF, scanned-PDF fallback, and mixed PDFs where only part of the pages need OCR

- [ ] 5.0 Build the knowledge-base management UI
  - [ ] 5.1 Extend `AppConfig` with RAG settings: enabled switch, retrieval scope, embedding provider/model, OCR toggle, and auto-reindex policy
  - [ ] 5.2 Create frontend types and service methods for knowledge-base CRUD, import progress, and document preview
  - [ ] 5.3 Add a lazily loaded `KnowledgeBasePanel` that follows the existing full-screen panel pattern used by settings and session views
  - [ ] 5.4 Implement the file import flow with system file picker, optimistic status rows, progress display, and actionable failure states
  - [ ] 5.5 Build document list filters for index state, file type, and last updated time
  - [ ] 5.6 Add document preview showing title, file path, parse summary, and representative chunks, pages, or heading paths
  - [ ] 5.7 Add delete and reindex actions with confirmation and immediate state refresh

- [ ] 6.0 Wire retrieval-augmented chat into the existing conversation pipeline
  - [ ] 6.1 Add backend retrieval commands that return both prompt-ready context and structured citation metadata
  - [ ] 6.2 Define retrieval policy by mode: assistant mode default on, interviewer mode configurable or off by default unless explicitly enabled
  - [ ] 6.3 In `App.tsx`, run retrieval before `sendStream()` and skip cleanly when RAG is disabled or no indexed documents exist
  - [ ] 6.4 In `aiChat.ts`, inject the returned context into the system prompt in a deterministic, token-bounded format
  - [ ] 6.5 Keep failure behavior non-blocking: if retrieval fails, log it and continue with plain chat instead of breaking the answer path
  - [ ] 6.6 Render source citations under assistant messages with document title, page number or heading path, and snippet preview
  - [ ] 6.7 Add regression coverage for retrieval-off, retrieval-on, empty-result, and failure-fallback scenarios

- [ ] 7.0 Add incremental indexing and operational hardening
  - [ ] 7.1 Use stored fingerprint metadata to detect unchanged files and skip redundant re-embedding
  - [ ] 7.2 Add a background command to scan unindexed documents or retry failed documents for future batch import support
  - [ ] 7.3 Record structured logs around parse, OCR, embed, and retrieve latency and failure causes
  - [ ] 7.4 Surface stats in the backend and UI for total documents, total chunks, total embeddings, storage size, and last indexed model
  - [ ] 7.5 Update `README.md`, `TODO.md`, and related design docs so the documented RAG architecture matches the implemented behavior and constraints
