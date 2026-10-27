//! Chromium 相关：版本检测、数据目录命名与启动参数构建（启动与预览共用）。

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::config::{DEFAULTS, PRESETS};
use crate::fsutil::expand_tilde;
use crate::models::{ChromiumInfo, FlagMode, Profile, Settings};

/// 新建环境尚未生成 id 时，预览中使用的数据目录占位名。
pub const PENDING_DATA_DIR_NAME: &str = "chrome_<保存后生成>";

/// 环境数据目录名：`chrome_{id 前 8 位}`，与旧版一致。
pub fn data_dir_name(id: &str) -> String {
    let prefix: String = id.chars().take(8).collect();
    format!("chrome_{prefix}")
}

/// 环境的用户数据目录；`id` 为空时使用预览占位名。
pub fn user_data_dir(settings: &Settings, id: &str) -> PathBuf {
    let name = if id.is_empty() {
        PENDING_DATA_DIR_NAME.to_string()
    } else {
        data_dir_name(id)
    };
    expand_tilde(&settings.data_dir_prefix).join(name)
}

/// 从任意文本中提取形如 `142.0.7444.175` 的版本号。
pub fn parse_version(text: &str) -> Option<String> {
    text.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .map(|token| token.trim_matches('.'))
        .find(|token| {
            let parts: Vec<&str> = token.split('.').collect();
            parts.len() >= 3 && parts.iter().all(|part| !part.is_empty())
        })
        .map(str::to_string)
}

/// 版本号的主版本。
pub fn major_of(version: &str) -> Option<u32> {
    version.split('.').next()?.parse().ok()
}

/// 主版本到参数模式的映射。
pub fn flag_mode(major: Option<u32>) -> FlagMode {
    match major {
        Some(m) if m >= DEFAULTS.spoofing_min_major_version => FlagMode::Spoofing,
        Some(_) => FlagMode::Legacy,
        None => FlagMode::Unknown,
    }
}

/// 从可执行文件所在的 `.app` 包读取 `CFBundleShortVersionString`。
pub fn version_from_bundle(executable: &Path) -> Option<String> {
    let bundle = executable
        .ancestors()
        .find(|dir| dir.extension().is_some_and(|ext| ext == "app"))?;
    let value = plist::Value::from_file(bundle.join("Contents").join("Info.plist")).ok()?;
    let version = value
        .as_dictionary()?
        .get("CFBundleShortVersionString")?
        .as_string()?;
    parse_version(version)
}

/// 执行 `<chromium> --version` 并解析输出，超时则结束子进程。
fn version_from_binary(executable: &Path, timeout: Duration) -> Option<String> {
    let mut child = Command::new(executable)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut output = String::new();
    child.stdout.take()?.read_to_string(&mut output).ok()?;
    parse_version(&output)
}

/// 检测 Chromium 版本：优先读 `.app` 的 Info.plist，失败再执行 `--version`。
///
/// Args:
///     chromium_path: 设置中的 Chromium 可执行文件路径（支持 `~`）。
///
/// Returns:
///     版本信息；无法识别时 `version` 与 `major` 为 `None`，参数模式为 `Unknown`。
pub fn detect_version(chromium_path: &str) -> ChromiumInfo {
    let executable = expand_tilde(chromium_path);
    let timeout = Duration::from_millis(DEFAULTS.version_detect_timeout_ms);
    let version =
        version_from_bundle(&executable).or_else(|| version_from_binary(&executable, timeout));
    let major = version.as_deref().and_then(major_of);
    ChromiumInfo {
        version,
        major,
        flag_mode: flag_mode(major),
    }
}

/// 解析额外启动参数（shell 规则）。
pub fn parse_extra_args(extra_args: &str) -> Result<Vec<String>, String> {
    if extra_args.trim().is_empty() {
        return Ok(Vec::new());
    }
    shlex::split(extra_args)
        .ok_or_else(|| format!("额外启动参数无法解析（请检查引号是否成对）: {extra_args}"))
}

fn has_disable_encryption_arg(args: &[String]) -> bool {
    args.iter()
        .any(|arg| arg == "--disable-encryption" || arg.starts_with("--disable-encryption="))
}

/// 合并 `disable_spoofing` 与旧字段 `disable_gpu_fingerprint`，按预设顺序去重。
fn spoofing_targets(profile: &Profile) -> Vec<String> {
    let mut wanted: Vec<String> = profile
        .disable_spoofing
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    if profile.disable_gpu_fingerprint {
        wanted.push("gpu".to_string());
    }
    let mut ordered: Vec<String> = PRESETS
        .spoofing_options
        .iter()
        .filter(|option| wanted.contains(&option.value))
        .map(|option| option.value.clone())
        .collect();
    for item in wanted {
        if !ordered.contains(&item) {
            ordered.push(item);
        }
    }
    ordered
}

/// 构建 Chromium 启动参数（不含可执行文件本身），顺序与旧版 `server.py` 一致。
///
/// Args:
///     profile: 环境配置。
///     user_data_dir: 该环境的用户数据目录。
///     mode: 由 Chromium 主版本决定的参数模式。
///
/// Returns:
///     参数列表；额外参数无法解析时返回错误。
pub fn build_args(
    profile: &Profile,
    user_data_dir: &Path,
    mode: FlagMode,
) -> Result<Vec<String>, String> {
    let extra_args = parse_extra_args(&profile.extra_args)?;
    let legacy = matches!(mode, FlagMode::Legacy | FlagMode::Unknown);
    let spoofing = matches!(mode, FlagMode::Spoofing | FlagMode::Unknown);

    let mut args: Vec<String> = DEFAULTS.base_args.clone();
    let mut push_value = |flag: &str, value: &str| {
        if !value.trim().is_empty() {
            args.push(format!("{flag}={value}"));
        }
    };

    if profile.fingerprint != 0 {
        push_value("--fingerprint", &profile.fingerprint.to_string());
    }
    push_value("--fingerprint-platform", &profile.platform);
    push_value("--fingerprint-brand", &profile.brand);
    push_value("--fingerprint-brand-version", &profile.brand_version);
    if profile.hardware_concurrency != 0 {
        push_value(
            "--fingerprint-hardware-concurrency",
            &profile.hardware_concurrency.to_string(),
        );
    }
    if legacy {
        push_value("--fingerprint-gpu-vendor", &profile.gpu_vendor);
        push_value("--fingerprint-gpu-renderer", &profile.gpu_renderer);
    }
    push_value("--fingerprint-platform-version", &profile.platform_version);
    push_value("--timezone", &profile.timezone);
    push_value("--lang", &profile.lang);
    push_value("--accept-lang", &profile.accept_lang);
    push_value("--proxy-server", &profile.proxy_server);

    if profile.disable_non_proxied_udp {
        args.push("--disable-non-proxied-udp".to_string());
    }
    if legacy && profile.disable_gpu_fingerprint {
        args.push("--disable-gpu-fingerprint".to_string());
    }
    if spoofing {
        let targets = spoofing_targets(profile);
        if !targets.is_empty() {
            args.push(format!("--disable-spoofing={}", targets.join(",")));
        }
    }
    if profile.disable_encryption && !has_disable_encryption_arg(&extra_args) {
        args.push("--disable-encryption".to_string());
    }
    args.push(format!("--user-data-dir={}", user_data_dir.display()));
    args.extend(extra_args);
    Ok(args)
}

/// 按 POSIX shell 规则为单个参数加引号，仅在含特殊字符时加单引号。
fn shell_quote(word: &str) -> String {
    let safe = !word.is_empty()
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./:=,@+%".contains(c));
    if safe {
        word.to_string()
    } else {
        format!("'{}'", word.replace('\'', r"'\''"))
    }
}

/// 生成可直接粘贴到 shell 的完整命令字符串。
pub fn command_display(executable: &Path, args: &[String]) -> String {
    let mut words = vec![shell_quote(&executable.to_string_lossy())];
    words.extend(args.iter().map(String::as_str).map(shell_quote));
    words.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn sample_profile() -> Profile {
        Profile {
            id: "0123456789abcdef".to_string(),
            fingerprint: 1024,
            platform: "macos".to_string(),
            gpu_vendor: "Apple".to_string(),
            gpu_renderer: "Apple M2".to_string(),
            ..Profile::default()
        }
    }

    #[test]
    fn data_dir_uses_first_eight_chars() {
        let settings = Settings {
            chromium_path: "chromium".to_string(),
            data_dir_prefix: "/data/".to_string(),
        };
        assert_eq!(data_dir_name("0123456789abcdef"), "chrome_01234567");
        assert_eq!(
            user_data_dir(&settings, "0123456789abcdef"),
            PathBuf::from("/data/chrome_01234567")
        );
        assert!(user_data_dir(&settings, "").ends_with(PENDING_DATA_DIR_NAME));
    }

    #[test]
    fn legacy_args_match_server_py_order() {
        let args = build_args(
            &sample_profile(),
            Path::new("/d/chrome_01234567"),
            FlagMode::Legacy,
        )
        .unwrap();
        assert_eq!(
            args,
            [
                "--no-default-browser-check",
                "--fingerprint=1024",
                "--fingerprint-platform=macos",
                "--fingerprint-brand=Chrome",
                "--fingerprint-hardware-concurrency=8",
                "--fingerprint-gpu-vendor=Apple",
                "--fingerprint-gpu-renderer=Apple M2",
                "--timezone=America/Los_Angeles",
                "--lang=en-US",
                "--accept-lang=en-US,en",
                "--disable-non-proxied-udp",
                "--user-data-dir=/d/chrome_01234567",
            ]
        );
    }

    #[test]
    fn spoofing_mode_replaces_gpu_flags() {
        let profile = Profile {
            disable_gpu_fingerprint: true,
            disable_spoofing: vec!["canvas".to_string(), "font".to_string(), "gpu".to_string()],
            ..sample_profile()
        };
        let args = build_args(&profile, Path::new("/d/x"), FlagMode::Spoofing).unwrap();
        assert!(args.contains(&"--disable-spoofing=font,canvas,gpu".to_string()));
        assert!(!args.iter().any(|a| a.starts_with("--fingerprint-gpu")));
        assert!(!args.contains(&"--disable-gpu-fingerprint".to_string()));
    }

    #[test]
    fn unknown_mode_outputs_both_flag_sets() {
        let profile = Profile {
            disable_gpu_fingerprint: true,
            ..sample_profile()
        };
        let args = build_args(&profile, Path::new("/d/x"), FlagMode::Unknown).unwrap();
        assert!(args.contains(&"--fingerprint-gpu-renderer=Apple M2".to_string()));
        assert!(args.contains(&"--disable-gpu-fingerprint".to_string()));
        assert!(args.contains(&"--disable-spoofing=gpu".to_string()));
    }

    #[test]
    fn omits_empty_values_and_zero_numbers() {
        let profile = Profile {
            fingerprint: 0,
            hardware_concurrency: 0,
            timezone: "  ".to_string(),
            disable_non_proxied_udp: false,
            ..Profile::default()
        };
        let args = build_args(&profile, Path::new("/d/x"), FlagMode::Legacy).unwrap();
        assert!(!args.iter().any(|a| a.starts_with("--fingerprint=")));
        assert!(
            !args
                .iter()
                .any(|a| a.starts_with("--fingerprint-hardware-concurrency"))
        );
        assert!(!args.iter().any(|a| a.starts_with("--timezone")));
        assert!(!args.iter().any(|a| a.starts_with("--fingerprint-gpu")));
        assert!(!args.contains(&"--disable-non-proxied-udp".to_string()));
    }

    #[test]
    fn disable_encryption_is_not_duplicated_and_extra_args_last() {
        let profile = Profile {
            disable_encryption: true,
            extra_args: "--disable-encryption --window-size=1280,720 --custom-ntp='about:blank'"
                .to_string(),
            ..sample_profile()
        };
        let args = build_args(&profile, Path::new("/d/x"), FlagMode::Legacy).unwrap();
        let count = args
            .iter()
            .filter(|a| a.as_str() == "--disable-encryption")
            .count();
        assert_eq!(count, 1);
        assert_eq!(
            args.last().map(String::as_str),
            Some("--custom-ntp=about:blank")
        );

        let profile = Profile {
            disable_encryption: true,
            ..sample_profile()
        };
        let args = build_args(&profile, Path::new("/d/x"), FlagMode::Legacy).unwrap();
        let encryption_pos = args
            .iter()
            .position(|a| a == "--disable-encryption")
            .unwrap();
        let dir_pos = args
            .iter()
            .position(|a| a.starts_with("--user-data-dir="))
            .unwrap();
        assert!(encryption_pos < dir_pos);
    }

    #[test]
    fn invalid_extra_args_are_rejected() {
        let profile = Profile {
            extra_args: "--foo='unterminated".to_string(),
            ..sample_profile()
        };
        assert!(build_args(&profile, Path::new("/d/x"), FlagMode::Legacy).is_err());
    }

    #[test]
    fn command_display_quotes_spaces() {
        let display = command_display(
            Path::new("/Applications/Chromium.app/Contents/MacOS/Chromium"),
            &["--fingerprint-gpu-renderer=Apple M2".to_string()],
        );
        assert_eq!(
            display,
            "/Applications/Chromium.app/Contents/MacOS/Chromium '--fingerprint-gpu-renderer=Apple M2'"
        );
    }

    #[test]
    fn shell_quote_only_when_needed() {
        assert_eq!(shell_quote("--lang=en-US"), "--lang=en-US");
        assert_eq!(
            shell_quote("--accept-lang=en-US,en"),
            "--accept-lang=en-US,en"
        );
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn parses_versions_and_modes() {
        assert_eq!(
            parse_version("Chromium 142.0.7444.175 \n").as_deref(),
            Some("142.0.7444.175")
        );
        assert_eq!(
            parse_version("Google Chrome 150.0.7871.186 unknown").as_deref(),
            Some("150.0.7871.186")
        );
        assert_eq!(parse_version("no version here 1.2"), None);
        assert_eq!(major_of("142.0.7444.175"), Some(142));
        assert_eq!(flag_mode(Some(142)), FlagMode::Legacy);
        assert_eq!(flag_mode(Some(144)), FlagMode::Spoofing);
        assert_eq!(flag_mode(None), FlagMode::Unknown);
    }

    #[test]
    fn reads_version_from_fake_app_bundle() {
        let dir = tempfile::tempdir().unwrap();
        let contents = dir.path().join("Chromium.app").join("Contents");
        fs::create_dir_all(contents.join("MacOS")).unwrap();
        fs::write(
            contents.join("Info.plist"),
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>142.0.7444.175</string>
</dict>
</plist>
"#,
        )
        .unwrap();
        let executable = contents.join("MacOS").join("Chromium");
        assert_eq!(
            version_from_bundle(&executable).as_deref(),
            Some("142.0.7444.175")
        );
        let info = detect_version(&executable.to_string_lossy());
        assert_eq!(info.major, Some(142));
        assert_eq!(info.flag_mode, FlagMode::Legacy);
    }

    #[test]
    fn missing_binary_is_unknown() {
        let info = detect_version("/nonexistent/path/to/chromium");
        assert_eq!(info.version, None);
        assert_eq!(info.flag_mode, FlagMode::Unknown);
    }
}
