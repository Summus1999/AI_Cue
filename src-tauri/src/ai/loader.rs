// Provider 配置加载器 - 从文件系统加载 Provider 描述符

use super::security::UrlValidator;
use super::types::ProviderDescriptor;
use std::path::PathBuf;

/// Provider 配置加载器
#[derive(Debug)]
pub struct ProviderLoader {
    providers_dir: PathBuf,
}

impl ProviderLoader {
    /// 创建新的加载器
    pub fn new(app_data_dir: &std::path::Path) -> Self {
        Self {
            providers_dir: app_data_dir.join("providers"),
        }
    }

    /// 获取 providers 目录
    pub fn providers_dir(&self) -> &PathBuf {
        &self.providers_dir
    }

    /// 确保目录存在
    pub fn ensure_dir(&self) -> Result<(), String> {
        std::fs::create_dir_all(&self.providers_dir)
            .map_err(|e| format!("创建 providers 目录失败: {}", e))
    }

    /// 列出所有 Provider 配置文件
    pub fn list_config_files(&self) -> Result<Vec<PathBuf>, String> {
        if !self.providers_dir.exists() {
            return Ok(vec![]);
        }

        let mut files = Vec::new();
        let entries =
            std::fs::read_dir(&self.providers_dir).map_err(|e| format!("读取目录失败: {}", e))?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                files.push(path);
            }
        }

        Ok(files)
    }

    /// 加载单个配置文件
    pub fn load_single(&self, path: &PathBuf) -> Result<ProviderDescriptor, String> {
        let content = std::fs::read_to_string(path).map_err(|e| format!("读取文件失败: {}", e))?;

        let descriptor: ProviderDescriptor =
            serde_json::from_str(&content).map_err(|e| format!("JSON 解析失败: {}", e))?;

        // 校验描述符
        descriptor.validate()?;

        // URL 安全校验
        let validator = UrlValidator::new();
        validator
            .validate(&descriptor.base_url)
            .map_err(|e| format!("URL 安全校验失败: {}", e))?;

        tracing::info!(
            provider_id = %descriptor.id,
            path = %path.display(),
            "加载 Provider 配置成功"
        );

        Ok(descriptor)
    }

    /// 加载所有 Provider 配置
    pub fn load_all(&self) -> Result<Vec<ProviderDescriptor>, String> {
        self.ensure_dir()?;

        let files = self.list_config_files()?;
        let mut descriptors = Vec::new();

        for path in files {
            match self.load_single(&path) {
                Ok(descriptor) => {
                    descriptors.push(descriptor);
                }
                Err(e) => {
                    tracing::warn!(
                        path = %path.display(),
                        error = %e,
                        "加载 Provider 配置失败，已跳过"
                    );
                }
            }
        }

        Ok(descriptors)
    }
}
