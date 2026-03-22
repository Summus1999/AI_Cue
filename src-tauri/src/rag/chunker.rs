// 文档分块策略 - 文本分块、Q&A 对识别、代码块处理

/// 分块配置
#[derive(Debug, Clone)]
pub struct ChunkConfig {
    /// 最大分块字符数
    pub max_chunk_size: usize,
    /// 重叠窗口大小
    pub overlap_size: usize,
    /// 最小分块大小
    pub min_chunk_size: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            max_chunk_size: 512,
            overlap_size: 50,
            min_chunk_size: 100,
        }
    }
}

/// 分块类型
#[derive(Debug, Clone)]
pub enum ChunkType {
    /// 普通文本
    Text,
    /// 代码块
    Code {
        language: Option<String>,
    },
    /// Q&A 对
    QaPair,
}

/// 分块
#[derive(Debug, Clone)]
pub struct Chunk {
    /// 文本内容
    pub text: String,
    /// 起始字符位置
    pub start_char: usize,
    /// 结束字符位置
    pub end_char: usize,
    /// 分块类型
    pub chunk_type: ChunkType,
}

impl Default for Chunk {
    fn default() -> Self {
        Self {
            text: String::new(),
            start_char: 0,
            end_char: 0,
            chunk_type: ChunkType::Text,
        }
    }
}

/// 代码块结构
struct CodeBlock {
    content: String,
    language: Option<String>,
    start: usize,
    end: usize,
}

/// 提取代码块
fn extract_code_blocks(content: &str) -> Vec<CodeBlock> {
    let mut blocks = Vec::new();
    let mut in_code_block = false;
    let mut current_block = String::new();
    let mut language = None;
    let mut block_start = 0;
    
    // 计算行偏移
    let mut line_offsets: Vec<usize> = vec![0];
    for (i, ch) in content.char_indices() {
        if ch == '\n' {
            line_offsets.push(i + 1);
        }
    }
    line_offsets.push(content.len());
    
    let lines: Vec<&str> = content.lines().collect();
    
    for (i, line) in lines.iter().enumerate() {
        let line_start = *line_offsets.get(i).unwrap_or(&0);
        
        if line.trim_start().starts_with("```") {
            if in_code_block {
                // 结束代码块
                blocks.push(CodeBlock {
                    content: current_block.clone(),
                    language: language.clone(),
                    start: block_start,
                    end: line_start + line.len(),
                });
                current_block.clear();
                language = None;
                in_code_block = false;
            } else {
                // 开始代码块
                in_code_block = true;
                block_start = line_start;
                // 提取语言
                let lang = line.trim_start().trim_start_matches("```");
                if !lang.is_empty() {
                    language = Some(lang.to_string());
                }
            }
        } else if in_code_block {
            current_block.push_str(line);
            current_block.push('\n');
        }
    }
    
    blocks
}

/// 按代码块分割文本
fn split_by_code_blocks(content: &str, code_blocks: &[CodeBlock]) -> Vec<(String, usize, usize)> {
    let mut parts = Vec::new();
    let mut last_end = 0;
    
    for block in code_blocks {
        if block.start > last_end {
            // 添加非代码部分
            parts.push((
                content[last_end..block.start].to_string(),
                last_end,
                block.start,
            ));
        }
        last_end = block.end;
    }
    
    // 添加最后部分
    if last_end < content.len() {
        parts.push((
            content[last_end..].to_string(),
            last_end,
            content.len(),
        ));
    }
    
    parts
}

/// 按语义边界分块
fn split_text_semantically(text: &str, config: &ChunkConfig) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    
    // 尝试按句子边界分割
    let sentences = split_by_sentences(text);
    
    let mut current_chunk = String::new();
    let mut current_start = 0;
    
    for sentence in sentences {
        if current_chunk.chars().count() + sentence.chars().count() > config.max_chunk_size {
            // 当前块已满，保存并开始新块
            if current_chunk.chars().count() >= config.min_chunk_size {
                chunks.push(Chunk {
                    text: current_chunk.trim().to_string(),
                    start_char: current_start,
                    end_char: current_start + current_chunk.len(),
                    chunk_type: ChunkType::Text,
                });
                
                // 重叠窗口（使用字符迭代）
                let overlap_chars: String = current_chunk.chars()
                    .skip(current_chunk.chars().count().saturating_sub(config.overlap_size))
                    .collect();
                current_chunk = overlap_chars;
                current_start += current_chunk.len();
            }
        }
        
        current_chunk.push_str(&sentence);
        current_chunk.push(' ');
    }
    
    // 添加最后一个块
    if current_chunk.len() >= config.min_chunk_size {
        chunks.push(Chunk {
            text: current_chunk.trim().to_string(),
            start_char: current_start,
            end_char: current_start + current_chunk.len(),
            chunk_type: ChunkType::Text,
        });
    } else if !chunks.is_empty() {
        // 合并到前一个块
        if let Some(last) = chunks.last_mut() {
            last.text.push_str(" ");
            last.text.push_str(&current_chunk);
            last.end_char = last.start_char + last.text.len();
        }
    }
    
    chunks
}

/// 按句子分割
fn split_by_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    
    for ch in text.chars() {
        current.push(ch);
        
        if ch == '"' || ch == '"' || ch == '"' {
            in_quote = !in_quote;
        }
        
        // 句子结束标记
        let sentence_ends = ['。', '！', '？', '.', '!', '?'];
        if !in_quote && sentence_ends.contains(&ch) {
            let trimmed = current.trim().to_string();
            current.clear();
            sentences.push(trimmed);
        }
    }
    
    // 添加剩余部分
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        sentences.push(trimmed);
    }
    
    sentences
}

/// 智能分块器
pub fn chunk_message(content: &str, config: &ChunkConfig) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    
    // 空内容处理
    if content.trim().is_empty() {
        return chunks;
    }
    
    // 短文本直接作为单个块
    if content.len() <= config.max_chunk_size {
        chunks.push(Chunk {
            text: content.to_string(),
            start_char: 0,
            end_char: content.len(),
            chunk_type: ChunkType::Text,
        });
        return chunks;
    }
    
    // 1. 识别代码块，单独处理
    let code_blocks = extract_code_blocks(content);
    
    // 2. 非代码部分按语义边界分块
    let text_parts = split_by_code_blocks(content, &code_blocks);
    
    for (part_text, start, _) in text_parts {
        if part_text.trim().is_empty() {
            continue;
        }
        let sub_chunks = split_text_semantically(&part_text, config);
        for mut chunk in sub_chunks {
            chunk.start_char += start;
            chunk.end_char += start;
            chunks.push(chunk);
        }
    }
    
    // 3. 代码块作为独立分块
    for code in code_blocks {
        chunks.push(Chunk {
            text: code.content.trim().to_string(),
            start_char: code.start,
            end_char: code.end,
            chunk_type: ChunkType::Code { language: code.language },
        });
    }
    
    // 按起始位置排序
    chunks.sort_by_key(|c| c.start_char);
    
    chunks
}

/// 简单消息结构用于 Q&A 配对
#[derive(Debug, Clone)]
pub struct SimpleMessage {
    pub id: String,
    pub role: String,
    pub content: String,
}

/// 识别 Q&A 对并合并为单个分块
pub fn merge_qa_pairs(messages: &[SimpleMessage]) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let mut i = 0;
    
    while i < messages.len() {
        let msg = &messages[i];
        
        if msg.role == "user" && i + 1 < messages.len() && messages[i + 1].role == "assistant" {
            // Q&A 对合并
            let qa_text = format!(
                "问题：{}\n\n回答：{}",
                msg.content,
                messages[i + 1].content
            );
            let qa_len = qa_text.len();
            chunks.push(Chunk {
                text: qa_text,
                start_char: 0,
                end_char: qa_len,
                chunk_type: ChunkType::QaPair,
            });
            i += 2;
        } else {
            // 单独处理
            let sub_chunks = chunk_message(&msg.content, &ChunkConfig::default());
            chunks.extend(sub_chunks);
            i += 1;
        }
    }
    
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_extract_code_blocks() {
        let content = "这是普通文本\n```python\nprint('hello')\n```\n更多文本";
        let blocks = extract_code_blocks(content);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].language, Some("python".to_string()));
    }
    
    #[test]
    fn test_chunk_message() {
        let content = "这是一个很长的文本内容，需要进行分块处理。".repeat(50);
        let config = ChunkConfig::default();
        let chunks = chunk_message(&content, &config);
        assert!(!chunks.is_empty());
    }
    
    #[test]
    fn test_short_content() {
        let content = "短文本";
        let chunks = chunk_message(content, &ChunkConfig::default());
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "短文本");
    }
    
    #[test]
    fn test_merge_qa_pairs() {
        let messages = vec![
            SimpleMessage {
                id: "1".to_string(),
                role: "user".to_string(),
                content: "什么是 Rust?".to_string(),
            },
            SimpleMessage {
                id: "2".to_string(),
                role: "assistant".to_string(),
                content: "Rust 是系统编程语言。".to_string(),
            },
        ];
        let chunks = merge_qa_pairs(&messages);
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].text.contains("问题："));
        assert!(chunks[0].text.contains("回答："));
    }
}
