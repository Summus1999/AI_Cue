use super::{
    KnowledgeBaseImportOperation, KnowledgeBaseImportProgress, KnowledgeBaseImportProgressStatus,
    KnowledgeBaseImportStage,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;

const MAX_FINISHED_TASK_SNAPSHOTS: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBaseImportTaskSnapshot {
    pub request_id: String,
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
    pub started_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
}

pub struct KnowledgeBaseImportTaskRegistry {
    tasks: RwLock<HashMap<String, KnowledgeBaseImportTaskSnapshot>>,
}

impl Default for KnowledgeBaseImportTaskRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl KnowledgeBaseImportTaskRegistry {
    pub fn new() -> Self {
        Self {
            tasks: RwLock::new(HashMap::new()),
        }
    }

    pub fn upsert(&self, progress: KnowledgeBaseImportProgress) {
        let Some(request_id) = normalize_request_id(progress.request_id.as_deref()) else {
            return;
        };

        let now = Utc::now().timestamp_millis();
        let mut guard = match self.tasks.write() {
            Ok(guard) => guard,
            Err(_) => return,
        };

        let finished_at = if is_finished_status(progress.status) {
            Some(now)
        } else {
            None
        };

        match guard.get_mut(&request_id) {
            Some(snapshot) => {
                snapshot.operation = progress.operation;
                snapshot.stage = progress.stage;
                snapshot.status = progress.status;
                snapshot.current = progress.current;
                snapshot.total = progress.total;
                snapshot.knowledge_base_id = progress.knowledge_base_id;
                snapshot.document_id = progress.document_id;
                snapshot.file_name = progress.file_name;
                snapshot.source_path = progress.source_path;
                snapshot.chunk_count = progress.chunk_count;
                snapshot.embedding_count = progress.embedding_count;
                snapshot.message = progress.message;
                snapshot.updated_at = now;
                snapshot.finished_at = finished_at;
            }
            None => {
                guard.insert(
                    request_id.clone(),
                    KnowledgeBaseImportTaskSnapshot {
                        request_id,
                        operation: progress.operation,
                        stage: progress.stage,
                        status: progress.status,
                        current: progress.current,
                        total: progress.total,
                        knowledge_base_id: progress.knowledge_base_id,
                        document_id: progress.document_id,
                        file_name: progress.file_name,
                        source_path: progress.source_path,
                        chunk_count: progress.chunk_count,
                        embedding_count: progress.embedding_count,
                        message: progress.message,
                        started_at: now,
                        updated_at: now,
                        finished_at,
                    },
                );
            }
        }

        prune_finished_tasks(&mut guard);
    }

    pub fn get(&self, request_id: &str) -> Option<KnowledgeBaseImportTaskSnapshot> {
        let request_id = normalize_request_id(Some(request_id))?;
        let guard = self.tasks.read().ok()?;
        guard.get(&request_id).cloned()
    }

    pub fn list(
        &self,
        knowledge_base_id: Option<&str>,
        document_id: Option<&str>,
        include_finished: bool,
    ) -> Vec<KnowledgeBaseImportTaskSnapshot> {
        let knowledge_base_id = normalize_request_id(knowledge_base_id);
        let document_id = normalize_request_id(document_id);

        let guard = match self.tasks.read() {
            Ok(guard) => guard,
            Err(_) => return Vec::new(),
        };

        let mut tasks = guard
            .values()
            .filter(|snapshot| {
                if !include_finished && is_finished_status(snapshot.status) {
                    return false;
                }

                if let Some(expected_knowledge_base_id) = knowledge_base_id.as_deref() {
                    if snapshot.knowledge_base_id != expected_knowledge_base_id {
                        return false;
                    }
                }

                if let Some(expected_document_id) = document_id.as_deref() {
                    if snapshot.document_id.as_deref() != Some(expected_document_id) {
                        return false;
                    }
                }

                true
            })
            .cloned()
            .collect::<Vec<_>>();

        tasks.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.request_id.cmp(&right.request_id))
        });

        tasks
    }
}

fn normalize_request_id(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn is_finished_status(status: KnowledgeBaseImportProgressStatus) -> bool {
    matches!(
        status,
        KnowledgeBaseImportProgressStatus::Completed | KnowledgeBaseImportProgressStatus::Failed
    )
}

fn prune_finished_tasks(tasks: &mut HashMap<String, KnowledgeBaseImportTaskSnapshot>) {
    let finished_count = tasks
        .values()
        .filter(|snapshot| snapshot.finished_at.is_some())
        .count();

    if finished_count <= MAX_FINISHED_TASK_SNAPSHOTS {
        return;
    }

    let remove_count = finished_count - MAX_FINISHED_TASK_SNAPSHOTS;
    let mut finished_tasks = tasks
        .values()
        .filter_map(|snapshot| {
            snapshot
                .finished_at
                .map(|_| (snapshot.request_id.clone(), snapshot.updated_at))
        })
        .collect::<Vec<_>>();

    finished_tasks.sort_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));

    for (request_id, _) in finished_tasks.into_iter().take(remove_count) {
        tasks.remove(&request_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
    use std::time::Duration;

    fn build_progress(
        request_id: &str,
        stage: KnowledgeBaseImportStage,
        status: KnowledgeBaseImportProgressStatus,
        document_id: Option<&str>,
    ) -> KnowledgeBaseImportProgress {
        KnowledgeBaseImportProgress {
            request_id: Some(request_id.to_string()),
            operation: KnowledgeBaseImportOperation::Import,
            stage,
            status,
            current: 1,
            total: 4,
            knowledge_base_id: "kb-1".to_string(),
            document_id: document_id.map(|value| value.to_string()),
            file_name: Some("rust.md".to_string()),
            source_path: Some("C:\\docs\\rust.md".to_string()),
            chunk_count: Some(3),
            embedding_count: None,
            message: "progress".to_string(),
        }
    }

    #[test]
    fn upsert_tracks_running_and_completed_snapshots() {
        let registry = KnowledgeBaseImportTaskRegistry::new();

        registry.upsert(build_progress(
            "task-1",
            KnowledgeBaseImportStage::Parse,
            KnowledgeBaseImportProgressStatus::Running,
            Some("doc-1"),
        ));

        let running = registry.get("task-1").unwrap();
        assert_eq!(running.stage, KnowledgeBaseImportStage::Parse);
        assert_eq!(running.status, KnowledgeBaseImportProgressStatus::Running);
        assert_eq!(running.finished_at, None);

        sleep(Duration::from_millis(2));
        registry.upsert(KnowledgeBaseImportProgress {
            stage: KnowledgeBaseImportStage::Finalize,
            status: KnowledgeBaseImportProgressStatus::Completed,
            embedding_count: Some(3),
            message: "done".to_string(),
            ..build_progress(
                "task-1",
                KnowledgeBaseImportStage::Finalize,
                KnowledgeBaseImportProgressStatus::Completed,
                Some("doc-1"),
            )
        });

        let completed = registry.get("task-1").unwrap();
        assert_eq!(completed.stage, KnowledgeBaseImportStage::Finalize);
        assert_eq!(
            completed.status,
            KnowledgeBaseImportProgressStatus::Completed
        );
        assert_eq!(completed.embedding_count, Some(3));
        assert_eq!(completed.message, "done");
        assert_eq!(completed.started_at, running.started_at);
        assert!(completed.updated_at >= running.updated_at);
        assert!(completed.finished_at.is_some());
    }

    #[test]
    fn list_filters_by_document_and_finished_state() {
        let registry = KnowledgeBaseImportTaskRegistry::new();

        registry.upsert(build_progress(
            "task-finished",
            KnowledgeBaseImportStage::Finalize,
            KnowledgeBaseImportProgressStatus::Completed,
            Some("doc-finished"),
        ));
        sleep(Duration::from_millis(2));
        registry.upsert(build_progress(
            "task-running",
            KnowledgeBaseImportStage::Chunk,
            KnowledgeBaseImportProgressStatus::Running,
            Some("doc-running"),
        ));

        let active_only = registry.list(Some("kb-1"), None, false);
        assert_eq!(active_only.len(), 1);
        assert_eq!(active_only[0].request_id, "task-running");

        let doc_filtered = registry.list(None, Some("doc-finished"), true);
        assert_eq!(doc_filtered.len(), 1);
        assert_eq!(doc_filtered[0].request_id, "task-finished");

        let all_tasks = registry.list(Some("kb-1"), None, true);
        assert_eq!(all_tasks.len(), 2);
        assert_eq!(all_tasks[0].request_id, "task-running");
        assert_eq!(all_tasks[1].request_id, "task-finished");
    }
}
