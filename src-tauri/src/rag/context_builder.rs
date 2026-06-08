// RAG Prompt 构建 - 上下文增强、Token 预算管理

use crate::rag::retriever::{SearchResult, SearchSourceKind};

/// 上下文配置
#[derive(Debug, Clone)]
pub struct ContextConfig {
    /// Token 预算
    pub max_tokens: usize,
    /// 最大引用条数
    pub max_results: usize,
    /// 是否标注来源
    pub include_source: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationMetadata {
    pub index: usize,
    pub knowledge_base_id: Option<String>,
    pub document_id: Option<String>,
    pub chunk_id: String,
    pub title: String,
    pub snippet: String,
    pub page_number: Option<u32>,
    pub heading_path: Vec<String>,
    pub score: f32,
    pub source_kind: SearchSourceKind,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagContextBundle {
    pub prompt_context: String,
    pub citations: Vec<CitationMetadata>,
}

#[derive(Debug, Clone)]
struct ContextEntry {
    prompt_entry: String,
    citation: CitationMetadata,
}

impl Default for ContextConfig {
    fn default() -> Self {
        Self {
            max_tokens: 2000,
            max_results: 5,
            include_source: true,
        }
    }
}

/// 构建 RAG 增强 Prompt
pub fn build_rag_context(results: &[SearchResult], config: &ContextConfig) -> String {
    build_rag_context_bundle(results, config).prompt_context
}

pub fn build_rag_context_bundle(
    results: &[SearchResult],
    config: &ContextConfig,
) -> RagContextBundle {
    let header = "【检索上下文】\n\n";
    let footer = "\n请优先使用最相关的上下文回答；如果上下文不足以支撑结论，请明确说明。\n";
    let reserved_tokens = estimate_tokens(header) + estimate_tokens(footer);
    let available_tokens = config.max_tokens.saturating_sub(reserved_tokens);
    let (entries, _) = build_context_entries(results, config, available_tokens, true);

    let mut context = String::from(header);
    for entry in &entries {
        context.push_str(&entry.prompt_entry);
    }
    context.push_str(footer);

    RagContextBundle {
        prompt_context: context,
        citations: entries.into_iter().map(|entry| entry.citation).collect(),
    }
}

/// Token 估算（中文约 2 字符/token，英文约 4 字符/token）
fn estimate_tokens(text: &str) -> usize {
    let chinese_count = text.chars().filter(|c| !c.is_ascii()).count();
    let ascii_count = text.chars().filter(|c| c.is_ascii()).count();
    (chinese_count / 2) + (ascii_count / 4) + 1
}

/// 构建用于 AI 消息的历史上下文
pub fn build_history_context(results: &[SearchResult], config: &ContextConfig) -> String {
    let (entries, _) = build_context_entries(results, config, config.max_tokens, false);
    entries
        .into_iter()
        .map(|entry| entry.prompt_entry)
        .collect::<String>()
        .trim()
        .to_string()
}

fn build_context_entries(
    results: &[SearchResult],
    config: &ContextConfig,
    max_tokens: usize,
    include_content_label: bool,
) -> (Vec<ContextEntry>, usize) {
    let mut entries = Vec::new();
    let mut used_tokens = 0usize;

    for (index, result) in sort_results_for_context(results)
        .into_iter()
        .take(config.max_results)
        .enumerate()
    {
        let prefix = render_context_prefix(
            index + 1,
            result,
            config.include_source,
            include_content_label,
        );
        let separator = if include_content_label {
            "\n---\n\n"
        } else {
            "\n\n"
        };
        let prefix_tokens = estimate_tokens(&prefix) + estimate_tokens(separator);
        if used_tokens + prefix_tokens >= max_tokens {
            break;
        }

        let remaining_tokens = max_tokens.saturating_sub(used_tokens + prefix_tokens);
        let body = truncate_to_token_limit(&result.chunk_text, remaining_tokens);
        if body.trim().is_empty() {
            continue;
        }

        let body_tokens = estimate_tokens(&body);
        used_tokens += prefix_tokens + body_tokens;
        entries.push(ContextEntry {
            prompt_entry: format!("{prefix}{body}{separator}"),
            citation: build_citation_metadata(index + 1, result),
        });
    }

    (entries, used_tokens)
}

fn sort_results_for_context(results: &[SearchResult]) -> Vec<&SearchResult> {
    let mut ordered = results.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                context_source_rank(&left.source_kind).cmp(&context_source_rank(&right.source_kind))
            })
            .then_with(|| left.title.cmp(&right.title))
            .then_with(|| left.chunk_id.cmp(&right.chunk_id))
    });
    ordered
}

fn context_source_rank(source_kind: &SearchSourceKind) -> u8 {
    match source_kind {
        SearchSourceKind::KnowledgeBaseDocument => 0,
        SearchSourceKind::PersonalMemory => 1,
        SearchSourceKind::Message => 2,
    }
}

fn render_context_prefix(
    index: usize,
    result: &SearchResult,
    include_source: bool,
    include_content_label: bool,
) -> String {
    let mut lines = vec![format!("[{}]", index)];

    if include_source {
        lines.push(format!("标题: {}", result.title));
        if let Some(knowledge_base_id) = &result.knowledge_base_id {
            lines.push(format!("知识库: {}", knowledge_base_id));
        }
        if let Some(page_number) = result.page_number {
            lines.push(format!("页码: {}", page_number));
        }
        if !result.heading_path.is_empty() {
            lines.push(format!("标题路径: {}", result.heading_path.join(" > ")));
        }
        lines.push(format!(
            "来源类型: {}",
            render_source_kind(&result.source_kind)
        ));
    }

    if include_content_label {
        lines.push("内容:".to_string());
    }

    format!("{}\n", lines.join("\n"))
}

fn render_source_kind(source_kind: &SearchSourceKind) -> &'static str {
    match source_kind {
        SearchSourceKind::KnowledgeBaseDocument => "knowledge_base_document",
        SearchSourceKind::PersonalMemory => "personal_memory",
        SearchSourceKind::Message => "message",
    }
}

fn build_citation_metadata(index: usize, result: &SearchResult) -> CitationMetadata {
    CitationMetadata {
        index,
        knowledge_base_id: result.knowledge_base_id.clone(),
        document_id: result.document_id.clone(),
        chunk_id: result.chunk_id.clone(),
        title: result.title.clone(),
        snippet: result.snippet.clone(),
        page_number: result.page_number,
        heading_path: result.heading_path.clone(),
        score: result.score,
        source_kind: result.source_kind.clone(),
    }
}

/// 构建系统提示词（包含 RAG 上下文）
pub fn build_system_prompt(base_prompt: &str, rag_context: Option<&str>) -> String {
    match rag_context {
        Some(ctx) if !ctx.is_empty() => {
            format!(
                "{}\n\n---\n\n【历史上下文】\n{}\n\n---\n\n请结合以上历史上下文回答用户问题。",
                base_prompt, ctx
            )
        }
        _ => base_prompt.to_string(),
    }
}

/// 估算总 Token 数量
pub fn estimate_total_tokens(texts: &[String]) -> usize {
    texts.iter().map(|t| estimate_tokens(t)).sum()
}

/// 截断文本以适应 token 限制
pub fn truncate_to_token_limit(text: &str, max_tokens: usize) -> String {
    let mut result = String::new();
    let mut token_count: f32 = 0.0;

    for ch in text.chars() {
        let char_tokens: f32 = if ch.is_ascii() { 0.25 } else { 0.5 };

        if token_count + char_tokens > max_tokens as f32 {
            break;
        }

        result.push(ch);
        token_count += char_tokens;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimate_tokens() {
        // 纯中文 - 6个字
        let chinese = "这是一个测试";
        // 6个字: 6/2 + 1 = 4 tokens
        assert_eq!(estimate_tokens(chinese), 4);

        // 纯英文
        let english = "this is a test";
        assert!(estimate_tokens(english) >= 3);

        // 混合
        let mixed = "Hello 你好 World 世界";
        let tokens = estimate_tokens(mixed);
        assert!(tokens > 0);
    }

    #[test]
    fn test_build_rag_context() {
        let results = vec![
            SearchResult {
                knowledge_base_id: None,
                chunk_id: "message:1:0".to_string(),
                embedding_id: Some("emb-1".to_string()),
                message_id: Some("1".to_string()),
                document_id: None,
                title: "历史消息".to_string(),
                chunk_text: "这是第一个答案".to_string(),
                snippet: "这是第一个答案".to_string(),
                page_number: None,
                heading_path: Vec::new(),
                score: 0.9,
                source: crate::rag::retriever::SearchSource::Vector,
                source_kind: crate::rag::retriever::SearchSourceKind::Message,
            },
            SearchResult {
                knowledge_base_id: None,
                chunk_id: "message:2:0".to_string(),
                embedding_id: Some("emb-2".to_string()),
                message_id: Some("2".to_string()),
                document_id: None,
                title: "历史消息".to_string(),
                chunk_text: "这是第二个答案".to_string(),
                snippet: "这是第二个答案".to_string(),
                page_number: None,
                heading_path: Vec::new(),
                score: 0.8,
                source: crate::rag::retriever::SearchSource::Vector,
                source_kind: crate::rag::retriever::SearchSourceKind::Message,
            },
        ];

        let config = ContextConfig::default();
        let context = build_rag_context(&results, &config);

        assert!(context.contains("【检索上下文】"));
        assert!(context.contains("标题: 历史消息"));
        assert!(context.contains("来源类型: message"));
        assert!(context.contains("请优先使用最相关的上下文回答"));
    }

    #[test]
    fn test_truncate_to_token_limit() {
        let text = "这是一个很长的文本".repeat(100);
        let truncated = truncate_to_token_limit(&text, 20);
        assert!(truncated.len() < text.len());
    }

    #[test]
    fn test_build_rag_context_orders_results_stably_by_score_then_identity() {
        let results = vec![
            SearchResult {
                knowledge_base_id: Some("kb-2".to_string()),
                chunk_id: "chunk-b".to_string(),
                embedding_id: Some("emb-b".to_string()),
                message_id: None,
                document_id: Some("doc-b".to_string()),
                title: "第二份文档".to_string(),
                chunk_text: "第二条".to_string(),
                snippet: "第二条".to_string(),
                page_number: Some(2),
                heading_path: vec!["章节 B".to_string()],
                score: 0.8,
                source: crate::rag::retriever::SearchSource::Vector,
                source_kind: crate::rag::retriever::SearchSourceKind::KnowledgeBaseDocument,
            },
            SearchResult {
                knowledge_base_id: Some("kb-1".to_string()),
                chunk_id: "chunk-a".to_string(),
                embedding_id: Some("emb-a".to_string()),
                message_id: None,
                document_id: Some("doc-a".to_string()),
                title: "第一份文档".to_string(),
                chunk_text: "第一条".to_string(),
                snippet: "第一条".to_string(),
                page_number: Some(1),
                heading_path: vec!["章节 A".to_string()],
                score: 0.9,
                source: crate::rag::retriever::SearchSource::Vector,
                source_kind: crate::rag::retriever::SearchSourceKind::KnowledgeBaseDocument,
            },
        ];

        let context = build_rag_context(
            &results,
            &ContextConfig {
                max_tokens: 200,
                max_results: 5,
                include_source: true,
            },
        );

        let first_index = context.find("标题: 第一份文档").unwrap();
        let second_index = context.find("标题: 第二份文档").unwrap();
        assert!(first_index < second_index);
    }

    #[test]
    fn test_build_rag_context_bundle_returns_citations_with_render_metadata() {
        let results = vec![SearchResult {
            knowledge_base_id: Some("kb-1".to_string()),
            chunk_id: "chunk-1".to_string(),
            embedding_id: Some("emb-1".to_string()),
            message_id: None,
            document_id: Some("doc-1".to_string()),
            title: "Rust 手册".to_string(),
            chunk_text: "Ownership prevents double free.".to_string(),
            snippet: "Ownership prevents double free.".to_string(),
            page_number: Some(8),
            heading_path: vec!["Chapter 1".to_string(), "Ownership".to_string()],
            score: 0.95,
            source: crate::rag::retriever::SearchSource::Vector,
            source_kind: crate::rag::retriever::SearchSourceKind::KnowledgeBaseDocument,
        }];

        let bundle = build_rag_context_bundle(
            &results,
            &ContextConfig {
                max_tokens: 200,
                max_results: 5,
                include_source: true,
            },
        );

        assert_eq!(bundle.citations.len(), 1);
        assert_eq!(bundle.citations[0].index, 1);
        assert_eq!(
            bundle.citations[0].knowledge_base_id.as_deref(),
            Some("kb-1")
        );
        assert_eq!(bundle.citations[0].document_id.as_deref(), Some("doc-1"));
        assert_eq!(bundle.citations[0].chunk_id, "chunk-1");
        assert_eq!(bundle.citations[0].title, "Rust 手册");
        assert_eq!(bundle.citations[0].page_number, Some(8));
        assert_eq!(
            bundle.citations[0].heading_path,
            vec!["Chapter 1".to_string(), "Ownership".to_string()]
        );
        assert!(bundle.prompt_context.contains("标题: Rust 手册"));
        assert!(bundle.prompt_context.contains("页码: 8"));
    }

    #[test]
    fn test_build_rag_context_bundle_handles_empty_results() {
        let bundle = build_rag_context_bundle(
            &[],
            &ContextConfig {
                max_tokens: 200,
                max_results: 5,
                include_source: true,
            },
        );

        assert!(bundle.prompt_context.contains("【检索上下文】"));
        assert!(bundle
            .prompt_context
            .contains("请优先使用最相关的上下文回答"));
        assert!(bundle.citations.is_empty());
        assert!(!bundle.prompt_context.contains("[1]"));
    }

    #[test]
    fn test_build_rag_context_bundle_orders_equal_score_results_by_source_kind() {
        let results = vec![
            SearchResult {
                knowledge_base_id: None,
                chunk_id: "message:1:0".to_string(),
                embedding_id: Some("emb-message".to_string()),
                message_id: Some("1".to_string()),
                document_id: None,
                title: "历史消息".to_string(),
                chunk_text: "消息来源内容".to_string(),
                snippet: "消息来源内容".to_string(),
                page_number: None,
                heading_path: Vec::new(),
                score: 0.9,
                source: crate::rag::retriever::SearchSource::Vector,
                source_kind: crate::rag::retriever::SearchSourceKind::Message,
            },
            SearchResult {
                knowledge_base_id: Some("kb-1".to_string()),
                chunk_id: "chunk-1".to_string(),
                embedding_id: Some("emb-kb".to_string()),
                message_id: None,
                document_id: Some("doc-1".to_string()),
                title: "Rust 手册".to_string(),
                chunk_text: "知识库来源内容".to_string(),
                snippet: "知识库来源内容".to_string(),
                page_number: Some(3),
                heading_path: vec!["Chapter 1".to_string()],
                score: 0.9,
                source: crate::rag::retriever::SearchSource::Vector,
                source_kind: crate::rag::retriever::SearchSourceKind::KnowledgeBaseDocument,
            },
        ];

        let bundle = build_rag_context_bundle(
            &results,
            &ContextConfig {
                max_tokens: 200,
                max_results: 5,
                include_source: true,
            },
        );

        assert_eq!(bundle.citations.len(), 2);
        assert_eq!(
            bundle.citations[0].source_kind,
            crate::rag::retriever::SearchSourceKind::KnowledgeBaseDocument
        );
        assert_eq!(
            bundle.citations[1].source_kind,
            crate::rag::retriever::SearchSourceKind::Message
        );

        let knowledge_index = bundle.prompt_context.find("标题: Rust 手册").unwrap();
        let message_index = bundle.prompt_context.find("标题: 历史消息").unwrap();
        assert!(knowledge_index < message_index);
    }

    #[test]
    fn test_build_rag_context_bundle_returns_structured_citations_for_mixed_sources() {
        let results = vec![
            SearchResult {
                knowledge_base_id: Some("kb-1".to_string()),
                chunk_id: "chunk-1".to_string(),
                embedding_id: Some("emb-kb".to_string()),
                message_id: None,
                document_id: Some("doc-1".to_string()),
                title: "Rust 手册".to_string(),
                chunk_text: "Ownership prevents double free.".to_string(),
                snippet: "Ownership prevents double free.".to_string(),
                page_number: Some(8),
                heading_path: vec!["Chapter 1".to_string(), "Ownership".to_string()],
                score: 0.95,
                source: crate::rag::retriever::SearchSource::Vector,
                source_kind: crate::rag::retriever::SearchSourceKind::KnowledgeBaseDocument,
            },
            SearchResult {
                knowledge_base_id: None,
                chunk_id: "message:session-1:0".to_string(),
                embedding_id: Some("emb-message".to_string()),
                message_id: Some("session-1".to_string()),
                document_id: None,
                title: "历史消息".to_string(),
                chunk_text: "Rust ownership 规则".to_string(),
                snippet: "Rust ownership 规则".to_string(),
                page_number: None,
                heading_path: Vec::new(),
                score: 0.9,
                source: crate::rag::retriever::SearchSource::Vector,
                source_kind: crate::rag::retriever::SearchSourceKind::Message,
            },
        ];

        let bundle = build_rag_context_bundle(
            &results,
            &ContextConfig {
                max_tokens: 200,
                max_results: 5,
                include_source: true,
            },
        );

        assert_eq!(bundle.citations.len(), 2);

        let knowledge_citation = &bundle.citations[0];
        assert_eq!(knowledge_citation.index, 1);
        assert_eq!(
            knowledge_citation.knowledge_base_id.as_deref(),
            Some("kb-1")
        );
        assert_eq!(knowledge_citation.document_id.as_deref(), Some("doc-1"));
        assert_eq!(knowledge_citation.chunk_id, "chunk-1");
        assert_eq!(knowledge_citation.page_number, Some(8));
        assert_eq!(
            knowledge_citation.heading_path,
            vec!["Chapter 1".to_string(), "Ownership".to_string()]
        );
        assert_eq!(
            knowledge_citation.source_kind,
            crate::rag::retriever::SearchSourceKind::KnowledgeBaseDocument
        );

        let message_citation = &bundle.citations[1];
        assert_eq!(message_citation.index, 2);
        assert!(message_citation.knowledge_base_id.is_none());
        assert!(message_citation.document_id.is_none());
        assert_eq!(message_citation.chunk_id, "message:session-1:0");
        assert!(message_citation.page_number.is_none());
        assert!(message_citation.heading_path.is_empty());
        assert_eq!(
            message_citation.source_kind,
            crate::rag::retriever::SearchSourceKind::Message
        );
    }
}
