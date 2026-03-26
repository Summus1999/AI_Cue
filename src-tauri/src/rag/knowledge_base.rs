use super::{
    chunk_document, parse_document, ChunkConfig, DocumentChunk, ParseOptions, ParsedDocument,
};
use crate::database::{
    create_knowledge_document, get_knowledge_document, update_knowledge_document_index_state,
    CreateKnowledgeDocumentInput, Database, KnowledgeDocumentIndexState, KnowledgeDocumentRecord,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedKnowledgeBaseImport {
    pub document: KnowledgeDocumentRecord,
    pub parsed_document: ParsedDocument,
    pub chunks: Vec<DocumentChunk>,
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

pub struct KnowledgeBaseImportOrchestrator {
    db: Arc<Database>,
}

impl KnowledgeBaseImportOrchestrator {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn prepare_import(
        &self,
        request: &KnowledgeBaseImportRequest,
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

        let preparation: Result<PreparedKnowledgeBaseImport, String> =
            (|| -> Result<PreparedKnowledgeBaseImport, String> {
                let parsed_document =
                    parse_document(&snapshot.source_path, request.parse_options.clone())?;
                let chunk_config = request
                    .chunk_config
                    .clone()
                    .unwrap_or_else(ChunkConfig::document_default);
                let chunks = chunk_document(&parsed_document, &chunk_config);
                let document = self.load_document(&document.id)?;

                Ok(PreparedKnowledgeBaseImport {
                    document,
                    parsed_document,
                    chunks,
                })
            })();

        match preparation {
            Ok(prepared) => Ok(prepared),
            Err(error) => {
                let _ = self.mark_document_failed(&document.id, &error);
                Err(error)
            }
        }
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

    fn load_document(&self, document_id: &str) -> Result<KnowledgeDocumentRecord, String> {
        get_knowledge_document(&self.db, document_id)?
            .ok_or_else(|| format!("知识库文档不存在: {document_id}"))
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

    #[test]
    fn prepare_import_creates_indexing_document_and_returns_chunks() {
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
            })
            .unwrap();

        assert_eq!(prepared.document.knowledge_base_id, knowledge_base_id);
        assert_eq!(
            prepared.document.index_state,
            KnowledgeDocumentIndexState::Indexing
        );
        assert_eq!(prepared.parsed_document.metadata.file_name, "rust-guide.md");
        assert!(!prepared.chunks.is_empty());

        let persisted = get_knowledge_document(&db, &prepared.document.id)
            .unwrap()
            .unwrap();
        assert_eq!(persisted.index_state, KnowledgeDocumentIndexState::Indexing);
        assert_eq!(persisted.last_error, None);
    }

    #[test]
    fn prepare_import_persists_document_snapshot_metadata() {
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
            })
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

    #[test]
    fn prepare_import_marks_document_failed_when_parse_stage_errors() {
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
                }),
                chunk_config: None,
            })
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
