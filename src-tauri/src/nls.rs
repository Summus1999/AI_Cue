// 阿里云 NLS 语音识别服务
// 在 Rust 后端实现以绕过 CORS 限制

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::Utc;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use std::collections::BTreeMap;
use std::io::Cursor;

type HmacSha1 = Hmac<Sha1>;

const MAX_SEGMENT_SECONDS: usize = 45;
const MIN_SEGMENT_SECONDS: usize = 8;
const SILENCE_SCAN_BACK_SECONDS: usize = 3;
const SILENCE_WINDOW_MS: usize = 300;
const SILENCE_THRESHOLD_I16: i16 = 700;

/// 阿里云 POP API 的 URL 编码（严格模式）
fn percent_encode_strict(input: &str) -> String {
    let mut result = String::new();
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            _ => {
                result.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    result
}

/// 生成 HMAC-SHA1 签名并返回 Base64
fn hmac_sha1_base64(key: &str, data: &str) -> String {
    let mut mac = HmacSha1::new_from_slice(key.as_bytes()).expect("HMAC can take key of any size");
    mac.update(data.as_bytes());
    let result = mac.finalize();
    BASE64.encode(result.into_bytes())
}

/// 获取 NLS Token
async fn get_nls_token(
    access_key_id: &str,
    access_key_secret: &str,
    region: &str,
) -> Result<String, String> {
    let endpoint = format!("https://nls-meta.{}.aliyuncs.com", region);

    // 构建请求参数
    let mut params: BTreeMap<&str, String> = BTreeMap::new();
    params.insert("AccessKeyId", access_key_id.to_string());
    params.insert("Action", "CreateToken".to_string());
    params.insert("Format", "JSON".to_string());
    params.insert("RegionId", region.to_string());
    params.insert("SignatureMethod", "HMAC-SHA1".to_string());
    params.insert("SignatureNonce", uuid::Uuid::new_v4().to_string());
    params.insert("SignatureVersion", "1.0".to_string());
    params.insert(
        "Timestamp",
        Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    );
    params.insert("Version", "2019-02-28".to_string());

    // 构建规范化查询字符串
    let canonicalized_query: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode_strict(k), percent_encode_strict(v)))
        .collect::<Vec<_>>()
        .join("&");

    // 构建待签名字符串
    let string_to_sign = format!("POST&%2F&{}", percent_encode_strict(&canonicalized_query));

    // 计算签名
    let sign_key = format!("{}&", access_key_secret);
    let signature = hmac_sha1_base64(&sign_key, &string_to_sign);

    // 构建请求体
    let mut body_params: Vec<(String, String)> = params
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
    body_params.push(("Signature".to_string(), signature));

    let client = reqwest::Client::new();
    let res = client
        .post(&endpoint)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&body_params)
        .send()
        .await
        .map_err(|e| format!("Token request failed: {}", e))?;

    if !res.status().is_success() {
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("Token request failed: {}", err_body));
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    json["Token"]["Id"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Token response missing Token.Id".to_string())
}

/// 调用 NLS 一句话识别 API
pub async fn recognize_speech(
    audio_data: Vec<u8>,
    access_key_id: &str,
    access_key_secret: &str,
    app_key: &str,
    region: &str,
) -> Result<String, String> {
    let token = get_nls_token(access_key_id, access_key_secret, region).await?;
    recognize_speech_with_token(audio_data, app_key, region, &token).await
}

async fn recognize_speech_with_token(
    audio_data: Vec<u8>,
    app_key: &str,
    region: &str,
    token: &str,
) -> Result<String, String> {
    if let Some(segments) = split_wav_for_asr(&audio_data)? {
        let mut results = Vec::with_capacity(segments.len());
        for (index, segment) in segments.into_iter().enumerate() {
            let text = recognize_single_segment(segment, app_key, region, token)
                .await
                .map_err(|err| format!("ASR segment {} failed: {}", index + 1, err))?;
            if !text.trim().is_empty() {
                results.push(text.trim().to_string());
            }
        }
        return Ok(results.join("\n"));
    }

    recognize_single_segment(audio_data, app_key, region, token).await
}

async fn recognize_single_segment(
    audio_data: Vec<u8>,
    app_key: &str,
    region: &str,
    token: &str,
) -> Result<String, String> {
    let url = format!(
        "https://nls-gateway-{}.aliyuncs.com/stream/v1/asr?appkey={}&format=wav&sample_rate=16000",
        region, app_key
    );

    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .header("X-NLS-Token", token)
        .header("Content-Type", "application/octet-stream")
        .body(audio_data)
        .send()
        .await
        .map_err(|e| format!("ASR request failed: {}", e))?;

    if !res.status().is_success() {
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("ASR request failed: {}", err_body));
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse ASR response: {}", e))?;

    let status = json["status"].as_i64().unwrap_or(0);
    if status != 20000000 {
        let message = json["message"].as_str().unwrap_or("Unknown error");
        return Err(format!("ASR error: {}", message));
    }

    Ok(json["result"].as_str().unwrap_or("").to_string())
}

fn split_wav_for_asr(audio_data: &[u8]) -> Result<Option<Vec<Vec<u8>>>, String> {
    let mut reader = hound::WavReader::new(Cursor::new(audio_data))
        .map_err(|e| format!("Invalid WAV payload: {}", e))?;
    let spec = reader.spec();

    if spec.channels != 1 || spec.sample_rate != 16_000 || spec.bits_per_sample != 16 {
        return Ok(None);
    }

    let samples = reader
        .samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Invalid WAV samples: {}", e))?;

    let max_samples = MAX_SEGMENT_SECONDS * spec.sample_rate as usize;
    let min_samples = MIN_SEGMENT_SECONDS * spec.sample_rate as usize;
    if samples.len() <= max_samples {
        return Ok(None);
    }

    let mut start = 0usize;
    let mut segments = Vec::new();
    while start < samples.len() {
        let remaining = samples.len() - start;
        if remaining <= max_samples {
            segments.push(encode_wav_segment(&samples[start..], spec)?);
            break;
        }

        let preferred_end = start + max_samples;
        let cut = find_silence_cut(&samples, start, preferred_end, spec.sample_rate as usize)
            .unwrap_or(preferred_end)
            .max(start + min_samples)
            .min(samples.len());

        segments.push(encode_wav_segment(&samples[start..cut], spec)?);
        start = cut;
    }

    Ok(Some(segments))
}

fn find_silence_cut(
    samples: &[i16],
    start: usize,
    preferred_end: usize,
    sample_rate: usize,
) -> Option<usize> {
    let look_back = SILENCE_SCAN_BACK_SECONDS * sample_rate;
    let search_start = preferred_end.saturating_sub(look_back).max(start);
    let window = (SILENCE_WINDOW_MS * sample_rate / 1000).max(1);

    let mut best_cut = None;
    let mut idx = preferred_end;
    while idx > search_start + window {
        let begin = idx - window;
        let mut silent = true;
        for sample in &samples[begin..idx] {
            if sample.unsigned_abs() > SILENCE_THRESHOLD_I16 as u16 {
                silent = false;
                break;
            }
        }
        if silent {
            best_cut = Some(begin);
            break;
        }
        idx = idx.saturating_sub(window / 2).max(search_start + window);
    }
    best_cut
}

fn encode_wav_segment(segment_samples: &[i16], spec: hound::WavSpec) -> Result<Vec<u8>, String> {
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .map_err(|e| format!("Failed to create WAV writer: {}", e))?;
        for sample in segment_samples {
            writer
                .write_sample(*sample)
                .map_err(|e| format!("Failed to write WAV sample: {}", e))?;
        }
        writer
            .finalize()
            .map_err(|e| format!("Failed to finalize WAV segment: {}", e))?;
    }
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_wav(samples: &[i16]) -> Vec<u8> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        encode_wav_segment(samples, spec).expect("build wav")
    }

    #[test]
    fn split_wav_for_asr_returns_none_for_short_audio() {
        let short = vec![500i16; 16_000 * 10];
        let wav = build_wav(&short);
        let result = split_wav_for_asr(&wav).expect("split result");
        assert!(result.is_none());
    }

    #[test]
    fn split_wav_for_asr_splits_long_audio() {
        let mut samples = vec![1200i16; 16_000 * 46];
        samples.extend(std::iter::repeat_n(0i16, 16_000));
        samples.extend(std::iter::repeat_n(900i16, 16_000 * 46));
        let wav = build_wav(&samples);

        let segments = split_wav_for_asr(&wav)
            .expect("split result")
            .expect("segments");

        assert!(segments.len() >= 2);
    }
}
