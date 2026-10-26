//! 前后端共享的数据模型，字段名与旧版 JSON 保持一致（snake_case）。

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

use crate::config;

/// 将 JSON 中的 `null` 视为类型默认值，避免旧数据中的空值导致整份文件解析失败。
fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

/// 浏览器环境配置。缺失字段取旧版 `ProfileModel` 的默认值，未知字段原样保留在 `extra`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Profile {
    #[serde(deserialize_with = "null_as_default")]
    pub id: String,
    #[serde(deserialize_with = "null_as_default")]
    pub group: String,
    #[serde(deserialize_with = "null_as_default")]
    pub name: String,
    #[serde(deserialize_with = "null_as_default")]
    pub fingerprint: i64,
    #[serde(deserialize_with = "null_as_default")]
    pub platform: String,
    #[serde(deserialize_with = "null_as_default")]
    pub brand: String,
    #[serde(deserialize_with = "null_as_default")]
    pub brand_version: String,
    #[serde(deserialize_with = "null_as_default")]
    pub hardware_concurrency: u32,
    #[serde(deserialize_with = "null_as_default")]
    pub gpu_vendor: String,
    #[serde(deserialize_with = "null_as_default")]
    pub gpu_renderer: String,
    #[serde(deserialize_with = "null_as_default")]
    pub platform_version: String,
    #[serde(deserialize_with = "null_as_default")]
    pub timezone: String,
    #[serde(deserialize_with = "null_as_default")]
    pub lang: String,
    #[serde(deserialize_with = "null_as_default")]
    pub accept_lang: String,
    #[serde(deserialize_with = "null_as_default")]
    pub proxy_server: String,
    #[serde(deserialize_with = "null_as_default")]
    pub disable_non_proxied_udp: bool,
    #[serde(deserialize_with = "null_as_default")]
    pub disable_gpu_fingerprint: bool,
    #[serde(deserialize_with = "null_as_default")]
    pub disable_encryption: bool,
    #[serde(deserialize_with = "null_as_default")]
    pub extra_args: String,
    #[serde(deserialize_with = "null_as_default")]
    pub disable_spoofing: Vec<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            id: String::new(),
            group: String::new(),
            name: String::new(),
            fingerprint: 0,
            platform: "windows".to_string(),
            brand: "Chrome".to_string(),
            brand_version: String::new(),
            hardware_concurrency: 8,
            gpu_vendor: String::new(),
            gpu_renderer: String::new(),
            platform_version: String::new(),
            timezone: "America/Los_Angeles".to_string(),
            lang: "en-US".to_string(),
            accept_lang: "en-US,en".to_string(),
            proxy_server: String::new(),
            disable_non_proxied_udp: true,
            disable_gpu_fingerprint: false,
            disable_encryption: false,
            extra_args: String::new(),
            disable_spoofing: Vec::new(),
            extra: Map::new(),
        }
    }
}

/// 全局设置。旧版的 `port` 字段读入时忽略。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub chromium_path: String,
    pub data_dir_prefix: String,
}

impl Default for Settings {
    fn default() -> Self {
        let defaults = config::os_defaults();
        Self {
            chromium_path: defaults.chromium_path.clone(),
            data_dir_prefix: defaults.data_dir_prefix.clone(),
        }
    }
}

/// 启动参数的版本适配模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FlagMode {
    /// 主版本 < 144：使用 GPU vendor / renderer 与 `--disable-gpu-fingerprint`。
    Legacy,
    /// 主版本 ≥ 144：使用 `--disable-spoofing`。
    Spoofing,
    /// 版本未知：两套参数都输出。
    Unknown,
}

/// Chromium 版本检测结果。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChromiumInfo {
    pub version: Option<String>,
    pub major: Option<u32>,
    pub flag_mode: FlagMode,
}

/// 指纹推荐结果。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Recommendation {
    pub fingerprint: i64,
    pub platform: String,
    pub gpu_vendor: String,
    pub gpu_renderer: String,
    pub hardware_concurrency: u32,
}

/// 命令行预览。
#[derive(Debug, Clone, Serialize)]
pub struct CommandPreview {
    pub args: Vec<String>,
    pub display: String,
}

/// 启动结果。
#[derive(Debug, Clone, Serialize)]
pub struct LaunchResult {
    pub pid: u32,
    pub command: String,
}

/// 运行中实例的状态。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InstanceStatus {
    pub pid: u32,
    pub uptime_seconds: u64,
}

/// 批量删除结果。
#[derive(Debug, Clone, Default, Serialize)]
pub struct DeleteResult {
    pub deleted: Vec<String>,
    pub errors: Vec<String>,
}

/// 旧版数据导入结果。
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ImportResult {
    pub added: usize,
    pub skipped: usize,
    pub settings_imported: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_profile_fills_defaults_and_keeps_unknown_fields() {
        let raw = r#"{"id":"abcdef0123456789","name":"a","fingerprint":1024,"platform":"macos","custom_flag":"x","proxy_server":null}"#;
        let profile: Profile = serde_json::from_str(raw).unwrap();
        assert_eq!(profile.fingerprint, 1024);
        assert!(profile.disable_non_proxied_udp);
        assert!(!profile.disable_encryption);
        assert_eq!(profile.proxy_server, "");
        assert_eq!(profile.timezone, "America/Los_Angeles");
        assert!(profile.disable_spoofing.is_empty());
        assert_eq!(profile.extra.get("custom_flag"), Some(&Value::from("x")));

        let round_trip = serde_json::to_value(&profile).unwrap();
        assert_eq!(round_trip["custom_flag"], "x");
        assert!(round_trip.get("extra").is_none());
    }

    #[test]
    fn legacy_settings_ignore_port() {
        let raw = r#"{"chromium_path":"/x/Chromium","data_dir_prefix":"/data","port":18080}"#;
        let settings: Settings = serde_json::from_str(raw).unwrap();
        assert_eq!(settings.chromium_path, "/x/Chromium");
        assert_eq!(settings.data_dir_prefix, "/data");
    }
}
