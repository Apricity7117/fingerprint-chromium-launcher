//! 文件系统工具：原子写入 JSON 与 `~` 路径展开。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// 以「临时文件 + rename」方式原子写入格式化 JSON，避免写到一半损坏原文件。
///
/// Args:
///     path: 目标文件路径，父目录不存在时自动创建。
///     value: 可序列化的值。
///
/// Returns:
///     成功返回 `Ok(())`，失败返回中文错误信息。
pub fn write_json_atomic<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
    }
    let mut content =
        serde_json::to_string_pretty(value).map_err(|e| format!("序列化 JSON 失败: {e}"))?;
    content.push('\n');

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let temp_path = path.with_file_name(format!("{file_name}.tmp"));
    fs::write(&temp_path, content)
        .map_err(|e| format!("写入临时文件失败 {}: {e}", temp_path.display()))?;
    fs::rename(temp_path.as_path(), path)
        .map_err(|e| format!("替换文件失败 {}: {e}", path.display()))
}

/// 展开路径开头的 `~`；无法确定主目录时原样返回。
pub fn expand_tilde(path: &str) -> PathBuf {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return PathBuf::from(path);
    };
    if path == "~" {
        home
    } else if let Some(rest) = path.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_creates_parent_and_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("data.json");
        write_json_atomic(&path, &serde_json::json!({"a": 1})).unwrap();
        write_json_atomic(&path, &serde_json::json!({"a": 2})).unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["a"], 2);
        assert!(!path.with_file_name("data.json.tmp").exists());
    }

    #[test]
    fn expands_home_prefix_only() {
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        assert_eq!(expand_tilde("~/x/y"), home.join("x/y"));
        assert_eq!(expand_tilde("~"), home);
        assert_eq!(expand_tilde("/abs/~/x"), PathBuf::from("/abs/~/x"));
        assert_eq!(expand_tilde("chromium"), PathBuf::from("chromium"));
    }
}
