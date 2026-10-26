//! 后端集成测试：用假 Chromium 脚本驱动启动、运行检测、停止与删除的完整流程。

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use fingerprint_chromium_launcher_lib::chromium;
use fingerprint_chromium_launcher_lib::commands::AppState;
use fingerprint_chromium_launcher_lib::models::{FlagMode, Profile, Settings};
use fingerprint_chromium_launcher_lib::process::{self, Detector};

fn fake_chromium() -> PathBuf {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-chromium.sh");
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&path, permissions).unwrap();
    path
}

fn wait_for(timeout: Duration, mut check: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if check() {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    check()
}

/// 创建一个使用假 Chromium 与临时数据目录的应用状态。
fn setup() -> (tempfile::TempDir, AppState, Settings) {
    let root = tempfile::tempdir().unwrap();
    let state = AppState::new(root.path().join("app-data"));
    let settings = Settings {
        chromium_path: fake_chromium().to_string_lossy().into_owned(),
        data_dir_prefix: root.path().join("browsers").to_string_lossy().into_owned(),
    };
    state.store().save_settings(&settings).unwrap();
    (root, state, settings)
}

#[test]
fn spawn_detached_creates_new_process_group_and_stops() {
    let dir = tempfile::tempdir().unwrap();
    let user_data_dir = dir.path().join("chrome_0123abcd");
    let args = [
        "--fingerprint=1".to_string(),
        format!("--user-data-dir={}", user_data_dir.display()),
    ];
    let pid = process::spawn_detached(&fake_chromium(), &args).unwrap();
    let raw_pid = i32::try_from(pid).unwrap();
    // SAFETY: 只读查询进程组。
    assert_eq!(unsafe { libc::getpgid(raw_pid) }, raw_pid);

    let mut detector = Detector::default();
    assert!(wait_for(Duration::from_secs(5), || {
        detector.running_pid("p", &user_data_dir) == Some(pid)
    }));

    process::stop_pid(pid, Duration::from_secs(3)).unwrap();
    assert!(wait_for(Duration::from_secs(2), || !process::is_alive(pid)));
    assert_eq!(detector.running_pid("p", &user_data_dir), None);
}

#[test]
fn process_ignoring_sigterm_is_force_killed() {
    let dir = tempfile::tempdir().unwrap();
    let user_data_dir = dir.path().join("chrome_89abcdef");
    let args = [
        "--fake-ignore-term".to_string(),
        format!("--user-data-dir={}", user_data_dir.display()),
    ];
    let pid = process::spawn_detached(&fake_chromium(), &args).unwrap();
    let mut detector = Detector::default();
    assert!(wait_for(Duration::from_secs(5), || {
        detector.running_pid("p", &user_data_dir) == Some(pid)
    }));

    let started = Instant::now();
    process::stop_pid(pid, Duration::from_millis(600)).unwrap();
    assert!(started.elapsed() >= Duration::from_millis(600));
    assert!(wait_for(Duration::from_secs(2), || !process::is_alive(pid)));
    // 强杀后残留的陈旧锁不应被识别为运行中
    assert!(user_data_dir.join("SingletonLock").symlink_metadata().is_ok());
    assert_eq!(detector.running_pid("p", &user_data_dir), None);
}

#[test]
fn full_profile_lifecycle() {
    let (root, state, settings) = setup();
    assert_eq!(
        state.chromium_info(&settings.chromium_path).flag_mode,
        FlagMode::Legacy
    );

    let profile = state
        .store()
        .create_profile(Profile {
            name: "测试环境".to_string(),
            fingerprint: 1018,
            platform: "linux".to_string(),
            gpu_vendor: "NVIDIA Corporation".to_string(),
            gpu_renderer: "GeForce RTX 4080".to_string(),
            ..Profile::default()
        })
        .unwrap();
    let dir = chromium::user_data_dir(&settings, &profile.id);

    let preview = state.preview_command(&profile).unwrap();
    assert!(
        preview
            .display
            .contains("'--fingerprint-gpu-renderer=GeForce RTX 4080'")
    );

    let launched = state.launch(&profile.id).unwrap();
    assert_eq!(launched.command, preview.display);
    let preferences = fs::read_to_string(dir.join("Default").join("Preferences")).unwrap();
    assert!(preferences.contains("show_tab_groups"));

    assert!(wait_for(Duration::from_secs(5), || {
        state
            .running_status()
            .unwrap()
            .get(&profile.id)
            .is_some_and(|status| status.pid == launched.pid)
    }));

    // 启动器「重启」后仍能识别运行中的实例
    let restarted = AppState::new(root.path().join("app-data"));
    assert!(restarted.running_status().unwrap().contains_key(&profile.id));
    assert!(restarted.launch(&profile.id).is_err());

    restarted.stop(&profile.id).unwrap();
    assert!(wait_for(Duration::from_secs(3), || {
        !restarted.running_status().unwrap().contains_key(&profile.id)
    }));

    let result = restarted
        .delete_profiles(std::slice::from_ref(&profile.id), true)
        .unwrap();
    assert_eq!(result.deleted.as_slice(), std::slice::from_ref(&profile.id));
    assert!(result.errors.is_empty(), "{:?}", result.errors);
    assert!(!dir.exists());
    assert!(restarted.store().load_profiles().unwrap().is_empty());
}

#[test]
fn deleting_running_profile_stops_it_first() {
    let (_root, state, settings) = setup();
    let profile = state
        .store()
        .create_profile(Profile {
            fingerprint: 7,
            ..Profile::default()
        })
        .unwrap();
    let launched = state.launch(&profile.id).unwrap();
    assert!(wait_for(Duration::from_secs(5), || {
        state.running_status().unwrap().contains_key(&profile.id)
    }));

    let result = state
        .delete_profiles(std::slice::from_ref(&profile.id), false)
        .unwrap();
    assert_eq!(result.deleted.len(), 1);
    assert!(wait_for(Duration::from_secs(2), || !process::is_alive(launched.pid)));
    // 未勾选删除数据时保留目录
    assert!(chromium::user_data_dir(&settings, &profile.id).exists());
}
