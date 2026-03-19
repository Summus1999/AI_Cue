// SQLite 数据库模块 - 会话和消息持久化

use rusqlite::{Connection, params};
use serde_json::json;
use std::path::Path;
use std::sync::Mutex;

/// 数据库封装结构
pub struct Database(pub Mutex<Connection>);

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
    
    Ok(Database(Mutex::new(conn)))
}

/// 获取当前时间戳（毫秒）
fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// 创建新会话
pub fn create_session(db: &Database) -> Result<serde_json::Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    
    let id = uuid::Uuid::new_v4().to_string();
    let now = current_timestamp_ms();
    let title = "新会话";
    
    conn.execute(
        "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, title, now, now]
    ).map_err(|e| e.to_string())?;
    
    Ok(json!({
        "id": id,
        "title": title,
        "created_at": now,
        "updated_at": now
    }))
}

/// 列出所有会话
pub fn list_sessions(db: &Database) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC"
    ).map_err(|e| e.to_string())?;
    
    let sessions = stmt.query_map([], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "title": row.get::<_, String>(1)?,
            "created_at": row.get::<_, i64>(2)?,
            "updated_at": row.get::<_, i64>(3)?
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
        "SELECT DISTINCT s.id, s.title, s.created_at, s.updated_at 
         FROM sessions s 
         JOIN messages m ON s.id = m.session_id 
         WHERE m.content LIKE '%' || ?1 || '%' 
         ORDER BY s.updated_at DESC"
    ).map_err(|e| e.to_string())?;
    
    let sessions = stmt.query_map(params![keyword], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "title": row.get::<_, String>(1)?,
            "created_at": row.get::<_, i64>(2)?,
            "updated_at": row.get::<_, i64>(3)?
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
        "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 1"
    ).map_err(|e| e.to_string())?;
    
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(Some(json!({
            "id": row.get::<_, String>(0).map_err(|e| e.to_string())?,
            "title": row.get::<_, String>(1).map_err(|e| e.to_string())?,
            "created_at": row.get::<_, i64>(2).map_err(|e| e.to_string())?,
            "updated_at": row.get::<_, i64>(3).map_err(|e| e.to_string())?
        })))
    } else {
        Ok(None)
    }
}
