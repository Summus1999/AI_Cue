use super::{
    chunk_document, create_default_ocr_engine, parse_document_with_ocr, ChunkConfig, ChunkType,
    DocumentChunk, DocumentType, EmbeddingProvider, OcrEngine, ParseOptions, ParsedDocument,
    ParsedDocumentMetadata,
};
use crate::database::{
    create_knowledge_document, get_knowledge_document, get_knowledge_document_by_source_path,
    insert_knowledge_chunks, insert_knowledge_embeddings, list_knowledge_document_chunks,
    list_knowledge_document_embeddings, reset_knowledge_document_for_reindex,
    update_knowledge_document_index_state, CreateKnowledgeChunkInput, CreateKnowledgeDocumentInput,
    CreateKnowledgeEmbeddingInput, Database, KnowledgeChunkRecord, KnowledgeDocumentIndexState,
    KnowledgeDocumentRecord, KnowledgeEmbeddingRecord,
};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBaseImportRequest {
    pub knowledge_base_id: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parse_options: Option<ParseOptions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunk_config: Option<ChunkConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReindexKnowledgeDocumentRequest {
    pub document_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parse_options: Option<ParseOptions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunk_config: Option<ChunkConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedKnowledgeBaseImport {
    pub document: KnowledgeDocumentRecord,
    pub parsed_document: ParsedDocument,
    pub chunks: Vec<DocumentChunk>,
    pub persisted_chunks: Vec<KnowledgeChunkRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedKnowledgeChunkEmbedding {
    pub knowledge_base_id: String,
    pub document_id: String,
    pub chunk_id: String,
    pub chunk_index: usize,
    pub text: String,
    pub model_id: String,
    pub embedding_dim: usize,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedKnowledgeBaseImport {
    pub document: KnowledgeDocumentRecord,
    pub parsed_document: ParsedDocument,
    pub chunks: Vec<DocumentChunk>,
    pub persisted_chunks: Vec<KnowledgeChunkRecord>,
    pub persisted_embeddings: Vec<KnowledgeEmbeddingRecord>,
}

pub type KnowledgeBaseImportProgressCallback =
    Arc<dyn Fn(KnowledgeBaseImportProgress) + Send + Sync>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum KnowledgeBaseImportOperation {
    Import,
    Reindex,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum KnowledgeBaseImportStage {
    Parse,
    Chunk,
    Embed,
    Finalize,
}

impl KnowledgeBaseImportStage {
    fn current(self) -> usize {
        match self {
            Self::Parse => 1,
            Self::Chunk => 2,
            Self::Embed => 3,
            Self::Finalize => 4,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum KnowledgeBaseImportProgressStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBaseImportProgress {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub operation: KnowledgeBaseImportOperation,
    pub stage: KnowledgeBaseImportStage,
    pub status: KnowledgeBaseImportProgressStatus,
    pub current: usize,
    pub total: usize,
    pub knowledge_base_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunk_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub embedding_count: Option<usize>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDocumentSnapshot {
    pub source_path: String,
    pub file_name: String,
    pub title: String,
    pub file_extension: Option<String>,
    pub document_type: String,
    pub source_byte_size: u64,
    pub source_modified_at: i64,
    pub content_hash: String,
    pub fingerprint: String,
}

impl SourceDocumentSnapshot {
    pub fn from_path(path: &str) -> Result<Self, String> {
        let source_path = Path::new(path);

        if !source_path.exists() {
            return Err(format!("文件不存在: {path}"));
        }

        if !source_path.is_file() {
            return Err(format!("不是文件: {path}"));
        }

        let normalized_path = canonicalize_path(source_path);
        let metadata =
            fs::metadata(&normalized_path).map_err(|e| format!("读取文件信息失败: {e}"))?;
        let file_bytes = fs::read(&normalized_path).map_err(|e| format!("读取文件失败: {e}"))?;

        let extension = normalized_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase());
        let content_hash = sha1_hex(&file_bytes);
        let source_path_string = normalized_path.to_string_lossy().into_owned();
        let source_modified_at = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
            .unwrap_or(0);

        Ok(Self {
            file_name: normalized_path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| format!("无法解析文件名: {}", normalized_path.display()))?
                .to_string(),
            title: normalized_path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .ok_or_else(|| format!("无法解析文件标题: {}", normalized_path.display()))?
                .to_string(),
            document_type: infer_document_type(extension.as_deref()).to_string(),
            file_extension: extension,
            source_byte_size: metadata.len(),
            source_modified_at,
            fingerprint: format!(
                "fp:{}:{}:{}:{}",
                source_path_string,
                metadata.len(),
                source_modified_at,
                content_hash
            ),
            source_path: source_path_string,
            content_hash,
        })
    }

    fn to_create_document_input(
        &self,
        knowledge_base_id: &str,
        index_state: KnowledgeDocumentIndexState,
    ) -> CreateKnowledgeDocumentInput {
        CreateKnowledgeDocumentInput {
            knowledge_base_id: knowledge_base_id.to_string(),
            title: self.title.clone(),
            file_name: self.file_name.clone(),
            file_extension: self.file_extension.clone(),
            document_type: self.document_type.clone(),
            source_path: self.source_path.clone(),
            source_byte_size: self.source_byte_size,
            source_modified_at: self.source_modified_at,
            content_hash: self.content_hash.clone(),
            fingerprint: self.fingerprint.clone(),
            index_state: Some(index_state),
            last_error: None,
        }
    }
}

#[derive(Debug, Clone)]
struct KnowledgeBaseImportProgressContext {
    request_id: Option<String>,
    operation: KnowledgeBaseImportOperation,
    knowledge_base_id: String,
    document_id: Option<String>,
    file_name: Option<String>,
    source_path: Option<String>,
}

impl KnowledgeBaseImportProgressContext {
    fn new(
        request_id: Option<String>,
        operation: KnowledgeBaseImportOperation,
        knowledge_base_id: String,
        document_id: Option<String>,
        file_name: Option<String>,
        source_path: Option<String>,
    ) -> Self {
        Self {
            request_id,
            operation,
            knowledge_base_id,
            document_id,
            file_name,
            source_path,
        }
    }

    fn event(
        &self,
        stage: KnowledgeBaseImportStage,
        status: KnowledgeBaseImportProgressStatus,
        message: impl Into<String>,
        chunk_count: Option<usize>,
        embedding_count: Option<usize>,
    ) -> KnowledgeBaseImportProgress {
        KnowledgeBaseImportProgress {
            request_id: self.request_id.clone(),
            operation: self.operation,
            stage,
            status,
            current: stage.current(),
            total: 4,
            knowledge_base_id: self.knowledge_base_id.clone(),
            document_id: self.document_id.clone(),
            file_name: self.file_name.clone(),
            source_path: self.source_path.clone(),
            chunk_count,
            embedding_count,
            message: message.into(),
        }
    }
}

pub struct KnowledgeBaseImportOrchestrator {
    db: Arc<Database>,
    ocr_engine: Arc<dyn OcrEngine>,
}

impl KnowledgeBaseImportOrchestrator {
    pub fn new(db: Arc<Database>) -> Self {
        Self::with_ocr_engine(db, create_default_ocr_engine())
    }

    pub fn with_ocr_engine(db: Arc<Database>, ocr_engine: Arc<dyn OcrEngine>) -> Self {
        Self { db, ocr_engine }
    }

    pub async fn import_document_with_embeddings(
        &self,
        request: &KnowledgeBaseImportRequest,
        embedder: Arc<dyn EmbeddingProvider>,
    ) -> Result<CompletedKnowledgeBaseImport, String> {
        self.import_document_with_embeddings_and_progress(request, embedder, None)
            .await
    }

    pub async fn import_document_with_embeddings_and_progress(
        &self,
        request: &KnowledgeBaseImportRequest,
        embedder: Arc<dyn EmbeddingProvider>,
        progress_callback: Option<KnowledgeBaseImportProgressCallback>,
    ) -> Result<CompletedKnowledgeBaseImport, String> {
        let snapshot = SourceDocumentSnapshot::from_path(&request.path)?;
        if let Some(existing_document) = get_knowledge_document_by_source_path(
            &self.db,
            &request.knowledge_base_id,
            &snapshot.source_path,
        )? {
            if existing_document.fingerprint == snapshot.fingerprint {
                if existing_document.index_state == KnowledgeDocumentIndexState::Ready {
                    if !self.document_embeddings_match_model(&existing_document.id, embedder.model_id())? {
                        return Err(format!(
                            "该文件未发生变化，但当前 embedding 模型 {} 与现有索引不一致，请改用重建索引",
                            embedder.model_id()
                        ));
                    }

                    let progress_context = KnowledgeBaseImportProgressContext::new(
                        request.progress_event_id.clone(),
                        KnowledgeBaseImportOperation::Import,
                        existing_document.knowledge_base_id.clone(),
                        Some(existing_document.id.clone()),
                        Some(existing_document.file_name.clone()),
                        Some(existing_document.source_path.clone()),
                    );

                    self.report_progress(
                        progress_callback.as_ref(),
                        progress_context.event(
                            KnowledgeBaseImportStage::Finalize,
                            KnowledgeBaseImportProgressStatus::Completed,
                            "文件未发生变化，跳过导入并复用现有索引".to_string(),
                            Some(existing_document.chunk_count),
                            Some(existing_document.embedding_count),
                        ),
                    );

                    return self.load_completed_import_from_existing_document(&existing_document.id);
                }

                return Err(format!(
                    "该文件未发生变化，但当前索引状态为 {}，请改用重建索引或处理失败文档",
                    existing_document.index_state.as_str()
                ));
            }

            return Err("该知识库中已存在同一路径且文件内容已变化的文档，请改用重建索引而不是重复导入".to_string());
        }

        let prepared = self
            .prepare_import_with_progress(request, progress_callback.as_ref())
            .await?;
        let progress_context = KnowledgeBaseImportProgressContext::new(
            request.progress_event_id.clone(),
            KnowledgeBaseImportOperation::Import,
            prepared.document.knowledge_base_id.clone(),
            Some(prepared.document.id.clone()),
            Some(prepared.document.file_name.clone()),
            Some(prepared.document.source_path.clone()),
        );

        self.report_progress(
            progress_callback.as_ref(),
            progress_context.event(
                KnowledgeBaseImportStage::Embed,
                KnowledgeBaseImportProgressStatus::Running,
                format!("正在生成 {} 个分块的 embedding", prepared.chunks.len()),
                Some(prepared.chunks.len()),
                None,
            ),
        );

        let prepared_embeddings = match self
            .embed_prepared_document_or_mark_failed(&prepared, embedder)
            .await
        {
            Ok(embeddings) => {
                self.report_progress(
                    progress_callback.as_ref(),
                    progress_context.event(
                        KnowledgeBaseImportStage::Embed,
                        KnowledgeBaseImportProgressStatus::Completed,
                        format!("embedding 生成完成，共 {} 条向量", embeddings.len()),
                        Some(prepared.chunks.len()),
                        Some(embeddings.len()),
                    ),
                );
                embeddings
            }
            Err(error) => {
                self.report_progress(
                    progress_callback.as_ref(),
                    progress_context.event(
                        KnowledgeBaseImportStage::Embed,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("embedding 生成失败: {error}"),
                        Some(prepared.chunks.len()),
                        None,
                    ),
                );
                return Err(error);
            }
        };

        self.report_progress(
            progress_callback.as_ref(),
            progress_context.event(
                KnowledgeBaseImportStage::Finalize,
                KnowledgeBaseImportProgressStatus::Running,
                "正在写入向量并完成索引".to_string(),
                Some(prepared.persisted_chunks.len()),
                Some(prepared_embeddings.len()),
            ),
        );

        let persisted_embeddings = match self
            .persist_prepared_embeddings_or_mark_failed(&prepared.document.id, &prepared_embeddings)
        {
            Ok(embeddings) => embeddings,
            Err(error) => {
                self.report_progress(
                    progress_callback.as_ref(),
                    progress_context.event(
                        KnowledgeBaseImportStage::Finalize,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("索引收尾失败: {error}"),
                        Some(prepared.persisted_chunks.len()),
                        Some(prepared_embeddings.len()),
                    ),
                );
                return Err(error);
            }
        };
        let document = match self.load_document(&prepared.document.id) {
            Ok(document) => document,
            Err(error) => {
                self.report_progress(
                    progress_callback.as_ref(),
                    progress_context.event(
                        KnowledgeBaseImportStage::Finalize,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("读取最终文档状态失败: {error}"),
                        Some(prepared.persisted_chunks.len()),
                        Some(prepared_embeddings.len()),
                    ),
                );
                return Err(error);
            }
        };

        self.report_progress(
            progress_callback.as_ref(),
            progress_context.event(
                KnowledgeBaseImportStage::Finalize,
                KnowledgeBaseImportProgressStatus::Completed,
                format!(
                    "知识库文档索引完成，共 {} 个分块、{} 条向量",
                    document.chunk_count, document.embedding_count
                ),
                Some(document.chunk_count),
                Some(document.embedding_count),
            ),
        );

        Ok(CompletedKnowledgeBaseImport {
            document,
            parsed_document: prepared.parsed_document,
            chunks: prepared.chunks,
            persisted_chunks: prepared.persisted_chunks,
            persisted_embeddings,
        })
    }

    pub async fn reindex_document_with_embeddings(
        &self,
        request: &ReindexKnowledgeDocumentRequest,
        embedder: Arc<dyn EmbeddingProvider>,
    ) -> Result<CompletedKnowledgeBaseImport, String> {
        self.reindex_document_with_embeddings_and_progress(request, embedder, None)
            .await
    }

    pub async fn reindex_document_with_embeddings_and_progress(
        &self,
        request: &ReindexKnowledgeDocumentRequest,
        embedder: Arc<dyn EmbeddingProvider>,
        progress_callback: Option<KnowledgeBaseImportProgressCallback>,
    ) -> Result<CompletedKnowledgeBaseImport, String> {
        let prepared = self
            .prepare_reindex_with_progress(request, progress_callback.as_ref())
            .await?;
        let progress_context = KnowledgeBaseImportProgressContext::new(
            request.progress_event_id.clone(),
            KnowledgeBaseImportOperation::Reindex,
            prepared.document.knowledge_base_id.clone(),
            Some(prepared.document.id.clone()),
            Some(prepared.document.file_name.clone()),
            Some(prepared.document.source_path.clone()),
        );

        self.report_progress(
            progress_callback.as_ref(),
            progress_context.event(
                KnowledgeBaseImportStage::Embed,
                KnowledgeBaseImportProgressStatus::Running,
                format!("正在生成 {} 个分块的 embedding", prepared.chunks.len()),
                Some(prepared.chunks.len()),
                None,
            ),
        );

        let prepared_embeddings = match self
            .embed_prepared_document_or_mark_failed(&prepared, embedder)
            .await
        {
            Ok(embeddings) => {
                self.report_progress(
                    progress_callback.as_ref(),
                    progress_context.event(
                        KnowledgeBaseImportStage::Embed,
                        KnowledgeBaseImportProgressStatus::Completed,
                        format!("embedding 生成完成，共 {} 条向量", embeddings.len()),
                        Some(prepared.chunks.len()),
                        Some(embeddings.len()),
                    ),
                );
                embeddings
            }
            Err(error) => {
                self.report_progress(
                    progress_callback.as_ref(),
                    progress_context.event(
                        KnowledgeBaseImportStage::Embed,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("embedding 生成失败: {error}"),
                        Some(prepared.chunks.len()),
                        None,
                    ),
                );
                return Err(error);
            }
        };

        self.report_progress(
            progress_callback.as_ref(),
            progress_context.event(
                KnowledgeBaseImportStage::Finalize,
                KnowledgeBaseImportProgressStatus::Running,
                "正在写入向量并完成索引".to_string(),
                Some(prepared.persisted_chunks.len()),
                Some(prepared_embeddings.len()),
            ),
        );

        let persisted_embeddings = match self
            .persist_prepared_embeddings_or_mark_failed(&prepared.document.id, &prepared_embeddings)
        {
            Ok(embeddings) => embeddings,
            Err(error) => {
                self.report_progress(
                    progress_callback.as_ref(),
                    progress_context.event(
                        KnowledgeBaseImportStage::Finalize,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("索引收尾失败: {error}"),
                        Some(prepared.persisted_chunks.len()),
                        Some(prepared_embeddings.len()),
                    ),
                );
                return Err(error);
            }
        };
        let document = match self.load_document(&prepared.document.id) {
            Ok(document) => document,
            Err(error) => {
                self.report_progress(
                    progress_callback.as_ref(),
                    progress_context.event(
                        KnowledgeBaseImportStage::Finalize,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("读取最终文档状态失败: {error}"),
                        Some(prepared.persisted_chunks.len()),
                        Some(prepared_embeddings.len()),
                    ),
                );
                return Err(error);
            }
        };

        self.report_progress(
            progress_callback.as_ref(),
            progress_context.event(
                KnowledgeBaseImportStage::Finalize,
                KnowledgeBaseImportProgressStatus::Completed,
                format!(
                    "知识库文档索引完成，共 {} 个分块、{} 条向量",
                    document.chunk_count, document.embedding_count
                ),
                Some(document.chunk_count),
                Some(document.embedding_count),
            ),
        );

        Ok(CompletedKnowledgeBaseImport {
            document,
            parsed_document: prepared.parsed_document,
            chunks: prepared.chunks,
            persisted_chunks: prepared.persisted_chunks,
            persisted_embeddings,
        })
    }

    pub async fn prepare_import(
        &self,
        request: &KnowledgeBaseImportRequest,
    ) -> Result<PreparedKnowledgeBaseImport, String> {
        self.prepare_import_with_progress(request, None).await
    }

    async fn prepare_import_with_progress(
        &self,
        request: &KnowledgeBaseImportRequest,
        progress_callback: Option<&KnowledgeBaseImportProgressCallback>,
    ) -> Result<PreparedKnowledgeBaseImport, String> {
        if request.knowledge_base_id.trim().is_empty() {
            return Err("knowledgeBaseId 不能为空".to_string());
        }

        let snapshot = SourceDocumentSnapshot::from_path(&request.path)?;
        let document = create_knowledge_document(
            &self.db,
            snapshot.to_create_document_input(
                &request.knowledge_base_id,
                KnowledgeDocumentIndexState::Indexing,
            ),
        )?;
        let progress_context = KnowledgeBaseImportProgressContext::new(
            request.progress_event_id.clone(),
            KnowledgeBaseImportOperation::Import,
            request.knowledge_base_id.clone(),
            Some(document.id.clone()),
            Some(snapshot.file_name.clone()),
            Some(snapshot.source_path.clone()),
        );

        self.report_progress(
            progress_callback,
            progress_context.event(
                KnowledgeBaseImportStage::Parse,
                KnowledgeBaseImportProgressStatus::Running,
                format!("正在解析文档 {}", snapshot.file_name),
                None,
                None,
            ),
        );

        let parsed_document = match parse_document_with_ocr(
            &snapshot.source_path,
            request.parse_options.clone(),
            Some(self.ocr_engine.clone()),
        )
        .await
        {
            Ok(parsed_document) => {
                self.report_progress(
                    progress_callback,
                    progress_context.event(
                        KnowledgeBaseImportStage::Parse,
                        KnowledgeBaseImportProgressStatus::Completed,
                        format!(
                            "文档解析完成，共提取 {} 个结构化块",
                            parsed_document.blocks.len()
                        ),
                        None,
                        None,
                    ),
                );
                parsed_document
            }
            Err(error) => {
                let _ = self.mark_document_failed(&document.id, &error);
                self.report_progress(
                    progress_callback,
                    progress_context.event(
                        KnowledgeBaseImportStage::Parse,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("文档解析失败: {error}"),
                        None,
                        None,
                    ),
                );
                return Err(error);
            }
        };

        self.report_progress(
            progress_callback,
            progress_context.event(
                KnowledgeBaseImportStage::Chunk,
                KnowledgeBaseImportProgressStatus::Running,
                "正在生成并持久化文档分块".to_string(),
                None,
                None,
            ),
        );

        let chunk_config = request
            .chunk_config
            .clone()
            .unwrap_or_else(ChunkConfig::document_default);
        let chunks = chunk_document(&parsed_document, &chunk_config);
        let persisted_chunks = match self.persist_chunks(&document.id, &chunks) {
            Ok(persisted_chunks) => persisted_chunks,
            Err(error) => {
                let _ = self.mark_document_failed(&document.id, &error);
                self.report_progress(
                    progress_callback,
                    progress_context.event(
                        KnowledgeBaseImportStage::Chunk,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("文档分块持久化失败: {error}"),
                        Some(chunks.len()),
                        None,
                    ),
                );
                return Err(error);
            }
        };
        let document = match self.load_document(&document.id) {
            Ok(document) => document,
            Err(error) => {
                let _ = self.mark_document_failed(&document.id, &error);
                self.report_progress(
                    progress_callback,
                    progress_context.event(
                        KnowledgeBaseImportStage::Chunk,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("读取分块后的文档状态失败: {error}"),
                        Some(chunks.len()),
                        None,
                    ),
                );
                return Err(error);
            }
        };

        self.report_progress(
            progress_callback,
            progress_context.event(
                KnowledgeBaseImportStage::Chunk,
                KnowledgeBaseImportProgressStatus::Completed,
                format!("文档分块完成，共 {} 个分块", persisted_chunks.len()),
                Some(persisted_chunks.len()),
                None,
            ),
        );

        Ok(PreparedKnowledgeBaseImport {
            document,
            parsed_document,
            chunks,
            persisted_chunks,
        })
    }

    pub async fn prepare_reindex(
        &self,
        request: &ReindexKnowledgeDocumentRequest,
    ) -> Result<PreparedKnowledgeBaseImport, String> {
        self.prepare_reindex_with_progress(request, None).await
    }

    async fn prepare_reindex_with_progress(
        &self,
        request: &ReindexKnowledgeDocumentRequest,
        progress_callback: Option<&KnowledgeBaseImportProgressCallback>,
    ) -> Result<PreparedKnowledgeBaseImport, String> {
        if request.document_id.trim().is_empty() {
            return Err("documentId 不能为空".to_string());
        }

        let existing_document = self.load_document(&request.document_id)?;
        let progress_context = KnowledgeBaseImportProgressContext::new(
            request.progress_event_id.clone(),
            KnowledgeBaseImportOperation::Reindex,
            existing_document.knowledge_base_id.clone(),
            Some(existing_document.id.clone()),
            Some(existing_document.file_name.clone()),
            Some(existing_document.source_path.clone()),
        );

        self.report_progress(
            progress_callback,
            progress_context.event(
                KnowledgeBaseImportStage::Parse,
                KnowledgeBaseImportProgressStatus::Running,
                format!("正在解析文档 {}", existing_document.file_name),
                None,
                None,
            ),
        );

        let snapshot = match SourceDocumentSnapshot::from_path(&existing_document.source_path) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                let _ = self.mark_document_failed(&existing_document.id, &error);
                self.report_progress(
                    progress_callback,
                    progress_context.event(
                        KnowledgeBaseImportStage::Parse,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("文档解析失败: {error}"),
                        None,
                        None,
                    ),
                );
                return Err(error);
            }
        };

        let parsed_document = match parse_document_with_ocr(
            &snapshot.source_path,
            request.parse_options.clone(),
            Some(self.ocr_engine.clone()),
        )
        .await
        {
            Ok(parsed_document) => {
                self.report_progress(
                    progress_callback,
                    progress_context.event(
                        KnowledgeBaseImportStage::Parse,
                        KnowledgeBaseImportProgressStatus::Completed,
                        format!(
                            "文档解析完成，共提取 {} 个结构化块",
                            parsed_document.blocks.len()
                        ),
                        None,
                        None,
                    ),
                );
                parsed_document
            }
            Err(error) => {
                let _ = self.mark_document_failed(&existing_document.id, &error);
                self.report_progress(
                    progress_callback,
                    progress_context.event(
                        KnowledgeBaseImportStage::Parse,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("文档解析失败: {error}"),
                        None,
                        None,
                    ),
                );
                return Err(error);
            }
        };

        self.report_progress(
            progress_callback,
            progress_context.event(
                KnowledgeBaseImportStage::Chunk,
                KnowledgeBaseImportProgressStatus::Running,
                "正在重新生成并持久化文档分块".to_string(),
                None,
                None,
            ),
        );

        let chunk_config = request
            .chunk_config
            .clone()
            .unwrap_or_else(ChunkConfig::document_default);
        let chunks = chunk_document(&parsed_document, &chunk_config);
        let document = match reset_knowledge_document_for_reindex(
            &self.db,
            &existing_document.id,
            snapshot.to_create_document_input(
                &existing_document.knowledge_base_id,
                KnowledgeDocumentIndexState::Indexing,
            ),
        ) {
            Ok(document) => document,
            Err(error) => {
                let _ = self.mark_document_failed(&existing_document.id, &error);
                self.report_progress(
                    progress_callback,
                    progress_context.event(
                        KnowledgeBaseImportStage::Chunk,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("重置文档索引状态失败: {error}"),
                        Some(chunks.len()),
                        None,
                    ),
                );
                return Err(error);
            }
        };
        let persisted_chunks = match self.persist_chunks(&document.id, &chunks) {
            Ok(persisted_chunks) => persisted_chunks,
            Err(error) => {
                let _ = self.mark_document_failed(&document.id, &error);
                self.report_progress(
                    progress_callback,
                    progress_context.event(
                        KnowledgeBaseImportStage::Chunk,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("文档分块持久化失败: {error}"),
                        Some(chunks.len()),
                        None,
                    ),
                );
                return Err(error);
            }
        };
        let document = match self.load_document(&document.id) {
            Ok(document) => document,
            Err(error) => {
                let _ = self.mark_document_failed(&document.id, &error);
                self.report_progress(
                    progress_callback,
                    progress_context.event(
                        KnowledgeBaseImportStage::Chunk,
                        KnowledgeBaseImportProgressStatus::Failed,
                        format!("读取分块后的文档状态失败: {error}"),
                        Some(chunks.len()),
                        None,
                    ),
                );
                return Err(error);
            }
        };

        self.report_progress(
            progress_callback,
            progress_context.event(
                KnowledgeBaseImportStage::Chunk,
                KnowledgeBaseImportProgressStatus::Completed,
                format!("文档分块完成，共 {} 个分块", persisted_chunks.len()),
                Some(persisted_chunks.len()),
                None,
            ),
        );

        Ok(PreparedKnowledgeBaseImport {
            document,
            parsed_document,
            chunks,
            persisted_chunks,
        })
    }

    pub fn mark_document_failed(&self, document_id: &str, error: &str) -> Result<(), String> {
        update_knowledge_document_index_state(
            &self.db,
            document_id,
            KnowledgeDocumentIndexState::Failed,
            Some(error.to_string()),
        )
    }

    pub fn mark_document_indexing(&self, document_id: &str) -> Result<(), String> {
        update_knowledge_document_index_state(
            &self.db,
            document_id,
            KnowledgeDocumentIndexState::Indexing,
            None,
        )
    }

    pub fn mark_document_ready(&self, document_id: &str) -> Result<(), String> {
        update_knowledge_document_index_state(
            &self.db,
            document_id,
            KnowledgeDocumentIndexState::Ready,
            None,
        )
    }

    pub async fn embed_prepared_document(
        &self,
        prepared: &PreparedKnowledgeBaseImport,
        embedder: Arc<dyn EmbeddingProvider>,
    ) -> Result<Vec<PreparedKnowledgeChunkEmbedding>, String> {
        if prepared.chunks.len() != prepared.persisted_chunks.len() {
            return Err(format!(
                "知识库分块数量不一致，无法执行 embedding: chunks={}, persisted_chunks={}",
                prepared.chunks.len(),
                prepared.persisted_chunks.len()
            ));
        }

        if prepared.chunks.is_empty() {
            return Ok(Vec::new());
        }

        let texts = prepared
            .chunks
            .iter()
            .map(|chunk| chunk.text.clone())
            .collect::<Vec<_>>();
        let model_id = embedder.model_id().to_string();
        let expected_dimension = embedder.dimension();
        let embeddings = embedder
            .embed_batch(&texts)
            .await
            .map_err(|e| e.to_string())?;

        if embeddings.len() != texts.len() {
            return Err(format!(
                "Embedding 返回数量与文档分块数量不一致: expected {}, got {}",
                texts.len(),
                embeddings.len()
            ));
        }

        let mut prepared_embeddings = Vec::with_capacity(embeddings.len());

        for ((chunk, persisted_chunk), embedding) in prepared
            .chunks
            .iter()
            .zip(prepared.persisted_chunks.iter())
            .zip(embeddings.into_iter())
        {
            if embedding.len() != expected_dimension {
                return Err(format!(
                    "Embedding 维度不匹配: chunk_index={}, expected={}, got={}",
                    chunk.chunk_index,
                    expected_dimension,
                    embedding.len()
                ));
            }

            prepared_embeddings.push(PreparedKnowledgeChunkEmbedding {
                knowledge_base_id: prepared.document.knowledge_base_id.clone(),
                document_id: prepared.document.id.clone(),
                chunk_id: persisted_chunk.id.clone(),
                chunk_index: chunk.chunk_index,
                text: chunk.text.clone(),
                model_id: model_id.clone(),
                embedding_dim: expected_dimension,
                embedding,
            });
        }

        Ok(prepared_embeddings)
    }

    pub fn persist_prepared_embeddings(
        &self,
        embeddings: &[PreparedKnowledgeChunkEmbedding],
    ) -> Result<Vec<KnowledgeEmbeddingRecord>, String> {
        let payload = embeddings
            .iter()
            .map(prepared_chunk_embedding_to_create_input)
            .collect::<Vec<_>>();

        insert_knowledge_embeddings(&self.db, &payload)
    }

    async fn embed_prepared_document_or_mark_failed(
        &self,
        prepared: &PreparedKnowledgeBaseImport,
        embedder: Arc<dyn EmbeddingProvider>,
    ) -> Result<Vec<PreparedKnowledgeChunkEmbedding>, String> {
        match self.embed_prepared_document(prepared, embedder).await {
            Ok(embeddings) => Ok(embeddings),
            Err(error) => {
                let _ = self.mark_document_failed(&prepared.document.id, &error);
                Err(error)
            }
        }
    }

    fn persist_prepared_embeddings_or_mark_failed(
        &self,
        document_id: &str,
        embeddings: &[PreparedKnowledgeChunkEmbedding],
    ) -> Result<Vec<KnowledgeEmbeddingRecord>, String> {
        let persistence = if embeddings.is_empty() {
            self.mark_document_ready(document_id).map(|_| Vec::new())
        } else {
            self.persist_prepared_embeddings(embeddings)
        };

        match persistence {
            Ok(persisted) => Ok(persisted),
            Err(error) => {
                let _ = self.mark_document_failed(document_id, &error);
                Err(error)
            }
        }
    }

    fn persist_chunks(
        &self,
        document_id: &str,
        chunks: &[DocumentChunk],
    ) -> Result<Vec<KnowledgeChunkRecord>, String> {
        let payload = chunks
            .iter()
            .map(document_chunk_to_create_input)
            .collect::<Vec<_>>();

        insert_knowledge_chunks(&self.db, document_id, &payload)
    }

    fn load_document(&self, document_id: &str) -> Result<KnowledgeDocumentRecord, String> {
        get_knowledge_document(&self.db, document_id)?
            .ok_or_else(|| format!("知识库文档不存在: {document_id}"))
    }

    fn document_embeddings_match_model(
        &self,
        document_id: &str,
        expected_model_id: &str,
    ) -> Result<bool, String> {
        let embeddings = list_knowledge_document_embeddings(&self.db, document_id)?;
        Ok(embeddings.is_empty()
            || embeddings
                .iter()
                .all(|embedding| embedding.model_id == expected_model_id))
    }

    fn load_completed_import_from_existing_document(
        &self,
        document_id: &str,
    ) -> Result<CompletedKnowledgeBaseImport, String> {
        let document = self.load_document(document_id)?;
        let persisted_chunks = list_knowledge_document_chunks(&self.db, document_id)?;
        let persisted_embeddings = list_knowledge_document_embeddings(&self.db, document_id)?;
        let chunks = persisted_chunks
            .iter()
            .map(|chunk| persisted_chunk_to_document_chunk(chunk, &document))
            .collect::<Vec<_>>();
        let total_chars = chunks.iter().map(|chunk| chunk.text.chars().count()).sum();
        let total_pages = chunks.iter().filter_map(|chunk| chunk.page_number).max();
        let parsed_document = ParsedDocument {
            metadata: ParsedDocumentMetadata {
                source_path: document.source_path.clone(),
                file_name: document.file_name.clone(),
                extension: document.file_extension.clone(),
                title: document.title.clone(),
                document_type: document_type_from_key(&document.document_type),
                byte_size: document.source_byte_size,
                language: chunks.iter().find_map(|chunk| chunk.language.clone()),
            },
            blocks: Vec::new(),
            total_chars,
            total_pages,
        };

        Ok(CompletedKnowledgeBaseImport {
            document,
            parsed_document,
            chunks,
            persisted_chunks,
            persisted_embeddings,
        })
    }

    fn report_progress(
        &self,
        progress_callback: Option<&KnowledgeBaseImportProgressCallback>,
        progress: KnowledgeBaseImportProgress,
    ) {
        if let Some(callback) = progress_callback {
            callback(progress);
        }
    }
}

fn document_chunk_to_create_input(chunk: &DocumentChunk) -> CreateKnowledgeChunkInput {
    CreateKnowledgeChunkInput {
        chunk_index: chunk.chunk_index,
        text: chunk.text.clone(),
        chunk_type: chunk_type_key(&chunk.chunk_type).to_string(),
        heading_path: chunk.heading_path.clone(),
        page_number: chunk.page_number,
        language: chunk.language.clone(),
        start_offset: chunk.start_offset,
        end_offset: chunk.end_offset,
        block_count: chunk.block_count,
    }
}

fn persisted_chunk_to_document_chunk(
    chunk: &KnowledgeChunkRecord,
    document: &KnowledgeDocumentRecord,
) -> DocumentChunk {
    DocumentChunk {
        chunk_index: chunk.chunk_index,
        text: chunk.text.clone(),
        chunk_type: chunk_type_from_key(&chunk.chunk_type, chunk.language.clone()),
        source_path: document.source_path.clone(),
        file_name: document.file_name.clone(),
        title: document.title.clone(),
        document_type: document_type_from_key(&document.document_type),
        heading_path: chunk.heading_path.clone(),
        page_number: chunk.page_number,
        language: chunk.language.clone(),
        start_offset: chunk.start_offset,
        end_offset: chunk.end_offset,
        block_count: chunk.block_count,
    }
}

fn chunk_type_key(chunk_type: &ChunkType) -> &'static str {
    match chunk_type {
        ChunkType::Text => "text",
        ChunkType::Code { .. } => "code",
        ChunkType::QaPair => "qa_pair",
    }
}

fn chunk_type_from_key(chunk_type: &str, language: Option<String>) -> ChunkType {
    match chunk_type {
        "code" => ChunkType::Code { language },
        "qa_pair" => ChunkType::QaPair,
        _ => ChunkType::Text,
    }
}

fn document_type_from_key(document_type: &str) -> DocumentType {
    match document_type {
        "markdown" => DocumentType::Markdown,
        "pdf" => DocumentType::Pdf,
        "code" => DocumentType::Code,
        _ => DocumentType::PlainText,
    }
}

fn prepared_chunk_embedding_to_create_input(
    embedding: &PreparedKnowledgeChunkEmbedding,
) -> CreateKnowledgeEmbeddingInput {
    CreateKnowledgeEmbeddingInput {
        knowledge_base_id: embedding.knowledge_base_id.clone(),
        document_id: embedding.document_id.clone(),
        chunk_id: embedding.chunk_id.clone(),
        embedding: embedding.embedding.clone(),
        embedding_dim: embedding.embedding_dim,
        model_id: embedding.model_id.clone(),
    }
}

fn canonicalize_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn sha1_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(bytes);
    format!("sha1:{:x}", hasher.finalize())
}

fn infer_document_type(extension: Option<&str>) -> &'static str {
    match extension {
        Some("md" | "markdown") => "markdown",
        Some("pdf") => "pdf",
        Some(
            "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "java" | "go" | "c" | "cpp" | "cc" | "h"
            | "hpp" | "cs" | "json" | "yaml" | "yml" | "toml" | "sql" | "sh",
        ) => "code",
        _ => "plain_text",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{
        create_knowledge_base, list_knowledge_documents, CreateKnowledgeBaseInput,
    };
    use crate::rag::{
        DocumentType, EmbedError, OcrContentFormat, OcrError, OcrPageInput, OcrPageResult,
        OcrTextLine,
    };
    use async_trait::async_trait;
    use lopdf::{
        content::{Content, Operation},
        dictionary, Object, Stream,
    };
    use std::sync::Mutex;

    #[derive(Debug)]
    struct StoredChunkRow {
        chunk_index: usize,
        text: String,
        chunk_type: String,
        heading_path: Vec<String>,
        page_number: Option<u32>,
        language: Option<String>,
        start_offset: usize,
        end_offset: usize,
        block_count: usize,
    }

    #[derive(Debug)]
    struct StoredEmbeddingRow {
        chunk_index: usize,
        chunk_id: String,
        embedding_dim: usize,
        model_id: String,
        blob_len: usize,
    }

    enum MockBatchResponse {
        Repeat(Vec<f32>),
        Exact(Vec<Vec<f32>>),
        Error(EmbedError),
    }

    struct RecordingEmbeddingProvider {
        model_id: String,
        dimension: usize,
        batch_calls: Mutex<Vec<Vec<String>>>,
        response: MockBatchResponse,
    }

    impl RecordingEmbeddingProvider {
        fn repeat(model_id: &str, embedding: Vec<f32>) -> Self {
            Self {
                model_id: model_id.to_string(),
                dimension: embedding.len(),
                batch_calls: Mutex::new(Vec::new()),
                response: MockBatchResponse::Repeat(embedding),
            }
        }

        fn exact(model_id: &str, dimension: usize, embeddings: Vec<Vec<f32>>) -> Self {
            Self {
                model_id: model_id.to_string(),
                dimension,
                batch_calls: Mutex::new(Vec::new()),
                response: MockBatchResponse::Exact(embeddings),
            }
        }

        fn failing(model_id: &str, dimension: usize, error: EmbedError) -> Self {
            Self {
                model_id: model_id.to_string(),
                dimension,
                batch_calls: Mutex::new(Vec::new()),
                response: MockBatchResponse::Error(error),
            }
        }
    }

    #[async_trait]
    impl EmbeddingProvider for RecordingEmbeddingProvider {
        async fn embed(&self, _text: &str) -> Result<Vec<f32>, EmbedError> {
            match &self.response {
                MockBatchResponse::Repeat(embedding) => Ok(embedding.clone()),
                MockBatchResponse::Exact(embeddings) => embeddings
                    .first()
                    .cloned()
                    .ok_or_else(|| EmbedError::Model("未获取到 embedding".to_string())),
                MockBatchResponse::Error(error) => Err(error.clone()),
            }
        }

        async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
            self.batch_calls.lock().unwrap().push(texts.to_vec());

            match &self.response {
                MockBatchResponse::Repeat(embedding) => {
                    Ok(texts.iter().map(|_| embedding.clone()).collect())
                }
                MockBatchResponse::Exact(embeddings) => Ok(embeddings.clone()),
                MockBatchResponse::Error(error) => Err(error.clone()),
            }
        }

        fn model_id(&self) -> &str {
            &self.model_id
        }

        fn dimension(&self) -> usize {
            self.dimension
        }
    }

    struct RecordingOcrEngine {
        calls: Mutex<Vec<OcrPageInput>>,
        response_text: String,
    }

    impl RecordingOcrEngine {
        fn available(response_text: &str) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                response_text: response_text.to_string(),
            }
        }
    }

    #[async_trait]
    impl OcrEngine for RecordingOcrEngine {
        async fn recognize_page(&self, input: OcrPageInput) -> Result<OcrPageResult, OcrError> {
            self.calls.lock().unwrap().push(input.clone());
            Ok(OcrPageResult::from_lines(
                input.source_path,
                input.page_number,
                vec![OcrTextLine {
                    text: self.response_text.clone(),
                    confidence: Some(0.96),
                }],
                "recording-ocr",
            ))
        }

        fn engine_id(&self) -> &str {
            "recording-ocr"
        }
    }

    fn create_test_db() -> Arc<Database> {
        let temp_dir = std::env::temp_dir().join(format!(
            "knowledge_base_orchestrator_test_{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        Arc::new(crate::database::init_database(&temp_dir).unwrap())
    }

    fn create_test_file(name: &str, content: &str) -> String {
        let temp_dir = std::env::temp_dir().join(format!(
            "knowledge_base_source_test_{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let path = temp_dir.join(name);
        std::fs::write(&path, content).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn create_test_pdf(name: &str, pages: &[Option<&str>]) -> String {
        let temp_dir =
            std::env::temp_dir().join(format!("knowledge_base_pdf_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let path = temp_dir.join(name);

        let mut document = lopdf::Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let mut page_ids = Vec::new();

        for page_text in pages {
            let page_id = document.new_object_id();
            let (content_id, resources_id) = if let Some(text) = page_text {
                let font_id = document.add_object(dictionary! {
                    "Type" => "Font",
                    "Subtype" => "Type1",
                    "BaseFont" => "Helvetica",
                });
                let resources_id = document.add_object(dictionary! {
                    "Font" => dictionary! {
                        "F1" => font_id,
                    }
                });
                let content = Content {
                    operations: vec![
                        Operation::new("BT", vec![]),
                        Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), 12.into()]),
                        Operation::new("Td", vec![50.into(), 750.into()]),
                        Operation::new("Tj", vec![Object::string_literal(*text)]),
                        Operation::new("ET", vec![]),
                    ],
                };
                let content_stream = Stream::new(dictionary! {}, content.encode().unwrap());
                let content_id = document.add_object(content_stream);
                (content_id, resources_id)
            } else {
                let content_stream = Stream::new(dictionary! {}, Vec::new());
                let content_id = document.add_object(content_stream);
                let resources_id = document.add_object(dictionary! {});
                (content_id, resources_id)
            };

            document.objects.insert(
                page_id,
                Object::Dictionary(dictionary! {
                    "Type" => "Page",
                    "Parent" => pages_id,
                    "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                    "Contents" => content_id,
                    "Resources" => resources_id,
                }),
            );
            page_ids.push(page_id);
        }

        document.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => page_ids
                    .iter()
                    .copied()
                    .map(Object::Reference)
                    .collect::<Vec<_>>(),
                "Count" => page_ids.len() as i64,
            }),
        );
        let catalog_id = document.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);
        document.save(&path).unwrap();

        path.to_string_lossy().into_owned()
    }

    fn create_test_knowledge_base(db: &Arc<Database>) -> String {
        create_knowledge_base(
            db,
            CreateKnowledgeBaseInput {
                name: "Import Test".to_string(),
                description: Some("for orchestrator tests".to_string()),
            },
        )
        .unwrap()
        .id
    }

    fn create_progress_recorder() -> (
        Arc<Mutex<Vec<KnowledgeBaseImportProgress>>>,
        KnowledgeBaseImportProgressCallback,
    ) {
        let recorded = Arc::new(Mutex::new(Vec::new()));
        let callback_events = Arc::clone(&recorded);
        let callback: KnowledgeBaseImportProgressCallback =
            Arc::new(move |progress: KnowledgeBaseImportProgress| {
                callback_events.lock().unwrap().push(progress);
            });

        (recorded, callback)
    }

    fn assert_progress_stage_sequence(
        events: &[KnowledgeBaseImportProgress],
        expected: &[(KnowledgeBaseImportStage, KnowledgeBaseImportProgressStatus)],
    ) {
        let actual = events
            .iter()
            .map(|event| (event.stage, event.status))
            .collect::<Vec<_>>();
        assert_eq!(actual, expected);
    }

    fn load_stored_chunks(db: &Arc<Database>, document_id: &str) -> Vec<StoredChunkRow> {
        let conn = db.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT chunk_index, text, chunk_type, heading_path, page_number, language,
                        start_offset, end_offset, block_count
                 FROM kb_chunks
                 WHERE document_id = ?1
                 ORDER BY chunk_index ASC",
            )
            .unwrap();

        stmt.query_map(rusqlite::params![document_id], |row| {
            let heading_path_json: String = row.get(3)?;
            let heading_path = serde_json::from_str(&heading_path_json).unwrap_or_default();

            Ok(StoredChunkRow {
                chunk_index: row.get::<_, i64>(0)? as usize,
                text: row.get(1)?,
                chunk_type: row.get(2)?,
                heading_path,
                page_number: row.get::<_, Option<i64>>(4)?.map(|value| value as u32),
                language: row.get(5)?,
                start_offset: row.get::<_, i64>(6)? as usize,
                end_offset: row.get::<_, i64>(7)? as usize,
                block_count: row.get::<_, i64>(8)? as usize,
            })
        })
        .unwrap()
        .map(|row| row.unwrap())
        .collect()
    }

    fn load_stored_embeddings(db: &Arc<Database>, document_id: &str) -> Vec<StoredEmbeddingRow> {
        let conn = db.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT kb_chunks.chunk_index, kb_embeddings.chunk_id, kb_embeddings.embedding_dim,
                        kb_embeddings.model_id, length(kb_embeddings.embedding)
                 FROM kb_embeddings
                 INNER JOIN kb_chunks ON kb_chunks.id = kb_embeddings.chunk_id
                 WHERE kb_embeddings.document_id = ?1
                 ORDER BY kb_chunks.chunk_index ASC",
            )
            .unwrap();

        stmt.query_map(rusqlite::params![document_id], |row| {
            Ok(StoredEmbeddingRow {
                chunk_index: row.get::<_, i64>(0)? as usize,
                chunk_id: row.get(1)?,
                embedding_dim: row.get::<_, i64>(2)? as usize,
                model_id: row.get(3)?,
                blob_len: row.get::<_, i64>(4)? as usize,
            })
        })
        .unwrap()
        .map(|row| row.unwrap())
        .collect()
    }

    #[test]
    fn document_chunk_to_create_input_preserves_chunk_metadata() {
        let input = document_chunk_to_create_input(&DocumentChunk {
            chunk_index: 7,
            text: "fn add(a: i32, b: i32) -> i32 { a + b }".to_string(),
            chunk_type: ChunkType::Code {
                language: Some("rust".to_string()),
            },
            source_path: "C:\\docs\\guide.pdf".to_string(),
            file_name: "guide.pdf".to_string(),
            title: "Guide".to_string(),
            document_type: DocumentType::Pdf,
            heading_path: vec!["Chapter 1".to_string(), "Examples".to_string()],
            page_number: Some(3),
            language: Some("rust".to_string()),
            start_offset: 120,
            end_offset: 162,
            block_count: 2,
        });

        assert_eq!(input.chunk_index, 7);
        assert_eq!(input.chunk_type, "code");
        assert_eq!(
            input.heading_path,
            vec!["Chapter 1".to_string(), "Examples".to_string()]
        );
        assert_eq!(input.page_number, Some(3));
        assert_eq!(input.language.as_deref(), Some("rust"));
        assert_eq!(input.start_offset, 120);
        assert_eq!(input.end_offset, 162);
        assert_eq!(input.block_count, 2);
    }

    #[tokio::test]
    async fn prepare_import_creates_indexing_document_and_returns_chunks() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "rust-guide.md",
            "# Rust Guide\n\nOwnership is Rust's core memory model.\n\nBorrow checking prevents data races.\n",
        );
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());

        let prepared = orchestrator
            .prepare_import(&KnowledgeBaseImportRequest {
                knowledge_base_id: knowledge_base_id.clone(),
                path,
                parse_options: None,
                chunk_config: None,
                progress_event_id: None,
            })
            .await
            .unwrap();

        assert_eq!(prepared.document.knowledge_base_id, knowledge_base_id);
        assert_eq!(
            prepared.document.index_state,
            KnowledgeDocumentIndexState::Indexing
        );
        assert_eq!(prepared.parsed_document.metadata.file_name, "rust-guide.md");
        assert!(!prepared.chunks.is_empty());
        assert_eq!(prepared.persisted_chunks.len(), prepared.chunks.len());

        let persisted = get_knowledge_document(&db, &prepared.document.id)
            .unwrap()
            .unwrap();
        assert_eq!(persisted.index_state, KnowledgeDocumentIndexState::Indexing);
        assert_eq!(persisted.last_error, None);
        assert_eq!(persisted.chunk_count, prepared.chunks.len());
    }

    #[tokio::test]
    async fn prepare_import_persists_document_snapshot_metadata() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "notes.txt",
            "Knowledge-base metadata persistence should include source path and hash.",
        );
        let expected_source_path = std::path::Path::new(&path)
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let expected_byte_size = std::fs::metadata(&path).unwrap().len();
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());

        let prepared = orchestrator
            .prepare_import(&KnowledgeBaseImportRequest {
                knowledge_base_id,
                path,
                parse_options: None,
                chunk_config: None,
                progress_event_id: None,
            })
            .await
            .unwrap();

        let persisted = get_knowledge_document(&db, &prepared.document.id)
            .unwrap()
            .unwrap();
        assert_eq!(persisted.source_path, expected_source_path);
        assert_eq!(persisted.file_name, "notes.txt");
        assert_eq!(persisted.file_extension.as_deref(), Some("txt"));
        assert_eq!(persisted.title, "notes");
        assert_eq!(persisted.document_type, "plain_text");
        assert_eq!(persisted.source_byte_size, expected_byte_size);
        assert!(persisted.source_modified_at > 0);
        assert!(persisted.content_hash.starts_with("sha1:"));
        assert!(persisted.fingerprint.contains(&persisted.content_hash));
        assert!(persisted.fingerprint.contains(&persisted.source_path));
        assert_eq!(persisted.index_state, KnowledgeDocumentIndexState::Indexing);
    }

    #[tokio::test]
    async fn prepare_import_persists_chunks_with_stable_order_and_metadata() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "guide.md",
            "# Rust Guide\n\nRust ownership prevents double free and keeps aliasing safe.\n\n## Code Example\n\n```rust\nfn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n```\n",
        );
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());

        let prepared = orchestrator
            .prepare_import(&KnowledgeBaseImportRequest {
                knowledge_base_id,
                path,
                parse_options: None,
                chunk_config: Some(ChunkConfig {
                    max_chunk_size: 80,
                    overlap_size: 0,
                    min_chunk_size: 20,
                    prefer_structure_boundary: true,
                }),
                progress_event_id: None,
            })
            .await
            .unwrap();

        let stored_chunks = load_stored_chunks(&db, &prepared.document.id);
        assert_eq!(stored_chunks.len(), prepared.chunks.len());
        assert_eq!(prepared.persisted_chunks.len(), prepared.chunks.len());
        assert!(stored_chunks.len() >= 2);

        for (expected, stored) in prepared.chunks.iter().zip(stored_chunks.iter()) {
            assert_eq!(stored.chunk_index, expected.chunk_index);
            assert_eq!(stored.text, expected.text);
            assert_eq!(stored.heading_path, expected.heading_path);
            assert_eq!(stored.page_number, expected.page_number);
            assert_eq!(stored.language, expected.language);
            assert_eq!(stored.start_offset, expected.start_offset);
            assert_eq!(stored.end_offset, expected.end_offset);
            assert_eq!(stored.block_count, expected.block_count);

            let expected_chunk_type = chunk_type_key(&expected.chunk_type);
            assert_eq!(stored.chunk_type, expected_chunk_type);
        }

        assert_eq!(
            stored_chunks[0].heading_path,
            vec!["Rust Guide".to_string()]
        );
        assert!(stored_chunks
            .iter()
            .any(|chunk| chunk.chunk_type == "code" && chunk.language.as_deref() == Some("rust")));
    }

    #[tokio::test]
    async fn embed_prepared_document_uses_embedding_provider_batch_api() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "embedding.md",
            "# Intro\n\nVector search needs stable chunk ordering.\n\n## Follow-up\n\nBatch embedding should reuse the provider trait.\n",
        );
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db);
        let prepared = orchestrator
            .prepare_import(&KnowledgeBaseImportRequest {
                knowledge_base_id,
                path,
                parse_options: None,
                chunk_config: Some(ChunkConfig {
                    max_chunk_size: 70,
                    overlap_size: 0,
                    min_chunk_size: 20,
                    prefer_structure_boundary: true,
                }),
                progress_event_id: None,
            })
            .await
            .unwrap();
        let provider = Arc::new(RecordingEmbeddingProvider::repeat(
            "kb-embed-model",
            vec![0.2, 0.4, 0.6],
        ));

        let prepared_embeddings = orchestrator
            .embed_prepared_document(&prepared, provider.clone())
            .await
            .unwrap();

        let batch_calls = provider.batch_calls.lock().unwrap();
        assert_eq!(batch_calls.len(), 1);
        assert_eq!(
            batch_calls[0],
            prepared
                .chunks
                .iter()
                .map(|chunk| chunk.text.clone())
                .collect::<Vec<_>>()
        );

        assert_eq!(prepared_embeddings.len(), prepared.chunks.len());
        for ((chunk, persisted_chunk), embedded_chunk) in prepared
            .chunks
            .iter()
            .zip(prepared.persisted_chunks.iter())
            .zip(prepared_embeddings.iter())
        {
            assert_eq!(
                embedded_chunk.knowledge_base_id,
                prepared.document.knowledge_base_id
            );
            assert_eq!(embedded_chunk.document_id, prepared.document.id);
            assert_eq!(embedded_chunk.chunk_id, persisted_chunk.id);
            assert_eq!(embedded_chunk.chunk_index, chunk.chunk_index);
            assert_eq!(embedded_chunk.text, chunk.text);
            assert_eq!(embedded_chunk.model_id, "kb-embed-model");
            assert_eq!(embedded_chunk.embedding_dim, 3);
            assert_eq!(embedded_chunk.embedding, vec![0.2, 0.4, 0.6]);
        }
    }

    #[tokio::test]
    async fn embed_prepared_document_rejects_embedding_dimension_mismatch() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "dimension.md",
            "# Intro\n\nDimension mismatch should fail before persistence.\n",
        );
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db);
        let prepared = orchestrator
            .prepare_import(&KnowledgeBaseImportRequest {
                knowledge_base_id,
                path,
                parse_options: None,
                chunk_config: None,
                progress_event_id: None,
            })
            .await
            .unwrap();
        let provider = Arc::new(RecordingEmbeddingProvider::exact(
            "bad-model",
            3,
            vec![vec![1.0, 2.0]],
        ));

        let error = orchestrator
            .embed_prepared_document(&prepared, provider)
            .await
            .unwrap_err();

        assert!(error.contains("维度不匹配"));
    }

    #[test]
    fn prepared_chunk_embedding_to_create_input_preserves_embedding_payload() {
        let input = prepared_chunk_embedding_to_create_input(&PreparedKnowledgeChunkEmbedding {
            knowledge_base_id: "kb-1".to_string(),
            document_id: "doc-1".to_string(),
            chunk_id: "chunk-3".to_string(),
            chunk_index: 3,
            text: "Ownership".to_string(),
            model_id: "embed-v1".to_string(),
            embedding_dim: 4,
            embedding: vec![0.1, 0.2, 0.3, 0.4],
        });

        assert_eq!(input.knowledge_base_id, "kb-1");
        assert_eq!(input.document_id, "doc-1");
        assert_eq!(input.chunk_id, "chunk-3");
        assert_eq!(input.model_id, "embed-v1");
        assert_eq!(input.embedding_dim, 4);
        assert_eq!(input.embedding, vec![0.1, 0.2, 0.3, 0.4]);
    }

    #[tokio::test]
    async fn persist_prepared_embeddings_writes_records_and_marks_document_ready() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "persist-embeddings.md",
            "# Rust\n\nOwnership and borrowing are indexed as separate chunks.\n\n## Lifetime\n\nLifetimes clarify relationships between references.\n",
        );
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());
        let prepared = orchestrator
            .prepare_import(&KnowledgeBaseImportRequest {
                knowledge_base_id,
                path,
                parse_options: None,
                chunk_config: Some(ChunkConfig {
                    max_chunk_size: 65,
                    overlap_size: 0,
                    min_chunk_size: 18,
                    prefer_structure_boundary: true,
                }),
                progress_event_id: None,
            })
            .await
            .unwrap();
        let provider = Arc::new(RecordingEmbeddingProvider::repeat(
            "kb-ready-model",
            vec![0.25, 0.5, 0.75],
        ));
        let prepared_embeddings = orchestrator
            .embed_prepared_document(&prepared, provider)
            .await
            .unwrap();

        let persisted_embeddings = orchestrator
            .persist_prepared_embeddings(&prepared_embeddings)
            .unwrap();

        assert_eq!(persisted_embeddings.len(), prepared_embeddings.len());

        let document = get_knowledge_document(&db, &prepared.document.id)
            .unwrap()
            .unwrap();
        assert_eq!(document.chunk_count, prepared.chunks.len());
        assert_eq!(document.embedding_count, prepared_embeddings.len());
        assert_eq!(document.index_state, KnowledgeDocumentIndexState::Ready);
        assert_eq!(document.last_error, None);
        assert!(document.indexed_at.is_some());

        let stored_embeddings = load_stored_embeddings(&db, &prepared.document.id);
        assert_eq!(stored_embeddings.len(), prepared_embeddings.len());

        for (stored, prepared_embedding) in stored_embeddings.iter().zip(prepared_embeddings.iter())
        {
            assert_eq!(stored.chunk_index, prepared_embedding.chunk_index);
            assert_eq!(stored.chunk_id, prepared_embedding.chunk_id);
            assert_eq!(stored.embedding_dim, prepared_embedding.embedding_dim);
            assert_eq!(stored.model_id, prepared_embedding.model_id);
            assert_eq!(stored.blob_len, prepared_embedding.embedding_dim * 4);
        }
    }

    #[tokio::test]
    async fn import_document_with_embeddings_marks_document_failed_when_embedding_stage_errors() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "embed-failure.md",
            "# Failure\n\nEmbedding should mark the document as failed instead of leaving it indexing.\n",
        );
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());
        let provider = Arc::new(RecordingEmbeddingProvider::failing(
            "broken-model",
            3,
            EmbedError::Network("upstream timeout".to_string()),
        ));

        let error = orchestrator
            .import_document_with_embeddings(
                &KnowledgeBaseImportRequest {
                    knowledge_base_id: knowledge_base_id.clone(),
                    path,
                    parse_options: None,
                    chunk_config: Some(ChunkConfig {
                        max_chunk_size: 80,
                        overlap_size: 0,
                        min_chunk_size: 20,
                        prefer_structure_boundary: true,
                    }),
                    progress_event_id: None,
                },
                provider,
            )
            .await
            .unwrap_err();

        assert!(error.contains("upstream timeout"));

        let documents = list_knowledge_documents(&db, &knowledge_base_id).unwrap();
        assert_eq!(documents.len(), 1);
        let document = &documents[0];

        assert_eq!(document.index_state, KnowledgeDocumentIndexState::Failed);
        assert_eq!(document.embedding_count, 0);
        assert!(document.chunk_count > 0);
        assert!(document
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("upstream timeout"));

        let stored_chunks = load_stored_chunks(&db, &document.id);
        let stored_embeddings = load_stored_embeddings(&db, &document.id);
        assert_eq!(stored_chunks.len(), document.chunk_count);
        assert!(stored_chunks.len() > 0);
        assert!(stored_embeddings.is_empty());
    }

    #[tokio::test]
    async fn import_document_with_embeddings_emits_stage_progress_events() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "progress-import.md",
            "# Rust\n\nOwnership and borrowing should emit stage progress events during import.\n",
        );
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());
        let provider = Arc::new(RecordingEmbeddingProvider::repeat(
            "progress-model",
            vec![0.2, 0.4, 0.6],
        ));
        let progress_event_id = "progress-import-1".to_string();
        let (recorded, callback) = create_progress_recorder();

        let completed = orchestrator
            .import_document_with_embeddings_and_progress(
                &KnowledgeBaseImportRequest {
                    knowledge_base_id: knowledge_base_id.clone(),
                    path,
                    parse_options: None,
                    chunk_config: Some(ChunkConfig {
                        max_chunk_size: 80,
                        overlap_size: 0,
                        min_chunk_size: 20,
                        prefer_structure_boundary: true,
                    }),
                    progress_event_id: Some(progress_event_id.clone()),
                },
                provider,
                Some(callback),
            )
            .await
            .unwrap();

        let events = recorded.lock().unwrap().clone();
        assert_progress_stage_sequence(
            &events,
            &[
                (
                    KnowledgeBaseImportStage::Parse,
                    KnowledgeBaseImportProgressStatus::Running,
                ),
                (
                    KnowledgeBaseImportStage::Parse,
                    KnowledgeBaseImportProgressStatus::Completed,
                ),
                (
                    KnowledgeBaseImportStage::Chunk,
                    KnowledgeBaseImportProgressStatus::Running,
                ),
                (
                    KnowledgeBaseImportStage::Chunk,
                    KnowledgeBaseImportProgressStatus::Completed,
                ),
                (
                    KnowledgeBaseImportStage::Embed,
                    KnowledgeBaseImportProgressStatus::Running,
                ),
                (
                    KnowledgeBaseImportStage::Embed,
                    KnowledgeBaseImportProgressStatus::Completed,
                ),
                (
                    KnowledgeBaseImportStage::Finalize,
                    KnowledgeBaseImportProgressStatus::Running,
                ),
                (
                    KnowledgeBaseImportStage::Finalize,
                    KnowledgeBaseImportProgressStatus::Completed,
                ),
            ],
        );
        assert!(events
            .iter()
            .all(|event| event.request_id.as_deref() == Some(progress_event_id.as_str())));
        assert!(events
            .iter()
            .all(|event| event.knowledge_base_id == knowledge_base_id));
        assert!(events
            .iter()
            .all(|event| event.document_id.as_deref() == Some(completed.document.id.as_str())));
        assert_eq!(
            events[3].chunk_count,
            Some(completed.persisted_chunks.len())
        );
        assert_eq!(
            events.last().and_then(|event| event.embedding_count),
            Some(completed.persisted_embeddings.len())
        );
    }

    #[tokio::test]
    async fn import_document_with_embeddings_emits_completed_progress_when_fingerprint_is_unchanged()
    {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "progress-import-unchanged.md",
            "# Rust\n\nThis file should be reused without re-import when unchanged.\n",
        );
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());
        let provider = Arc::new(RecordingEmbeddingProvider::repeat(
            "progress-unchanged-model",
            vec![0.2, 0.4, 0.6],
        ));

        let first = orchestrator
            .import_document_with_embeddings(
                &KnowledgeBaseImportRequest {
                    knowledge_base_id,
                    path: path.clone(),
                    parse_options: None,
                    chunk_config: Some(ChunkConfig {
                        max_chunk_size: 80,
                        overlap_size: 0,
                        min_chunk_size: 20,
                        prefer_structure_boundary: true,
                    }),
                    progress_event_id: None,
                },
                provider.clone(),
            )
            .await
            .unwrap();

        let progress_event_id = "progress-import-unchanged-1".to_string();
        let (recorded, callback) = create_progress_recorder();

        let second = orchestrator
            .import_document_with_embeddings_and_progress(
                &KnowledgeBaseImportRequest {
                    knowledge_base_id: first.document.knowledge_base_id.clone(),
                    path,
                    parse_options: None,
                    chunk_config: Some(ChunkConfig {
                        max_chunk_size: 80,
                        overlap_size: 0,
                        min_chunk_size: 20,
                        prefer_structure_boundary: true,
                    }),
                    progress_event_id: Some(progress_event_id.clone()),
                },
                provider,
                Some(callback),
            )
            .await
            .unwrap();

        let events = recorded.lock().unwrap().clone();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].stage, KnowledgeBaseImportStage::Finalize);
        assert_eq!(
            events[0].status,
            KnowledgeBaseImportProgressStatus::Completed
        );
        assert_eq!(events[0].request_id.as_deref(), Some(progress_event_id.as_str()));
        assert_eq!(events[0].document_id.as_deref(), Some(first.document.id.as_str()));
        assert!(events[0].message.contains("跳过导入"));
        assert_eq!(second.document.id, first.document.id);
        assert_eq!(second.persisted_chunks.len(), first.persisted_chunks.len());
        assert_eq!(
            second.persisted_embeddings.len(),
            first.persisted_embeddings.len()
        );
    }

    #[tokio::test]
    async fn reindex_document_with_embeddings_emits_stage_progress_events() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file("progress-reindex.md", "# Rust\n\nFirst import content.\n");
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());

        let first_import = orchestrator
            .import_document_with_embeddings(
                &KnowledgeBaseImportRequest {
                    knowledge_base_id: knowledge_base_id.clone(),
                    path: path.clone(),
                    parse_options: None,
                    chunk_config: None,
                    progress_event_id: None,
                },
                Arc::new(RecordingEmbeddingProvider::repeat(
                    "progress-reindex-v1",
                    vec![0.1, 0.2, 0.3],
                )),
            )
            .await
            .unwrap();

        std::fs::write(
            &path,
            "# Rust\n\nFirst import content.\n\n## Reindexed\n\nUpdated content should still emit progress events.\n",
        )
        .unwrap();

        let progress_event_id = "progress-reindex-1".to_string();
        let (recorded, callback) = create_progress_recorder();

        let completed = orchestrator
            .reindex_document_with_embeddings_and_progress(
                &ReindexKnowledgeDocumentRequest {
                    document_id: first_import.document.id.clone(),
                    parse_options: None,
                    chunk_config: Some(ChunkConfig {
                        max_chunk_size: 70,
                        overlap_size: 0,
                        min_chunk_size: 18,
                        prefer_structure_boundary: true,
                    }),
                    progress_event_id: Some(progress_event_id.clone()),
                },
                Arc::new(RecordingEmbeddingProvider::repeat(
                    "progress-reindex-v2",
                    vec![0.9, 0.1, 0.2, 0.3],
                )),
                Some(callback),
            )
            .await
            .unwrap();

        let events = recorded.lock().unwrap().clone();
        assert_progress_stage_sequence(
            &events,
            &[
                (
                    KnowledgeBaseImportStage::Parse,
                    KnowledgeBaseImportProgressStatus::Running,
                ),
                (
                    KnowledgeBaseImportStage::Parse,
                    KnowledgeBaseImportProgressStatus::Completed,
                ),
                (
                    KnowledgeBaseImportStage::Chunk,
                    KnowledgeBaseImportProgressStatus::Running,
                ),
                (
                    KnowledgeBaseImportStage::Chunk,
                    KnowledgeBaseImportProgressStatus::Completed,
                ),
                (
                    KnowledgeBaseImportStage::Embed,
                    KnowledgeBaseImportProgressStatus::Running,
                ),
                (
                    KnowledgeBaseImportStage::Embed,
                    KnowledgeBaseImportProgressStatus::Completed,
                ),
                (
                    KnowledgeBaseImportStage::Finalize,
                    KnowledgeBaseImportProgressStatus::Running,
                ),
                (
                    KnowledgeBaseImportStage::Finalize,
                    KnowledgeBaseImportProgressStatus::Completed,
                ),
            ],
        );
        assert!(events
            .iter()
            .all(|event| event.request_id.as_deref() == Some(progress_event_id.as_str())));
        assert!(events
            .iter()
            .all(|event| event.document_id.as_deref() == Some(completed.document.id.as_str())));
        assert_eq!(completed.document.id, first_import.document.id);
    }

    #[tokio::test]
    async fn import_document_with_embeddings_emits_failed_parse_progress_event() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "progress-parse-failure.txt",
            "This file is intentionally larger than the configured parser limit.",
        );
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db);
        let (recorded, callback) = create_progress_recorder();

        let error = orchestrator
            .import_document_with_embeddings_and_progress(
                &KnowledgeBaseImportRequest {
                    knowledge_base_id,
                    path,
                    parse_options: Some(ParseOptions {
                        max_file_size_bytes: 8,
                        enable_ocr: false,
                    }),
                    chunk_config: None,
                    progress_event_id: Some("progress-parse-failure".to_string()),
                },
                Arc::new(RecordingEmbeddingProvider::repeat(
                    "unused-progress-model",
                    vec![0.1, 0.2, 0.3],
                )),
                Some(callback),
            )
            .await
            .unwrap_err();

        assert!(error.contains("文件过大"));

        let events = recorded.lock().unwrap().clone();
        assert_progress_stage_sequence(
            &events,
            &[
                (
                    KnowledgeBaseImportStage::Parse,
                    KnowledgeBaseImportProgressStatus::Running,
                ),
                (
                    KnowledgeBaseImportStage::Parse,
                    KnowledgeBaseImportProgressStatus::Failed,
                ),
            ],
        );
        assert!(events[1].message.contains("文件过大"));
    }

    #[tokio::test]
    async fn import_document_with_embeddings_uses_ocr_fallback_when_enabled() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_pdf("scanned-import.pdf", &[None]);
        let ocr_engine = Arc::new(RecordingOcrEngine::available("Recovered from OCR"));
        let orchestrator =
            KnowledgeBaseImportOrchestrator::with_ocr_engine(db.clone(), ocr_engine.clone());

        let completed = orchestrator
            .import_document_with_embeddings(
                &KnowledgeBaseImportRequest {
                    knowledge_base_id: knowledge_base_id.clone(),
                    path,
                    parse_options: Some(ParseOptions {
                        max_file_size_bytes: 10 * 1024 * 1024,
                        enable_ocr: true,
                    }),
                    chunk_config: Some(ChunkConfig {
                        max_chunk_size: 80,
                        overlap_size: 0,
                        min_chunk_size: 1,
                        prefer_structure_boundary: true,
                    }),
                    progress_event_id: None,
                },
                Arc::new(RecordingEmbeddingProvider::repeat(
                    "ocr-import-model",
                    vec![0.4, 0.5, 0.6],
                )),
            )
            .await
            .unwrap();

        assert_eq!(completed.document.knowledge_base_id, knowledge_base_id);
        assert_eq!(completed.parsed_document.total_pages, Some(1));
        assert!(completed
            .parsed_document
            .blocks
            .iter()
            .any(|block| block.page_number == Some(1) && block.text == "Recovered from OCR"));
        assert!(!completed.persisted_chunks.is_empty());
        assert!(completed
            .persisted_chunks
            .iter()
            .all(|chunk| chunk.page_number == Some(1)));
        assert!(completed
            .persisted_embeddings
            .iter()
            .all(|embedding| embedding.model_id == "ocr-import-model"));

        let calls = ocr_engine.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].page_number, 1);
        assert_eq!(calls[0].content_format, Some(OcrContentFormat::Pdf));
    }

    #[tokio::test]
    async fn reindex_document_with_embeddings_marks_document_failed_when_parse_stage_errors() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "reindex-parse-failure.md",
            "# Rust\n\nThis content will fail reindex parsing when the size limit is too small.\n",
        );
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());

        let imported = orchestrator
            .import_document_with_embeddings(
                &KnowledgeBaseImportRequest {
                    knowledge_base_id,
                    path,
                    parse_options: None,
                    chunk_config: None,
                    progress_event_id: None,
                },
                Arc::new(RecordingEmbeddingProvider::repeat(
                    "reindex-parse-v1",
                    vec![0.1, 0.2, 0.3],
                )),
            )
            .await
            .unwrap();

        let error = orchestrator
            .reindex_document_with_embeddings(
                &ReindexKnowledgeDocumentRequest {
                    document_id: imported.document.id.clone(),
                    parse_options: Some(ParseOptions {
                        max_file_size_bytes: 8,
                        enable_ocr: false,
                    }),
                    chunk_config: None,
                    progress_event_id: None,
                },
                Arc::new(RecordingEmbeddingProvider::repeat(
                    "reindex-parse-v2",
                    vec![0.2, 0.3, 0.4],
                )),
            )
            .await
            .unwrap_err();

        assert!(error.contains("文件过大"));

        let document = get_knowledge_document(&db, &imported.document.id)
            .unwrap()
            .unwrap();
        assert_eq!(document.index_state, KnowledgeDocumentIndexState::Failed);
        assert!(document
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("文件过大"));
    }

    #[tokio::test]
    async fn persist_prepared_embeddings_or_mark_failed_marks_document_failed_when_insert_fails() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "persist-failure.md",
            "# Failure\n\nEmbedding persistence should fail cleanly when chunk linkage is invalid.\n",
        );
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());
        let prepared = orchestrator
            .prepare_import(&KnowledgeBaseImportRequest {
                knowledge_base_id,
                path,
                parse_options: None,
                chunk_config: Some(ChunkConfig {
                    max_chunk_size: 80,
                    overlap_size: 0,
                    min_chunk_size: 20,
                    prefer_structure_boundary: true,
                }),
                progress_event_id: None,
            })
            .await
            .unwrap();
        let provider = Arc::new(RecordingEmbeddingProvider::repeat(
            "persist-failure-model",
            vec![0.1, 0.2, 0.3],
        ));
        let mut prepared_embeddings = orchestrator
            .embed_prepared_document(&prepared, provider)
            .await
            .unwrap();
        prepared_embeddings[0].chunk_id = "missing-chunk-id".to_string();

        let error = orchestrator
            .persist_prepared_embeddings_or_mark_failed(&prepared.document.id, &prepared_embeddings)
            .unwrap_err();

        assert!(error.contains("FOREIGN KEY"));

        let document = get_knowledge_document(&db, &prepared.document.id)
            .unwrap()
            .unwrap();
        assert_eq!(document.index_state, KnowledgeDocumentIndexState::Failed);
        assert_eq!(document.chunk_count, prepared.chunks.len());
        assert_eq!(document.embedding_count, 0);
        assert!(document
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("FOREIGN KEY"));
        assert!(load_stored_embeddings(&db, &prepared.document.id).is_empty());
    }

    #[tokio::test]
    async fn prepare_import_marks_document_failed_when_parse_stage_errors() {
        let db = create_test_db();
        let knowledge_base_id = create_test_knowledge_base(&db);
        let path = create_test_file(
            "too-large.txt",
            "This file is intentionally larger than the configured parser limit.",
        );
        let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());

        let error = orchestrator
            .prepare_import(&KnowledgeBaseImportRequest {
                knowledge_base_id: knowledge_base_id.clone(),
                path,
                parse_options: Some(ParseOptions {
                    max_file_size_bytes: 8,
                    enable_ocr: false,
                }),
                chunk_config: None,
                progress_event_id: None,
            })
            .await
            .unwrap_err();

        assert!(error.contains("文件过大"));

        let documents = list_knowledge_documents(&db, &knowledge_base_id).unwrap();
        assert_eq!(documents.len(), 1);
        assert_eq!(
            documents[0].index_state,
            KnowledgeDocumentIndexState::Failed
        );
        assert!(documents[0]
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("文件过大"));
    }
}
