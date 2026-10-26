//! profiles.json / settings.json 持久化：读改写串行化 + 原子写入，兼容旧版文件结构。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use crate::chromium::data_dir_name;
use crate::fingerprint::random_seed;
use crate::fsutil::write_json_atomic;
use crate::models::{ImportResult, Profile, Settings};

/// 应用数据存储，位于 Tauri 的 app_data_dir。
pub struct Store {
    dir: PathBuf,
    lock: Mutex<()>,
}

fn read_profiles_file(path: &Path) -> Result<Vec<Profile>, String> {
    match fs::read_to_string(path) {
        Ok(content) if content.trim().is_empty() => Ok(Vec::new()),
        Ok(content) => serde_json::from_str(&content)
            .map_err(|e| format!("解析 {} 失败: {e}", path.display())),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("读取 {} 失败: {e}", path.display())),
    }
}

/// 读取设置文件；不存在或损坏时返回 `None`（损坏时记录日志）。
fn read_settings_file(path: &Path) -> Option<Settings> {
    let content = fs::read_to_string(path).ok()?;
    match serde_json::from_str(&content) {
        Ok(settings) => Some(settings),
        Err(e) => {
            log::warn!("解析 {} 失败，使用默认设置: {e}", path.display());
            None
        }
    }
}

/// 生成 16 位十六进制 id，并保证前 8 位（数据目录名）不与已有环境冲突。
fn generate_id(existing: &[Profile]) -> String {
    loop {
        let id = format!("{:016x}", rand::random::<u64>());
        let dir_name = data_dir_name(&id);
        if !existing.iter().any(|p| data_dir_name(&p.id) == dir_name) {
            return id;
        }
    }
}

/// 规范化用户输入：去除分组与名称首尾空白，名称为空时使用种子。
fn normalize(profile: &mut Profile) {
    profile.group = profile.group.trim().to_string();
    profile.name = profile.name.trim().to_string();
    if profile.name.is_empty() {
        profile.name = profile.fingerprint.to_string();
    }
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            lock: Mutex::new(()),
        }
    }

    pub fn profiles_path(&self) -> PathBuf {
        self.dir.join("profiles.json")
    }

    pub fn settings_path(&self) -> PathBuf {
        self.dir.join("settings.json")
    }

    fn guard(&self) -> MutexGuard<'_, ()> {
        self.lock.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// 读取全局设置；文件不存在或损坏时返回当前系统的默认值。
    pub fn load_settings(&self) -> Settings {
        let _guard = self.guard();
        read_settings_file(&self.settings_path()).unwrap_or_default()
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<(), String> {
        let _guard = self.guard();
        write_json_atomic(&self.settings_path(), settings)
    }

    /// 读取全部环境；文件损坏时返回错误，避免后续写入覆盖原数据。
    pub fn load_profiles(&self) -> Result<Vec<Profile>, String> {
        let _guard = self.guard();
        read_profiles_file(&self.profiles_path())
    }

    /// 在锁内完成「读取 → 修改 → 原子写回」。
    fn modify<T>(
        &self,
        apply: impl FnOnce(&mut Vec<Profile>) -> Result<T, String>,
    ) -> Result<T, String> {
        let _guard = self.guard();
        let path = self.profiles_path();
        let mut profiles = read_profiles_file(&path)?;
        let output = apply(&mut profiles)?;
        write_json_atomic(&path, &profiles)?;
        Ok(output)
    }

    /// 新建环境：生成 id，规范化名称与分组。
    pub fn create_profile(&self, draft: Profile) -> Result<Profile, String> {
        self.modify(|profiles| {
            let mut profile = draft;
            profile.id = generate_id(profiles);
            normalize(&mut profile);
            profiles.push(profile.clone());
            Ok(profile)
        })
    }

    /// 更新环境：保留原 id，并保留旧记录中前端未提交的未知字段。
    pub fn update_profile(&self, id: &str, draft: Profile) -> Result<Profile, String> {
        self.modify(|profiles| {
            let existing = profiles
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| format!("环境不存在: {id}"))?;
            let mut profile = draft;
            profile.id = id.to_string();
            for (key, value) in &existing.extra {
                profile
                    .extra
                    .entry(key.clone())
                    .or_insert_with(|| value.clone());
            }
            normalize(&mut profile);
            *existing = profile.clone();
            Ok(profile)
        })
    }

    /// 克隆环境：新 id、新随机种子，名称追加 ` (Copy)`。
    pub fn duplicate_profile(&self, id: &str) -> Result<Profile, String> {
        self.modify(|profiles| {
            let mut copy = profiles
                .iter()
                .find(|p| p.id == id)
                .cloned()
                .ok_or_else(|| format!("环境不存在: {id}"))?;
            copy.id = generate_id(profiles);
            copy.name = format!("{} (Copy)", copy.name);
            copy.fingerprint = random_seed();
            profiles.push(copy.clone());
            Ok(copy)
        })
    }

    /// 删除环境配置，返回被删除的记录（用于后续删除数据目录）。
    pub fn remove_profiles(&self, ids: &[String]) -> Result<Vec<Profile>, String> {
        self.modify(|profiles| {
            let (removed, kept): (Vec<Profile>, Vec<Profile>) =
                profiles.drain(..).partition(|p| ids.contains(&p.id));
            *profiles = kept;
            Ok(removed)
        })
    }

    /// 导入旧版数据：按 id 去重合并（已存在跳过），可选导入同目录的 settings.json。
    ///
    /// Args:
    ///     profiles_path: 旧版 profiles.json 路径（只读）。
    ///     import_settings: 是否同时导入同目录 settings.json 中的路径设置。
    ///
    /// Returns:
    ///     新增、跳过数量与设置是否已导入。
    pub fn import_legacy(
        &self,
        profiles_path: &Path,
        import_settings: bool,
    ) -> Result<ImportResult, String> {
        let content = fs::read_to_string(profiles_path)
            .map_err(|e| format!("读取 {} 失败: {e}", profiles_path.display()))?;
        let legacy: Vec<Profile> = serde_json::from_str(&content)
            .map_err(|e| format!("{} 不是有效的环境列表: {e}", profiles_path.display()))?;

        let mut result = self.modify(|profiles| {
            let mut result = ImportResult::default();
            for mut profile in legacy {
                let duplicated = !profile.id.is_empty()
                    && profiles
                        .iter()
                        .any(|p| data_dir_name(&p.id) == data_dir_name(&profile.id));
                if duplicated {
                    result.skipped += 1;
                    continue;
                }
                if profile.id.is_empty() {
                    profile.id = generate_id(profiles);
                }
                normalize(&mut profile);
                profiles.push(profile);
                result.added += 1;
            }
            Ok(result)
        })?;

        if import_settings {
            let settings_path = profiles_path.with_file_name("settings.json");
            if let Some(settings) = read_settings_file(&settings_path) {
                self.save_settings(&settings)?;
                result.settings_imported = true;
            }
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("app"));
        (dir, store)
    }

    fn draft(name: &str, seed: i64) -> Profile {
        Profile {
            name: name.to_string(),
            fingerprint: seed,
            group: "  work ".to_string(),
            ..Profile::default()
        }
    }

    #[test]
    fn crud_round_trip() {
        let (_dir, store) = store();
        assert!(store.load_profiles().unwrap().is_empty());

        let created = store.create_profile(draft("", 1018)).unwrap();
        assert_eq!(created.id.len(), 16);
        assert_eq!(created.name, "1018");
        assert_eq!(created.group, "work");

        let updated = store
            .update_profile(&created.id, draft("renamed", 1019))
            .unwrap();
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.name, "renamed");

        let copy = store.duplicate_profile(&created.id).unwrap();
        assert_ne!(copy.id, created.id);
        assert_eq!(copy.name, "renamed (Copy)");

        let all = store.load_profiles().unwrap();
        assert_eq!(all.len(), 2);

        let removed = store
            .remove_profiles(std::slice::from_ref(&created.id))
            .unwrap();
        assert_eq!(removed.len(), 1);
        let rest = store.load_profiles().unwrap();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].id, copy.id);

        assert!(store.update_profile("missing", draft("x", 1)).is_err());
        assert!(store.duplicate_profile("missing").is_err());
    }

    #[test]
    fn update_keeps_unknown_fields() {
        let (_dir, store) = store();
        let path = store.profiles_path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            path.as_path(),
            json!([{"id": "abcdef0123456789", "name": "a", "legacy_note": "keep"}]).to_string(),
        )
        .unwrap();
        store
            .update_profile("abcdef0123456789", draft("b", 1))
            .unwrap();
        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path.as_path()).unwrap()).unwrap();
        assert_eq!(saved[0]["legacy_note"], "keep");
        assert_eq!(saved[0]["name"], "b");
    }

    #[test]
    fn corrupted_profiles_file_is_not_overwritten() {
        let (_dir, store) = store();
        let path = store.profiles_path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path.as_path(), "{broken").unwrap();
        assert!(store.load_profiles().is_err());
        assert!(store.create_profile(draft("x", 1)).is_err());
        assert_eq!(fs::read_to_string(path.as_path()).unwrap(), "{broken");
    }

    #[test]
    fn settings_fall_back_to_defaults() {
        let (_dir, store) = store();
        assert_eq!(store.load_settings(), Settings::default());
        let custom = Settings {
            chromium_path: "/opt/chromium".to_string(),
            data_dir_prefix: "/data".to_string(),
        };
        store.save_settings(&custom).unwrap();
        assert_eq!(store.load_settings(), custom);
    }

    #[test]
    fn import_legacy_merges_by_id() {
        let (dir, store) = store();
        let legacy_dir = dir.path().join("legacy");
        fs::create_dir_all(&legacy_dir).unwrap();
        let legacy_profiles = legacy_dir.join("profiles.json");
        let legacy_content = json!([
            {"id": "1111111122222222", "group": "alpha", "name": "one", "fingerprint": 1024,
             "platform": "macos", "brand": "Chrome", "proxy_server": ""},
            {"id": "3333333344444444", "group": "", "name": "two", "fingerprint": 1025,
             "platform": "macos", "disable_encryption": true}
        ])
        .to_string();
        fs::write(legacy_profiles.as_path(), &legacy_content).unwrap();
        fs::write(
            legacy_dir.join("settings.json"),
            json!({"chromium_path": "/legacy/Chromium", "data_dir_prefix": "/legacy/data", "port": 18080})
                .to_string(),
        )
        .unwrap();

        let first = store.import_legacy(&legacy_profiles, true).unwrap();
        assert_eq!(
            first,
            ImportResult {
                added: 2,
                skipped: 0,
                settings_imported: true
            }
        );
        let profiles = store.load_profiles().unwrap();
        assert_eq!(profiles.len(), 2);
        assert!(profiles[0].disable_non_proxied_udp);
        assert!(profiles[1].disable_encryption);
        assert_eq!(store.load_settings().data_dir_prefix, "/legacy/data");

        let second = store.import_legacy(&legacy_profiles, false).unwrap();
        assert_eq!(second.added, 0);
        assert_eq!(second.skipped, 2);
        assert!(!second.settings_imported);
        assert_eq!(
            fs::read_to_string(legacy_profiles.as_path()).unwrap(),
            legacy_content
        );
    }
}
