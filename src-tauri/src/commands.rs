//! 应用状态与 Tauri commands。业务逻辑实现为 `AppState` 方法（便于集成测试），
//! command 只负责在阻塞线程池中调用并返回结果。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};

use crate::chromium;
use crate::config::DEFAULTS;
use crate::fingerprint;
use crate::fsutil::expand_tilde;
use crate::models::{
    ChromiumInfo, CommandPreview, DeleteResult, ImportResult, InstanceStatus, LaunchResult,
    Profile, Recommendation, Settings,
};
use crate::preferences;
use crate::process::{self, Detector};
use crate::store::Store;

type CmdResult<T> = Result<T, String>;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// 版本检测缓存：以可执行文件路径为键，文件修改时间变化时重新检测。
type VersionCache = HashMap<String, (Option<SystemTime>, ChromiumInfo)>;

/// 全局应用状态。
pub struct AppState {
    store: Store,
    detector: Mutex<Detector>,
    versions: Mutex<VersionCache>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            store: Store::new(data_dir),
            detector: Mutex::new(Detector::default()),
            versions: Mutex::new(HashMap::new()),
        }
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    /// 带缓存的 Chromium 版本检测（检测期间不持有锁）。
    pub fn chromium_info(&self, chromium_path: &str) -> ChromiumInfo {
        let modified = fs::metadata(expand_tilde(chromium_path))
            .and_then(|meta| meta.modified())
            .ok();
        if let Some((cached_at, info)) = lock(&self.versions).get(chromium_path)
            && *cached_at == modified
        {
            return info.clone();
        }
        let info = chromium::detect_version(chromium_path);
        lock(&self.versions).insert(chromium_path.to_string(), (modified, info.clone()));
        info
    }

    fn running_pid(&self, settings: &Settings, id: &str) -> Option<u32> {
        let dir = chromium::user_data_dir(settings, id);
        lock(&self.detector).running_pid(id, &dir)
    }

    fn find_profile(&self, id: &str) -> CmdResult<Profile> {
        self.store
            .load_profiles()?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| format!("环境不存在: {id}"))
    }

    /// 生成与实际启动完全一致的命令行。
    pub fn preview_command(&self, profile: &Profile) -> CmdResult<CommandPreview> {
        let settings = self.store.load_settings();
        let dir = chromium::user_data_dir(&settings, &profile.id);
        let mode = self.chromium_info(&settings.chromium_path).flag_mode;
        let args = chromium::build_args(profile, &dir, mode)?;
        let display = chromium::command_display(&expand_tilde(&settings.chromium_path), &args);
        Ok(CommandPreview { args, display })
    }

    /// 启动环境：拒绝重复启动 → 构建参数 → 写入默认偏好 → 脱钩启动。
    pub fn launch(&self, id: &str) -> CmdResult<LaunchResult> {
        let settings = self.store.load_settings();
        let profile = self.find_profile(id)?;
        if let Some(pid) = self.running_pid(&settings, id) {
            return Err(format!("环境已在运行（PID {pid}）"));
        }
        let dir = chromium::user_data_dir(&settings, id);
        let mode = self.chromium_info(&settings.chromium_path).flag_mode;
        let args = chromium::build_args(&profile, &dir, mode)?;
        preferences::ensure_launcher_preferences(&dir)?;

        let executable = expand_tilde(&settings.chromium_path);
        let command = chromium::command_display(&executable, &args);
        if args
            .iter()
            .any(|arg| arg.starts_with("--disable-encryption"))
        {
            log::warn!("环境 {id} 使用 --disable-encryption，本地 Cookie / 密码保护强度降低");
        }
        let pid = process::spawn_detached(&executable, &args)?;
        log::info!("已启动环境 {id}（PID {pid}）: {command}");
        Ok(LaunchResult { pid, command })
    }

    /// 停止环境；未运行时直接返回成功。
    pub fn stop(&self, id: &str) -> CmdResult<()> {
        let settings = self.store.load_settings();
        match self.running_pid(&settings, id) {
            Some(pid) => {
                process::stop_pid(pid, Duration::from_millis(DEFAULTS.stop_timeout_ms))?;
                log::info!("已停止环境 {id}（PID {pid}）");
                Ok(())
            }
            None => Ok(()),
        }
    }

    /// 全部环境的运行状态。
    pub fn running_status(&self) -> CmdResult<HashMap<String, InstanceStatus>> {
        let settings = self.store.load_settings();
        let candidates: Vec<(String, PathBuf)> = self
            .store
            .load_profiles()?
            .iter()
            .map(|p| (p.id.clone(), chromium::user_data_dir(&settings, &p.id)))
            .collect();
        Ok(lock(&self.detector).detect(&candidates))
    }

    /// 批量删除：先停止运行中的实例（停止失败的跳过），再删除配置与可选的数据目录。
    pub fn delete_profiles(&self, ids: &[String], delete_data: bool) -> CmdResult<DeleteResult> {
        let settings = self.store.load_settings();
        let mut result = DeleteResult::default();
        let mut deletable = Vec::with_capacity(ids.len());
        for id in ids {
            match self.stop(id) {
                Ok(()) => deletable.push(id.clone()),
                Err(e) => result.errors.push(format!("{id}: {e}")),
            }
        }

        let prefix = expand_tilde(&settings.data_dir_prefix);
        for profile in self.store.remove_profiles(&deletable)? {
            let dir_name = chromium::data_dir_name(&profile.id);
            if delete_data && let Err(e) = process::remove_data_dir(&prefix, &dir_name) {
                result.errors.push(format!("{}: {e}", profile.id));
            }
            result.deleted.push(profile.id);
        }
        Ok(result)
    }
}

/// 在阻塞线程池中执行业务逻辑，避免文件 I/O、等待进程退出等操作阻塞异步运行时。
async fn blocking<T, F>(app: AppHandle, task: F) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(&AppState) -> CmdResult<T> + Send + 'static,
{
    let joined = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        task(state.inner())
    })
    .await;
    match joined {
        Ok(result) => result,
        Err(e) => Err(format!("后台任务失败: {e}")),
    }
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> CmdResult<Settings> {
    blocking(app, |state| Ok(state.store().load_settings())).await
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> CmdResult<Settings> {
    blocking(app, move |state| {
        state.store().save_settings(&settings)?;
        Ok(settings)
    })
    .await
}

#[tauri::command]
pub async fn get_chromium_info(app: AppHandle, path: Option<String>) -> CmdResult<ChromiumInfo> {
    blocking(app, move |state| {
        let path = match path {
            Some(path) if !path.trim().is_empty() => path,
            _ => state.store().load_settings().chromium_path,
        };
        Ok(state.chromium_info(&path))
    })
    .await
}

#[tauri::command]
pub async fn list_profiles(app: AppHandle) -> CmdResult<Vec<Profile>> {
    blocking(app, |state| state.store().load_profiles()).await
}

#[tauri::command]
pub async fn create_profile(app: AppHandle, profile: Profile) -> CmdResult<Profile> {
    blocking(app, move |state| state.store().create_profile(profile)).await
}

#[tauri::command]
pub async fn update_profile(app: AppHandle, id: String, profile: Profile) -> CmdResult<Profile> {
    blocking(app, move |state| state.store().update_profile(&id, profile)).await
}

#[tauri::command]
pub async fn duplicate_profile(app: AppHandle, id: String) -> CmdResult<Profile> {
    blocking(app, move |state| state.store().duplicate_profile(&id)).await
}

#[tauri::command]
pub async fn delete_profiles(
    app: AppHandle,
    ids: Vec<String>,
    delete_data: bool,
) -> CmdResult<DeleteResult> {
    blocking(app, move |state| state.delete_profiles(&ids, delete_data)).await
}

#[tauri::command]
pub fn recommend_fingerprint(platform: String, seed: Option<i64>) -> Recommendation {
    fingerprint::recommend(&platform, seed)
}

#[tauri::command]
pub async fn preview_command(app: AppHandle, profile: Profile) -> CmdResult<CommandPreview> {
    blocking(app, move |state| state.preview_command(&profile)).await
}

#[tauri::command]
pub async fn launch_profile(app: AppHandle, id: String) -> CmdResult<LaunchResult> {
    blocking(app, move |state| state.launch(&id)).await
}

#[tauri::command]
pub async fn stop_profile(app: AppHandle, id: String) -> CmdResult<()> {
    blocking(app, move |state| state.stop(&id)).await
}

#[tauri::command]
pub async fn get_running_status(app: AppHandle) -> CmdResult<HashMap<String, InstanceStatus>> {
    blocking(app, |state| state.running_status()).await
}

#[tauri::command]
pub async fn import_legacy_data(
    app: AppHandle,
    profiles_path: String,
    import_settings: bool,
) -> CmdResult<ImportResult> {
    blocking(app, move |state| {
        state
            .store()
            .import_legacy(Path::new(&profiles_path), import_settings)
    })
    .await
}
