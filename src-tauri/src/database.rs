// SQLite 数据库模块 - 会话和消息持久化

use rusqlite::{Connection, params};
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

/// 会话元数据参数（创建会话时使用）
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct SessionMetadata {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub prompt_template_id: Option<String>,
    pub prompt_content: Option<String>,
    pub interview_context: Option<InterviewContext>,
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
         PRAGMA foreign_keys = ON;"
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
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at ASC);"
    )?;
    
    // 执行数据库迁移
    migrate_v1_to_v2(&conn)?;
    
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
    metadata: Option<SessionMetadata>
) -> Result<serde_json::Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    
    let id = uuid::Uuid::new_v4().to_string();
    let now = current_timestamp_ms();
    let title = "新会话";
    
    let metadata = metadata.unwrap_or_default();
    let interview_context_clone = metadata.interview_context.clone();
    let interview_context_json = metadata.interview_context
        .map(|ctx| serde_json::to_string(&ctx).ok())
        .flatten();
    
    conn.execute(
        "INSERT INTO sessions (
            id, title, created_at, updated_at,
            provider, model, prompt_template_id, prompt_content, interview_context
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id, title, now, now,
            metadata.provider,
            metadata.model,
            metadata.prompt_template_id,
            metadata.prompt_content,
            interview_context_json
        ]
    ).map_err(|e| e.to_string())?;
    
    Ok(json!({
        "id": id,
        "title": title,
        "created_at": now,
        "updated_at": now,
        "provider": metadata.provider,
        "model": metadata.model,
        "prompt_template_id": metadata.prompt_template_id,
        "prompt_content": metadata.prompt_content,
        "interview_context": interview_context_clone
    }))
}

/// 列出所有会话
pub fn list_sessions(db: &Database) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT id, title, created_at, updated_at, provider, model, 
                prompt_template_id, prompt_content, interview_context 
         FROM sessions ORDER BY updated_at DESC"
    ).map_err(|e| e.to_string())?;
    
    let sessions = stmt.query_map([], |row| {
        let interview_context_str: Option<String> = row.get(8)?;
        let interview_context: Option<InterviewContext> = interview_context_str
            .and_then(|s| serde_json::from_str(&s).ok());
        
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "title": row.get::<_, String>(1)?,
            "created_at": row.get::<_, i64>(2)?,
            "updated_at": row.get::<_, i64>(3)?,
            "provider": row.get::<_, Option<String>>(4)?,
            "model": row.get::<_, Option<String>>(5)?,
            "prompt_template_id": row.get::<_, Option<String>>(6)?,
            "prompt_content": row.get::<_, Option<String>>(7)?,
            "interview_context": interview_context
        }))
    }).map_err(|e| e.to_string())?;
    
    let mut result = Vec::new();
    for session in sessions {
        result.push(session.map_err(|e| e.to_string())?);
    }
    
    Ok(result)
}

/// 获取会话的所有消息
pub fn get_session_messages(db: &Database, session_id: &str) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT id, session_id, role, content, image, created_at FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;
    
    let messages = stmt.query_map(params![session_id], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "session_id": row.get::<_, String>(1)?,
            "role": row.get::<_, String>(2)?,
            "content": row.get::<_, String>(3)?,
            "image": row.get::<_, Option<String>>(4)?,
            "created_at": row.get::<_, i64>(5)?
        }))
    }).map_err(|e| e.to_string())?;
    
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
    image: Option<&str>
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
        params![now, session_id]
    ).map_err(|e| e.to_string())?;
    
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
        params![title, now, session_id]
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

/// 删除会话（CASCADE 自动删除消息）
pub fn delete_session(db: &Database, session_id: &str) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    
    conn.execute(
        "DELETE FROM sessions WHERE id = ?1",
        params![session_id]
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

/// 搜索会话（按消息内容）
pub fn search_sessions(db: &Database, keyword: &str) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT DISTINCT s.id, s.title, s.created_at, s.updated_at,
                s.provider, s.model, s.prompt_template_id, s.prompt_content, s.interview_context
         FROM sessions s 
         JOIN messages m ON s.id = m.session_id 
         WHERE m.content LIKE '%' || ?1 || '%' 
         ORDER BY s.updated_at DESC"
    ).map_err(|e| e.to_string())?;
    
    let sessions = stmt.query_map(params![keyword], |row| {
        let interview_context_str: Option<String> = row.get(8)?;
        let interview_context: Option<InterviewContext> = interview_context_str
            .and_then(|s| serde_json::from_str(&s).ok());
        
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "title": row.get::<_, String>(1)?,
            "created_at": row.get::<_, i64>(2)?,
            "updated_at": row.get::<_, i64>(3)?,
            "provider": row.get::<_, Option<String>>(4)?,
            "model": row.get::<_, Option<String>>(5)?,
            "prompt_template_id": row.get::<_, Option<String>>(6)?,
            "prompt_content": row.get::<_, Option<String>>(7)?,
            "interview_context": interview_context
        }))
    }).map_err(|e| e.to_string())?;
    
    let mut result = Vec::new();
    for session in sessions {
        result.push(session.map_err(|e| e.to_string())?);
    }
    
    Ok(result)
}

/// 获取最近活跃的会话
pub fn get_last_active_session(db: &Database) -> Result<Option<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT id, title, created_at, updated_at, provider, model,
                prompt_template_id, prompt_content, interview_context 
         FROM sessions ORDER BY updated_at DESC LIMIT 1"
    ).map_err(|e| e.to_string())?;
    
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let interview_context_str: Option<String> = row.get(8).map_err(|e| e.to_string())?;
        let interview_context: Option<InterviewContext> = interview_context_str
            .and_then(|s| serde_json::from_str(&s).ok());
        
        Ok(Some(json!({
            "id": row.get::<_, String>(0).map_err(|e| e.to_string())?,
            "title": row.get::<_, String>(1).map_err(|e| e.to_string())?,
            "created_at": row.get::<_, i64>(2).map_err(|e| e.to_string())?,
            "updated_at": row.get::<_, i64>(3).map_err(|e| e.to_string())?,
            "provider": row.get::<_, Option<String>>(4).map_err(|e| e.to_string())?,
            "model": row.get::<_, Option<String>>(5).map_err(|e| e.to_string())?,
            "prompt_template_id": row.get::<_, Option<String>>(6).map_err(|e| e.to_string())?,
            "prompt_content": row.get::<_, Option<String>>(7).map_err(|e| e.to_string())?,
            "interview_context": interview_context
        })))
    } else {
        Ok(None)
    }
}
