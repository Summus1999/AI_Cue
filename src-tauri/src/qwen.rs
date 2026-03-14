// 千问 API 调用模块 - 使用 DashScope OpenAI 兼容接口

use base64::Engine;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// 截图识别使用的固定视觉模型
const SCREENSHOT_VISION_MODEL: &str = "qwen-vl-max";
const SCREENSHOT_CODER_MODEL: &str = "qwen-coder-plus";
const BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

/// 聊天消息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// OpenAI 兼容的请求体
#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

/// OpenAI 兼容的响应体（非流式）
#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ResponseMessage {
    content: String,
}

/// 流式响应的 chunk 结构
#[derive(Debug, Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: Delta,
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Delta {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VisionExtractResult {
    problem_id: Option<String>,
    problem_title: Option<String>,
    problem_slug: Option<String>,
    problem_statement: Option<String>,
    visible_code: Option<String>,
    assumptions: Option<String>,
}

#[derive(Debug)]
struct SourceDoc {
    label: String,
    url: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct GitHubSearchResponse {
    items: Vec<GitHubSearchItem>,
}

#[derive(Debug, Deserialize)]
struct GitHubSearchItem {
    path: String,
    repository: GitHubRepository,
}

#[derive(Debug, Deserialize)]
struct GitHubRepository {
    full_name: String,
}

#[derive(Debug, Deserialize)]
struct GitHubContentResponse {
    content: String,
    encoding: String,
}

/// 流式事件 payload
#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    pub content: String,
    pub done: bool,
}

fn create_http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

async fn post_chat_request<T: Serialize>(
    client: &reqwest::Client,
    api_key: &str,
    request_body: &T,
) -> Result<reqwest::Response, String> {
    client
        .post(BASE_URL)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(request_body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "请求超时，请检查网络连接".to_string()
            } else if e.is_connect() {
                "无法连接服务器，请检查网络".to_string()
            } else {
                format!("请求失败: {}", e)
            }
        })
}

async fn fetch_public_url_text(client: &reqwest::Client, url: &str) -> Option<String> {
    let response = client
        .get(url)
        .header("User-Agent", "ai-cue/0.1")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let text = response.text().await.ok()?;
    if text.is_empty() {
        return None;
    }
    Some(text)
}

fn normalize_slug(title: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in title.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            slug.push('-');
            prev_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

fn clip_text(input: &str, limit: usize) -> String {
    let clipped = if input.len() > limit {
        &input[..limit]
    } else {
        input
    };
    clipped.replace('\r', "").trim().to_string()
}

fn extract_json_object(text: &str) -> Option<String> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(text[start..=end].to_string())
}

fn json_value_to_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::Null => None,
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(num) => Some(num.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(|item| json_value_to_text(Some(item)))
                .collect::<Vec<String>>();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(|item| json_value_to_text(Some(item))) {
                return Some(text);
            }
            Some(Value::Object(map.clone()).to_string())
        }
    }
}

fn parse_vision_extract_result(json_text: &str) -> Result<VisionExtractResult, String> {
    let value: Value =
        serde_json::from_str(json_text).map_err(|e| format!("视觉解析结果不是合法 JSON: {}", e))?;
    let object = value
        .as_object()
        .ok_or_else(|| "视觉解析结果不是 JSON object".to_string())?;

    Ok(VisionExtractResult {
        problem_id: json_value_to_text(object.get("problem_id")),
        problem_title: json_value_to_text(object.get("problem_title")),
        problem_slug: json_value_to_text(object.get("problem_slug")),
        problem_statement: json_value_to_text(object.get("problem_statement")),
        visible_code: json_value_to_text(object.get("visible_code")),
        assumptions: json_value_to_text(object.get("assumptions")),
    })
}

fn parse_repo_owner_and_name(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim().trim_end_matches('/');
    let marker = "github.com/";
    let idx = trimmed.find(marker)?;
    let remain = &trimmed[idx + marker.len()..];
    let parts: Vec<&str> = remain.split('/').collect();
    if parts.len() < 2 {
        return None;
    }
    let owner = parts[0].trim();
    let repo = parts[1].trim();
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

/// Parse markdown heading like:
/// ## 16. title
/// #### 16.标题
/// ### 16、标题
fn parse_problem_heading_id(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let hash_count = trimmed.chars().take_while(|&ch| ch == '#').count();
    if hash_count < 2 {
        return None;
    }

    let rest = trimmed[hash_count..].trim_start();
    if rest.is_empty() {
        return None;
    }

    let digit_len = rest.chars().take_while(|ch| ch.is_ascii_digit()).count();
    if digit_len == 0 {
        return None;
    }

    Some(rest[..digit_len].to_string())
}

/// Find section by markdown problem heading, returns section body until next numbered heading or EOF
fn find_local_doc_section(content: &str, problem_id: &str) -> Option<String> {
    let problem_id = problem_id.trim();
    if problem_id.is_empty() {
        return None;
    }

    let mut in_section = false;
    let mut section_content = String::new();

    for line in content.lines() {
        if let Some(current_id) = parse_problem_heading_id(line) {
            if current_id == problem_id {
                in_section = true;
                section_content.clear();
                section_content.push_str(line.trim());
                section_content.push('\n');
                continue;
            }

            if in_section {
                break;
            }
        }

        if in_section {
            section_content.push_str(line);
            section_content.push('\n');
        }
    }

    if in_section && !section_content.trim().is_empty() {
        Some(section_content)
    } else {
        None
    }
}

/// Extract first cpp/c++ code block from section
fn extract_cpp_code_block(section: &str) -> Option<String> {
    for marker in ["```cpp", "```c++"] {
        if let Some(pos) = section.find(marker) {
            let start = pos + marker.len();
            let after = section[start..].trim_start();
            let end = after.find("\n```").unwrap_or(after.len());
            let code = after[..end].trim();
            if !code.is_empty() {
                return Some(code.to_string());
            }
        }
    }
    None
}

/// Read local doc and find section + code block by problem_id
fn fetch_local_doc_section(local_doc_path: &str, problem_id: &str) -> Option<(String, String)> {
    let path = Path::new(local_doc_path.trim());
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    let section = find_local_doc_section(&content, problem_id)?;
    let code = extract_cpp_code_block(&section)?;
    Some((section, code))
}

async fn fetch_leetcode_sources(client: &reqwest::Client, slug: &str, docs: &mut Vec<SourceDoc>) {
    let urls = [
        format!("https://leetcode.com/problems/{}/description/", slug),
        format!("https://leetcode.com/problems/{}/solutions/", slug),
    ];
    for url in urls {
        if let Some(text) = fetch_public_url_text(client, &url).await {
            docs.push(SourceDoc {
                label: "LeetCode 官方".to_string(),
                url,
                content: clip_text(&text, 6000),
            });
        }
    }
}

async fn fetch_github_repo_sources(
    client: &reqwest::Client,
    repo_urls: &[String],
    search_hint: &str,
    docs: &mut Vec<SourceDoc>,
) {
    let mut seen = HashSet::new();

    for repo_url in repo_urls {
        let Some((owner, repo)) = parse_repo_owner_and_name(repo_url) else {
            continue;
        };

        let mut query_url = match reqwest::Url::parse("https://api.github.com/search/code") {
            Ok(url) => url,
            Err(_) => continue,
        };
        let query = format!("{} repo:{}/{}", search_hint, owner, repo);
        query_url.query_pairs_mut().append_pair("q", &query);

        let response = match client
            .get(query_url)
            .header("User-Agent", "ai-cue/0.1")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(_) => continue,
        };
        if !response.status().is_success() {
            continue;
        }

        let payload = match response.json::<GitHubSearchResponse>().await {
            Ok(data) => data,
            Err(_) => continue,
        };

        for item in payload.items.into_iter().take(2) {
            let unique_key = format!("{}:{}", item.repository.full_name, item.path);
            if seen.contains(&unique_key) {
                continue;
            }
            seen.insert(unique_key);

            let content_api = format!(
                "https://api.github.com/repos/{}/contents/{}",
                item.repository.full_name, item.path
            );
            let content_resp = match client
                .get(&content_api)
                .header("User-Agent", "ai-cue/0.1")
                .header("Accept", "application/vnd.github+json")
                .send()
                .await
            {
                Ok(resp) => resp,
                Err(_) => continue,
            };
            if !content_resp.status().is_success() {
                continue;
            }
            let content_payload = match content_resp.json::<GitHubContentResponse>().await {
                Ok(data) => data,
                Err(_) => continue,
            };
            if content_payload.encoding.to_lowercase() != "base64" {
                continue;
            }

            let raw_base64 = content_payload.content.replace('\n', "");
            let decoded = match base64::engine::general_purpose::STANDARD.decode(raw_base64) {
                Ok(bytes) => bytes,
                Err(_) => continue,
            };
            let text = String::from_utf8_lossy(&decoded).to_string();
            docs.push(SourceDoc {
                label: format!("GitHub {}", item.repository.full_name),
                url: format!(
                    "https://github.com/{}/blob/HEAD/{}",
                    item.repository.full_name, item.path
                ),
                content: clip_text(&text, 5000),
            });
        }
    }
}

async fn read_chat_response_text(response: reqwest::Response) -> Result<String, String> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!("API 错误 ({}): {}", status, body));
    }

    let chat_response: ChatResponse =
        serde_json::from_str(&body).map_err(|e| format!("解析响应失败: {} - {}", e, body))?;

    chat_response
        .choices
        .first()
        .map(|choice| choice.message.content.clone())
        .ok_or_else(|| "API 返回空结果".to_string())
}

async fn stream_response(app: AppHandle, response: reqwest::Response) -> Result<(), String> {
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API 错误 ({}): {}", status, body));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("读取流失败: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() {
                continue;
            }

            if let Some(json_str) = line.strip_prefix("data: ") {
                if json_str == "[DONE]" {
                    let _ = app.emit(
                        "qwen-stream",
                        StreamEvent {
                            content: String::new(),
                            done: true,
                        },
                    );
                    return Ok(());
                }

                if let Ok(chunk_data) = serde_json::from_str::<StreamChunk>(json_str) {
                    if let Some(choice) = chunk_data.choices.first() {
                        if let Some(content) = &choice.delta.content {
                            let _ = app.emit(
                                "qwen-stream",
                                StreamEvent {
                                    content: content.clone(),
                                    done: false,
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    let _ = app.emit(
        "qwen-stream",
        StreamEvent {
            content: String::new(),
            done: true,
        },
    );
    Ok(())
}

async fn chat_vision_extract(
    api_key: &str,
    image_base64: &str,
    user_prompt: &str,
) -> Result<VisionExtractResult, String> {
    let client = create_http_client(120)?;
    let image_url = format!("data:image/png;base64,{}", image_base64);
    let extraction_prompt = format!(
        "你是算法题截图解析助手。请只做识别和整理，不要给最终代码。\n\
用户诉求：{}\n\
请尽可能从截图中提取以下内容，并以 JSON 输出：\n\
{{\n\
  \"problem_id\": \"题号，无法识别则为空字符串\",\n\
  \"problem_title\": \"题目标题，无法识别则为空字符串\",\n\
  \"problem_slug\": \"LeetCode slug，无法识别可为空字符串\",\n\
  \"problem_statement\": \"题意摘要\",\n\
  \"visible_code\": \"截图中可见代码\",\n\
  \"assumptions\": \"题面不完整时的合理假设\"\n\
}}\n\
除了 JSON 不要输出其他内容。",
        user_prompt
    );

    let request_body = serde_json::json!({
        "model": SCREENSHOT_VISION_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    { "type": "image_url", "image_url": { "url": image_url } },
                    { "type": "text", "text": extraction_prompt }
                ]
            }
        ],
        "stream": false
    });

    let response = post_chat_request(&client, api_key, &request_body).await?;
    let text = read_chat_response_text(response).await?;
    let json_text = extract_json_object(&text).unwrap_or(text);
    parse_vision_extract_result(&json_text)
}

/// 调用千问 API 进行对话
///
/// # 参数
/// - `api_key`: DashScope API Key
/// - `model`: 模型名称 (qwen-turbo, qwen-plus, qwen-max, qwen-coder-plus)
/// - `messages`: 对话消息列表
///
/// # 返回
/// AI 回复的内容
pub async fn chat(
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let client = create_http_client(60)?;

    let request_body = ChatRequest {
        model: model.to_string(),
        messages,
        stream: false,
    };

    println!("[千问API] 发送请求到模型: {}", model);
    let response = post_chat_request(&client, api_key, &request_body).await?;
    let content = read_chat_response_text(response).await?;
    println!("[千问API] 成功获取回复，长度: {} 字符", content.len());
    Ok(content)
}

/// 流式调用千问 API 进行对话
/// 通过 Tauri Event 发送每个 chunk 到前端
pub async fn chat_stream(
    app: AppHandle,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let client = create_http_client(120)?;

    let request_body = ChatRequest {
        model: model.to_string(),
        messages,
        stream: true,
    };

    println!("[千问API] 发送流式请求到模型: {}", model);
    let response = post_chat_request(&client, api_key, &request_body).await?;
    stream_response(app, response).await
}

/// Two-stage screenshot pipeline:
/// 1. qwen-vl-max extracts the problem and any visible code from the screenshot.
/// 2. Priority: local doc -> LeetCode official -> GitHub -> inference.
/// 3. When local doc hits: emit code block first, then coder generates explanation only.
pub async fn chat_stream_vision(
    app: AppHandle,
    api_key: &str,
    image_base64: &str,
    prompt: &str,
    repo_urls: Vec<String>,
    local_doc_path: Option<String>,
) -> Result<(), String> {
    let extracted = chat_vision_extract(api_key, image_base64, prompt).await?;
    let title = extracted.problem_title.clone().unwrap_or_default();
    let problem_id = extracted.problem_id.clone().unwrap_or_default();
    let slug = extracted
        .problem_slug
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| normalize_slug(&title));

    // 1. Local doc first: if path set and problem_id match, use doc code + coder for explanation only
    if let Some(ref path) = local_doc_path {
        let path = path.trim();
        if !path.is_empty() && !problem_id.trim().is_empty() {
            if let Some((_section, code)) = fetch_local_doc_section(path, &problem_id) {
                let code_block = format!("```cpp\n{}\n```\n\n", code);
                let _ = app.emit(
                    "qwen-stream",
                    StreamEvent {
                        content: code_block,
                        done: false,
                    },
                );
                let explain_prompt = format!(
                    "以下是题号 {} 的 C++ 代码（来自本地文档，请勿修改）。\n\
你只需输出 3 到 6 行中文说明，末尾必须加：参考来源：本地文档（题号 {}）\n\
禁止输出任何代码，禁止修改文档内容。",
                    problem_id.trim(),
                    problem_id.trim()
                );
                let coder_messages = vec![
                    ChatMessage {
                        role: "system".to_string(),
                        content: "你是算法题说明助手。用户已提供完整代码，你只需输出简短中文说明（3-6行），末尾加参考来源。禁止输出代码。".to_string(),
                    },
                    ChatMessage {
                        role: "user".to_string(),
                        content: explain_prompt,
                    },
                ];
                return chat_stream(app, api_key, SCREENSHOT_CODER_MODEL, coder_messages).await;
            }
        }
    }

    // 2. Fall through to online retrieval
    let fetch_client = create_http_client(30)?;
    let mut official_docs: Vec<SourceDoc> = Vec::new();
    let mut github_docs: Vec<SourceDoc> = Vec::new();
    if !slug.is_empty() {
        fetch_leetcode_sources(&fetch_client, &slug, &mut official_docs).await;
    }
    let search_hint = if !problem_id.trim().is_empty() {
        format!("leetcode {}", problem_id.trim())
    } else if !title.trim().is_empty() {
        format!("leetcode {}", title.trim())
    } else {
        "leetcode".to_string()
    };
    if official_docs.is_empty() && !repo_urls.is_empty() {
        fetch_github_repo_sources(&fetch_client, &repo_urls, &search_hint, &mut github_docs).await;
    }

    let (selected_docs, source_mode, fallback_notice, inference_attribution) =
        if !official_docs.is_empty() {
            (
                official_docs,
                "official",
                "已命中 LeetCode 官方来源。".to_string(),
                None,
            )
        } else if !github_docs.is_empty() {
            (
                github_docs,
                "github",
                "未命中 LeetCode 官方，已回退到 GitHub 白名单仓库。".to_string(),
                None,
            )
        } else {
            let att = if !problem_id.trim().is_empty() {
                Some(format!(
                    "参考来源：模型推断（已识别题号 {}，但未命中 LeetCode 官方与 GitHub 白名单）",
                    problem_id.trim()
                ))
            } else {
                None
            };
            (
                Vec::<SourceDoc>::new(),
                "inference",
                "未命中 LeetCode 官方与 GitHub 白名单，已回退为模型推断（低置信度）。".to_string(),
                att,
            )
        };

    let source_summary = if selected_docs.is_empty() {
        fallback_notice.clone()
    } else {
        selected_docs
            .iter()
            .take(4)
            .map(|doc| format!("- {} ({})", doc.label, doc.url))
            .collect::<Vec<String>>()
            .join("\n")
    };
    let source_material = selected_docs
        .iter()
        .take(4)
        .enumerate()
        .map(|(index, doc)| format!("来源{} [{}]\n{}\n", index + 1, doc.url, doc.content))
        .collect::<Vec<String>>()
        .join("\n");

    let source_attribution_rule = if let Some(ref att) = inference_attribution {
        format!(
            "\n若为模型推断且已识别题号，说明末尾必须加以下一行（不可省略、不可改写）：\n{}",
            att
        )
    } else {
        String::new()
    };

    let system_content = format!(
        "你是算法题与面试代码助手。\n\
必须严格按以下顺序输出：\n\
1. 第一屏先输出完整 cpp 代码块。\n\
2. 代码块后再输出 3 到 6 行中文说明。\n\
禁止在代码块前输出任何解释。\n\
代码要求：可直接复制提交、可编译、默认使用中文注释。\n\
若题面不完整，先给可运行代码，再在说明中明确假设。\n\
说明末尾必须加一行“参考来源：...”，简短列出命中的来源标签。{}\n",
        source_attribution_rule
    );

    let coder_messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: system_content,
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!(
                "用户目标：{}\n\n\
题号：{}\n\
题目：{}\n\
题面摘要：{}\n\
截图可见代码：{}\n\
假设：{}\n\n\
来源策略：{}\n\
回退说明：{}\n\n\
白名单命中来源：\n{}\n\n\
来源正文摘录（可能为空）：\n{}\n\n\
请按以下优先级执行：\n\
1) 优先使用 LeetCode 官方来源；\n\
2) 若官方为空，则使用 GitHub 白名单来源；\n\
3) 若两者都为空，才允许基于题面推断。\n\
无论哪种情况，都必须先输出可提交的完整 cpp 代码块。",
                prompt,
                problem_id,
                title,
                extracted.problem_statement.unwrap_or_default(),
                extracted.visible_code.unwrap_or_default(),
                extracted.assumptions.unwrap_or_default(),
                source_mode,
                fallback_notice,
                source_summary,
                source_material
            ),
        },
    ];

    chat_stream(app, api_key, SCREENSHOT_CODER_MODEL, coder_messages).await
}
