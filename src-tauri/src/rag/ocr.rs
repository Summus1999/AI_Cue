use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OcrContentFormat {
    Pdf,
    Png,
    Jpeg,
    Webp,
    Bmp,
    Tiff,
    Other(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrPageInput {
    pub source_path: String,
    pub page_number: u32,
    pub content_bytes: Vec<u8>,
    #[serde(default)]
    pub content_format: Option<OcrContentFormat>,
    #[serde(default)]
    pub language_hints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrTextLine {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrPageResult {
    pub source_path: String,
    pub page_number: u32,
    pub full_text: String,
    pub lines: Vec<OcrTextLine>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub average_confidence: Option<f32>,
    pub engine_id: String,
}

impl OcrPageResult {
    pub fn from_lines(
        source_path: impl Into<String>,
        page_number: u32,
        lines: Vec<OcrTextLine>,
        engine_id: impl Into<String>,
    ) -> Self {
        let full_text = lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        let confidences = lines
            .iter()
            .filter_map(|line| line.confidence)
            .collect::<Vec<_>>();
        let average_confidence = (!confidences.is_empty()).then(|| {
            confidences.iter().copied().sum::<f32>() / confidences.len() as f32
        });

        Self {
            source_path: source_path.into(),
            page_number,
            full_text,
            lines,
            average_confidence,
            engine_id: engine_id.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum OcrError {
    Disabled(String),
    Unavailable(String),
    InvalidInput(String),
    Timeout(String),
    Engine(String),
}

impl std::fmt::Display for OcrError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Disabled(message) => write!(f, "OCR 已禁用: {message}"),
            Self::Unavailable(message) => write!(f, "OCR 不可用: {message}"),
            Self::InvalidInput(message) => write!(f, "OCR 输入无效: {message}"),
            Self::Timeout(message) => write!(f, "OCR 超时: {message}"),
            Self::Engine(message) => write!(f, "OCR 引擎错误: {message}"),
        }
    }
}

impl std::error::Error for OcrError {}

#[async_trait]
pub trait OcrEngine: Send + Sync {
    async fn recognize_page(&self, input: OcrPageInput) -> Result<OcrPageResult, OcrError>;

    fn engine_id(&self) -> &str;

    fn is_available(&self) -> bool {
        true
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnavailableOcrEngine {
    engine_id: String,
    reason: String,
}

impl UnavailableOcrEngine {
    pub fn new(engine_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            engine_id: engine_id.into(),
            reason: reason.into(),
        }
    }
}

impl Default for UnavailableOcrEngine {
    fn default() -> Self {
        Self::new("unavailable", "当前环境未配置 OCR 引擎")
    }
}

#[async_trait]
impl OcrEngine for UnavailableOcrEngine {
    async fn recognize_page(&self, input: OcrPageInput) -> Result<OcrPageResult, OcrError> {
        if input.source_path.trim().is_empty() {
            return Err(OcrError::InvalidInput("sourcePath 不能为空".to_string()));
        }

        if input.page_number == 0 {
            return Err(OcrError::InvalidInput("pageNumber 必须从 1 开始".to_string()));
        }

        if input.content_bytes.is_empty() {
            return Err(OcrError::InvalidInput(
                "contentBytes 不能为空".to_string(),
            ));
        }

        Err(OcrError::Unavailable(self.reason.clone()))
    }

    fn engine_id(&self) -> &str {
        &self.engine_id
    }

    fn is_available(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ocr_page_result_from_lines_builds_full_text_and_average_confidence() {
        let result = OcrPageResult::from_lines(
            "C:\\docs\\scan.pdf",
            3,
            vec![
                OcrTextLine {
                    text: "Hello".to_string(),
                    confidence: Some(0.8),
                },
                OcrTextLine {
                    text: "World".to_string(),
                    confidence: Some(0.6),
                },
            ],
            "mock-ocr",
        );

        assert_eq!(result.source_path, "C:\\docs\\scan.pdf");
        assert_eq!(result.page_number, 3);
        assert_eq!(result.full_text, "Hello\nWorld");
        let average_confidence = result.average_confidence.unwrap();
        assert!((average_confidence - 0.7).abs() < 1e-6);
        assert_eq!(result.engine_id, "mock-ocr");
    }

    #[tokio::test]
    async fn unavailable_ocr_engine_returns_unavailable_error_for_valid_input() {
        let engine = UnavailableOcrEngine::new("noop-ocr", "OCR runtime not installed");

        let error = engine
            .recognize_page(OcrPageInput {
                source_path: "C:\\docs\\scan.pdf".to_string(),
                page_number: 1,
                content_bytes: vec![1, 2, 3],
                content_format: Some(OcrContentFormat::Png),
                language_hints: vec!["zh".to_string(), "en".to_string()],
            })
            .await
            .unwrap_err();

        assert_eq!(engine.engine_id(), "noop-ocr");
        assert!(!engine.is_available());
        assert_eq!(
            error,
            OcrError::Unavailable("OCR runtime not installed".to_string())
        );
    }

    #[tokio::test]
    async fn unavailable_ocr_engine_validates_input_before_unavailable_error() {
        let engine = UnavailableOcrEngine::default();

        let error = engine
            .recognize_page(OcrPageInput {
                source_path: String::new(),
                page_number: 0,
                content_bytes: Vec::new(),
                content_format: None,
                language_hints: Vec::new(),
            })
            .await
            .unwrap_err();

        assert_eq!(
            error,
            OcrError::InvalidInput("sourcePath 不能为空".to_string())
        );
    }
}
