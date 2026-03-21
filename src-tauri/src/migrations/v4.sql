-- 迁移脚本 v4：添加会话 Prompt 模式字段
-- 执行时间：应用启动时自动检测并执行

-- 添加 prompt_mode 字段
-- prompt_mode: 'assistant'(AI助手模式) | 'interviewer'(面试官模式)
ALTER TABLE sessions ADD COLUMN prompt_mode TEXT NOT NULL DEFAULT 'assistant';

-- 更新 schema 版本号
PRAGMA user_version = 4;
