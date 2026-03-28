use async_trait::async_trait;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;

const WINDOWS_OCR_ENGINE_ID: &str = "windows-media-ocr";

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
        let average_confidence = (!confidences.is_empty())
            .then(|| confidences.iter().copied().sum::<f32>() / confidences.len() as f32);

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
        validate_ocr_input(&input)?;
        Err(OcrError::Unavailable(self.reason.clone()))
    }

    fn engine_id(&self) -> &str {
        &self.engine_id
    }

    fn is_available(&self) -> bool {
        false
    }
}

fn validate_ocr_input(input: &OcrPageInput) -> Result<(), OcrError> {
    if input.source_path.trim().is_empty() {
        return Err(OcrError::InvalidInput("sourcePath 不能为空".to_string()));
    }

    if input.page_number == 0 {
        return Err(OcrError::InvalidInput(
            "pageNumber 必须从 1 开始".to_string(),
        ));
    }

    if input.content_bytes.is_empty() {
        return Err(OcrError::InvalidInput("contentBytes 不能为空".to_string()));
    }

    Ok(())
}

fn normalize_text(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn primary_language_tag(tag: &str) -> &str {
    tag.split('-').next().unwrap_or(tag)
}

fn normalize_language_tag(tag: &str) -> Option<String> {
    let normalized = tag.trim().replace('_', "-").to_ascii_lowercase();
    (!normalized.is_empty()).then_some(normalized)
}

fn infer_content_format(
    source_path: &str,
    explicit: Option<&OcrContentFormat>,
) -> OcrContentFormat {
    if let Some(format) = explicit {
        return format.clone();
    }

    let Some(extension) = Path::new(source_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    else {
        return OcrContentFormat::Other("unknown".to_string());
    };

    match extension.as_str() {
        "pdf" => OcrContentFormat::Pdf,
        "png" => OcrContentFormat::Png,
        "jpg" | "jpeg" => OcrContentFormat::Jpeg,
        "webp" => OcrContentFormat::Webp,
        "bmp" => OcrContentFormat::Bmp,
        "tif" | "tiff" => OcrContentFormat::Tiff,
        other => OcrContentFormat::Other(other.to_string()),
    }
}

fn create_unavailable_default_engine(reason: impl Into<String>) -> Arc<dyn OcrEngine> {
    Arc::new(UnavailableOcrEngine::new(
        WINDOWS_OCR_ENGINE_ID,
        reason.into(),
    ))
}

#[cfg(target_os = "windows")]
#[derive(Clone)]
struct SupportedOcrLanguage {
    tag: String,
    primary_tag: String,
    language: windows::Globalization::Language,
}

#[cfg(target_os = "windows")]
#[derive(Clone)]
struct WindowsOcrEngine {
    supported_languages: Vec<SupportedOcrLanguage>,
}

#[cfg(target_os = "windows")]
impl WindowsOcrEngine {
    fn new() -> Result<Self, OcrError> {
        let languages = windows::Media::Ocr::OcrEngine::AvailableRecognizerLanguages()
            .map_err(|error| map_winrt_error(error, "读取系统 OCR 语言列表失败"))?;

        let mut supported_languages = Vec::new();
        for language in languages {
            let tag = normalize_language_tag(
                &language
                    .LanguageTag()
                    .map_err(|error| map_winrt_error(error, "读取 OCR 语言标签失败"))?
                    .to_string(),
            )
            .ok_or_else(|| OcrError::Unavailable("系统 OCR 语言标签为空".to_string()))?;

            supported_languages.push(SupportedOcrLanguage {
                primary_tag: primary_language_tag(&tag).to_string(),
                tag,
                language,
            });
        }

        if supported_languages.is_empty() {
            return Err(OcrError::Unavailable(
                "系统未安装任何 Windows OCR 语言包".to_string(),
            ));
        }

        Ok(Self {
            supported_languages,
        })
    }

    fn resolve_runtime_engine(
        &self,
        language_hints: &[String],
    ) -> Result<windows::Media::Ocr::OcrEngine, OcrError> {
        if let Some(language) = self.select_language(language_hints) {
            return windows::Media::Ocr::OcrEngine::TryCreateFromLanguage(&language.language)
                .map_err(|error| {
                    map_winrt_error(
                        error,
                        &format!("按语言提示 {} 创建 OCR 引擎失败", language.tag),
                    )
                });
        }

        match windows::Media::Ocr::OcrEngine::TryCreateFromUserProfileLanguages() {
            Ok(engine) => Ok(engine),
            Err(user_profile_error) => {
                let Some(fallback_language) = self.supported_languages.first() else {
                    return Err(OcrError::Unavailable(
                        "系统未安装任何 Windows OCR 语言包".to_string(),
                    ));
                };

                windows::Media::Ocr::OcrEngine::TryCreateFromLanguage(&fallback_language.language)
                    .map_err(|fallback_error| {
                        OcrError::Unavailable(format!(
                            "用户语言未配置可用 OCR 包，且回退到 {} 失败: {}; {}",
                            fallback_language.tag,
                            user_profile_error.message(),
                            fallback_error.message()
                        ))
                    })
            }
        }
    }

    fn select_language(&self, language_hints: &[String]) -> Option<&SupportedOcrLanguage> {
        for hint in language_hints {
            let Some(normalized_hint) = normalize_language_tag(hint) else {
                continue;
            };

            if let Some(exact_match) = self
                .supported_languages
                .iter()
                .find(|language| language.tag == normalized_hint)
            {
                return Some(exact_match);
            }

            let hint_primary_tag = primary_language_tag(&normalized_hint);
            if let Some(primary_match) = self
                .supported_languages
                .iter()
                .find(|language| language.primary_tag == hint_primary_tag)
            {
                return Some(primary_match);
            }
        }

        None
    }

    fn recognize_page_blocking(&self, input: OcrPageInput) -> Result<OcrPageResult, OcrError> {
        match infer_content_format(&input.source_path, input.content_format.as_ref()) {
            OcrContentFormat::Pdf => self.recognize_pdf(&input),
            OcrContentFormat::Png
            | OcrContentFormat::Jpeg
            | OcrContentFormat::Webp
            | OcrContentFormat::Bmp
            | OcrContentFormat::Tiff => self.recognize_image(&input),
            OcrContentFormat::Other(format) => Err(OcrError::InvalidInput(format!(
                "当前 OCR 引擎不支持的内容格式: {format}"
            ))),
        }
    }

    fn recognize_pdf(&self, input: &OcrPageInput) -> Result<OcrPageResult, OcrError> {
        let bitmap = render_pdf_page_bitmap(&input.content_bytes, input.page_number)?;
        self.recognize_bitmap(input, bitmap)
    }

    fn recognize_image(&self, input: &OcrPageInput) -> Result<OcrPageResult, OcrError> {
        let bitmap = decode_image_bitmap(&input.content_bytes)?;
        self.recognize_bitmap(input, bitmap)
    }

    fn recognize_bitmap(
        &self,
        input: &OcrPageInput,
        bitmap: windows::Graphics::Imaging::SoftwareBitmap,
    ) -> Result<OcrPageResult, OcrError> {
        let engine = self.resolve_runtime_engine(&input.language_hints)?;
        let ocr_result = engine
            .RecognizeAsync(&bitmap)
            .map_err(|error| map_winrt_error(error, "提交 OCR 任务失败"))?
            .get()
            .map_err(|error| map_winrt_error(error, "执行 OCR 任务失败"))?;

        build_page_result(input, &ocr_result)
    }
}

#[cfg(target_os = "windows")]
#[async_trait]
impl OcrEngine for WindowsOcrEngine {
    async fn recognize_page(&self, input: OcrPageInput) -> Result<OcrPageResult, OcrError> {
        validate_ocr_input(&input)?;
        let engine = self.clone();
        tokio::task::spawn_blocking(move || engine.recognize_page_blocking(input))
            .await
            .map_err(|error| OcrError::Engine(format!("执行 OCR 后台任务失败: {error}")))?
    }

    fn engine_id(&self) -> &str {
        WINDOWS_OCR_ENGINE_ID
    }
}

#[cfg(target_os = "windows")]
fn map_winrt_error(error: windows::core::Error, context: &str) -> OcrError {
    let message = format!("{context}: {}", error.message());
    match error.code().0 as u32 {
        0x80070057 => OcrError::InvalidInput(message),
        0x800705B4 => OcrError::Timeout(message),
        0x80040154 | 0x80004002 | 0x80070490 => OcrError::Unavailable(message),
        _ => OcrError::Engine(message),
    }
}

#[cfg(target_os = "windows")]
fn build_page_result(
    input: &OcrPageInput,
    ocr_result: &windows::Media::Ocr::OcrResult,
) -> Result<OcrPageResult, OcrError> {
    let mut lines = Vec::new();
    for line in ocr_result
        .Lines()
        .map_err(|error| map_winrt_error(error, "读取 OCR 行结果失败"))?
    {
        let text = normalize_text(
            &line
                .Text()
                .map_err(|error| map_winrt_error(error, "读取 OCR 行文本失败"))?
                .to_string(),
        );
        if text.trim().is_empty() {
            continue;
        }
        lines.push(OcrTextLine {
            text,
            confidence: None,
        });
    }

    if lines.is_empty() {
        let full_text = normalize_text(
            &ocr_result
                .Text()
                .map_err(|error| map_winrt_error(error, "读取 OCR 全文失败"))?
                .to_string(),
        );
        if !full_text.trim().is_empty() {
            lines.push(OcrTextLine {
                text: full_text,
                confidence: None,
            });
        }
    }

    Ok(OcrPageResult::from_lines(
        input.source_path.clone(),
        input.page_number,
        lines,
        WINDOWS_OCR_ENGINE_ID,
    ))
}

#[cfg(target_os = "windows")]
fn decode_image_bitmap(
    content_bytes: &[u8],
) -> Result<windows::Graphics::Imaging::SoftwareBitmap, OcrError> {
    let stream = create_memory_stream(content_bytes)?;
    let decoder = windows::Graphics::Imaging::BitmapDecoder::CreateAsync(&stream)
        .map_err(|error| map_winrt_error(error, "创建图像解码器失败"))?
        .get()
        .map_err(|error| map_winrt_error(error, "等待图像解码器失败"))?;

    decoder
        .GetSoftwareBitmapConvertedAsync(
            windows::Graphics::Imaging::BitmapPixelFormat::Gray8,
            windows::Graphics::Imaging::BitmapAlphaMode::Ignore,
        )
        .map_err(|error| map_winrt_error(error, "准备 OCR 图像失败"))?
        .get()
        .map_err(|error| map_winrt_error(error, "读取 OCR 图像失败"))
}

#[cfg(target_os = "windows")]
fn render_pdf_page_bitmap(
    content_bytes: &[u8],
    page_number: u32,
) -> Result<windows::Graphics::Imaging::SoftwareBitmap, OcrError> {
    let pdf_stream = create_memory_stream(content_bytes)?;
    let document = windows::Data::Pdf::PdfDocument::LoadFromStreamAsync(&pdf_stream)
        .map_err(|error| map_winrt_error(error, "加载 PDF 失败"))?
        .get()
        .map_err(|error| map_winrt_error(error, "等待 PDF 加载失败"))?;

    let page_count = document
        .PageCount()
        .map_err(|error| map_winrt_error(error, "读取 PDF 页数失败"))?;
    if page_number > page_count {
        return Err(OcrError::InvalidInput(format!(
            "pageNumber 超出 PDF 页数范围: {} > {}",
            page_number, page_count
        )));
    }

    let page = document
        .GetPage(page_number - 1)
        .map_err(|error| map_winrt_error(error, "读取 PDF 页面失败"))?;
    let render_stream = windows::Storage::Streams::InMemoryRandomAccessStream::new()
        .map_err(|error| map_winrt_error(error, "创建 PDF 渲染缓冲区失败"))?;
    let render_options = windows::Data::Pdf::PdfPageRenderOptions::new()
        .map_err(|error| map_winrt_error(error, "创建 PDF 渲染选项失败"))?;

    let page_size = page
        .Size()
        .map_err(|error| map_winrt_error(error, "读取 PDF 页面尺寸失败"))?;
    render_options
        .SetDestinationWidth(scale_page_edge(page_size.Width))
        .map_err(|error| map_winrt_error(error, "设置 PDF 渲染宽度失败"))?;
    render_options
        .SetDestinationHeight(scale_page_edge(page_size.Height))
        .map_err(|error| map_winrt_error(error, "设置 PDF 渲染高度失败"))?;

    page.RenderWithOptionsToStreamAsync(&render_stream, &render_options)
        .map_err(|error| map_winrt_error(error, "提交 PDF 页面渲染任务失败"))?
        .get()
        .map_err(|error| map_winrt_error(error, "执行 PDF 页面渲染失败"))?;
    render_stream
        .Seek(0)
        .map_err(|error| map_winrt_error(error, "重置 PDF 渲染流失败"))?;

    let decoder = windows::Graphics::Imaging::BitmapDecoder::CreateAsync(&render_stream)
        .map_err(|error| map_winrt_error(error, "创建 PDF 渲染位图解码器失败"))?
        .get()
        .map_err(|error| map_winrt_error(error, "等待 PDF 渲染位图解码器失败"))?;

    decoder
        .GetSoftwareBitmapConvertedAsync(
            windows::Graphics::Imaging::BitmapPixelFormat::Gray8,
            windows::Graphics::Imaging::BitmapAlphaMode::Ignore,
        )
        .map_err(|error| map_winrt_error(error, "准备 PDF OCR 位图失败"))?
        .get()
        .map_err(|error| map_winrt_error(error, "读取 PDF OCR 位图失败"))
}

#[cfg(target_os = "windows")]
fn create_memory_stream(
    content_bytes: &[u8],
) -> Result<windows::Storage::Streams::InMemoryRandomAccessStream, OcrError> {
    let stream = windows::Storage::Streams::InMemoryRandomAccessStream::new()
        .map_err(|error| map_winrt_error(error, "创建内存流失败"))?;
    let output_stream = stream
        .GetOutputStreamAt(0)
        .map_err(|error| map_winrt_error(error, "打开内存流输出失败"))?;
    let writer = windows::Storage::Streams::DataWriter::CreateDataWriter(&output_stream)
        .map_err(|error| map_winrt_error(error, "创建内存流写入器失败"))?;

    writer
        .WriteBytes(content_bytes)
        .map_err(|error| map_winrt_error(error, "写入 OCR 内容失败"))?;
    writer
        .StoreAsync()
        .map_err(|error| map_winrt_error(error, "提交 OCR 内容写入失败"))?
        .get()
        .map_err(|error| map_winrt_error(error, "等待 OCR 内容写入失败"))?;
    writer
        .FlushAsync()
        .map_err(|error| map_winrt_error(error, "刷新 OCR 内容缓冲区失败"))?
        .get()
        .map_err(|error| map_winrt_error(error, "等待 OCR 内容缓冲区刷新失败"))?;
    stream
        .Seek(0)
        .map_err(|error| map_winrt_error(error, "重置内存流位置失败"))?;

    Ok(stream)
}

#[cfg(target_os = "windows")]
fn scale_page_edge(edge: f32) -> u32 {
    let scaled = (edge.max(1.0) * 2.0).round() as u32;
    scaled.clamp(1, 4096)
}

static DEFAULT_OCR_ENGINE: Lazy<Arc<dyn OcrEngine>> = Lazy::new(|| {
    #[cfg(target_os = "windows")]
    {
        return match WindowsOcrEngine::new() {
            Ok(engine) => Arc::new(engine) as Arc<dyn OcrEngine>,
            Err(error) => create_unavailable_default_engine(error.to_string()),
        };
    }

    #[cfg(not(target_os = "windows"))]
    {
        create_unavailable_default_engine("当前平台不支持 Windows OCR 运行时")
    }
});

pub fn create_default_ocr_engine() -> Arc<dyn OcrEngine> {
    DEFAULT_OCR_ENGINE.clone()
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

    #[test]
    fn infer_content_format_prefers_explicit_value_and_path_extension() {
        assert_eq!(
            infer_content_format("C:\\docs\\scan.pdf", None),
            OcrContentFormat::Pdf
        );
        assert_eq!(
            infer_content_format("C:\\docs\\image.jpeg", None),
            OcrContentFormat::Jpeg
        );
        assert_eq!(
            infer_content_format("C:\\docs\\scan.bin", Some(&OcrContentFormat::Png)),
            OcrContentFormat::Png
        );
    }

    #[test]
    fn normalize_language_tag_handles_case_and_separator_variants() {
        assert_eq!(normalize_language_tag(" zh_CN "), Some("zh-cn".to_string()));
        assert_eq!(normalize_language_tag("EN-us"), Some("en-us".to_string()));
        assert_eq!(normalize_language_tag("   "), None);
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

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn default_ocr_engine_is_unavailable_outside_windows() {
        let engine = create_default_ocr_engine();
        assert!(!engine.is_available());
        assert_eq!(engine.engine_id(), WINDOWS_OCR_ENGINE_ID);
    }
}
