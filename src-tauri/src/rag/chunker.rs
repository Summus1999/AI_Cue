use serde::{Deserialize, Serialize};

use super::parser::{BlockKind, DocumentType, ParsedBlock, ParsedDocument};

/// 分块配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkConfig {
    /// 最大分块字符数
    pub max_chunk_size: usize,
    /// 重叠窗口大小
    pub overlap_size: usize,
    /// 最小分块大小
    pub min_chunk_size: usize,
    /// 文档分块时是否优先按结构边界切分
    pub prefer_structure_boundary: bool,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            max_chunk_size: 512,
            overlap_size: 50,
            min_chunk_size: 100,
            prefer_structure_boundary: false,
        }
    }
}

impl ChunkConfig {
    pub fn document_default() -> Self {
        Self {
            max_chunk_size: 1200,
            overlap_size: 120,
            min_chunk_size: 180,
            prefer_structure_boundary: true,
        }
    }
}

/// 分块类型
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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

/// 消息级分块
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// 文档级分块
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChunk {
    pub chunk_index: usize,
    pub text: String,
    pub chunk_type: ChunkType,
    pub source_path: String,
    pub file_name: String,
    pub title: String,
    pub document_type: DocumentType,
    pub heading_path: Vec<String>,
    pub page_number: Option<u32>,
    pub language: Option<String>,
    pub start_offset: usize,
    pub end_offset: usize,
    pub block_count: usize,
}

/// 代码块结构
struct CodeBlock {
    content: String,
    language: Option<String>,
    start: usize,
    end: usize,
}

#[derive(Debug)]
struct PendingDocumentChunk {
    text_parts: Vec<String>,
    heading_path: Vec<String>,
    page_number: Option<u32>,
    start_offset: usize,
    end_offset: usize,
    block_count: usize,
}

#[derive(Debug)]
struct TextWindow {
    text: String,
    start_offset: usize,
    end_offset: usize,
}

/// 提取代码块
fn extract_code_blocks(content: &str) -> Vec<CodeBlock> {
    let mut blocks = Vec::new();
    let mut in_code_block = false;
    let mut current_block = String::new();
    let mut language = None;
    let mut block_start = 0;
    let lines = lines_with_offsets(content);

    for (_, line, line_start, line_end) in lines {
        if line.trim_start().starts_with("```") {
            if in_code_block {
                blocks.push(CodeBlock {
                    content: current_block.clone(),
                    language: language.clone(),
                    start: block_start,
                    end: line_end,
                });
                current_block.clear();
                language = None;
                in_code_block = false;
            } else {
                in_code_block = true;
                block_start = line_start;
                let lang = line.trim_start().trim_start_matches("```").trim();
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
            parts.push((
                content[last_end..block.start].to_string(),
                last_end,
                block.start,
            ));
        }
        last_end = block.end;
    }

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
fn split_text_windows(text: &str, base_offset: usize, config: &ChunkConfig) -> Vec<TextWindow> {
    let mut windows = Vec::new();
    let sentences = split_by_sentences(text);

    if sentences.is_empty() {
        return windows;
    }

    let mut current_chunk = String::new();
    let mut current_start = base_offset;
    let mut cursor = base_offset;

    for sentence in sentences {
        let sentence_len = sentence.len();
        let current_chars = current_chunk.chars().count();
        let sentence_chars = sentence.chars().count();

        if current_chars > 0 && current_chars + sentence_chars > config.max_chunk_size {
            if current_chars >= config.min_chunk_size {
                let chunk_text = current_chunk.trim().to_string();
                let chunk_end = current_start + chunk_text.len();
                windows.push(TextWindow {
                    text: chunk_text.clone(),
                    start_offset: current_start,
                    end_offset: chunk_end,
                });

                let overlap_text = tail_overlap(&chunk_text, config.overlap_size);
                current_start = chunk_end.saturating_sub(overlap_text.len());
                current_chunk = overlap_text;
            }
        }

        if current_chunk.is_empty() {
            current_start = cursor;
        }

        current_chunk.push_str(&sentence);
        if !sentence.ends_with('\n') {
            current_chunk.push(' ');
        }
        cursor += sentence_len + 1;
    }

    let final_text = current_chunk.trim().to_string();
    if !final_text.is_empty() {
        if final_text.chars().count() >= config.min_chunk_size || windows.is_empty() {
            windows.push(TextWindow {
                text: final_text.clone(),
                start_offset: current_start,
                end_offset: current_start + final_text.len(),
            });
        } else if let Some(last) = windows.last_mut() {
            if !last.text.ends_with(' ') {
                last.text.push(' ');
            }
            last.text.push_str(&final_text);
            last.end_offset = last.start_offset + last.text.len();
        }
    }

    windows
}

fn split_code_windows(text: &str, base_offset: usize, config: &ChunkConfig) -> Vec<TextWindow> {
    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return Vec::new();
    }

    let mut windows = Vec::new();
    let overlap_lines = ((config.overlap_size / 40).max(1)).min(8);
    let mut start_line = 0usize;
    let line_offsets = line_offsets(text);

    while start_line < lines.len() {
        let mut end_line = start_line;
        let mut char_count = 0usize;

        while end_line < lines.len() {
            let next_chars = lines[end_line].chars().count() + 1;
            if char_count > 0 && char_count + next_chars > config.max_chunk_size {
                break;
            }
            char_count += next_chars;
            end_line += 1;
        }

        if end_line == start_line {
            end_line = (start_line + 1).min(lines.len());
        }

        let chunk_text = lines[start_line..end_line].join("\n").trim().to_string();
        if !chunk_text.is_empty() {
            let start_offset = base_offset + line_offsets[start_line];
            let end_offset = base_offset
                + if end_line < line_offsets.len() {
                    line_offsets[end_line]
                } else {
                    text.len()
                };
            windows.push(TextWindow {
                text: chunk_text,
                start_offset,
                end_offset,
            });
        }

        if end_line >= lines.len() {
            break;
        }

        start_line = end_line.saturating_sub(overlap_lines);
        if start_line >= end_line {
            start_line = end_line;
        }
    }

    windows
}

/// 按句子分割
fn split_by_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '。' | '！' | '？' | '.' | '!' | '?' | '\n') {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(trimmed);
            }
            current.clear();
        }
    }

    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        sentences.push(trimmed);
    }

    sentences
}

/// 智能分块器：消息内容
pub fn chunk_message(content: &str, config: &ChunkConfig) -> Vec<Chunk> {
    let mut chunks = Vec::new();

    if content.trim().is_empty() {
        return chunks;
    }

    if content.chars().count() <= config.max_chunk_size {
        chunks.push(Chunk {
            text: content.to_string(),
            start_char: 0,
            end_char: content.len(),
            chunk_type: ChunkType::Text,
        });
        return chunks;
    }

    let code_blocks = extract_code_blocks(content);
    let text_parts = split_by_code_blocks(content, &code_blocks);

    for (part_text, start, _) in text_parts {
        if part_text.trim().is_empty() {
            continue;
        }

        for window in split_text_windows(&part_text, start, config) {
            chunks.push(Chunk {
                text: window.text,
                start_char: window.start_offset,
                end_char: window.end_offset,
                chunk_type: ChunkType::Text,
            });
        }
    }

    for code in code_blocks {
        let code_text = code.content.trim().to_string();
        if code_text.is_empty() {
            continue;
        }

        if code_text.chars().count() <= config.max_chunk_size {
            chunks.push(Chunk {
                text: code_text,
                start_char: code.start,
                end_char: code.end,
                chunk_type: ChunkType::Code {
                    language: code.language,
                },
            });
            continue;
        }

        for window in split_code_windows(&code_text, code.start, config) {
            chunks.push(Chunk {
                text: window.text,
                start_char: window.start_offset,
                end_char: window.end_offset,
                chunk_type: ChunkType::Code {
                    language: code.language.clone(),
                },
            });
        }
    }

    chunks.sort_by_key(|chunk| chunk.start_char);
    chunks
}

/// 文档级结构化分块
pub fn chunk_document(document: &ParsedDocument, config: &ChunkConfig) -> Vec<DocumentChunk> {
    let mut chunks = Vec::new();
    let mut pending: Option<PendingDocumentChunk> = None;

    for block in &document.blocks {
        let block_text = render_block_text(block);
        if block_text.trim().is_empty() {
            continue;
        }

        let is_code_block = matches!(block.block_kind, BlockKind::Code | BlockKind::CodeSymbol);
        if is_code_block {
            flush_pending_document_chunk(&mut chunks, &document.metadata, &mut pending);

            let code_type = ChunkType::Code {
                language: block.language.clone().or(document.metadata.language.clone()),
            };
            let windows = split_code_windows(&block_text, block.start_offset, config);
            if windows.is_empty() {
                continue;
            }

            for window in windows {
                chunks.push(DocumentChunk {
                    chunk_index: chunks.len(),
                    text: window.text,
                    chunk_type: code_type.clone(),
                    source_path: document.metadata.source_path.clone(),
                    file_name: document.metadata.file_name.clone(),
                    title: document.metadata.title.clone(),
                    document_type: document.metadata.document_type,
                    heading_path: block.heading_path.clone(),
                    page_number: block.page_number,
                    language: block.language.clone().or(document.metadata.language.clone()),
                    start_offset: window.start_offset,
                    end_offset: window.end_offset,
                    block_count: 1,
                });
            }
            continue;
        }

        let block_chars = block_text.chars().count();
        if block_chars > config.max_chunk_size {
            flush_pending_document_chunk(&mut chunks, &document.metadata, &mut pending);
            for window in split_text_windows(&block_text, block.start_offset, config) {
                chunks.push(DocumentChunk {
                    chunk_index: chunks.len(),
                    text: window.text,
                    chunk_type: ChunkType::Text,
                    source_path: document.metadata.source_path.clone(),
                    file_name: document.metadata.file_name.clone(),
                    title: document.metadata.title.clone(),
                    document_type: document.metadata.document_type,
                    heading_path: block.heading_path.clone(),
                    page_number: block.page_number,
                    language: block.language.clone().or(document.metadata.language.clone()),
                    start_offset: window.start_offset,
                    end_offset: window.end_offset,
                    block_count: 1,
                });
            }
            continue;
        }

        if should_flush_before_block(pending.as_ref(), block, &block_text, config) {
            flush_pending_document_chunk(&mut chunks, &document.metadata, &mut pending);
        }

        match pending.as_mut() {
            Some(current) => {
                current.text_parts.push(block_text);
                current.end_offset = block.end_offset;
                current.block_count += 1;
            }
            None => {
                pending = Some(PendingDocumentChunk {
                    text_parts: vec![block_text],
                    heading_path: block.heading_path.clone(),
                    page_number: block.page_number,
                    start_offset: block.start_offset,
                    end_offset: block.end_offset,
                    block_count: 1,
                });
            }
        }
    }

    flush_pending_document_chunk(&mut chunks, &document.metadata, &mut pending);
    chunks
}

fn should_flush_before_block(
    pending: Option<&PendingDocumentChunk>,
    block: &ParsedBlock,
    block_text: &str,
    config: &ChunkConfig,
) -> bool {
    let Some(pending) = pending else {
        return false;
    };

    if config.prefer_structure_boundary
        && (pending.heading_path != block.heading_path || pending.page_number != block.page_number)
    {
        return true;
    }

    let current_len = pending
        .text_parts
        .iter()
        .map(|part| part.chars().count())
        .sum::<usize>()
        + pending.text_parts.len().saturating_sub(1) * 2;
    let next_len = current_len + block_text.chars().count() + 2;
    next_len > config.max_chunk_size
}

fn flush_pending_document_chunk(
    chunks: &mut Vec<DocumentChunk>,
    metadata: &super::parser::ParsedDocumentMetadata,
    pending: &mut Option<PendingDocumentChunk>,
) {
    if let Some(pending_chunk) = pending.take() {
        let text = pending_chunk
            .text_parts
            .join("\n\n")
            .trim()
            .to_string();
        if text.is_empty() {
            return;
        }

        chunks.push(DocumentChunk {
            chunk_index: chunks.len(),
            text,
            chunk_type: ChunkType::Text,
            source_path: metadata.source_path.clone(),
            file_name: metadata.file_name.clone(),
            title: metadata.title.clone(),
            document_type: metadata.document_type,
            heading_path: pending_chunk.heading_path,
            page_number: pending_chunk.page_number,
            language: metadata.language.clone(),
            start_offset: pending_chunk.start_offset,
            end_offset: pending_chunk.end_offset,
            block_count: pending_chunk.block_count,
        });
    }
}

fn render_block_text(block: &ParsedBlock) -> String {
    match block.block_kind {
        BlockKind::Heading => {
            let level = block.heading_path.len().max(1);
            format!("{} {}", "#".repeat(level), block.text.trim())
        }
        BlockKind::Code | BlockKind::CodeSymbol => {
            let mut rendered = String::new();
            rendered.push_str("```");
            if let Some(language) = &block.language {
                rendered.push_str(language);
            }
            rendered.push('\n');
            if let Some(symbol) = &block.symbol {
                rendered.push_str(&format!("// symbol: {}\n", symbol));
            }
            rendered.push_str(block.text.trim());
            rendered.push_str("\n```");
            rendered
        }
        _ => block.text.trim().to_string(),
    }
}

fn tail_overlap(text: &str, overlap_size: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    let start = chars.len().saturating_sub(overlap_size);
    chars[start..].iter().collect::<String>()
}

fn lines_with_offsets(content: &str) -> Vec<(usize, &str, usize, usize)> {
    let mut result = Vec::new();
    let mut start = 0usize;

    for (idx, line) in content.lines().enumerate() {
        let end = start + line.len();
        result.push((idx, line, start, end));
        start = end + 1;
    }

    result
}

fn line_offsets(text: &str) -> Vec<usize> {
    let mut offsets = vec![0usize];
    for (idx, ch) in text.char_indices() {
        if ch == '\n' {
            offsets.push(idx + 1);
        }
    }
    offsets.push(text.len());
    offsets
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
    let mut cursor = 0usize;
    let mut i = 0usize;

    while i < messages.len() {
        let msg = &messages[i];

        if msg.role == "user" && i + 1 < messages.len() && messages[i + 1].role == "assistant" {
            let qa_text = format!("问题：{}\n\n回答：{}", msg.content, messages[i + 1].content);
            let qa_len = qa_text.len();
            chunks.push(Chunk {
                text: qa_text,
                start_char: cursor,
                end_char: cursor + qa_len,
                chunk_type: ChunkType::QaPair,
            });
            cursor += qa_len;
            i += 2;
        } else {
            let sub_chunks = chunk_message(&msg.content, &ChunkConfig::default());
            for mut chunk in sub_chunks {
                chunk.start_char += cursor;
                chunk.end_char += cursor;
                chunks.push(chunk);
            }
            cursor += msg.content.len();
            i += 1;
        }
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::parser::{BlockKind, DocumentType, ParsedDocument, ParsedDocumentMetadata};

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

    #[test]
    fn test_chunk_document_preserves_heading_path() {
        let document = ParsedDocument {
            metadata: ParsedDocumentMetadata {
                source_path: "C:/demo.md".to_string(),
                file_name: "demo.md".to_string(),
                extension: Some("md".to_string()),
                title: "演示文档".to_string(),
                document_type: DocumentType::Markdown,
                byte_size: 128,
                language: Some("markdown".to_string()),
            },
            blocks: vec![
                ParsedBlock {
                    index: 0,
                    block_kind: BlockKind::Heading,
                    text: "第一章".to_string(),
                    heading_path: vec!["第一章".to_string()],
                    page_number: None,
                    language: None,
                    symbol: None,
                    start_offset: 0,
                    end_offset: 5,
                    line_start: Some(1),
                    line_end: Some(1),
                },
                ParsedBlock {
                    index: 1,
                    block_kind: BlockKind::Paragraph,
                    text: "这里是正文。".to_string(),
                    heading_path: vec!["第一章".to_string()],
                    page_number: None,
                    language: None,
                    symbol: None,
                    start_offset: 6,
                    end_offset: 12,
                    line_start: Some(2),
                    line_end: Some(2),
                },
            ],
            total_chars: 12,
            total_pages: None,
        };

        let chunks = chunk_document(&document, &ChunkConfig::document_default());
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].heading_path, vec!["第一章".to_string()]);
        assert!(chunks[0].text.contains("第一章"));
        assert!(chunks[0].text.contains("这里是正文"));
    }

    #[test]
    fn test_chunk_document_splits_large_code_block() {
        let code = (0..200)
            .map(|idx| format!("fn part_{}() {{ println!(\"{}\"); }}", idx, idx))
            .collect::<Vec<String>>()
            .join("\n");
        let document = ParsedDocument {
            metadata: ParsedDocumentMetadata {
                source_path: "C:/demo.rs".to_string(),
                file_name: "demo.rs".to_string(),
                extension: Some("rs".to_string()),
                title: "demo".to_string(),
                document_type: DocumentType::Code,
                byte_size: 2048,
                language: Some("rust".to_string()),
            },
            blocks: vec![ParsedBlock {
                index: 0,
                block_kind: BlockKind::Code,
                text: code,
                heading_path: Vec::new(),
                page_number: None,
                language: Some("rust".to_string()),
                symbol: Some("part_0".to_string()),
                start_offset: 0,
                end_offset: 2048,
                line_start: Some(1),
                line_end: Some(200),
            }],
            total_chars: 2048,
            total_pages: None,
        };

        let chunks = chunk_document(&document, &ChunkConfig::document_default());
        assert!(chunks.len() > 1);
        assert!(matches!(chunks[0].chunk_type, ChunkType::Code { .. }));
    }
}
