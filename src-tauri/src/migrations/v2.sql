-- 迁移脚本 v2：添加会话元数据字段
-- 执行时间：应用启动时自动检测并执行

-- 检查并添加 provider 字段
ALTER TABLE sessions ADD COLUMN provider TEXT;

-- 检查并添加 model 字段
ALTER TABLE sessions ADD COLUMN model TEXT;

-- 检查并添加 prompt_template_id 字段
ALTER TABLE sessions ADD COLUMN prompt_template_id TEXT;

-- 检查并添加 prompt_content 字段
ALTER TABLE sessions ADD COLUMN prompt_content TEXT;

-- 检查并添加 interview_context 字段（JSON 格式）
ALTER TABLE sessions ADD COLUMN interview_context TEXT;

-- 更新 schema 版本号
PRAGMA user_version = 2;
