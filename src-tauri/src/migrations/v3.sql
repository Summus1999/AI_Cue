-- 迁移脚本 v3：添加面试复盘相关表和字段
-- 执行时间：应用启动时自动检测并执行

-- 1. sessions 表扩展字段
ALTER TABLE sessions ADD COLUMN review_status TEXT DEFAULT NULL;
-- review_status: NULL(未复盘) | 'in_progress'(生成中) | 'completed'(已完成)

ALTER TABLE sessions ADD COLUMN overall_score REAL DEFAULT NULL;
-- 综合评分 0-100，复盘完成后写入

ALTER TABLE sessions ADD COLUMN completed_at INTEGER DEFAULT NULL;
-- 面试结束时间戳(毫秒)

-- 2. 消息评分表: 每条 assistant 消息的多维度评分
CREATE TABLE IF NOT EXISTS message_scores (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    completeness_score REAL NOT NULL,      -- 完整性 0-100
    accuracy_score REAL NOT NULL,          -- 准确性 0-100
    clarity_score REAL NOT NULL,           -- 表达清晰度 0-100
    overall_score REAL NOT NULL,           -- 单条综合分 (加权平均)
    feedback TEXT NOT NULL DEFAULT '',     -- AI 反馈(改进建议)
    topic_tags TEXT NOT NULL DEFAULT '[]', -- JSON 数组: 话题标签
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_message_scores_session ON message_scores(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_scores_message ON message_scores(message_id);

-- 3. 会话洞察表: 知识盲点 / 优势项 / 改进建议
CREATE TABLE IF NOT EXISTS session_insights (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    insight_type TEXT NOT NULL,
    -- insight_type: 'knowledge_gap'(知识盲点) | 'strength'(优势) | 'suggestion'(改进建议)
    title TEXT NOT NULL,                   -- 简短标题
    detail TEXT NOT NULL DEFAULT '',       -- 详细描述
    related_message_ids TEXT NOT NULL DEFAULT '[]', -- JSON 数组: 关联消息 ID
    priority INTEGER NOT NULL DEFAULT 0,   -- 排序优先级(越大越重要)
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_insights_session
    ON session_insights(session_id, insight_type);

-- 更新 schema 版本号
PRAGMA user_version = 3;
