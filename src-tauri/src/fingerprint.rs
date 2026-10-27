//! 指纹推荐：按平台与种子确定性地选取 GPU 与 CPU 核心数（与旧版推荐表一致）。

use crate::config::{DEFAULTS, PRESETS};
use crate::models::Recommendation;

/// 生成随机指纹种子。
pub fn random_seed() -> i64 {
    i64::from(rand::random_range(0..DEFAULTS.random_seed_max))
}

/// 按平台与种子推荐硬件参数；未提供种子时随机生成。
///
/// Args:
///     platform: 平台标识（windows / macos / linux，大小写不敏感）。
///     seed: 指纹种子，`None` 时随机生成。
///
/// Returns:
///     推荐结果；未知平台只返回种子与默认核心数 8。
pub fn recommend(platform: &str, seed: Option<i64>) -> Recommendation {
    let seed = seed.unwrap_or_else(random_seed);
    let platform = platform.to_lowercase();
    let Some(table) = PRESETS.recommendations.get(&platform) else {
        return Recommendation {
            fingerprint: seed,
            platform,
            gpu_vendor: String::new(),
            gpu_renderer: String::new(),
            hardware_concurrency: 8,
        };
    };
    Recommendation {
        fingerprint: seed,
        gpu_vendor: table.gpu_vendor.clone(),
        gpu_renderer: table.gpu_renderers[pick_index(seed, table.gpu_renderers.len())].clone(),
        hardware_concurrency: table.hardware_concurrency
            [pick_index(seed, table.hardware_concurrency.len())],
        platform,
    }
}

/// 与 Python `seed % len` 一致的非负取模。
fn pick_index(seed: i64, len: usize) -> usize {
    seed.rem_euclid(len as i64) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_legacy_recommendation_tables() {
        let mac = recommend("macos", Some(1024));
        assert_eq!(mac.gpu_vendor, "Apple");
        // 旧版：models[1024 % 11] = models[1] = "M1 Pro"，hardware[1024 % 4] = 8
        assert_eq!(mac.gpu_renderer, "Apple M1 Pro");
        assert_eq!(mac.hardware_concurrency, 8);

        let win = recommend("Windows", Some(1018));
        assert_eq!(win.platform, "windows");
        assert_eq!(win.gpu_vendor, "NVIDIA");
        // 1018 % 10 = 8 → RTX 4080；1018 % 5 = 3 → 12
        assert_eq!(win.gpu_renderer, "GeForce RTX 4080");
        assert_eq!(win.hardware_concurrency, 12);

        let linux = recommend("linux", Some(7));
        assert_eq!(linux.gpu_vendor, "NVIDIA Corporation");
        assert_eq!(linux.gpu_renderer, "GeForce RTX 4070");
        assert_eq!(linux.hardware_concurrency, 16);
    }

    #[test]
    fn negative_seed_uses_non_negative_modulo() {
        let rec = recommend("linux", Some(-1));
        assert_eq!(rec.gpu_renderer, "GeForce RTX 4090");
        assert_eq!(rec.hardware_concurrency, 16);
    }

    #[test]
    fn unknown_platform_and_random_seed() {
        let rec = recommend("beos", None);
        assert!(rec.gpu_vendor.is_empty());
        assert_eq!(rec.hardware_concurrency, 8);
        assert!((0..i64::from(DEFAULTS.random_seed_max)).contains(&rec.fingerprint));
    }
}
