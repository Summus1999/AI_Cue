// SQLite 数据库模块 - 会话和消息持久化

use rusqlite::{params, Connection};
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

    Ok(Database(Mutex::new(conn)))
}

/// 获取当前时间戳（毫秒）
fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

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
