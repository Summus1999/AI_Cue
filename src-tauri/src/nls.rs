// 阿里云 NLS 语音识别服务
// 在 Rust 后端实现以绕过 CORS 限制

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::Utc;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use std::collections::BTreeMap;

type HmacSha1 = Hmac<Sha1>;

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
    // 获取 Token
    let token = get_nls_token(access_key_id, access_key_secret, region).await?;

    // 调用 ASR API
    let url = format!(
        "https://nls-gateway-{}.aliyuncs.com/stream/v1/asr?appkey={}&format=wav&sample_rate=16000",
        region, app_key
    );

    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .header("X-NLS-Token", &token)
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
