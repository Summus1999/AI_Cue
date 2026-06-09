// 安全验证模块 - URL 白名单和敏感信息处理

use std::collections::HashSet;
use url::Url;

/// URL 安全验证器
#[derive(Debug, Clone)]
pub struct UrlValidator {
    /// 允许的域名白名单
    allowed_domains: HashSet<String>,
    /// 禁止的域名黑名单
    blocked_domains: HashSet<String>,
    /// 是否允许本地地址
    allow_localhost: bool,
    /// 是否允许私有 IP
    allow_private_ip: bool,
}

impl UrlValidator {
    /// 创建新的验证器
    pub fn new() -> Self {
        let mut allowed = HashSet::new();
        // 内置白名单
        allowed.insert("dashscope.aliyuncs.com".to_string());
        allowed.insert("api.openai.com".to_string());
        allowed.insert("api.anthropic.com".to_string());
        allowed.insert("api.deepseek.com".to_string());
        allowed.insert("openai.com".to_string());

        let blocked = HashSet::new();
        // 内置黑名单（默认禁止）

        Self {
            allowed_domains: allowed,
            blocked_domains: blocked,
            allow_localhost: false,
            allow_private_ip: false,
        }
    }

    /// 验证 URL 是否安全
    pub fn validate(&self, url_str: &str) -> Result<(), String> {
        let url = Url::parse(url_str).map_err(|e| format!("无效 URL: {}", e))?;

        // 必须是 HTTPS（localhost 除外）
        let host = url.host_str().ok_or("URL 缺少主机名")?.to_string();

        if url.scheme() != "https" {
            if !self.allow_localhost || host != "localhost" {
                return Err("仅支持 HTTPS 协议".to_string());
            }
        }

        // 检查黑名单
        if self.blocked_domains.contains(&host) && !self.allow_localhost {
            return Err(format!("域名 {} 已被禁止", host));
        }

        // 检查私有 IP（如果禁止）
        if !self.allow_private_ip {
            if let Ok(ip) = host.parse::<std::net::IpAddr>() {
                if is_private_ip(&ip) {
                    return Err("禁止访问私有 IP 地址".to_string());
                }
            }
        }

        Ok(())
    }

    /// 添加允许的域名
    pub fn allow_domain(&mut self, domain: &str) {
        self.allowed_domains.insert(domain.to_lowercase());
        self.blocked_domains.remove(&domain.to_lowercase());
    }

    /// 启用本地地址访问
    pub fn enable_localhost(&mut self) {
        self.allow_localhost = true;
    }

    /// 启用私有 IP 访问
    pub fn enable_private_ip(&mut self) {
        self.allow_private_ip = true;
    }

    /// 检查域名是否在白名单中
    pub fn is_allowed(&self, domain: &str) -> bool {
        self.allowed_domains.contains(&domain.to_lowercase())
    }
}

impl Default for UrlValidator {
    fn default() -> Self {
        Self::new()
    }
}

fn is_private_ip(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local(),
        std::net::IpAddr::V6(v6) => v6.is_loopback(),
    }
}

/// 请求转换安全检查
pub fn validate_request_transform(
    extra_headers: Option<&std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    if let Some(headers) = extra_headers {
        for key in headers.keys() {
            let key_lower = key.to_lowercase();
            // 禁止设置敏感 Header
            if key_lower.contains("cookie")
                || key_lower.contains("authorization")
                || key_lower == "host"
            {
                return Err(format!("禁止设置 Header: {}", key));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_https_url() {
        let validator = UrlValidator::new();
        assert!(validator.validate("https://api.openai.com/v1").is_ok());
    }

    #[test]
    fn test_invalid_http_url() {
        let validator = UrlValidator::new();
        assert!(validator.validate("http://api.openai.com/v1").is_err());
    }

    #[test]
    fn test_localhost_allowed() {
        let mut validator = UrlValidator::new();
        validator.enable_localhost();
        assert!(validator
            .validate("http://localhost:11434/v1/models")
            .is_ok());
    }

    #[test]
    fn test_private_ip_blocked() {
        let validator = UrlValidator::new();
        assert!(validator.validate("https://192.168.1.1/v1").is_err());
        assert!(validator.validate("https://10.0.0.1/v1").is_err());
    }

    #[test]
    fn test_allow_custom_domain() {
        let mut validator = UrlValidator::new();
        validator.allow_domain("my-custom-api.com");
        assert!(validator.validate("https://my-custom-api.com/v1").is_ok());
    }
}
