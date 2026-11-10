//! 启动前把启动器默认偏好合并写入 Chromium 的 `Default/Preferences`。

use std::fs;
use std::path::Path;

use serde_json::{Map, Value};

use crate::config::DEFAULTS;
use crate::fsutil::write_json_atomic;

const BIOMETRIC_AUTHENTICATION_FILLING: &str = "biometric_authentication_filling";

/// 递归合并：`updates` 中的对象逐层合并，其余值直接覆盖。
pub fn merge_preferences(target: &mut Map<String, Value>, updates: &Map<String, Value>) {
    for (key, value) in updates {
        match value {
            Value::Object(child_updates) => {
                let entry = target
                    .entry(key.clone())
                    .or_insert_with(|| Value::Object(Map::new()));
                if !entry.is_object() {
                    *entry = Value::Object(Map::new());
                }
                if let Value::Object(child_target) = entry {
                    merge_preferences(child_target, child_updates);
                }
            }
            other => {
                target.insert(key.clone(), other.clone());
            }
        }
    }
}

/// 合并启动器偏好并原子写回，保留已保存的密码填充屏幕锁布尔设置。
///
/// 不存在、损坏或非对象的 Preferences 视为空对象，屏幕锁设置缺失或非布尔时使用默认值。
///
/// Args:
///     user_data_dir: 环境的用户数据目录。
///
/// Returns:
///     成功返回 `Ok(())`，写入失败返回中文错误信息。
pub fn ensure_launcher_preferences(user_data_dir: &Path) -> Result<(), String> {
    let preferences_path = user_data_dir.join("Default").join("Preferences");
    let mut preferences = match fs::read_to_string(&preferences_path) {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(Value::Object(map)) => map,
            Ok(_) => {
                log::warn!(
                    "Preferences 不是 JSON 对象，将以启动器默认值重建: {}",
                    preferences_path.display()
                );
                Map::new()
            }
            Err(e) => {
                log::warn!(
                    "Preferences 解析失败，将以启动器默认值重建: {}: {e}",
                    preferences_path.display()
                );
                Map::new()
            }
        },
        Err(_) => Map::new(),
    };
    let mut launcher_preferences = DEFAULTS.launcher_preferences.clone();
    if preferences
        .get("password_manager")
        .and_then(|value| value.get(BIOMETRIC_AUTHENTICATION_FILLING))
        .is_some_and(Value::is_boolean)
        && let Some(password_manager) = launcher_preferences
            .get_mut("password_manager")
            .and_then(Value::as_object_mut)
    {
        password_manager.remove(BIOMETRIC_AUTHENTICATION_FILLING);
    }
    merge_preferences(&mut preferences, &launcher_preferences);
    write_json_atomic(&preferences_path, &preferences)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn read(dir: &Path) -> Value {
        let content = fs::read_to_string(dir.join("Default").join("Preferences")).unwrap();
        serde_json::from_str(&content).unwrap()
    }

    #[test]
    fn creates_preferences_with_launcher_defaults() {
        let dir = tempfile::tempdir().unwrap();
        ensure_launcher_preferences(dir.path()).unwrap();
        let prefs = read(dir.path());
        assert_eq!(prefs["bookmark_bar"]["show_tab_groups"], false);
        assert_eq!(prefs["credentials_enable_service"], true);
        assert_eq!(prefs["credentials_enable_autosignin"], true);
        assert_eq!(
            prefs["password_manager"]["automatic_passkey_upgrades"],
            true
        );
        assert_eq!(
            prefs["password_manager"]["biometric_authentication_filling"],
            false
        );
    }

    #[test]
    fn keeps_existing_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Default").join("Preferences");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let existing = json!({
            "bookmark_bar": {"show_on_all_tabs": true, "show_tab_groups": true},
            "password_manager": "broken",
            "profile": {"name": "x"}
        });
        fs::write(path.as_path(), existing.to_string()).unwrap();

        ensure_launcher_preferences(dir.path()).unwrap();
        let prefs = read(dir.path());
        assert_eq!(prefs["bookmark_bar"]["show_on_all_tabs"], true);
        assert_eq!(prefs["bookmark_bar"]["show_tab_groups"], false);
        assert_eq!(
            prefs["password_manager"]["automatic_passkey_upgrades"],
            true
        );
        assert_eq!(
            prefs["password_manager"]["biometric_authentication_filling"],
            false
        );
        assert_eq!(prefs["profile"]["name"], "x");
    }

    #[test]
    fn initializes_password_screen_lock_without_overriding_user_choice() {
        for (screen_lock, expected) in [
            (None, false),
            (Some(json!(true)), true),
            (Some(json!(false)), false),
            (Some(json!(null)), false),
            (Some(json!("true")), false),
            (Some(json!(1)), false),
            (Some(json!([])), false),
            (Some(json!({})), false),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("Default").join("Preferences");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let mut password_manager = json!({
                "automatic_passkey_upgrades": false,
                "custom_setting": "keep"
            });
            if let Some(value) = screen_lock {
                password_manager["biometric_authentication_filling"] = value;
            }
            let existing = json!({"password_manager": password_manager});
            fs::write(path.as_path(), existing.to_string()).unwrap();

            for _ in 0..2 {
                ensure_launcher_preferences(dir.path()).unwrap();
                let prefs = read(dir.path());
                assert_eq!(
                    prefs["password_manager"]["biometric_authentication_filling"],
                    expected
                );
                assert_eq!(
                    prefs["password_manager"]["automatic_passkey_upgrades"],
                    true
                );
                assert_eq!(prefs["password_manager"]["custom_setting"], "keep");
            }
        }
    }

    #[test]
    fn rebuilds_non_object_or_corrupted_file() {
        for content in ["[1, 2]", "{not json", "null"] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("Default").join("Preferences");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path.as_path(), content).unwrap();
            ensure_launcher_preferences(dir.path()).unwrap();
            let prefs = read(dir.path());
            assert_eq!(prefs["credentials_enable_service"], true);
            assert_eq!(
                prefs["password_manager"]["biometric_authentication_filling"],
                false
            );
        }
    }
}
