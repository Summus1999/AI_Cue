// RAG Prompt 构建 - 上下文增强、Token 预算管理

use crate::rag::retriever::SearchResult;

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
pub fn build_rag_context(
    results: &[SearchResult],
    config: &ContextConfig,
) -> String {
    let mut context = String::from("【相关历史参考】\n\n");
    let mut token_count = 0;
    
    for (i, result) in results.iter().take(config.max_results).enumerate() {
        let entry = if config.include_source {
            format!("[{}] {}\n---\n", i + 1, result.chunk_text)
        } else {
            format!("{}\n---\n", result.chunk_text)
        };
        
        let entry_tokens = estimate_tokens(&entry);
        if token_count + entry_tokens > config.max_tokens {
            break;
        }
        
        context.push_str(&entry);
        token_count += entry_tokens;
    }
    
    context.push_str("\n请参考以上历史记录回答用户问题。\n");
    context
}

/// Token 估算（中文约 2 字符/token，英文约 4 字符/token）
fn estimate_tokens(text: &str) -> usize {
    let chinese_count = text.chars().filter(|c| !c.is_ascii()).count();
    let ascii_count = text.chars().filter(|c| c.is_ascii()).count();
    (chinese_count / 2) + (ascii_count / 4) + 1
}

/// 构建用于 AI 消息的历史上下文
pub fn build_history_context(
    results: &[SearchResult],
    config: &ContextConfig,
) -> String {
    let mut context = String::new();
    
    for (i, result) in results.iter().take(config.max_results).enumerate() {
        if config.include_source {
            context.push_str(&format!("[参考 {}] {}\n\n", i + 1, result.chunk_text));
        } else {
            context.push_str(&format!("{}\n\n", result.chunk_text));
        }
    }
    
    context.trim().to_string()
}

/// 构建系统提示词（包含 RAG 上下文）
pub fn build_system_prompt(
    base_prompt: &str,
    rag_context: Option<&str>,
) -> String {
    match rag_context {
        Some(ctx) if !ctx.is_empty() => {
            format!("{}\n\n---\n\n【历史上下文】\n{}\n\n---\n\n请结合以上历史上下文回答用户问题。", 
                base_prompt, ctx)
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
                message_id: "1".to_string(),
                chunk_text: "这是第一个答案".to_string(),
                score: 0.9,
                source: crate::rag::retriever::SearchSource::Vector,
            },
            SearchResult {
                message_id: "2".to_string(),
                chunk_text: "这是第二个答案".to_string(),
                score: 0.8,
                source: crate::rag::retriever::SearchSource::Vector,
            },
        ];
        
        let config = ContextConfig::default();
        let context = build_rag_context(&results, &config);
        
        assert!(context.contains("【相关历史参考】"));
        assert!(context.contains("参考以上历史记录"));
    }
    
    #[test]
    fn test_truncate_to_token_limit() {
        let text = "这是一个很长的文本".repeat(100);
        let truncated = truncate_to_token_limit(&text, 20);
        assert!(truncated.len() < text.len());
    }
}
