//! 编译期嵌入 `configs/` 下的可调参数，Rust 与前端共用同一份 JSON。

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::Deserialize;
use serde_json::{Map, Value};

/// 某个操作系统下的默认全局设置。
#[derive(Debug, Clone, Deserialize)]
pub struct OsDefaults {
    pub chromium_path: String,
    pub data_dir_prefix: String,
}

/// `configs/defaults.json` 中 Rust 端使用的部分。
#[derive(Debug, Deserialize)]
pub struct DefaultsConfig {
    pub settings: HashMap<String, OsDefaults>,
    pub base_args: Vec<String>,
    pub launcher_preferences: Map<String, Value>,
    pub stop_timeout_ms: u64,
    pub version_detect_timeout_ms: u64,
    pub spoofing_min_major_version: u32,
    pub random_seed_max: u32,
}

/// 单个平台的指纹推荐表。
#[derive(Debug, Deserialize)]
pub struct PlatformRecommendation {
    pub gpu_vendor: String,
    pub gpu_renderers: Vec<String>,
    pub hardware_concurrency: Vec<u32>,
}

/// 下拉选项。
#[derive(Debug, Deserialize)]
pub struct OptionItem {
    pub value: String,
}

/// `configs/fingerprint-presets.json` 中 Rust 端使用的部分。
#[derive(Debug, Deserialize)]
pub struct PresetsConfig {
    pub recommendations: HashMap<String, PlatformRecommendation>,
    pub spoofing_options: Vec<OptionItem>,
}

pub static DEFAULTS: LazyLock<DefaultsConfig> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../configs/defaults.json"))
        .expect("configs/defaults.json 格式错误")
});

pub static PRESETS: LazyLock<PresetsConfig> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../configs/fingerprint-presets.json"))
        .expect("configs/fingerprint-presets.json 格式错误")
});

/// 返回当前操作系统对应的默认设置（非 macOS 一律按 Linux 处理）。
pub fn os_defaults() -> &'static OsDefaults {
    let key = if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    DEFAULTS
        .settings
        .get(key)
        .expect("configs/defaults.json 缺少当前系统的默认设置")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configs_are_valid() {
        assert!(!DEFAULTS.base_args.is_empty());
        assert!(DEFAULTS.stop_timeout_ms > 0);
        assert!(!os_defaults().chromium_path.is_empty());
        for platform in ["macos", "windows", "linux"] {
            let rec = PRESETS
                .recommendations
                .get(platform)
                .expect("缺少平台推荐表");
            assert!(!rec.gpu_renderers.is_empty());
            assert!(!rec.hardware_concurrency.is_empty());
        }
        assert_eq!(PRESETS.spoofing_options.len(), 5);
    }
}
