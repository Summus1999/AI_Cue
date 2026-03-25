// 会话导出模块

use serde::{Deserialize, Serialize};

/// 导出元数据
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportMetadata {
    pub session_id: String,
    pub session_title: String,
    pub exported_at: i64,
    pub export_format: String,
    pub app_version: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: usize,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub prompt_template_id: Option<String>,
    pub prompt_template_name: Option<String>,
    pub prompt_content: Option<String>,
    pub interview_context: Option<ExportInterviewContext>,
}

/// 面试背景上下文
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportInterviewContext {
    pub company: String,
    pub position: String,
    pub jd_highlights: String,
}

/// 导出消息项
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
    pub has_image: bool,
    pub image_data: Option<String>,
}

/// 统一导出数据结构
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportData {
    pub metadata: ExportMetadata,
    pub messages: Vec<ExportMessage>,
}

/// 导出选项
#[derive(Debug, Deserialize)]
pub struct ExportOptions {
    pub session_id: String,
    pub format: String, // "markdown" | "pdf" | "json"
    pub include_metadata: bool,
    pub include_prompt_content: bool,
    pub include_images: bool,
    pub image_handling: String, // "embed" | "extract"
    pub selected_message_ids: Option<Vec<String>>,
}

/// 导出结果
#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub success: bool,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

/// 获取应用版本
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 格式化日期时间（用于 Markdown）
fn format_datetime(timestamp: i64) -> String {
    let datetime =
        chrono::DateTime::from_timestamp_millis(timestamp).unwrap_or_else(|| chrono::Utc::now());
    datetime.format("%Y-%m-%d %H:%M:%S").to_string()
}

/// 格式化为日期（用于文件名）
fn format_date(timestamp: i64) -> String {
    let datetime =
        chrono::DateTime::from_timestamp_millis(timestamp).unwrap_or_else(|| chrono::Utc::now());
    datetime.format("%Y-%m-%d").to_string()
}

/// 构建安全的文件名
fn sanitize_filename(title: &str) -> String {
    title
        .replace(
            |c: char| c.is_ascii_punctuation() && c != '-' && c != '_',
            "_",
        )
        .replace(' ', "_")
}

/// 生成 Markdown 内容
pub fn export_to_markdown(data: &ExportData, options: &ExportOptions) -> String {
    let mut lines: Vec<String> = Vec::new();

    // 生成元数据头（YAML Front Matter 格式）
    if options.include_metadata {
        lines.push("---".to_string());
        lines.push(format!("title: {}", data.metadata.session_title));
        lines.push(format!(
            "exported_at: {}",
            format_datetime(data.metadata.exported_at)
        ));
        lines.push(format!(
            "created_at: {}",
            format_datetime(data.metadata.created_at)
        ));
        lines.push(format!("message_count: {}", data.metadata.message_count));

        if let Some(provider) = &data.metadata.provider {
            lines.push(format!("provider: {}", provider));
        }
        if let Some(model) = &data.metadata.model {
            lines.push(format!("model: {}", model));
        }
        if let Some(template) = &data.metadata.prompt_template_name {
            lines.push(format!("prompt_template: {}", template));
        }

        // 面试背景
        if let Some(ctx) = &data.metadata.interview_context {
            lines.push("interview_context:".to_string());
            lines.push(format!("  company: {}", ctx.company));
            lines.push(format!("  position: {}", ctx.position));
            if !ctx.jd_highlights.is_empty() {
                lines.push("  jd_highlights: |".to_string());
                for line in ctx.jd_highlights.lines() {
                    lines.push(format!("    {}", line));
                }
            }
        }

        lines.push("---".to_string());
        lines.push(String::new());
    }

    // 标题
    lines.push(format!("# {}", data.metadata.session_title));
    lines.push(String::new());

    // 消息内容
    for msg in &data.messages {
        let role_label = if msg.role == "user" { "用户" } else { "AI" };
        let timestamp = format_datetime(msg.timestamp);

        lines.push(format!("## {} [{}]", role_label, timestamp));
        lines.push(String::new());
        lines.push(msg.content.clone());
        lines.push(String::new());

        // 处理图片
        if msg.has_image && options.include_images {
            if let Some(img_data) = &msg.image_data {
                lines.push(format!("![截图](data:image/png;base64,{})", img_data));
                lines.push(String::new());
            }
        }
    }

    // 可选：导出 Prompt 内容
    if options.include_prompt_content {
        if let Some(prompt) = &data.metadata.prompt_content {
            lines.push("---".to_string());
            lines.push(String::new());
            lines.push("## 附录：System Prompt".to_string());
            lines.push(String::new());
            lines.push("```".to_string());
            lines.push(prompt.clone());
            lines.push("```".to_string());
        }
    }

    lines.join("\n")
}

/// 生成 JSON 内容
pub fn export_to_json(data: &ExportData, options: &ExportOptions) -> String {
    let export_obj = serde_json::json!({
        "version": "1.0",
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "metadata": {
            "session_id": data.metadata.session_id,
            "session_title": data.metadata.session_title,
            "exported_at": data.metadata.exported_at,
            "created_at": data.metadata.created_at,
            "updated_at": data.metadata.updated_at,
            "message_count": data.metadata.message_count,
            "provider": data.metadata.provider,
            "model": data.metadata.model,
            "prompt_template_id": data.metadata.prompt_template_id,
            "prompt_template_name": data.metadata.prompt_template_name,
            "prompt_content": if options.include_prompt_content { data.metadata.prompt_content.clone() } else { None },
            "interview_context": data.metadata.interview_context,
        },
        "messages": data.messages.iter().map(|msg| {
            serde_json::json!({
                "id": msg.id,
                "role": msg.role,
                "content": msg.content,
                "timestamp": msg.timestamp,
                "has_image": msg.has_image,
                "image_data": if options.include_images { msg.image_data.clone() } else { None },
            })
        }).collect::<Vec<_>>(),
    });

    serde_json::to_string_pretty(&export_obj).unwrap_or_default()
}

/// 生成可打印的 HTML（用于 PDF 导出）
pub fn export_to_pdf_html(data: &ExportData, options: &ExportOptions) -> String {
    let styles = r#"
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
            font-size: 14px;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
        }
        h1 {
            font-size: 24px;
            color: #1a1a1a;
            border-bottom: 2px solid #e0e0e0;
            padding-bottom: 10px;
            margin-bottom: 30px;
        }
        h2 {
            font-size: 16px;
            color: #555;
            margin-top: 30px;
            margin-bottom: 10px;
        }
        .metadata {
            background: #f5f5f5;
            border-left: 4px solid #2196F3;
            padding: 15px 20px;
            margin-bottom: 30px;
            border-radius: 4px;
            font-size: 13px;
            color: #666;
        }
        .metadata-item {
            margin: 5px 0;
        }
        .message {
            margin-bottom: 25px;
            page-break-inside: avoid;
        }
        .message-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
            font-size: 13px;
            color: #888;
        }
        .role-badge {
            font-weight: 600;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
        }
        .role-user {
            background: #e3f2fd;
            color: #1976d2;
        }
        .role-assistant {
            background: #e8f5e9;
            color: #388e3c;
        }
        .message-content {
            background: #fafafa;
            padding: 15px;
            border-radius: 8px;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .message.user .message-content {
            background: #e3f2fd;
        }
        .message.assistant .message-content {
            background: #e8f5e9;
        }
        .screenshot {
            max-width: 100%;
            height: auto;
            border-radius: 4px;
            margin-top: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .prompt-section {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e0e0e0;
        }
        .prompt-section h2 {
            color: #666;
        }
        pre {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            font-size: 13px;
            line-height: 1.4;
        }
        @media print {
            body { padding: 20px; }
            .message { page-break-inside: avoid; }
        }
    </style>
    "#;

    let mut message_html = String::new();
    for msg in &data.messages {
        let role_class = if msg.role == "user" {
            "user"
        } else {
            "assistant"
        };
        let role_label = if msg.role == "user" { "用户" } else { "AI" };
        let role_badge_class = if msg.role == "user" {
            "role-user"
        } else {
            "role-assistant"
        };
        let timestamp = format_datetime(msg.timestamp);

        let mut content_html = msg.content.replace('\n', "<br>");

        // 添加图片
        if msg.has_image && options.include_images {
            if let Some(img_data) = &msg.image_data {
                content_html.push_str(&format!(
                    r#"<br><img src="data:image/png;base64,{}" class="screenshot" alt="截图">"#,
                    img_data
                ));
            }
        }

        message_html.push_str(&format!(
            r#"<div class="message {role_class}">
                <div class="message-header">
                    <span class="role-badge {role_badge_class}">{role_label}</span>
                    <span>{timestamp}</span>
                </div>
                <div class="message-content">{content_html}</div>
            </div>"#,
            role_class = role_class,
            role_badge_class = role_badge_class,
            role_label = role_label,
            timestamp = timestamp,
            content_html = content_html
        ));
    }

    let mut metadata_html = String::new();
    if options.include_metadata {
        metadata_html.push_str(r#"<div class="metadata">"#);
        metadata_html.push_str(&format!(
            r#"<div class="metadata-item"><strong>导出时间：</strong>{}</div>"#,
            format_datetime(data.metadata.exported_at)
        ));
        metadata_html.push_str(&format!(
            r#"<div class="metadata-item"><strong>会话创建：</strong>{}</div>"#,
            format_datetime(data.metadata.created_at)
        ));
        metadata_html.push_str(&format!(
            r#"<div class="metadata-item"><strong>消息数量：</strong>{}</div>"#,
            data.metadata.message_count
        ));
        if let Some(provider) = &data.metadata.provider {
            metadata_html.push_str(&format!(
                r#"<div class="metadata-item"><strong>AI 提供商：</strong>{}</div>"#,
                provider
            ));
        }
        if let Some(model) = &data.metadata.model {
            metadata_html.push_str(&format!(
                r#"<div class="metadata-item"><strong>模型：</strong>{}</div>"#,
                model
            ));
        }
        metadata_html.push_str("</div>");
    }

    let mut prompt_section = String::new();
    if options.include_prompt_content {
        if let Some(prompt) = &data.metadata.prompt_content {
            prompt_section.push_str(r#"<div class="prompt-section">"#);
            prompt_section.push_str("<h2>附录：System Prompt</h2>");
            prompt_section.push_str("<pre>");
            prompt_section.push_str(prompt);
            prompt_section.push_str("</pre>");
            prompt_section.push_str("</div>");
        }
    }

    format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{}</title>
    {}
</head>
<body>
    <h1>{}</h1>
    {}
    {}
    {}
</body>
</html>"#,
        data.metadata.session_title,
        styles,
        data.metadata.session_title,
        metadata_html,
        message_html,
        prompt_section
    )
}

/// 获取默认文件名
pub fn get_default_file_name(title: &str, format: &str) -> String {
    let safe_title = sanitize_filename(title);
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let extension = match format {
        "markdown" => "md",
        "pdf" => "pdf",
        "json" => "json",
        _ => "md",
    };
    format!("{}_{}.{}", safe_title, date, extension)
}
