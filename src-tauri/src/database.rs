// SQLite 数据库模块 - 会话和消息持久化

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::Path;
use std::sync::Mutex;

/// 面试背景信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterviewContext {
    pub company: String,
    pub position: String,
    pub jd_highlights: String,
}

/// 消息评分（复盘功能）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageScore {
    pub id: String,
    pub session_id: String,
    pub message_id: String,
    // 五个核心评分维度
    pub confidence_score: f64,       // 面试自信度
    pub professionalism_score: f64,  // 技术专业度
    pub depth_score: f64,            // 技术深度
    pub theory_practice_score: f64,  // 理论和实际项目结合程度
    pub tech_sensitivity_score: f64, // 技术敏感度
    pub overall_score: f64,
    pub feedback: String,
    pub topic_tags: Vec<String>,
    pub created_at: i64,
}

/// 会话洞察（复盘功能）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInsight {
    pub id: String,
    pub session_id: String,
    pub insight_type: String, // 'knowledge_gap' | 'strength' | 'suggestion'
    pub title: String,
    pub detail: String,
    pub related_message_ids: Vec<String>,
    pub priority: i32,
    pub created_at: i64,
}

/// 已复盘会话摘要（用于趋势分析）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewedSession {
    pub session_id: String,
    pub title: String,
    pub overall_score: f64,
    pub completed_at: i64,
    pub review_status: String,
}

/// 会话元数据参数（创建会话时使用）
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct SessionMetadata {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub prompt_template_id: Option<String>,
    pub prompt_content: Option<String>,
    pub interview_context: Option<InterviewContext>,
    #[serde(default = "default_prompt_mode")]
    pub prompt_mode: String, // "assistant" 或 "interviewer"
}

fn default_prompt_mode() -> String {
    "assistant".to_string()
}

/// 数据库封装结构
pub struct Database(pub Mutex<Connection>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeDocumentIndexState {
    Pending,
    Indexing,
    Ready,
    Failed,
}

impl Default for KnowledgeDocumentIndexState {
    fn default() -> Self {
        Self::Pending
    }
}

impl KnowledgeDocumentIndexState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Indexing => "indexing",
            Self::Ready => "ready",
            Self::Failed => "failed",
        }
    }
}

impl TryFrom<&str> for KnowledgeDocumentIndexState {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "pending" => Ok(Self::Pending),
            "indexing" => Ok(Self::Indexing),
            "ready" => Ok(Self::Ready),
            "failed" => Ok(Self::Failed),
            _ => Err(format!("未知的知识库索引状态: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKnowledgeBaseInput {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBaseRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub document_count: usize,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBaseStatsRecord {
    pub knowledge_base_id: String,
    pub document_count: usize,
    pub chunk_count: usize,
    pub embedding_count: usize,
    pub source_bytes: u64,
    pub chunk_bytes: u64,
    pub embedding_bytes: u64,
    pub storage_bytes: u64,
    pub latest_indexed_model_id: Option<String>,
    pub latest_indexed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKnowledgeDocumentInput {
    pub knowledge_base_id: String,
    pub title: String,
    pub file_name: String,
    pub file_extension: Option<String>,
    pub document_type: String,
    pub source_path: String,
    pub source_byte_size: u64,
    pub source_modified_at: i64,
    pub content_hash: String,
    pub fingerprint: String,
    pub index_state: Option<KnowledgeDocumentIndexState>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDocumentRecord {
    pub id: String,
    pub knowledge_base_id: String,
    pub title: String,
    pub file_name: String,
    pub file_extension: Option<String>,
    pub document_type: String,
    pub source_path: String,
    pub source_byte_size: u64,
    pub source_modified_at: i64,
    pub content_hash: String,
    pub fingerprint: String,
    pub index_state: KnowledgeDocumentIndexState,
    pub last_error: Option<String>,
    pub chunk_count: usize,
    pub embedding_count: usize,
    pub created_at: i64,
    pub updated_at: i64,
    pub indexed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKnowledgeChunkInput {
    pub chunk_index: usize,
    pub text: String,
    pub chunk_type: String,
    pub heading_path: Vec<String>,
    pub page_number: Option<u32>,
    pub language: Option<String>,
    pub start_offset: usize,
    pub end_offset: usize,
    pub block_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeChunkRecord {
    pub id: String,
    pub document_id: String,
    pub chunk_index: usize,
    pub text: String,
    pub chunk_type: String,
    pub heading_path: Vec<String>,
    pub page_number: Option<u32>,
    pub language: Option<String>,
    pub start_offset: usize,
    pub end_offset: usize,
    pub block_count: usize,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKnowledgeEmbeddingInput {
    pub knowledge_base_id: String,
    pub document_id: String,
    pub chunk_id: String,
    pub embedding: Vec<f32>,
    pub embedding_dim: usize,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEmbeddingRecord {
    pub id: String,
    pub knowledge_base_id: String,
    pub document_id: String,
    pub chunk_id: String,
    pub embedding_dim: usize,
    pub model_id: String,
    pub created_at: i64,
}

/// 数据库迁移 - v1 到 v2
fn migrate_v1_to_v2(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    // 检查当前版本
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version < 2 {
        println!("执行数据库迁移 v1 -> v2...");

        // 使用事务确保原子性
        let tx = conn.unchecked_transaction()?;

        // 添加新字段（SQLite 支持 ALTER TABLE ADD COLUMN，且忽略已存在的字段）
        let migrations = [
            "ALTER TABLE sessions ADD COLUMN provider TEXT",
            "ALTER TABLE sessions ADD COLUMN model TEXT",
            "ALTER TABLE sessions ADD COLUMN prompt_template_id TEXT",
            "ALTER TABLE sessions ADD COLUMN prompt_content TEXT",
            "ALTER TABLE sessions ADD COLUMN interview_context TEXT",
        ];

        for sql in &migrations {
            if let Err(e) = tx.execute(sql, []) {
                // 如果错误是字段已存在，则忽略
                let err_msg = e.to_string();
                if !err_msg.contains("duplicate column name") {
                    return Err(e.into());
                }
            }
        }

        // 更新版本号
        tx.pragma_update(None, "user_version", 2)?;
        tx.commit()?;

        println!("数据库迁移 v1 -> v2 完成");
    }

    Ok(())
}

/// 数据库迁移 - v2 到 v3（面试复盘功能）
fn migrate_v2_to_v3(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version < 3 {
        println!("执行数据库迁移 v2 -> v3...");

        let tx = conn.unchecked_transaction()?;

        // 1. sessions 表扩展字段
        let alter_migrations = [
            "ALTER TABLE sessions ADD COLUMN review_status TEXT DEFAULT NULL",
            "ALTER TABLE sessions ADD COLUMN overall_score REAL DEFAULT NULL",
            "ALTER TABLE sessions ADD COLUMN completed_at INTEGER DEFAULT NULL",
        ];

        for sql in &alter_migrations {
            if let Err(e) = tx.execute(sql, []) {
                let err_msg = e.to_string();
                if !err_msg.contains("duplicate column name") {
                    return Err(e.into());
                }
            }
        }

        // 2. 创建消息评分表
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS message_scores (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                completeness_score REAL NOT NULL,
                accuracy_score REAL NOT NULL,
                clarity_score REAL NOT NULL,
                overall_score REAL NOT NULL,
                feedback TEXT NOT NULL DEFAULT '',
                topic_tags TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_message_scores_session ON message_scores(session_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_message_scores_message ON message_scores(message_id);"
        )?;

        // 3. 创建会话洞察表
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS session_insights (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                insight_type TEXT NOT NULL,
                title TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '',
                related_message_ids TEXT NOT NULL DEFAULT '[]',
                priority INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_session_insights_session
                ON session_insights(session_id, insight_type);",
        )?;

        tx.pragma_update(None, "user_version", 3)?;
        tx.commit()?;

        println!("数据库迁移 v2 -> v3 完成");
    }

    Ok(())
}

/// 数据库迁移 - v3 到 v4（添加 prompt_mode 字段）
fn migrate_v3_to_v4(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version < 4 {
        println!("执行数据库迁移 v3 -> v4...");

        let tx = conn.unchecked_transaction()?;

        // 添加 prompt_mode 字段
        if let Err(e) = tx.execute(
            "ALTER TABLE sessions ADD COLUMN prompt_mode TEXT NOT NULL DEFAULT 'assistant'",
            [],
        ) {
            let err_msg = e.to_string();
            if !err_msg.contains("duplicate column name") {
                return Err(e.into());
            }
        }

        tx.pragma_update(None, "user_version", 4)?;
        tx.commit()?;

        println!("数据库迁移 v3 -> v4 完成");
    }

    Ok(())
}

/// 数据库迁移 - v4 到 v5（更新评分维度为五个新指标）
fn migrate_v4_to_v5(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version < 5 {
        println!("执行数据库迁移 v4 -> v5...");

        let tx = conn.unchecked_transaction()?;

        // 1. 更新 message_scores 表：删除旧字段，添加新字段
        // SQLite 不支持直接删除列或重命名列，需要重建表
        // 策略：创建新表，复制数据，删除旧表，重命名新表

        // 检查新表是否已存在（避免重复迁移）
        let has_new_columns: bool = conn
            .query_row("PRAGMA table_info(message_scores)", [], |row| {
                let name: String = row.get(1)?;
                Ok(name == "confidence_score")
            })
            .unwrap_or(false);

        if !has_new_columns {
            // 创建临时新表
            tx.execute(
                "CREATE TABLE IF NOT EXISTS message_scores_new (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    confidence_score REAL NOT NULL DEFAULT 0,
                    professionalism_score REAL NOT NULL DEFAULT 0,
                    depth_score REAL NOT NULL DEFAULT 0,
                    theory_practice_score REAL NOT NULL DEFAULT 0,
                    tech_sensitivity_score REAL NOT NULL DEFAULT 0,
                    overall_score REAL NOT NULL DEFAULT 0,
                    feedback TEXT NOT NULL DEFAULT '',
                    topic_tags TEXT NOT NULL DEFAULT '[]',
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
                )",
                [],
            )?;

            // 从旧表复制数据（使用旧字段的默认值）
            tx.execute(
                "INSERT INTO message_scores_new (id, session_id, message_id, 
                    confidence_score, professionalism_score, depth_score, 
                    theory_practice_score, tech_sensitivity_score,
                    overall_score, feedback, topic_tags, created_at)
                 SELECT id, session_id, message_id,
                    COALESCE(completeness_score, 0) as confidence_score,
                    COALESCE(accuracy_score, 0) as professionalism_score,
                    COALESCE(clarity_score, 0) as depth_score,
                    0 as theory_practice_score,
                    0 as tech_sensitivity_score,
                    overall_score, feedback, topic_tags, created_at
                 FROM message_scores",
                [],
            )?;

            // 删除旧表
            tx.execute("DROP TABLE message_scores", [])?;

            // 重命名新表
            tx.execute(
                "ALTER TABLE message_scores_new RENAME TO message_scores",
                [],
            )?;

            // 重建索引
            tx.execute(
                "CREATE INDEX IF NOT EXISTS idx_message_scores_session ON message_scores(session_id)",
                []
            )?;
            tx.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_message_scores_message ON message_scores(message_id)",
                []
            )?;
        }

        tx.pragma_update(None, "user_version", 5)?;
        tx.commit()?;

        println!("数据库迁移 v4 -> v5 完成");
    }

    Ok(())
}

/// 数据库迁移 - v5 到 v6（向量存储表）
fn migrate_v5_to_v6(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version < 6 {
        println!("执行数据库迁移 v5 -> v6...");

        let tx = conn.unchecked_transaction()?;

        // 创建向量嵌入表
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS vec_embeddings (
                id              TEXT PRIMARY KEY,
                message_id      TEXT NOT NULL,
                chunk_idx       INTEGER NOT NULL DEFAULT 0,
                chunk_text      TEXT NOT NULL,
                embedding       BLOB NOT NULL,
                embedding_dim   INTEGER NOT NULL,
                model_id        TEXT NOT NULL,
                created_at      INTEGER NOT NULL,
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_vec_embeddings_message ON vec_embeddings(message_id);
            CREATE INDEX IF NOT EXISTS idx_vec_embeddings_model ON vec_embeddings(model_id);",
        )?;

        tx.pragma_update(None, "user_version", 6)?;
        tx.commit()?;

        println!("数据库迁移 v5 -> v6 完成");
    }

    Ok(())
}

/// 数据库迁移 - v6 到 v7（知识库持久化表）
fn migrate_v6_to_v7(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version < 7 {
        println!("执行数据库迁移 v6 -> v7...");

        let tx = conn.unchecked_transaction()?;

        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS knowledge_bases (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                description     TEXT NOT NULL DEFAULT '',
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_knowledge_bases_updated
                ON knowledge_bases(updated_at DESC);

            CREATE TABLE IF NOT EXISTS kb_documents (
                id                  TEXT PRIMARY KEY,
                knowledge_base_id   TEXT NOT NULL,
                title               TEXT NOT NULL,
                file_name           TEXT NOT NULL,
                file_extension      TEXT,
                document_type       TEXT NOT NULL,
                source_path         TEXT NOT NULL,
                source_byte_size    INTEGER NOT NULL,
                source_modified_at  INTEGER NOT NULL,
                content_hash        TEXT NOT NULL,
                fingerprint         TEXT NOT NULL,
                index_state         TEXT NOT NULL DEFAULT 'pending',
                last_error          TEXT,
                chunk_count         INTEGER NOT NULL DEFAULT 0,
                embedding_count     INTEGER NOT NULL DEFAULT 0,
                created_at          INTEGER NOT NULL,
                updated_at          INTEGER NOT NULL,
                indexed_at          INTEGER,
                FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
                UNIQUE (knowledge_base_id, source_path)
            );
            CREATE INDEX IF NOT EXISTS idx_kb_documents_base
                ON kb_documents(knowledge_base_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_kb_documents_state
                ON kb_documents(knowledge_base_id, index_state, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_kb_documents_fingerprint
                ON kb_documents(knowledge_base_id, fingerprint);
            CREATE INDEX IF NOT EXISTS idx_kb_documents_content_hash
                ON kb_documents(knowledge_base_id, content_hash);

            CREATE TABLE IF NOT EXISTS kb_chunks (
                id              TEXT PRIMARY KEY,
                document_id      TEXT NOT NULL,
                chunk_index      INTEGER NOT NULL,
                text             TEXT NOT NULL,
                chunk_type       TEXT NOT NULL,
                heading_path     TEXT NOT NULL DEFAULT '[]',
                page_number      INTEGER,
                language         TEXT,
                start_offset     INTEGER NOT NULL,
                end_offset       INTEGER NOT NULL,
                block_count      INTEGER NOT NULL DEFAULT 1,
                created_at       INTEGER NOT NULL,
                FOREIGN KEY (document_id) REFERENCES kb_documents(id) ON DELETE CASCADE,
                UNIQUE (document_id, chunk_index)
            );
            CREATE INDEX IF NOT EXISTS idx_kb_chunks_document
                ON kb_chunks(document_id, chunk_index);

            CREATE TABLE IF NOT EXISTS kb_embeddings (
                id                  TEXT PRIMARY KEY,
                knowledge_base_id   TEXT NOT NULL,
                document_id         TEXT NOT NULL,
                chunk_id            TEXT NOT NULL,
                embedding           BLOB NOT NULL,
                embedding_dim       INTEGER NOT NULL,
                model_id            TEXT NOT NULL,
                created_at          INTEGER NOT NULL,
                FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
                FOREIGN KEY (document_id) REFERENCES kb_documents(id) ON DELETE CASCADE,
                FOREIGN KEY (chunk_id) REFERENCES kb_chunks(id) ON DELETE CASCADE,
                UNIQUE (chunk_id, model_id)
            );
            CREATE INDEX IF NOT EXISTS idx_kb_embeddings_base_model
                ON kb_embeddings(knowledge_base_id, model_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_kb_embeddings_document
                ON kb_embeddings(document_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_kb_embeddings_chunk
                ON kb_embeddings(chunk_id);",
        )?;

        tx.pragma_update(None, "user_version", 7)?;
        tx.commit()?;

        println!("数据库迁移 v6 -> v7 完成");
    }

    Ok(())
}

/// 初始化数据库
pub fn init_database(app_data_dir: &Path) -> Result<Database, Box<dyn std::error::Error>> {
    // 确保目录存在
    std::fs::create_dir_all(app_data_dir)?;

    // 在 app_data_dir 下创建 sessions.db
    let db_path = app_data_dir.join("sessions.db");
    let conn = Connection::open(&db_path)?;

    // 启用 WAL 模式和外键约束
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;",
    )?;

    // 执行建表 SQL
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL DEFAULT '新会话',
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

        CREATE TABLE IF NOT EXISTS messages (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL,
            role        TEXT NOT NULL,
            content     TEXT NOT NULL DEFAULT '',
            image       TEXT,
            created_at  INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at ASC);",
    )?;

    // 执行数据库迁移
    migrate_v1_to_v2(&conn)?;
    migrate_v2_to_v3(&conn)?;
    migrate_v3_to_v4(&conn)?;
    migrate_v4_to_v5(&conn)?;
    migrate_v5_to_v6(&conn)?;
    migrate_v6_to_v7(&conn)?;

    Ok(Database(Mutex::new(conn)))
}

/// 获取当前时间戳（毫秒）
fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn serialize_embedding_blob(embedding: &[f32]) -> Vec<u8> {
    embedding
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

fn parse_index_state(value: String) -> KnowledgeDocumentIndexState {
    KnowledgeDocumentIndexState::try_from(value.as_str()).unwrap_or_default()
}

fn map_knowledge_base_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeBaseRecord> {
    Ok(KnowledgeBaseRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        document_count: row.get::<_, i64>(5)? as usize,
    })
}

fn map_knowledge_document_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<KnowledgeDocumentRecord> {
    let index_state: String = row.get(11)?;

    Ok(KnowledgeDocumentRecord {
        id: row.get(0)?,
        knowledge_base_id: row.get(1)?,
        title: row.get(2)?,
        file_name: row.get(3)?,
        file_extension: row.get(4)?,
        document_type: row.get(5)?,
        source_path: row.get(6)?,
        source_byte_size: row.get::<_, i64>(7)? as u64,
        source_modified_at: row.get(8)?,
        content_hash: row.get(9)?,
        fingerprint: row.get(10)?,
        index_state: parse_index_state(index_state),
        last_error: row.get(12)?,
        chunk_count: row.get::<_, i64>(13)? as usize,
        embedding_count: row.get::<_, i64>(14)? as usize,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        indexed_at: row.get(17)?,
    })
}

fn map_knowledge_chunk_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeChunkRecord> {
    let heading_path_json: String = row.get(5)?;
    let heading_path = serde_json::from_str(&heading_path_json).unwrap_or_default();

    Ok(KnowledgeChunkRecord {
        id: row.get(0)?,
        document_id: row.get(1)?,
        chunk_index: row.get::<_, i64>(2)? as usize,
        text: row.get(3)?,
        chunk_type: row.get(4)?,
        heading_path,
        page_number: row.get::<_, Option<i64>>(6)?.map(|value| value as u32),
        language: row.get(7)?,
        start_offset: row.get::<_, i64>(8)? as usize,
        end_offset: row.get::<_, i64>(9)? as usize,
        block_count: row.get::<_, i64>(10)? as usize,
        created_at: row.get(11)?,
    })
}

fn touch_knowledge_base(
    conn: &Connection,
    knowledge_base_id: &str,
    updated_at: i64,
) -> Result<(), String> {
    conn.execute(
        "UPDATE knowledge_bases SET updated_at = ?1 WHERE id = ?2",
        params![updated_at, knowledge_base_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

const KNOWLEDGE_DOCUMENT_RESTART_RECOVERY_ERROR: &str =
    "应用重启后恢复：上次索引任务未完成，请重试";

/// 创建新会话（支持元数据）
pub fn create_session(
    db: &Database,
    metadata: Option<SessionMetadata>,
) -> Result<serde_json::Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = current_timestamp_ms();
    let title = "新会话";

    let metadata = metadata.unwrap_or_default();
    let interview_context_clone = metadata.interview_context.clone();
    let interview_context_json = metadata
        .interview_context
        .map(|ctx| serde_json::to_string(&ctx).ok())
        .flatten();
    let prompt_mode = if metadata.prompt_mode.is_empty() {
        "assistant".to_string()
    } else {
        metadata.prompt_mode.clone()
    };

    conn.execute(
        "INSERT INTO sessions (
            id, title, created_at, updated_at,
            provider, model, prompt_template_id, prompt_content, interview_context, prompt_mode
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id,
            title,
            now,
            now,
            metadata.provider,
            metadata.model,
            metadata.prompt_template_id,
            metadata.prompt_content,
            interview_context_json,
            prompt_mode
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({
        "id": id,
        "title": title,
        "created_at": now,
        "updated_at": now,
        "provider": metadata.provider,
        "model": metadata.model,
        "prompt_template_id": metadata.prompt_template_id,
        "prompt_content": metadata.prompt_content,
        "interview_context": interview_context_clone,
        "prompt_mode": prompt_mode
    }))
}

/// 列出所有会话（支持按 prompt_mode 筛选）
pub fn list_sessions(
    db: &Database,
    prompt_mode: Option<&str>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // 辅助函数：将行转换为 JSON
    fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<serde_json::Value> {
        let interview_context_str: Option<String> = row.get(8)?;
        let interview_context: Option<InterviewContext> =
            interview_context_str.and_then(|s| serde_json::from_str(&s).ok());
        let prompt_mode_val: String = row
            .get::<_, Option<String>>(9)?
            .unwrap_or_else(|| "assistant".to_string());

        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "title": row.get::<_, String>(1)?,
            "created_at": row.get::<_, i64>(2)?,
            "updated_at": row.get::<_, i64>(3)?,
            "provider": row.get::<_, Option<String>>(4)?,
            "model": row.get::<_, Option<String>>(5)?,
            "prompt_template_id": row.get::<_, Option<String>>(6)?,
            "prompt_content": row.get::<_, Option<String>>(7)?,
            "interview_context": interview_context,
            "prompt_mode": prompt_mode_val,
            "completed_at": row.get::<_, Option<i64>>(10)?,
            "review_status": row.get::<_, Option<String>>(11)?,
            "overall_score": row.get::<_, Option<f64>>(12)?
        }))
    }

    let mut result = Vec::new();

    if let Some(mode) = prompt_mode {
        // 有筛选条件时使用参数化查询
        let mut stmt = conn
            .prepare(
                "SELECT id, title, created_at, updated_at, provider, model, 
                    prompt_template_id, prompt_content, interview_context, prompt_mode,
                    completed_at, review_status, overall_score
             FROM sessions WHERE prompt_mode = ?1 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let sessions = stmt
            .query_map(params![mode], row_to_json)
            .map_err(|e| e.to_string())?;
        for session in sessions {
            result.push(session.map_err(|e| e.to_string())?);
        }
    } else {
        // 无筛选条件时返回所有
        let mut stmt = conn
            .prepare(
                "SELECT id, title, created_at, updated_at, provider, model, 
                    prompt_template_id, prompt_content, interview_context, prompt_mode,
                    completed_at, review_status, overall_score
             FROM sessions ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let sessions = stmt.query_map([], row_to_json).map_err(|e| e.to_string())?;
        for session in sessions {
            result.push(session.map_err(|e| e.to_string())?);
        }
    }

    Ok(result)
}

/// 获取会话的所有消息
pub fn get_session_messages(
    db: &Database,
    session_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, session_id, role, content, image, created_at FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;

    let messages = stmt
        .query_map(params![session_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "session_id": row.get::<_, String>(1)?,
                "role": row.get::<_, String>(2)?,
                "content": row.get::<_, String>(3)?,
                "image": row.get::<_, Option<String>>(4)?,
                "created_at": row.get::<_, i64>(5)?
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for msg in messages {
        result.push(msg.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

/// 保存消息
pub fn save_message(
    db: &Database,
    session_id: &str,
    role: &str,
    content: &str,
    image: Option<&str>,
) -> Result<serde_json::Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = current_timestamp_ms();

    // 插入消息
    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, image, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, session_id, role, content, image, now]
    ).map_err(|e| e.to_string())?;

    // 更新会话的 updated_at
    conn.execute(
        "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({
        "id": id,
        "session_id": session_id,
        "role": role,
        "content": content,
        "image": image,
        "created_at": now
    }))
}

/// 更新会话标题
pub fn update_session_title(db: &Database, session_id: &str, title: &str) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp_ms();

    conn.execute(
        "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, now, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 删除会话（CASCADE 自动删除消息）
pub fn delete_session(db: &Database, session_id: &str) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 搜索会话（按消息内容，支持按 prompt_mode 筛选）
pub fn search_sessions(
    db: &Database,
    keyword: &str,
    prompt_mode: Option<&str>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // 辅助函数：将行转换为 JSON
    fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<serde_json::Value> {
        let interview_context_str: Option<String> = row.get(8)?;
        let interview_context: Option<InterviewContext> =
            interview_context_str.and_then(|s| serde_json::from_str(&s).ok());
        let prompt_mode_val: String = row
            .get::<_, Option<String>>(9)?
            .unwrap_or_else(|| "assistant".to_string());

        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "title": row.get::<_, String>(1)?,
            "created_at": row.get::<_, i64>(2)?,
            "updated_at": row.get::<_, i64>(3)?,
            "provider": row.get::<_, Option<String>>(4)?,
            "model": row.get::<_, Option<String>>(5)?,
            "prompt_template_id": row.get::<_, Option<String>>(6)?,
            "prompt_content": row.get::<_, Option<String>>(7)?,
            "interview_context": interview_context,
            "prompt_mode": prompt_mode_val,
            "completed_at": row.get::<_, Option<i64>>(10)?,
            "review_status": row.get::<_, Option<String>>(11)?,
            "overall_score": row.get::<_, Option<f64>>(12)?
        }))
    }

    let mut result = Vec::new();

    if let Some(mode) = prompt_mode {
        // 有 prompt_mode 筛选条件
        let mut stmt = conn.prepare(
            "SELECT DISTINCT s.id, s.title, s.created_at, s.updated_at,
                    s.provider, s.model, s.prompt_template_id, s.prompt_content, 
                    s.interview_context, s.prompt_mode, s.completed_at, s.review_status, s.overall_score
             FROM sessions s 
             JOIN messages m ON s.id = m.session_id 
             WHERE m.content LIKE '%' || ?1 || '%' AND s.prompt_mode = ?2
             ORDER BY s.updated_at DESC"
        ).map_err(|e| e.to_string())?;
        let sessions = stmt
            .query_map(params![keyword, mode], row_to_json)
            .map_err(|e| e.to_string())?;
        for session in sessions {
            result.push(session.map_err(|e| e.to_string())?);
        }
    } else {
        // 无 prompt_mode 筛选条件
        let mut stmt = conn.prepare(
            "SELECT DISTINCT s.id, s.title, s.created_at, s.updated_at,
                    s.provider, s.model, s.prompt_template_id, s.prompt_content, 
                    s.interview_context, s.prompt_mode, s.completed_at, s.review_status, s.overall_score
             FROM sessions s 
             JOIN messages m ON s.id = m.session_id 
             WHERE m.content LIKE '%' || ?1 || '%' 
             ORDER BY s.updated_at DESC"
        ).map_err(|e| e.to_string())?;
        let sessions = stmt
            .query_map(params![keyword], row_to_json)
            .map_err(|e| e.to_string())?;
        for session in sessions {
            result.push(session.map_err(|e| e.to_string())?);
        }
    }

    Ok(result)
}

/// 获取最近活跃的会话（支持按 prompt_mode 筛选）
pub fn get_last_active_session(
    db: &Database,
    prompt_mode: Option<&str>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // 辅助函数：将行转换为 JSON
    fn row_to_json(row: &rusqlite::Row) -> Result<serde_json::Value, String> {
        let interview_context_str: Option<String> = row.get(8).map_err(|e| e.to_string())?;
        let interview_context: Option<InterviewContext> =
            interview_context_str.and_then(|s| serde_json::from_str(&s).ok());
        let prompt_mode_val: String = row
            .get::<_, Option<String>>(9)
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "assistant".to_string());

        Ok(json!({
            "id": row.get::<_, String>(0).map_err(|e| e.to_string())?,
            "title": row.get::<_, String>(1).map_err(|e| e.to_string())?,
            "created_at": row.get::<_, i64>(2).map_err(|e| e.to_string())?,
            "updated_at": row.get::<_, i64>(3).map_err(|e| e.to_string())?,
            "provider": row.get::<_, Option<String>>(4).map_err(|e| e.to_string())?,
            "model": row.get::<_, Option<String>>(5).map_err(|e| e.to_string())?,
            "prompt_template_id": row.get::<_, Option<String>>(6).map_err(|e| e.to_string())?,
            "prompt_content": row.get::<_, Option<String>>(7).map_err(|e| e.to_string())?,
            "interview_context": interview_context,
            "prompt_mode": prompt_mode_val,
            "completed_at": row.get::<_, Option<i64>>(10).map_err(|e| e.to_string())?,
            "review_status": row.get::<_, Option<String>>(11).map_err(|e| e.to_string())?,
            "overall_score": row.get::<_, Option<f64>>(12).map_err(|e| e.to_string())?
        }))
    }

    if let Some(mode) = prompt_mode {
        // 有 prompt_mode 筛选条件
        let mut stmt = conn
            .prepare(
                "SELECT id, title, created_at, updated_at, provider, model,
                    prompt_template_id, prompt_content, interview_context, prompt_mode,
                    completed_at, review_status, overall_score
             FROM sessions WHERE prompt_mode = ?1 ORDER BY updated_at DESC LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![mode]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            return Ok(Some(row_to_json(row)?));
        }
    } else {
        // 无 prompt_mode 筛选条件
        let mut stmt = conn
            .prepare(
                "SELECT id, title, created_at, updated_at, provider, model,
                    prompt_template_id, prompt_content, interview_context, prompt_mode,
                    completed_at, review_status, overall_score
             FROM sessions ORDER BY updated_at DESC LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            return Ok(Some(row_to_json(row)?));
        }
    }

    Ok(None)
}

// ==================== Knowledge Base CRUD Functions ====================

/// 创建知识库
pub fn create_knowledge_base(
    db: &Database,
    input: CreateKnowledgeBaseInput,
) -> Result<KnowledgeBaseRecord, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("知识库名称不能为空".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = current_timestamp_ms();
    let description = input.description.unwrap_or_default().trim().to_string();

    conn.execute(
        "INSERT INTO knowledge_bases (id, name, description, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, name, description, now, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(KnowledgeBaseRecord {
        id,
        name: name.to_string(),
        description,
        document_count: 0,
        created_at: now,
        updated_at: now,
    })
}

/// 列出知识库
pub fn list_knowledge_bases(db: &Database) -> Result<Vec<KnowledgeBaseRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT kb.id, kb.name, kb.description, kb.created_at, kb.updated_at, COUNT(d.id) AS document_count
             FROM knowledge_bases kb
             LEFT JOIN kb_documents d ON d.knowledge_base_id = kb.id
             GROUP BY kb.id, kb.name, kb.description, kb.created_at, kb.updated_at
             ORDER BY kb.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], map_knowledge_base_row)
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

/// 获取单个知识库的聚合统计
pub fn get_knowledge_base_stats(
    db: &Database,
    knowledge_base_id: &str,
) -> Result<Option<KnowledgeBaseStatsRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT kb.id,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM kb_documents d
                        WHERE d.knowledge_base_id = kb.id
                    ), 0) AS document_count,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM kb_chunks kc
                        INNER JOIN kb_documents d ON d.id = kc.document_id
                        WHERE d.knowledge_base_id = kb.id
                    ), 0) AS chunk_count,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM kb_embeddings ke
                        WHERE ke.knowledge_base_id = kb.id
                    ), 0) AS embedding_count,
                    COALESCE((
                        SELECT SUM(d.source_byte_size)
                        FROM kb_documents d
                        WHERE d.knowledge_base_id = kb.id
                    ), 0) AS source_bytes,
                    COALESCE((
                        SELECT SUM(LENGTH(CAST(kc.text AS BLOB)))
                        FROM kb_chunks kc
                        INNER JOIN kb_documents d ON d.id = kc.document_id
                        WHERE d.knowledge_base_id = kb.id
                    ), 0) AS chunk_bytes,
                    COALESCE((
                        SELECT SUM(LENGTH(ke.embedding))
                        FROM kb_embeddings ke
                        WHERE ke.knowledge_base_id = kb.id
                    ), 0) AS embedding_bytes,
                    (
                        SELECT ke.model_id
                        FROM kb_embeddings ke
                        WHERE ke.knowledge_base_id = kb.id
                        ORDER BY ke.created_at DESC, ke.id DESC
                        LIMIT 1
                    ) AS latest_indexed_model_id,
                    (
                        SELECT ke.created_at
                        FROM kb_embeddings ke
                        WHERE ke.knowledge_base_id = kb.id
                        ORDER BY ke.created_at DESC, ke.id DESC
                        LIMIT 1
                    ) AS latest_indexed_at
             FROM knowledge_bases kb
             WHERE kb.id = ?1",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_row(params![knowledge_base_id], |row| {
        let source_bytes = row.get::<_, i64>(4)?.max(0) as u64;
        let chunk_bytes = row.get::<_, i64>(5)?.max(0) as u64;
        let embedding_bytes = row.get::<_, i64>(6)?.max(0) as u64;

        Ok(KnowledgeBaseStatsRecord {
            knowledge_base_id: row.get(0)?,
            document_count: row.get::<_, i64>(1)?.max(0) as usize,
            chunk_count: row.get::<_, i64>(2)?.max(0) as usize,
            embedding_count: row.get::<_, i64>(3)?.max(0) as usize,
            source_bytes,
            chunk_bytes,
            embedding_bytes,
            storage_bytes: source_bytes + chunk_bytes + embedding_bytes,
            latest_indexed_model_id: row.get(7)?,
            latest_indexed_at: row.get(8)?,
        })
    })
    .optional()
    .map_err(|e| e.to_string())
}

/// 删除知识库
pub fn delete_knowledge_base(db: &Database, knowledge_base_id: &str) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let affected = conn
        .execute(
            "DELETE FROM knowledge_bases WHERE id = ?1",
            params![knowledge_base_id],
        )
        .map_err(|e| e.to_string())?;

    if affected == 0 {
        return Err(format!("知识库不存在: {knowledge_base_id}"));
    }

    Ok(())
}

/// 创建知识库文档记录
pub fn create_knowledge_document(
    db: &Database,
    input: CreateKnowledgeDocumentInput,
) -> Result<KnowledgeDocumentRecord, String> {
    let CreateKnowledgeDocumentInput {
        knowledge_base_id,
        title,
        file_name,
        file_extension,
        document_type,
        source_path,
        source_byte_size,
        source_modified_at,
        content_hash,
        fingerprint,
        index_state,
        last_error,
    } = input;

    if knowledge_base_id.trim().is_empty() {
        return Err("knowledgeBaseId 不能为空".to_string());
    }
    if source_path.trim().is_empty() {
        return Err("sourcePath 不能为空".to_string());
    }
    if file_name.trim().is_empty() {
        return Err("fileName 不能为空".to_string());
    }
    if document_type.trim().is_empty() {
        return Err("documentType 不能为空".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = current_timestamp_ms();
    let index_state = index_state.unwrap_or_default();

    let insert_result = conn.execute(
        "INSERT INTO kb_documents (
            id, knowledge_base_id, title, file_name, file_extension, document_type,
            source_path, source_byte_size, source_modified_at, content_hash, fingerprint,
            index_state, last_error, chunk_count, embedding_count, created_at, updated_at, indexed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 0, 0, ?14, ?15, NULL)",
        params![
            &id,
            &knowledge_base_id,
            &title,
            &file_name,
            file_extension,
            &document_type,
            &source_path,
            source_byte_size as i64,
            source_modified_at,
            &content_hash,
            &fingerprint,
            index_state.as_str(),
            last_error,
            now,
            now,
        ],
    );

    if let Err(err) = insert_result {
        let raw = err.to_string();
        if raw.contains("FOREIGN KEY constraint failed") {
            return Err(format!("知识库不存在: {knowledge_base_id}"));
        }
        if raw.contains(
            "UNIQUE constraint failed: kb_documents.knowledge_base_id, kb_documents.source_path",
        ) {
            return Err("该知识库中已存在同一路径的文档，请改用重建索引而不是重复导入".to_string());
        }
        return Err(raw);
    }

    touch_knowledge_base(&conn, &knowledge_base_id, now)?;
    drop(conn);

    get_knowledge_document(db, &id)?.ok_or_else(|| format!("知识库文档创建后读取失败: {id}"))
}

/// 重建索引前重置知识库文档的快照元数据与索引内容
pub fn reset_knowledge_document_for_reindex(
    db: &Database,
    document_id: &str,
    input: CreateKnowledgeDocumentInput,
) -> Result<KnowledgeDocumentRecord, String> {
    let CreateKnowledgeDocumentInput {
        knowledge_base_id,
        title,
        file_name,
        file_extension,
        document_type,
        source_path,
        source_byte_size,
        source_modified_at,
        content_hash,
        fingerprint,
        index_state,
        last_error,
    } = input;

    if document_id.trim().is_empty() {
        return Err("documentId 不能为空".to_string());
    }
    if knowledge_base_id.trim().is_empty() {
        return Err("knowledgeBaseId 不能为空".to_string());
    }
    if source_path.trim().is_empty() {
        return Err("sourcePath 不能为空".to_string());
    }
    if file_name.trim().is_empty() {
        return Err("fileName 不能为空".to_string());
    }
    if document_type.trim().is_empty() {
        return Err("documentType 不能为空".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let now = current_timestamp_ms();
    let index_state = index_state.unwrap_or_default();

    let stored_knowledge_base_id: Option<String> = tx
        .query_row(
            "SELECT knowledge_base_id FROM kb_documents WHERE id = ?1",
            params![document_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(stored_knowledge_base_id) = stored_knowledge_base_id else {
        return Err(format!("知识库文档不存在: {document_id}"));
    };

    if stored_knowledge_base_id != knowledge_base_id {
        return Err(format!(
            "知识库文档 {document_id} 不属于知识库 {knowledge_base_id}"
        ));
    }

    tx.execute(
        "DELETE FROM kb_embeddings WHERE document_id = ?1",
        params![document_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM kb_chunks WHERE document_id = ?1",
        params![document_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE kb_documents
         SET title = ?1,
             file_name = ?2,
             file_extension = ?3,
             document_type = ?4,
             source_path = ?5,
             source_byte_size = ?6,
             source_modified_at = ?7,
             content_hash = ?8,
             fingerprint = ?9,
             index_state = ?10,
             last_error = ?11,
             chunk_count = 0,
             embedding_count = 0,
             indexed_at = NULL,
             updated_at = ?12
         WHERE id = ?13",
        params![
            &title,
            &file_name,
            file_extension,
            &document_type,
            &source_path,
            source_byte_size as i64,
            source_modified_at,
            &content_hash,
            &fingerprint,
            index_state.as_str(),
            last_error,
            now,
            document_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    touch_knowledge_base(&tx, &knowledge_base_id, now)?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);

    get_knowledge_document(db, document_id)?
        .ok_or_else(|| format!("知识库文档重建索引后读取失败: {document_id}"))
}

/// 列出知识库中的文档
pub fn list_knowledge_documents(
    db: &Database,
    knowledge_base_id: &str,
) -> Result<Vec<KnowledgeDocumentRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, knowledge_base_id, title, file_name, file_extension, document_type,
                    source_path, source_byte_size, source_modified_at, content_hash, fingerprint,
                    index_state, last_error, chunk_count, embedding_count, created_at, updated_at, indexed_at
             FROM kb_documents
             WHERE knowledge_base_id = ?1
             ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![knowledge_base_id], map_knowledge_document_row)
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

/// 获取单个知识库文档
pub fn get_knowledge_document(
    db: &Database,
    document_id: &str,
) -> Result<Option<KnowledgeDocumentRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, knowledge_base_id, title, file_name, file_extension, document_type,
                    source_path, source_byte_size, source_modified_at, content_hash, fingerprint,
                    index_state, last_error, chunk_count, embedding_count, created_at, updated_at, indexed_at
             FROM kb_documents
             WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_row(params![document_id], map_knowledge_document_row)
        .optional()
        .map_err(|e| e.to_string())
}

/// 按知识库和源文件路径获取单个知识库文档
pub fn get_knowledge_document_by_source_path(
    db: &Database,
    knowledge_base_id: &str,
    source_path: &str,
) -> Result<Option<KnowledgeDocumentRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, knowledge_base_id, title, file_name, file_extension, document_type,
                    source_path, source_byte_size, source_modified_at, content_hash, fingerprint,
                    index_state, last_error, chunk_count, embedding_count, created_at, updated_at, indexed_at
             FROM kb_documents
             WHERE knowledge_base_id = ?1 AND source_path = ?2
             LIMIT 1",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_row(params![knowledge_base_id, source_path], map_knowledge_document_row)
        .optional()
        .map_err(|e| e.to_string())
}

/// 列出单个知识库文档的分块明细，供预览界面使用
pub fn list_knowledge_document_chunks(
    db: &Database,
    document_id: &str,
) -> Result<Vec<KnowledgeChunkRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let document_exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM kb_documents WHERE id = ?1)",
            params![document_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        != 0;

    if !document_exists {
        return Err(format!("知识库文档不存在: {document_id}"));
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, chunk_index, text, chunk_type, heading_path,
                    page_number, language, start_offset, end_offset, block_count, created_at
             FROM kb_chunks
             WHERE document_id = ?1
             ORDER BY chunk_index ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![document_id], map_knowledge_chunk_row)
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

/// 列出单个知识库文档的 embedding 明细，供导入跳过与测试使用
pub fn list_knowledge_document_embeddings(
    db: &Database,
    document_id: &str,
) -> Result<Vec<KnowledgeEmbeddingRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let document_exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM kb_documents WHERE id = ?1)",
            params![document_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        != 0;

    if !document_exists {
        return Err(format!("知识库文档不存在: {document_id}"));
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, knowledge_base_id, document_id, chunk_id, embedding_dim, model_id, created_at
             FROM kb_embeddings
             WHERE document_id = ?1
             ORDER BY created_at ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![document_id], |row| {
            Ok(KnowledgeEmbeddingRecord {
                id: row.get(0)?,
                knowledge_base_id: row.get(1)?,
                document_id: row.get(2)?,
                chunk_id: row.get(3)?,
                embedding_dim: row.get::<_, i64>(4)? as usize,
                model_id: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

/// 更新知识库文档索引状态
pub fn update_knowledge_document_index_state(
    db: &Database,
    document_id: &str,
    index_state: KnowledgeDocumentIndexState,
    last_error: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp_ms();

    let affected = conn
        .execute(
            "UPDATE kb_documents
             SET index_state = ?1,
                 last_error = ?2,
                 updated_at = ?3,
                 indexed_at = CASE
                     WHEN ?1 = 'ready' THEN COALESCE(indexed_at, ?3)
                     ELSE indexed_at
                 END
             WHERE id = ?4",
            params![index_state.as_str(), last_error, now, document_id],
        )
        .map_err(|e| e.to_string())?;

    if affected == 0 {
        return Err(format!("知识库文档不存在: {document_id}"));
    }

    Ok(())
}

/// 恢复应用重启前卡在 indexing 状态的知识库文档
pub fn recover_stuck_knowledge_documents(
    db: &Database,
) -> Result<Vec<KnowledgeDocumentRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let now = current_timestamp_ms();

    let mut stmt = tx
        .prepare(
            "SELECT id, knowledge_base_id, title, file_name, file_extension, document_type,
                    source_path, source_byte_size, source_modified_at, content_hash, fingerprint,
                    index_state, last_error, chunk_count, embedding_count, created_at, updated_at,
                    indexed_at
             FROM kb_documents
             WHERE index_state = 'indexing'
             ORDER BY updated_at DESC, created_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], map_knowledge_document_row)
        .map_err(|e| e.to_string())?;
    let mut indexing_documents = Vec::new();
    for row in rows {
        indexing_documents.push(row.map_err(|e| e.to_string())?);
    }
    drop(stmt);

    let mut recovered = Vec::new();
    let mut touched_knowledge_base_ids = std::collections::HashSet::new();

    for mut document in indexing_documents {
        document.index_state = KnowledgeDocumentIndexState::Failed;
        document.last_error = Some(KNOWLEDGE_DOCUMENT_RESTART_RECOVERY_ERROR.to_string());
        document.updated_at = now;

        tx.execute(
            "UPDATE kb_documents
             SET index_state = 'failed',
                 last_error = ?1,
                 updated_at = ?2
             WHERE id = ?3",
            params![document.last_error.as_deref(), now, &document.id],
        )
        .map_err(|e| e.to_string())?;

        touched_knowledge_base_ids.insert(document.knowledge_base_id.clone());
        recovered.push(document);
    }

    for knowledge_base_id in touched_knowledge_base_ids {
        touch_knowledge_base(&tx, &knowledge_base_id, now)?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(recovered)
}

/// 删除知识库文档
pub fn delete_knowledge_document(db: &Database, document_id: &str) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let knowledge_base_id: Option<String> = conn
        .query_row(
            "SELECT knowledge_base_id FROM kb_documents WHERE id = ?1",
            params![document_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(knowledge_base_id) = knowledge_base_id else {
        return Err(format!("知识库文档不存在: {document_id}"));
    };

    conn.execute(
        "DELETE FROM kb_documents WHERE id = ?1",
        params![document_id],
    )
    .map_err(|e| e.to_string())?;
    touch_knowledge_base(&conn, &knowledge_base_id, current_timestamp_ms())?;

    Ok(())
}

/// 插入文档分块
pub fn insert_knowledge_chunks(
    db: &Database,
    document_id: &str,
    chunks: &[CreateKnowledgeChunkInput],
) -> Result<Vec<KnowledgeChunkRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let now = current_timestamp_ms();
    let mut inserted = Vec::with_capacity(chunks.len());

    for chunk in chunks {
        let id = uuid::Uuid::new_v4().to_string();
        let heading_path = serde_json::to_string(&chunk.heading_path).map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO kb_chunks (
                id, document_id, chunk_index, text, chunk_type, heading_path,
                page_number, language, start_offset, end_offset, block_count, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                &id,
                document_id,
                chunk.chunk_index as i64,
                &chunk.text,
                &chunk.chunk_type,
                &heading_path,
                chunk.page_number.map(|value| value as i64),
                chunk.language.as_deref(),
                chunk.start_offset as i64,
                chunk.end_offset as i64,
                chunk.block_count as i64,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        inserted.push(KnowledgeChunkRecord {
            id,
            document_id: document_id.to_string(),
            chunk_index: chunk.chunk_index,
            text: chunk.text.clone(),
            chunk_type: chunk.chunk_type.clone(),
            heading_path: chunk.heading_path.clone(),
            page_number: chunk.page_number,
            language: chunk.language.clone(),
            start_offset: chunk.start_offset,
            end_offset: chunk.end_offset,
            block_count: chunk.block_count,
            created_at: now,
        });
    }

    tx.execute(
        "UPDATE kb_documents
         SET chunk_count = (SELECT COUNT(*) FROM kb_chunks WHERE document_id = ?1),
             updated_at = ?2
         WHERE id = ?1",
        params![document_id, now],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(inserted)
}

/// 插入文档向量
pub fn insert_knowledge_embeddings(
    db: &Database,
    embeddings: &[CreateKnowledgeEmbeddingInput],
) -> Result<Vec<KnowledgeEmbeddingRecord>, String> {
    if embeddings.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let now = current_timestamp_ms();
    let mut inserted = Vec::with_capacity(embeddings.len());
    let mut touched_documents = std::collections::HashSet::new();

    for item in embeddings {
        let id = uuid::Uuid::new_v4().to_string();
        let blob = serialize_embedding_blob(&item.embedding);

        tx.execute(
            "INSERT INTO kb_embeddings (
                id, knowledge_base_id, document_id, chunk_id, embedding, embedding_dim, model_id, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &id,
                &item.knowledge_base_id,
                &item.document_id,
                &item.chunk_id,
                blob,
                item.embedding_dim as i64,
                &item.model_id,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        touched_documents.insert(item.document_id.clone());
        inserted.push(KnowledgeEmbeddingRecord {
            id,
            knowledge_base_id: item.knowledge_base_id.clone(),
            document_id: item.document_id.clone(),
            chunk_id: item.chunk_id.clone(),
            embedding_dim: item.embedding_dim,
            model_id: item.model_id.clone(),
            created_at: now,
        });
    }

    for document_id in touched_documents {
        tx.execute(
            "UPDATE kb_documents
             SET embedding_count = (SELECT COUNT(*) FROM kb_embeddings WHERE document_id = ?1),
                 index_state = 'ready',
                 last_error = NULL,
                 indexed_at = COALESCE(indexed_at, ?2),
                 updated_at = ?2
             WHERE id = ?1",
            params![document_id, now],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(inserted)
}

// ==================== Review CRUD Functions ====================

/// 插入单条消息评分
pub fn insert_message_score(db: &Database, score: &MessageScore) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let topic_tags_json = serde_json::to_string(&score.topic_tags).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO message_scores (
            id, session_id, message_id, confidence_score, professionalism_score,
            depth_score, theory_practice_score, tech_sensitivity_score,
            overall_score, feedback, topic_tags, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            score.id,
            score.session_id,
            score.message_id,
            score.confidence_score,
            score.professionalism_score,
            score.depth_score,
            score.theory_practice_score,
            score.tech_sensitivity_score,
            score.overall_score,
            score.feedback,
            topic_tags_json,
            score.created_at
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 批量插入消息评分（使用事务保证原子性）
pub fn insert_message_scores_batch(db: &Database, scores: &[MessageScore]) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // 开始事务
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    for score in scores {
        let topic_tags_json =
            serde_json::to_string(&score.topic_tags).map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO message_scores (
                id, session_id, message_id, confidence_score, professionalism_score,
                depth_score, theory_practice_score, tech_sensitivity_score,
                overall_score, feedback, topic_tags, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                score.id,
                score.session_id,
                score.message_id,
                score.confidence_score,
                score.professionalism_score,
                score.depth_score,
                score.theory_practice_score,
                score.tech_sensitivity_score,
                score.overall_score,
                score.feedback,
                topic_tags_json,
                score.created_at
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    // 提交事务
    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

/// 查询会话下所有消息评分
pub fn get_message_scores(db: &Database, session_id: &str) -> Result<Vec<MessageScore>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, message_id, confidence_score, professionalism_score,
                depth_score, theory_practice_score, tech_sensitivity_score,
                overall_score, feedback, topic_tags, created_at
         FROM message_scores WHERE session_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let scores = stmt
        .query_map(params![session_id], |row| {
            let topic_tags_str: String = row.get(10)?;
            let topic_tags: Vec<String> = serde_json::from_str(&topic_tags_str).unwrap_or_default();

            Ok(MessageScore {
                id: row.get(0)?,
                session_id: row.get(1)?,
                message_id: row.get(2)?,
                confidence_score: row.get(3)?,
                professionalism_score: row.get(4)?,
                depth_score: row.get(5)?,
                theory_practice_score: row.get(6)?,
                tech_sensitivity_score: row.get(7)?,
                overall_score: row.get(8)?,
                feedback: row.get(9)?,
                topic_tags,
                created_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for score in scores {
        result.push(score.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

/// 查询已评分的消息 ID 列表（用于增量评分跳过）
pub fn get_scored_message_ids(db: &Database, session_id: &str) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT message_id FROM message_scores WHERE session_id = ?1")
        .map_err(|e| e.to_string())?;

    let ids = stmt
        .query_map(params![session_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for id in ids {
        result.push(id.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

/// 删除会话下所有消息评分
pub fn delete_message_scores(db: &Database, session_id: &str) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM message_scores WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 批量插入会话洞察
pub fn insert_session_insights(db: &Database, insights: &[SessionInsight]) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    for insight in insights {
        let related_ids_json =
            serde_json::to_string(&insight.related_message_ids).map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO session_insights (
                id, session_id, insight_type, title, detail,
                related_message_ids, priority, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                insight.id,
                insight.session_id,
                insight.insight_type,
                insight.title,
                insight.detail,
                related_ids_json,
                insight.priority,
                insight.created_at
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 查询会话洞察（按类型和优先级排序）
pub fn get_session_insights(
    db: &Database,
    session_id: &str,
) -> Result<Vec<SessionInsight>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, insight_type, title, detail,
                related_message_ids, priority, created_at
         FROM session_insights WHERE session_id = ?1
         ORDER BY insight_type ASC, priority DESC",
        )
        .map_err(|e| e.to_string())?;

    let insights = stmt
        .query_map(params![session_id], |row| {
            let related_ids_str: String = row.get(5)?;
            let related_message_ids: Vec<String> =
                serde_json::from_str(&related_ids_str).unwrap_or_default();

            Ok(SessionInsight {
                id: row.get(0)?,
                session_id: row.get(1)?,
                insight_type: row.get(2)?,
                title: row.get(3)?,
                detail: row.get(4)?,
                related_message_ids,
                priority: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for insight in insights {
        result.push(insight.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

/// 删除会话下所有洞察
pub fn delete_session_insights(db: &Database, session_id: &str) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM session_insights WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 更新会话复盘状态
pub fn update_review_status(db: &Database, session_id: &str, status: &str) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE sessions SET review_status = ?1 WHERE id = ?2",
        params![status, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 更新会话综合评分
pub fn update_overall_score(db: &Database, session_id: &str, score: f64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE sessions SET overall_score = ?1 WHERE id = ?2",
        params![score, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 更新面试完成时间
pub fn update_completed_at(
    db: &Database,
    session_id: &str,
    completed_at: i64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE sessions SET completed_at = ?1 WHERE id = ?2",
        params![completed_at, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 获取所有已完成复盘的会话（用于趋势分析）
pub fn get_reviewed_sessions(db: &Database) -> Result<Vec<ReviewedSession>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, overall_score, completed_at, review_status
         FROM sessions WHERE review_status = 'completed' AND overall_score IS NOT NULL
         ORDER BY completed_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let sessions = stmt
        .query_map([], |row| {
            Ok(ReviewedSession {
                session_id: row.get(0)?,
                title: row.get(1)?,
                overall_score: row.get(2)?,
                completed_at: row.get(3)?,
                review_status: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for session in sessions {
        result.push(session.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

/// 获取会话的所有 knowledge_gap 类型洞察标题（用于趋势对比）
pub fn get_knowledge_gap_titles(db: &Database, session_id: &str) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT title FROM session_insights 
         WHERE session_id = ?1 AND insight_type = 'knowledge_gap'
         ORDER BY priority DESC",
        )
        .map_err(|e| e.to_string())?;

    let titles = stmt
        .query_map(params![session_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for title in titles {
        result.push(title.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_db() -> Database {
        let temp_dir =
            std::env::temp_dir().join(format!("knowledge_base_db_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        init_database(&temp_dir).unwrap()
    }

    fn sample_document_input(
        knowledge_base_id: &str,
        source_path: &str,
    ) -> CreateKnowledgeDocumentInput {
        CreateKnowledgeDocumentInput {
            knowledge_base_id: knowledge_base_id.to_string(),
            title: "Rust Guide".to_string(),
            file_name: "rust-guide.md".to_string(),
            file_extension: Some("md".to_string()),
            document_type: "markdown".to_string(),
            source_path: source_path.to_string(),
            source_byte_size: 1024,
            source_modified_at: 1_710_000_000_000,
            content_hash: "sha1:test-hash".to_string(),
            fingerprint: format!("fp:{source_path}:1024:1710000000000:test-hash"),
            index_state: Some(KnowledgeDocumentIndexState::Pending),
            last_error: None,
        }
    }

    fn count_rows(db: &Database, table: &str) -> i64 {
        let conn = db.0.lock().unwrap();
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
    }

    #[test]
    fn test_v7_migration_creates_knowledge_base_tables() {
        let db = create_test_db();
        let conn = db.0.lock().unwrap();

        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 7);

        for table in [
            "knowledge_bases",
            "kb_documents",
            "kb_chunks",
            "kb_embeddings",
        ] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    params![table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1, "table should exist: {table}");
        }

        let mut stmt = conn.prepare("PRAGMA table_info(kb_documents)").unwrap();
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|row| row.unwrap())
            .collect::<Vec<_>>();

        for required in [
            "source_path",
            "source_byte_size",
            "source_modified_at",
            "content_hash",
            "fingerprint",
            "index_state",
            "last_error",
        ] {
            assert!(
                columns.contains(&required.to_string()),
                "missing column: {required}"
            );
        }
    }

    #[test]
    fn test_duplicate_document_protection_prevents_same_path_reimport() {
        let db = create_test_db();
        let kb = create_knowledge_base(
            &db,
            CreateKnowledgeBaseInput {
                name: "Backend Docs".to_string(),
                description: Some("RAG documents".to_string()),
            },
        )
        .unwrap();

        let first =
            create_knowledge_document(&db, sample_document_input(&kb.id, "C:\\docs\\rust.md"))
                .unwrap();
        let err =
            create_knowledge_document(&db, sample_document_input(&kb.id, "C:\\docs\\rust.md"))
                .unwrap_err();

        assert!(err.contains("已存在同一路径的文档"));

        let docs = list_knowledge_documents(&db, &kb.id).unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].id, first.id);
        assert_eq!(docs[0].source_path, "C:\\docs\\rust.md");
        assert_eq!(
            docs[0].fingerprint,
            "fp:C:\\docs\\rust.md:1024:1710000000000:test-hash"
        );
    }

    #[test]
    fn test_reset_knowledge_document_for_reindex_reuses_document_and_clears_rows() {
        let db = create_test_db();
        let kb = create_knowledge_base(
            &db,
            CreateKnowledgeBaseInput {
                name: "Reindex".to_string(),
                description: Some("reindex document".to_string()),
            },
        )
        .unwrap();

        let document =
            create_knowledge_document(&db, sample_document_input(&kb.id, "C:\\docs\\rust.md"))
                .unwrap();

        let chunks = insert_knowledge_chunks(
            &db,
            &document.id,
            &[CreateKnowledgeChunkInput {
                chunk_index: 0,
                text: "old chunk".to_string(),
                chunk_type: "text".to_string(),
                heading_path: vec!["Old".to_string()],
                page_number: Some(1),
                language: None,
                start_offset: 0,
                end_offset: 9,
                block_count: 1,
            }],
        )
        .unwrap();

        insert_knowledge_embeddings(
            &db,
            &[CreateKnowledgeEmbeddingInput {
                knowledge_base_id: kb.id.clone(),
                document_id: document.id.clone(),
                chunk_id: chunks[0].id.clone(),
                embedding: vec![0.1, 0.2, 0.3],
                embedding_dim: 3,
                model_id: "old-model".to_string(),
            }],
        )
        .unwrap();

        let reindexed = reset_knowledge_document_for_reindex(
            &db,
            &document.id,
            CreateKnowledgeDocumentInput {
                knowledge_base_id: kb.id.clone(),
                title: "rust-updated".to_string(),
                file_name: "rust-updated.md".to_string(),
                file_extension: Some("md".to_string()),
                document_type: "markdown".to_string(),
                source_path: "C:\\docs\\rust-updated.md".to_string(),
                source_byte_size: 2048,
                source_modified_at: 1720000000000,
                content_hash: "sha1:new-hash".to_string(),
                fingerprint: "fp:C:\\docs\\rust-updated.md:2048:1720000000000:new-hash".to_string(),
                index_state: Some(KnowledgeDocumentIndexState::Indexing),
                last_error: None,
            },
        )
        .unwrap();

        assert_eq!(reindexed.id, document.id);
        assert_eq!(reindexed.knowledge_base_id, kb.id);
        assert_eq!(reindexed.title, "rust-updated");
        assert_eq!(reindexed.file_name, "rust-updated.md");
        assert_eq!(reindexed.source_path, "C:\\docs\\rust-updated.md");
        assert_eq!(reindexed.source_byte_size, 2048);
        assert_eq!(reindexed.content_hash, "sha1:new-hash");
        assert_eq!(
            reindexed.fingerprint,
            "fp:C:\\docs\\rust-updated.md:2048:1720000000000:new-hash"
        );
        assert_eq!(reindexed.index_state, KnowledgeDocumentIndexState::Indexing);
        assert_eq!(reindexed.chunk_count, 0);
        assert_eq!(reindexed.embedding_count, 0);
        assert_eq!(reindexed.indexed_at, None);

        assert_eq!(count_rows(&db, "kb_documents"), 1);
        assert_eq!(count_rows(&db, "kb_chunks"), 0);
        assert_eq!(count_rows(&db, "kb_embeddings"), 0);
    }

    #[test]
    fn test_delete_knowledge_base_cascades_documents_chunks_and_embeddings() {
        let db = create_test_db();
        let kb = create_knowledge_base(
            &db,
            CreateKnowledgeBaseInput {
                name: "System Design".to_string(),
                description: None,
            },
        )
        .unwrap();

        let document = create_knowledge_document(
            &db,
            sample_document_input(&kb.id, "C:\\docs\\system-design.md"),
        )
        .unwrap();

        let chunks = insert_knowledge_chunks(
            &db,
            &document.id,
            &[
                CreateKnowledgeChunkInput {
                    chunk_index: 0,
                    text: "第一段内容".to_string(),
                    chunk_type: "text".to_string(),
                    heading_path: vec!["第1章".to_string()],
                    page_number: Some(1),
                    language: None,
                    start_offset: 0,
                    end_offset: 12,
                    block_count: 1,
                },
                CreateKnowledgeChunkInput {
                    chunk_index: 1,
                    text: "第二段内容".to_string(),
                    chunk_type: "text".to_string(),
                    heading_path: vec!["第1章".to_string(), "小节".to_string()],
                    page_number: Some(1),
                    language: None,
                    start_offset: 13,
                    end_offset: 24,
                    block_count: 1,
                },
            ],
        )
        .unwrap();

        let document_after_chunks = get_knowledge_document(&db, &document.id).unwrap().unwrap();
        assert_eq!(document_after_chunks.chunk_count, 2);
        assert_eq!(document_after_chunks.embedding_count, 0);
        assert_eq!(
            document_after_chunks.index_state,
            KnowledgeDocumentIndexState::Pending
        );

        insert_knowledge_embeddings(
            &db,
            &[
                CreateKnowledgeEmbeddingInput {
                    knowledge_base_id: kb.id.clone(),
                    document_id: document.id.clone(),
                    chunk_id: chunks[0].id.clone(),
                    embedding: vec![0.1, 0.2, 0.3],
                    embedding_dim: 3,
                    model_id: "test-embedding-model".to_string(),
                },
                CreateKnowledgeEmbeddingInput {
                    knowledge_base_id: kb.id.clone(),
                    document_id: document.id.clone(),
                    chunk_id: chunks[1].id.clone(),
                    embedding: vec![0.3, 0.2, 0.1],
                    embedding_dim: 3,
                    model_id: "test-embedding-model".to_string(),
                },
            ],
        )
        .unwrap();

        let document_after_embeddings = get_knowledge_document(&db, &document.id).unwrap().unwrap();
        assert_eq!(document_after_embeddings.chunk_count, 2);
        assert_eq!(document_after_embeddings.embedding_count, 2);
        assert_eq!(
            document_after_embeddings.index_state,
            KnowledgeDocumentIndexState::Ready
        );
        assert!(document_after_embeddings.indexed_at.is_some());

        assert_eq!(count_rows(&db, "knowledge_bases"), 1);
        assert_eq!(count_rows(&db, "kb_documents"), 1);
        assert_eq!(count_rows(&db, "kb_chunks"), 2);
        assert_eq!(count_rows(&db, "kb_embeddings"), 2);

        delete_knowledge_base(&db, &kb.id).unwrap();

        assert_eq!(count_rows(&db, "knowledge_bases"), 0);
        assert_eq!(count_rows(&db, "kb_documents"), 0);
        assert_eq!(count_rows(&db, "kb_chunks"), 0);
        assert_eq!(count_rows(&db, "kb_embeddings"), 0);
    }

    #[test]
    fn test_get_knowledge_base_stats_aggregates_counts_storage_and_latest_model() {
        let db = create_test_db();
        let kb = create_knowledge_base(
            &db,
            CreateKnowledgeBaseInput {
                name: "Stats".to_string(),
                description: Some("aggregate stats".to_string()),
            },
        )
        .unwrap();

        let first_document =
            create_knowledge_document(&db, sample_document_input(&kb.id, "C:\\docs\\stats-a.md"))
                .unwrap();
        let second_document =
            create_knowledge_document(&db, sample_document_input(&kb.id, "C:\\docs\\stats-b.md"))
                .unwrap();

        let second_document = reset_knowledge_document_for_reindex(
            &db,
            &second_document.id,
            CreateKnowledgeDocumentInput {
                knowledge_base_id: kb.id.clone(),
                title: "Stats B".to_string(),
                file_name: "stats-b.md".to_string(),
                file_extension: Some("md".to_string()),
                document_type: "markdown".to_string(),
                source_path: "C:\\docs\\stats-b.md".to_string(),
                source_byte_size: 2048,
                source_modified_at: 1_720_000_000_000,
                content_hash: "sha1:stats-b".to_string(),
                fingerprint: "fp:C:\\docs\\stats-b.md:2048:1720000000000:stats-b".to_string(),
                index_state: Some(KnowledgeDocumentIndexState::Indexing),
                last_error: None,
            },
        )
        .unwrap();

        let chunks = insert_knowledge_chunks(
            &db,
            &first_document.id,
            &[
                CreateKnowledgeChunkInput {
                    chunk_index: 0,
                    text: "alpha".to_string(),
                    chunk_type: "text".to_string(),
                    heading_path: vec!["A".to_string()],
                    page_number: Some(1),
                    language: None,
                    start_offset: 0,
                    end_offset: 5,
                    block_count: 1,
                },
                CreateKnowledgeChunkInput {
                    chunk_index: 1,
                    text: "beta beta".to_string(),
                    chunk_type: "text".to_string(),
                    heading_path: vec!["B".to_string()],
                    page_number: Some(2),
                    language: None,
                    start_offset: 6,
                    end_offset: 15,
                    block_count: 1,
                },
            ],
        )
        .unwrap();

        insert_knowledge_embeddings(
            &db,
            &[CreateKnowledgeEmbeddingInput {
                knowledge_base_id: kb.id.clone(),
                document_id: first_document.id.clone(),
                chunk_id: chunks[0].id.clone(),
                embedding: vec![0.1, 0.2, 0.3],
                embedding_dim: 3,
                model_id: "stats-model-v1".to_string(),
            }],
        )
        .unwrap();

        std::thread::sleep(std::time::Duration::from_millis(2));

        insert_knowledge_embeddings(
            &db,
            &[CreateKnowledgeEmbeddingInput {
                knowledge_base_id: kb.id.clone(),
                document_id: first_document.id.clone(),
                chunk_id: chunks[1].id.clone(),
                embedding: vec![0.4, 0.5, 0.6],
                embedding_dim: 3,
                model_id: "stats-model-v2".to_string(),
            }],
        )
        .unwrap();

        let stats = get_knowledge_base_stats(&db, &kb.id).unwrap().unwrap();

        assert_eq!(stats.knowledge_base_id, kb.id);
        assert_eq!(stats.document_count, 2);
        assert_eq!(stats.chunk_count, 2);
        assert_eq!(stats.embedding_count, 2);
        assert_eq!(stats.source_bytes, 1024 + second_document.source_byte_size);
        assert_eq!(stats.chunk_bytes, "alpha".len() as u64 + "beta beta".len() as u64);
        assert_eq!(stats.embedding_bytes, (3 * std::mem::size_of::<f32>() * 2) as u64);
        assert_eq!(
            stats.storage_bytes,
            stats.source_bytes + stats.chunk_bytes + stats.embedding_bytes
        );
        assert_eq!(
            stats.latest_indexed_model_id.as_deref(),
            Some("stats-model-v2")
        );
        assert!(stats.latest_indexed_at.is_some());
    }

    #[test]
    fn test_recover_stuck_knowledge_documents_marks_indexing_documents_failed() {
        let db = create_test_db();
        let kb = create_knowledge_base(
            &db,
            CreateKnowledgeBaseInput {
                name: "Recovery".to_string(),
                description: Some("restart recovery".to_string()),
            },
        )
        .unwrap();

        let indexing_document = create_knowledge_document(
            &db,
            CreateKnowledgeDocumentInput {
                knowledge_base_id: kb.id.clone(),
                title: "stuck".to_string(),
                file_name: "stuck.md".to_string(),
                file_extension: Some("md".to_string()),
                document_type: "markdown".to_string(),
                source_path: "C:\\docs\\stuck.md".to_string(),
                source_byte_size: 512,
                source_modified_at: 1_710_000_000_000,
                content_hash: "sha1:stuck".to_string(),
                fingerprint: "fp:C:\\docs\\stuck.md:512:1710000000000:stuck".to_string(),
                index_state: Some(KnowledgeDocumentIndexState::Indexing),
                last_error: None,
            },
        )
        .unwrap();

        let ready_document = create_knowledge_document(
            &db,
            CreateKnowledgeDocumentInput {
                knowledge_base_id: kb.id.clone(),
                title: "ready".to_string(),
                file_name: "ready.md".to_string(),
                file_extension: Some("md".to_string()),
                document_type: "markdown".to_string(),
                source_path: "C:\\docs\\ready.md".to_string(),
                source_byte_size: 256,
                source_modified_at: 1_710_000_000_100,
                content_hash: "sha1:ready".to_string(),
                fingerprint: "fp:C:\\docs\\ready.md:256:1710000000100:ready".to_string(),
                index_state: Some(KnowledgeDocumentIndexState::Ready),
                last_error: None,
            },
        )
        .unwrap();

        let recovered = recover_stuck_knowledge_documents(&db).unwrap();

        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].id, indexing_document.id);
        assert_eq!(recovered[0].index_state, KnowledgeDocumentIndexState::Failed);
        assert_eq!(
            recovered[0].last_error.as_deref(),
            Some(KNOWLEDGE_DOCUMENT_RESTART_RECOVERY_ERROR)
        );

        let persisted_indexing = get_knowledge_document(&db, &indexing_document.id)
            .unwrap()
            .unwrap();
        assert_eq!(
            persisted_indexing.index_state,
            KnowledgeDocumentIndexState::Failed
        );
        assert_eq!(
            persisted_indexing.last_error.as_deref(),
            Some(KNOWLEDGE_DOCUMENT_RESTART_RECOVERY_ERROR)
        );

        let persisted_ready = get_knowledge_document(&db, &ready_document.id)
            .unwrap()
            .unwrap();
        assert_eq!(persisted_ready.index_state, KnowledgeDocumentIndexState::Ready);
        assert_eq!(persisted_ready.last_error, None);
    }

    #[test]
    fn test_list_knowledge_document_chunks_returns_sorted_preview_details() {
        let db = create_test_db();
        let kb = create_knowledge_base(
            &db,
            CreateKnowledgeBaseInput {
                name: "Preview".to_string(),
                description: Some("preview chunks".to_string()),
            },
        )
        .unwrap();

        let document =
            create_knowledge_document(&db, sample_document_input(&kb.id, "C:\\docs\\preview.md"))
                .unwrap();

        insert_knowledge_chunks(
            &db,
            &document.id,
            &[
                CreateKnowledgeChunkInput {
                    chunk_index: 2,
                    text: "第三段".to_string(),
                    chunk_type: "text".to_string(),
                    heading_path: vec!["第二章".to_string()],
                    page_number: Some(3),
                    language: Some("zh".to_string()),
                    start_offset: 21,
                    end_offset: 30,
                    block_count: 1,
                },
                CreateKnowledgeChunkInput {
                    chunk_index: 0,
                    text: "第一段".to_string(),
                    chunk_type: "text".to_string(),
                    heading_path: vec!["第一章".to_string()],
                    page_number: Some(1),
                    language: Some("zh".to_string()),
                    start_offset: 0,
                    end_offset: 9,
                    block_count: 1,
                },
                CreateKnowledgeChunkInput {
                    chunk_index: 1,
                    text: "第二段".to_string(),
                    chunk_type: "text".to_string(),
                    heading_path: vec!["第一章".to_string(), "小节".to_string()],
                    page_number: Some(2),
                    language: Some("zh".to_string()),
                    start_offset: 10,
                    end_offset: 20,
                    block_count: 2,
                },
            ],
        )
        .unwrap();

        let chunks = list_knowledge_document_chunks(&db, &document.id).unwrap();

        assert_eq!(chunks.len(), 3);
        assert_eq!(
            chunks
                .iter()
                .map(|chunk| chunk.chunk_index)
                .collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert_eq!(chunks[0].text, "第一段");
        assert_eq!(chunks[0].page_number, Some(1));
        assert_eq!(chunks[0].heading_path, vec!["第一章".to_string()]);
        assert_eq!(
            chunks[1].heading_path,
            vec!["第一章".to_string(), "小节".to_string()]
        );
        assert_eq!(chunks[1].block_count, 2);
        assert_eq!(chunks[2].page_number, Some(3));
        assert_eq!(chunks[2].language.as_deref(), Some("zh"));
    }

    #[test]
    fn test_list_knowledge_document_chunks_rejects_missing_document() {
        let db = create_test_db();

        let error = list_knowledge_document_chunks(&db, "missing-document-id").unwrap_err();

        assert!(error.contains("知识库文档不存在"));
    }
}
