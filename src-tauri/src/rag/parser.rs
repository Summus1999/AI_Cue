use std::fs;
use std::path::Path;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentType {
    Markdown,
    Pdf,
    PlainText,
    Code,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockKind {
    Heading,
    Paragraph,
    List,
    Quote,
    Code,
    CodeSymbol,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseOptions {
    pub max_file_size_bytes: u64,
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self {
            max_file_size_bytes: 10 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDocumentMetadata {
    pub source_path: String,
    pub file_name: String,
    pub extension: Option<String>,
    pub title: String,
    pub document_type: DocumentType,
    pub byte_size: u64,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedBlock {
    pub index: usize,
    pub block_kind: BlockKind,
    pub text: String,
    pub heading_path: Vec<String>,
    pub page_number: Option<u32>,
    pub language: Option<String>,
    pub symbol: Option<String>,
    pub start_offset: usize,
    pub end_offset: usize,
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDocument {
    pub metadata: ParsedDocumentMetadata,
    pub blocks: Vec<ParsedBlock>,
    pub total_chars: usize,
    pub total_pages: Option<u32>,
}

#[derive(Debug)]
struct PendingTextBlock {
    block_kind: BlockKind,
    lines: Vec<String>,
    heading_path: Vec<String>,
    start_offset: usize,
    end_offset: usize,
    line_start: usize,
    line_end: usize,
}

#[derive(Debug)]
struct PendingCodeBlock {
    language: Option<String>,
    lines: Vec<String>,
    heading_path: Vec<String>,
    start_offset: usize,
    line_start: usize,
    line_end: usize,
}

static CODE_SYMBOL_PATTERNS: Lazy<Vec<(Regex, usize)>> = Lazy::new(|| {
    vec![
        (Regex::new(r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)").unwrap(), 1),
        (Regex::new(r"^\s*(?:pub\s+)?(?:struct|enum|trait|mod)\s+([A-Za-z_][A-Za-z0-9_]*)").unwrap(), 1),
        (Regex::new(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)").unwrap(), 1),
        (Regex::new(r"^\s*(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)").unwrap(), 1),
        (Regex::new(r"^\s*(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)").unwrap(), 1),
        (Regex::new(r"^\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(").unwrap(), 1),
        (Regex::new(r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(").unwrap(), 1),
        (Regex::new(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)").unwrap(), 1),
        (Regex::new(r"^\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(").unwrap(), 1),
        (Regex::new(r"^\s*(?:public|private|protected|static|\s)*(?:class|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)").unwrap(), 1),
        (Regex::new(r"^\s*[A-Za-z_][A-Za-z0-9_:<>,\s*&]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*\{?\s*$").unwrap(), 1),
    ]
});

pub fn parse_document(path: &str, options: Option<ParseOptions>) -> Result<ParsedDocument, String> {
    let options = options.unwrap_or_default();
    let source_path = Path::new(path);

    if !source_path.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    if !source_path.is_file() {
        return Err(format!("不是文件: {}", path));
    }

    let metadata = fs::metadata(source_path).map_err(|e| format!("读取文件信息失败: {}", e))?;
    if metadata.len() > options.max_file_size_bytes {
        return Err(format!(
            "文件过大: {} bytes，超过限制 {} bytes",
            metadata.len(),
            options.max_file_size_bytes
        ));
    }

    let extension = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());

    let document_type = detect_document_type(source_path, extension.as_deref())?;
    match document_type {
        DocumentType::Markdown => parse_markdown_document(source_path, metadata.len(), extension),
        DocumentType::Pdf => parse_pdf_document(source_path, metadata.len(), extension),
        DocumentType::PlainText => parse_plain_text_document(source_path, metadata.len(), extension),
        DocumentType::Code => parse_code_document(source_path, metadata.len(), extension),
    }
}

fn detect_document_type(path: &Path, extension: Option<&str>) -> Result<DocumentType, String> {
    if let Some(ext) = extension {
        if matches!(ext, "md" | "markdown") {
            return Ok(DocumentType::Markdown);
        }
        if ext == "pdf" {
            return Ok(DocumentType::Pdf);
        }
        if is_code_extension(ext) {
            return Ok(DocumentType::Code);
        }
        if matches!(ext, "txt" | "text" | "log" | "csv") {
            return Ok(DocumentType::PlainText);
        }
    }

    let bytes = fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;
    if is_probably_binary(&bytes) {
        return Err(format!("暂不支持二进制文件: {}", path.display()));
    }

    Ok(DocumentType::PlainText)
}

fn parse_markdown_document(
    path: &Path,
    byte_size: u64,
    extension: Option<String>,
) -> Result<ParsedDocument, String> {
    let content = read_text_file(path)?;
    let file_name = file_name(path);
    let title_from_file = file_stem(path);

    let mut blocks = Vec::new();
    let mut heading_stack: Vec<String> = Vec::new();
    let mut pending: Option<PendingTextBlock> = None;
    let mut pending_code: Option<PendingCodeBlock> = None;
    let lines = lines_with_offsets(&content);

    for (line_idx, line, line_start, line_end) in lines {
        let trimmed = line.trim();

        if let Some(code) = pending_code.as_mut() {
            code.line_end = line_idx + 1;
            if trimmed.starts_with("```") {
                push_code_block(&mut blocks, pending_code.take(), line_end);
            } else {
                code.lines.push(line.to_string());
            }
            continue;
        }

        if trimmed.starts_with("```") {
            flush_pending_text(&mut blocks, &mut pending);
            let language = trimmed.trim_start_matches("```").trim();
            pending_code = Some(PendingCodeBlock {
                language: (!language.is_empty()).then(|| language.to_string()),
                lines: Vec::new(),
                heading_path: heading_stack.clone(),
                start_offset: line_start,
                line_start: line_idx + 1,
                line_end: line_idx + 1,
            });
            continue;
        }

        if trimmed.is_empty() {
            flush_pending_text(&mut blocks, &mut pending);
            continue;
        }

        if let Some((level, heading_text)) = parse_markdown_heading(trimmed) {
            flush_pending_text(&mut blocks, &mut pending);
            while heading_stack.len() >= level {
                heading_stack.pop();
            }
            heading_stack.push(heading_text.to_string());
            blocks.push(ParsedBlock {
                index: blocks.len(),
                block_kind: BlockKind::Heading,
                text: heading_text.to_string(),
                heading_path: heading_stack.clone(),
                page_number: None,
                language: None,
                symbol: None,
                start_offset: line_start,
                end_offset: line_end,
                line_start: Some(line_idx + 1),
                line_end: Some(line_idx + 1),
            });
            continue;
        }

        let block_kind = if is_markdown_list_item(trimmed) {
            BlockKind::List
        } else if trimmed.starts_with('>') {
            BlockKind::Quote
        } else {
            BlockKind::Paragraph
        };

        match pending.as_mut() {
            Some(current) if current.block_kind == block_kind => {
                current.lines.push(line.to_string());
                current.end_offset = line_end;
                current.line_end = line_idx + 1;
            }
            Some(_) => {
                flush_pending_text(&mut blocks, &mut pending);
                pending = Some(PendingTextBlock {
                    block_kind,
                    lines: vec![line.to_string()],
                    heading_path: heading_stack.clone(),
                    start_offset: line_start,
                    end_offset: line_end,
                    line_start: line_idx + 1,
                    line_end: line_idx + 1,
                });
            }
            None => {
                pending = Some(PendingTextBlock {
                    block_kind,
                    lines: vec![line.to_string()],
                    heading_path: heading_stack.clone(),
                    start_offset: line_start,
                    end_offset: line_end,
                    line_start: line_idx + 1,
                    line_end: line_idx + 1,
                });
            }
        }
    }

    flush_pending_text(&mut blocks, &mut pending);
    if let Some(code) = pending_code.take() {
        push_code_block(&mut blocks, Some(code), content.len());
    }

    let title = blocks
        .iter()
        .find(|block| block.block_kind == BlockKind::Heading)
        .map(|block| block.text.clone())
        .unwrap_or(title_from_file);

    Ok(ParsedDocument {
        metadata: ParsedDocumentMetadata {
            source_path: path.to_string_lossy().to_string(),
            file_name,
            extension,
            title,
            document_type: DocumentType::Markdown,
            byte_size,
            language: Some("markdown".to_string()),
        },
        total_chars: content.chars().count(),
        total_pages: None,
        blocks,
    })
}

fn parse_plain_text_document(
    path: &Path,
    byte_size: u64,
    extension: Option<String>,
) -> Result<ParsedDocument, String> {
    let content = read_text_file(path)?;
    let blocks = split_text_into_blocks(&content, BlockKind::Paragraph, Vec::new(), None);

    Ok(ParsedDocument {
        metadata: ParsedDocumentMetadata {
            source_path: path.to_string_lossy().to_string(),
            file_name: file_name(path),
            extension,
            title: file_stem(path),
            document_type: DocumentType::PlainText,
            byte_size,
            language: None,
        },
        total_chars: content.chars().count(),
        total_pages: None,
        blocks,
    })
}

fn parse_code_document(
    path: &Path,
    byte_size: u64,
    extension: Option<String>,
) -> Result<ParsedDocument, String> {
    let content = read_text_file(path)?;
    let language = extension
        .as_deref()
        .and_then(detect_code_language)
        .map(|lang| lang.to_string());
    let lines = lines_with_offsets(&content);
    let mut blocks = Vec::new();
    let mut current_lines: Vec<String> = Vec::new();
    let mut current_kind = BlockKind::Code;
    let mut current_symbol: Option<String> = None;
    let mut section_start_offset = 0usize;
    let mut section_start_line = 1usize;
    let mut section_end_offset = 0usize;
    let mut section_end_line = 1usize;
    let mut brace_balance: i32 = 0;

    for (line_idx, line, line_start, line_end) in lines {
        let trimmed = line.trim();
        let detected_symbol = detect_code_symbol(trimmed);
        let is_separator = trimmed.is_empty();
        let is_import_like = is_code_preamble(trimmed);

        if current_lines.is_empty() {
            section_start_offset = line_start;
            section_start_line = line_idx + 1;
        }

        if detected_symbol.is_some() && !current_lines.is_empty() && brace_balance <= 0 {
            flush_code_section(
                &mut blocks,
                &mut current_lines,
                current_kind,
                &mut current_symbol,
                &language,
                section_start_offset,
                section_end_offset,
                section_start_line,
                section_end_line,
            );
            current_kind = BlockKind::Code;
            brace_balance = 0;
            section_start_offset = line_start;
            section_start_line = line_idx + 1;
        } else if is_separator && !current_lines.is_empty() && brace_balance <= 0 {
            current_lines.push(line.to_string());
            section_end_offset = line_end;
            section_end_line = line_idx + 1;
            flush_code_section(
                &mut blocks,
                &mut current_lines,
                current_kind,
                &mut current_symbol,
                &language,
                section_start_offset,
                section_end_offset,
                section_start_line,
                section_end_line,
            );
            current_kind = BlockKind::Code;
            brace_balance = 0;
            continue;
        }

        if current_lines.is_empty() {
            current_kind = if detected_symbol.is_some() {
                BlockKind::CodeSymbol
            } else {
                BlockKind::Code
            };
            current_symbol = detected_symbol;
        } else if current_kind == BlockKind::Code && is_import_like {
            current_symbol = Some("preamble".to_string());
        }

        current_lines.push(line.to_string());
        section_end_offset = line_end;
        section_end_line = line_idx + 1;
        brace_balance += count_char(line, '{') as i32;
        brace_balance -= count_char(line, '}') as i32;
    }

    flush_code_section(
        &mut blocks,
        &mut current_lines,
        current_kind,
        &mut current_symbol,
        &language,
        section_start_offset,
        section_end_offset,
        section_start_line,
        section_end_line,
    );

    Ok(ParsedDocument {
        metadata: ParsedDocumentMetadata {
            source_path: path.to_string_lossy().to_string(),
            file_name: file_name(path),
            extension,
            title: file_stem(path),
            document_type: DocumentType::Code,
            byte_size,
            language,
        },
        total_chars: content.chars().count(),
        total_pages: None,
        blocks,
    })
}

fn parse_pdf_document(
    path: &Path,
    byte_size: u64,
    extension: Option<String>,
) -> Result<ParsedDocument, String> {
    let document = lopdf::Document::load(path).map_err(|e| format!("打开 PDF 失败: {}", e))?;
    let pages = document.get_pages();
    let total_pages = pages.len() as u32;
    let mut blocks = Vec::new();
    let mut total_chars = 0usize;

    for page_number in pages.keys() {
        let page_text = document
            .extract_text(&[*page_number])
            .map_err(|e| format!("提取 PDF 第 {} 页文本失败: {}", page_number, e))?;
        let normalized = normalize_pdf_text(&page_text);
        total_chars += normalized.chars().count();

        let page_blocks = split_text_into_blocks(&normalized, BlockKind::Paragraph, Vec::new(), Some(*page_number));
        if page_blocks.is_empty() && !normalized.trim().is_empty() {
            blocks.push(ParsedBlock {
                index: blocks.len(),
                block_kind: BlockKind::Paragraph,
                text: normalized.trim().to_string(),
                heading_path: Vec::new(),
                page_number: Some(*page_number),
                language: None,
                symbol: None,
                start_offset: 0,
                end_offset: normalized.len(),
                line_start: None,
                line_end: None,
            });
        } else {
            for mut block in page_blocks {
                block.index = blocks.len();
                blocks.push(block);
            }
        }
    }

    Ok(ParsedDocument {
        metadata: ParsedDocumentMetadata {
            source_path: path.to_string_lossy().to_string(),
            file_name: file_name(path),
            extension,
            title: file_stem(path),
            document_type: DocumentType::Pdf,
            byte_size,
            language: None,
        },
        total_chars,
        total_pages: Some(total_pages),
        blocks,
    })
}

fn split_text_into_blocks(
    content: &str,
    default_kind: BlockKind,
    heading_path: Vec<String>,
    page_number: Option<u32>,
) -> Vec<ParsedBlock> {
    let mut blocks = Vec::new();
    let mut current_start = 0usize;
    let mut line_start = 1usize;
    let mut line_end = 1usize;
    let mut lines = Vec::new();

    for (idx, line, start, end) in lines_with_offsets(content) {
        if line.trim().is_empty() {
            if !lines.is_empty() {
                blocks.push(ParsedBlock {
                    index: blocks.len(),
                    block_kind: default_kind,
                    text: lines.join("\n").trim().to_string(),
                    heading_path: heading_path.clone(),
                    page_number,
                    language: None,
                    symbol: None,
                    start_offset: current_start,
                    end_offset: start,
                    line_start: Some(line_start),
                    line_end: Some(line_end),
                });
                lines.clear();
            }
            continue;
        }

        if lines.is_empty() {
            current_start = start;
            line_start = idx + 1;
        }
        lines.push(line.to_string());
        line_end = idx + 1;
        let _ = end;
    }

    if !lines.is_empty() {
        blocks.push(ParsedBlock {
            index: blocks.len(),
            block_kind: default_kind,
            text: lines.join("\n").trim().to_string(),
            heading_path,
            page_number,
            language: None,
            symbol: None,
            start_offset: current_start,
            end_offset: content.len(),
            line_start: Some(line_start),
            line_end: Some(line_end),
        });
    }

    blocks
}

fn flush_pending_text(blocks: &mut Vec<ParsedBlock>, pending: &mut Option<PendingTextBlock>) {
    if let Some(pending_block) = pending.take() {
        let text = pending_block.lines.join("\n").trim().to_string();
        if text.is_empty() {
            return;
        }

        blocks.push(ParsedBlock {
            index: blocks.len(),
            block_kind: pending_block.block_kind,
            text,
            heading_path: pending_block.heading_path,
            page_number: None,
            language: None,
            symbol: None,
            start_offset: pending_block.start_offset,
            end_offset: pending_block.end_offset,
            line_start: Some(pending_block.line_start),
            line_end: Some(pending_block.line_end),
        });
    }
}

fn push_code_block(blocks: &mut Vec<ParsedBlock>, code: Option<PendingCodeBlock>, end_offset: usize) {
    if let Some(code_block) = code {
        let text = code_block.lines.join("\n").trim().to_string();
        if text.is_empty() {
            return;
        }

        blocks.push(ParsedBlock {
            index: blocks.len(),
            block_kind: BlockKind::Code,
            text,
            heading_path: code_block.heading_path,
            page_number: None,
            language: code_block.language.clone(),
            symbol: None,
            start_offset: code_block.start_offset,
            end_offset,
            line_start: Some(code_block.line_start),
            line_end: Some(code_block.line_end),
        });
    }
}

fn flush_code_section(
    blocks: &mut Vec<ParsedBlock>,
    current_lines: &mut Vec<String>,
    current_kind: BlockKind,
    current_symbol: &mut Option<String>,
    language: &Option<String>,
    section_start_offset: usize,
    section_end_offset: usize,
    section_start_line: usize,
    section_end_line: usize,
) {
    if current_lines.is_empty() {
        return;
    }

    let lines = std::mem::take(current_lines);
    let symbol = current_symbol.take();
    let text = lines.join("\n").trim().to_string();
    if text.is_empty() {
        return;
    }

    blocks.push(ParsedBlock {
        index: blocks.len(),
        block_kind: current_kind,
        text,
        heading_path: symbol.clone().map(|name| vec![name]).unwrap_or_default(),
        page_number: None,
        language: language.clone(),
        symbol,
        start_offset: section_start_offset,
        end_offset: section_end_offset,
        line_start: Some(section_start_line),
        line_end: Some(section_end_line),
    });
}

fn parse_markdown_heading(line: &str) -> Option<(usize, &str)> {
    let level = line.chars().take_while(|ch| *ch == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }

    let text = line[level..].trim();
    if text.is_empty() {
        return None;
    }

    Some((level, text))
}

fn is_markdown_list_item(line: &str) -> bool {
    line.starts_with("- ")
        || line.starts_with("* ")
        || line.starts_with("+ ")
        || Regex::new(r"^\d+\.\s+").unwrap().is_match(line)
}

fn is_code_extension(ext: &str) -> bool {
    matches!(
        ext,
        "rs"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "py"
            | "java"
            | "go"
            | "c"
            | "cpp"
            | "cc"
            | "h"
            | "hpp"
            | "cs"
            | "json"
            | "yaml"
            | "yml"
            | "toml"
            | "sql"
            | "sh"
    )
}

fn detect_code_language(ext: &str) -> Option<&'static str> {
    match ext {
        "rs" => Some("rust"),
        "ts" => Some("typescript"),
        "tsx" => Some("tsx"),
        "js" => Some("javascript"),
        "jsx" => Some("jsx"),
        "py" => Some("python"),
        "java" => Some("java"),
        "go" => Some("go"),
        "c" => Some("c"),
        "cpp" | "cc" => Some("cpp"),
        "h" | "hpp" => Some("cpp"),
        "cs" => Some("csharp"),
        "json" => Some("json"),
        "yaml" | "yml" => Some("yaml"),
        "toml" => Some("toml"),
        "sql" => Some("sql"),
        "sh" => Some("shell"),
        _ => None,
    }
}

fn detect_code_symbol(line: &str) -> Option<String> {
    CODE_SYMBOL_PATTERNS.iter().find_map(|(regex, capture_idx)| {
        regex
            .captures(line)
            .and_then(|caps| caps.get(*capture_idx).map(|symbol| symbol.as_str().to_string()))
    })
}

fn is_code_preamble(line: &str) -> bool {
    line.starts_with("use ")
        || line.starts_with("import ")
        || line.starts_with("export ")
        || line.starts_with("#include")
        || line.starts_with("package ")
        || line.starts_with("from ")
}

fn lines_with_offsets(content: &str) -> Vec<(usize, &str, usize, usize)> {
    let mut result = Vec::new();
    let mut start = 0usize;

    for (idx, line) in content.lines().enumerate() {
        let end = start + line.len();
        result.push((idx, line, start, end));
        start = end + 1;
    }

    if content.ends_with('\n') {
        return result;
    }

    result
}

fn read_text_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;
    if is_probably_binary(&bytes) {
        return Err(format!("文件不是有效的文本格式: {}", path.display()));
    }

    String::from_utf8(bytes)
        .or_else(|err| Ok(String::from_utf8_lossy(err.as_bytes()).to_string()))
        .map(|content| content.replace("\r\n", "\n"))
}

fn normalize_pdf_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<&str>>()
        .join("\n")
}

fn is_probably_binary(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }

    if bytes.contains(&0) {
        return true;
    }

    let suspicious = bytes
        .iter()
        .filter(|byte| {
            !matches!(**byte, 0x09 | 0x0A | 0x0D)
                && (**byte < 0x20 || **byte == 0x7F)
        })
        .count();
    suspicious * 10 > bytes.len()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string()
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("未命名文档")
        .to_string()
}

fn count_char(line: &str, target: char) -> usize {
    line.chars().filter(|ch| *ch == target).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_markdown_heading_parse() {
        assert_eq!(parse_markdown_heading("## 标题"), Some((2, "标题")));
        assert_eq!(parse_markdown_heading("普通文本"), None);
    }

    #[test]
    fn test_binary_detection() {
        assert!(is_probably_binary(&[0, 1, 2, 3]));
        assert!(!is_probably_binary("hello\nworld".as_bytes()));
    }

    #[test]
    fn test_detect_code_symbol() {
        assert_eq!(detect_code_symbol("pub fn parse_document() -> Result<()> {"), Some("parse_document".to_string()));
        assert_eq!(detect_code_symbol("class Parser {"), Some("Parser".to_string()));
        assert_eq!(detect_code_symbol("plain text"), None);
    }
}
