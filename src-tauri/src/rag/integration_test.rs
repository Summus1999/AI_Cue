use super::{
    ChunkConfig, EmbedError, EmbeddingProvider, KnowledgeBaseImportOrchestrator,
    KnowledgeBaseImportRequest, ReindexKnowledgeDocumentRequest,
};
use crate::database::{
    create_knowledge_base, delete_knowledge_document, get_knowledge_document,
    list_knowledge_documents, CreateKnowledgeBaseInput, Database, KnowledgeDocumentIndexState,
};
use async_trait::async_trait;
use rusqlite::params;
use std::sync::Arc;

struct StaticEmbeddingProvider {
    model_id: String,
    embedding: Vec<f32>,
}

impl StaticEmbeddingProvider {
    fn new(model_id: &str, embedding: Vec<f32>) -> Self {
        Self {
            model_id: model_id.to_string(),
            embedding,
        }
    }
}

#[async_trait]
impl EmbeddingProvider for StaticEmbeddingProvider {
    async fn embed(&self, _text: &str) -> Result<Vec<f32>, EmbedError> {
        Ok(self.embedding.clone())
    }

    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        Ok(texts.iter().map(|_| self.embedding.clone()).collect())
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }

    fn dimension(&self) -> usize {
        self.embedding.len()
    }
}

fn create_test_db() -> Arc<Database> {
    let temp_dir = std::env::temp_dir().join(format!(
        "rag_knowledge_base_integration_test_{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    Arc::new(crate::database::init_database(&temp_dir).unwrap())
}

fn create_test_file(name: &str, content: &str) -> String {
    let temp_dir = std::env::temp_dir().join(format!(
        "rag_knowledge_base_source_test_{}",
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
            name: "Knowledge Base Integration".to_string(),
            description: Some("rag integration test".to_string()),
        },
    )
    .unwrap()
    .id
}

fn count_rows(db: &Arc<Database>, table: &str) -> usize {
    let conn = db.0.lock().unwrap();
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get::<_, i64>(0)
    })
    .unwrap() as usize
}

fn count_rows_for_document(db: &Arc<Database>, table: &str, document_id: &str) -> usize {
    let conn = db.0.lock().unwrap();
    conn.query_row(
        &format!("SELECT COUNT(*) FROM {table} WHERE document_id = ?1"),
        params![document_id],
        |row| row.get::<_, i64>(0),
    )
    .unwrap() as usize
}

#[tokio::test]
async fn import_document_with_embeddings_indexes_document_on_first_import() {
    let db = create_test_db();
    let knowledge_base_id = create_test_knowledge_base(&db);
    let path = create_test_file(
        "first-import.md",
        "# Rust Ownership\n\nOwnership prevents double free.\n\n## Borrowing\n\nBorrowing keeps access safe without taking ownership.\n",
    );
    let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());
    let provider = Arc::new(StaticEmbeddingProvider::new(
        "integration-model-v1",
        vec![0.25, 0.5, 0.75],
    ));

    let completed = orchestrator
        .import_document_with_embeddings(
            &KnowledgeBaseImportRequest {
                knowledge_base_id: knowledge_base_id.clone(),
                path,
                parse_options: None,
                chunk_config: Some(ChunkConfig {
                    max_chunk_size: 72,
                    overlap_size: 0,
                    min_chunk_size: 18,
                    prefer_structure_boundary: true,
                }),
                progress_event_id: None,
            },
            provider,
        )
        .await
        .unwrap();

    assert_eq!(completed.document.knowledge_base_id, knowledge_base_id);
    assert_eq!(
        completed.document.index_state,
        KnowledgeDocumentIndexState::Ready
    );
    assert_eq!(completed.document.last_error, None);
    assert!(completed.document.indexed_at.is_some());
    assert!(!completed.chunks.is_empty());
    assert_eq!(completed.chunks.len(), completed.persisted_chunks.len());
    assert_eq!(
        completed.persisted_embeddings.len(),
        completed.persisted_chunks.len()
    );
    assert_eq!(
        completed.document.chunk_count,
        completed.persisted_chunks.len()
    );
    assert_eq!(
        completed.document.embedding_count,
        completed.persisted_embeddings.len()
    );

    let documents = list_knowledge_documents(&db, &completed.document.knowledge_base_id).unwrap();
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0].id, completed.document.id);
    assert_eq!(documents[0].index_state, KnowledgeDocumentIndexState::Ready);

    assert_eq!(count_rows(&db, "kb_documents"), 1);
    assert_eq!(
        count_rows(&db, "kb_chunks"),
        completed.persisted_chunks.len()
    );
    assert_eq!(
        count_rows(&db, "kb_embeddings"),
        completed.persisted_embeddings.len()
    );
}

#[tokio::test]
async fn duplicate_import_of_same_file_is_rejected_without_creating_dirty_rows() {
    let db = create_test_db();
    let knowledge_base_id = create_test_knowledge_base(&db);
    let path = create_test_file(
        "duplicate-import.md",
        "# Duplicate\n\nThe same source path should not be imported twice into one knowledge base.\n",
    );
    let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());
    let provider = Arc::new(StaticEmbeddingProvider::new(
        "duplicate-check-model",
        vec![0.1, 0.2, 0.3],
    ));

    let first = orchestrator
        .import_document_with_embeddings(
            &KnowledgeBaseImportRequest {
                knowledge_base_id: knowledge_base_id.clone(),
                path: path.clone(),
                parse_options: None,
                chunk_config: None,
                progress_event_id: None,
            },
            provider.clone(),
        )
        .await
        .unwrap();

    let error = orchestrator
        .import_document_with_embeddings(
            &KnowledgeBaseImportRequest {
                knowledge_base_id: knowledge_base_id.clone(),
                path,
                parse_options: None,
                chunk_config: None,
                progress_event_id: None,
            },
            provider,
        )
        .await
        .unwrap_err();

    assert!(error.contains("已存在同一路径的文档"));
    assert!(error.contains("重建索引"));

    let documents = list_knowledge_documents(&db, &knowledge_base_id).unwrap();
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0].id, first.document.id);
    assert_eq!(documents[0].index_state, KnowledgeDocumentIndexState::Ready);
    assert_eq!(
        documents[0].embedding_count,
        first.persisted_embeddings.len()
    );
    assert_eq!(count_rows(&db, "kb_documents"), 1);
    assert_eq!(count_rows(&db, "kb_chunks"), first.persisted_chunks.len());
    assert_eq!(
        count_rows(&db, "kb_embeddings"),
        first.persisted_embeddings.len()
    );
}

#[tokio::test]
async fn delete_knowledge_document_cascades_chunks_and_embeddings_after_import() {
    let db = create_test_db();
    let knowledge_base_id = create_test_knowledge_base(&db);
    let path = create_test_file(
        "delete-cascade.md",
        "# Delete Cascade\n\nDocument deletion should remove dependent chunks and embeddings.\n",
    );
    let orchestrator = KnowledgeBaseImportOrchestrator::new(db.clone());
    let provider = Arc::new(StaticEmbeddingProvider::new(
        "delete-model",
        vec![0.3, 0.2, 0.1],
    ));

    let completed = orchestrator
        .import_document_with_embeddings(
            &KnowledgeBaseImportRequest {
                knowledge_base_id: knowledge_base_id.clone(),
                path,
                parse_options: None,
                chunk_config: None,
                progress_event_id: None,
            },
            provider,
        )
        .await
        .unwrap();

    assert!(count_rows_for_document(&db, "kb_chunks", &completed.document.id) > 0);
    assert!(count_rows_for_document(&db, "kb_embeddings", &completed.document.id) > 0);

    delete_knowledge_document(&db, &completed.document.id).unwrap();

    assert!(get_knowledge_document(&db, &completed.document.id)
        .unwrap()
        .is_none());
    assert_eq!(count_rows(&db, "kb_documents"), 0);
    assert_eq!(count_rows(&db, "kb_chunks"), 0);
    assert_eq!(count_rows(&db, "kb_embeddings"), 0);
    assert!(list_knowledge_documents(&db, &knowledge_base_id)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn delete_then_reimport_same_source_path_succeeds_as_current_reindex_flow() {
    let db = create_test_db();
    let knowledge_base_id = create_test_knowledge_base(&db);
    let path = create_test_file("reindex-flow.md", "# Original\n\nFirst import content.\n");
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
            Arc::new(StaticEmbeddingProvider::new(
                "reindex-model-v1",
                vec![0.4, 0.5, 0.6],
            )),
        )
        .await
        .unwrap();

    let first_document_id = first_import.document.id.clone();
    let first_content_hash = first_import.document.content_hash.clone();
    let first_source_path = first_import.document.source_path.clone();

    delete_knowledge_document(&db, &first_document_id).unwrap();
    std::fs::write(
        &path,
        "# Original\n\nFirst import content.\n\n## Reindexed\n\nSecond import content after delete should rebuild chunks and embeddings.\n",
    )
    .unwrap();

    let second_import = orchestrator
        .import_document_with_embeddings(
            &KnowledgeBaseImportRequest {
                knowledge_base_id: knowledge_base_id.clone(),
                path,
                parse_options: None,
                chunk_config: Some(ChunkConfig {
                    max_chunk_size: 70,
                    overlap_size: 0,
                    min_chunk_size: 18,
                    prefer_structure_boundary: true,
                }),
                progress_event_id: None,
            },
            Arc::new(StaticEmbeddingProvider::new(
                "reindex-model-v2",
                vec![0.9, 0.1, 0.2, 0.3],
            )),
        )
        .await
        .unwrap();

    assert_ne!(second_import.document.id, first_document_id);
    assert_eq!(second_import.document.source_path, first_source_path);
    assert_ne!(second_import.document.content_hash, first_content_hash);
    assert_eq!(
        second_import.document.index_state,
        KnowledgeDocumentIndexState::Ready
    );
    assert_eq!(
        second_import.document.embedding_count,
        second_import.persisted_embeddings.len()
    );
    assert!(second_import
        .persisted_embeddings
        .iter()
        .all(|embedding| embedding.model_id == "reindex-model-v2"));

    let documents = list_knowledge_documents(&db, &knowledge_base_id).unwrap();
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0].id, second_import.document.id);
    assert_eq!(count_rows(&db, "kb_documents"), 1);
    assert_eq!(
        count_rows(&db, "kb_chunks"),
        second_import.persisted_chunks.len()
    );
    assert_eq!(
        count_rows(&db, "kb_embeddings"),
        second_import.persisted_embeddings.len()
    );
}

#[tokio::test]
async fn reindex_document_with_embeddings_reuses_document_id_and_replaces_rows() {
    let db = create_test_db();
    let knowledge_base_id = create_test_knowledge_base(&db);
    let path = create_test_file(
        "real-reindex-flow.md",
        "# Original\n\nFirst import content.\n",
    );
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
            Arc::new(StaticEmbeddingProvider::new(
                "reindex-model-v1",
                vec![0.4, 0.5, 0.6],
            )),
        )
        .await
        .unwrap();

    let first_document_id = first_import.document.id.clone();
    let first_content_hash = first_import.document.content_hash.clone();
    let first_source_path = first_import.document.source_path.clone();

    std::fs::write(
        &path,
        "# Original\n\nFirst import content.\n\n## Reindexed\n\nSecond import content should replace old chunks and embeddings in place.\n",
    )
    .unwrap();

    let second_import = orchestrator
        .reindex_document_with_embeddings(
            &ReindexKnowledgeDocumentRequest {
                document_id: first_document_id.clone(),
                parse_options: None,
                chunk_config: Some(ChunkConfig {
                    max_chunk_size: 70,
                    overlap_size: 0,
                    min_chunk_size: 18,
                    prefer_structure_boundary: true,
                }),
                progress_event_id: None,
            },
            Arc::new(StaticEmbeddingProvider::new(
                "reindex-model-v2",
                vec![0.9, 0.1, 0.2, 0.3],
            )),
        )
        .await
        .unwrap();

    assert_eq!(second_import.document.id, first_document_id);
    assert_eq!(second_import.document.knowledge_base_id, knowledge_base_id);
    assert_eq!(second_import.document.source_path, first_source_path);
    assert_ne!(second_import.document.content_hash, first_content_hash);
    assert_eq!(
        second_import.document.index_state,
        KnowledgeDocumentIndexState::Ready
    );
    assert_eq!(
        second_import.document.embedding_count,
        second_import.persisted_embeddings.len()
    );
    assert!(second_import.document.indexed_at.is_some());
    assert!(second_import
        .persisted_embeddings
        .iter()
        .all(|embedding| embedding.model_id == "reindex-model-v2"));

    let stored = get_knowledge_document(&db, &first_document_id)
        .unwrap()
        .unwrap();
    assert_eq!(stored.id, first_document_id);
    assert_eq!(
        count_rows_for_document(&db, "kb_chunks", &first_document_id),
        second_import.persisted_chunks.len()
    );
    assert_eq!(
        count_rows_for_document(&db, "kb_embeddings", &first_document_id),
        second_import.persisted_embeddings.len()
    );

    let documents = list_knowledge_documents(&db, &knowledge_base_id).unwrap();
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0].id, stored.id);
    assert_eq!(count_rows(&db, "kb_documents"), 1);
    assert_eq!(
        count_rows(&db, "kb_chunks"),
        second_import.persisted_chunks.len()
    );
    assert_eq!(
        count_rows(&db, "kb_embeddings"),
        second_import.persisted_embeddings.len()
    );
}
