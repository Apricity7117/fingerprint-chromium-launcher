//! 浏览器进程管理：脱钩启动、基于 `SingletonLock` 的运行检测、SIGTERM→SIGKILL 停止。

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use sysinfo::{Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind};

use crate::models::InstanceStatus;

/// `SingletonLock` 记录的占用者（Chromium 写入格式为 `<hostname>-<pid>`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockOwner {
    pub hostname: String,
    pub pid: u32,
}

/// 解析 `SingletonLock` 符号链接目标。
pub fn parse_singleton_lock(target: &str) -> Option<LockOwner> {
    let (hostname, pid) = target.rsplit_once('-')?;
    if hostname.is_empty() {
        return None;
    }
    Some(LockOwner {
        hostname: hostname.to_string(),
        pid: pid.parse().ok()?,
    })
}

/// 读取用户数据目录中的 `SingletonLock`。
pub fn read_singleton_lock(user_data_dir: &Path) -> Option<LockOwner> {
    let target = fs::read_link(user_data_dir.join("SingletonLock")).ok()?;
    let owner = parse_singleton_lock(&target.to_string_lossy());
    if owner.is_none() {
        log::warn!(
            "无法解析 SingletonLock: {} -> {}",
            user_data_dir.display(),
            target.display()
        );
    }
    owner
}

/// 本机主机名（与 Chromium 写入 `SingletonLock` 时使用的 `gethostname` 一致）。
pub fn local_hostname() -> String {
    let mut buf = [0u8; 256];
    // SAFETY: buf 有效且长度正确，gethostname 最多写入 len 字节。
    let ret = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) };
    if ret != 0 {
        return String::new();
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

/// 主机名比较：完全相同，或去掉域名后缀后相同。
fn same_host(a: &str, b: &str) -> bool {
    let short = |name: &str| name.split('.').next().unwrap_or_default().to_lowercase();
    a == b || short(a) == short(b)
}

/// 判断命令行是否属于 Chromium 主浏览器进程（带 `--user-data-dir` 且不是 `--type=` 子进程）。
pub fn is_browser_main(cmd: &[OsString]) -> bool {
    if cmd.is_empty() {
        // 读不到命令行时无法校验，按存活处理
        return true;
    }
    let args: Vec<String> = cmd
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    args.iter().any(|arg| arg.starts_with("--user-data-dir"))
        && !args.iter().any(|arg| arg.starts_with("--type="))
}

/// 以脱钩方式启动进程：独立进程组、丢弃标准输入输出，并在后台线程回收退出状态。
///
/// Args:
///     program: 可执行文件路径。
///     args: 启动参数。
///
/// Returns:
///     子进程 PID；启动失败返回中文错误信息。
pub fn spawn_detached(program: &Path, args: &[String]) -> Result<u32, String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|e| format!("无法启动浏览器（{}）: {e}", program.display()))?;
    let pid = child.id();
    thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(pid)
}

/// 进程是否存活（存在且不是僵尸进程由调用方另行判断）。
pub fn is_alive(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    // SAFETY: 信号 0 只做存在性与权限检查，不会影响目标进程。
    let ret = unsafe { libc::kill(pid, 0) };
    ret == 0 || io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

fn send_signal(pid: u32, signal: libc::c_int) -> Result<(), String> {
    let raw = i32::try_from(pid).map_err(|_| format!("无效的 PID: {pid}"))?;
    // SAFETY: 向指定 PID 发送信号，不涉及内存访问。
    let ret = unsafe { libc::kill(raw, signal) };
    if ret == 0 {
        return Ok(());
    }
    let err = io::Error::last_os_error();
    if err.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }
    Err(format!("向进程 {pid} 发送信号失败: {err}"))
}

fn wait_until_dead(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !is_alive(pid) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    !is_alive(pid)
}

/// 优雅停止：先 SIGTERM，超时后 SIGKILL。
///
/// Args:
///     pid: 浏览器主进程 PID。
///     timeout: 等待优雅退出的时长。
///
/// Returns:
///     进程已结束返回 `Ok(())`，信号发送失败或强杀后仍存活返回错误。
pub fn stop_pid(pid: u32, timeout: Duration) -> Result<(), String> {
    send_signal(pid, libc::SIGTERM)?;
    if wait_until_dead(pid, timeout) {
        return Ok(());
    }
    log::warn!("进程 {pid} 未在超时内退出，发送 SIGKILL");
    send_signal(pid, libc::SIGKILL)?;
    if wait_until_dead(pid, Duration::from_secs(2)) {
        Ok(())
    } else {
        Err(format!("进程 {pid} 无法结束"))
    }
}

/// 运行检测器：复用 `sysinfo::System`，仅刷新 `SingletonLock` 指向的 PID。
pub struct Detector {
    system: System,
    hostname: String,
}

impl Default for Detector {
    fn default() -> Self {
        Self {
            system: System::new(),
            hostname: local_hostname(),
        }
    }
}

impl Detector {
    /// 检测一组环境的运行状态。
    ///
    /// Args:
    ///     candidates: `(环境 id, 用户数据目录)` 列表。
    ///
    /// Returns:
    ///     运行中环境 id 到实例状态的映射。
    pub fn detect(&mut self, candidates: &[(String, PathBuf)]) -> HashMap<String, InstanceStatus> {
        let owners: Vec<(&String, u32)> = candidates
            .iter()
            .filter_map(|(id, dir)| {
                let owner = read_singleton_lock(dir)?;
                same_host(&owner.hostname, &self.hostname).then_some((id, owner.pid))
            })
            .collect();
        if owners.is_empty() {
            return HashMap::new();
        }

        let pids: Vec<Pid> = owners.iter().map(|(_, pid)| Pid::from_u32(*pid)).collect();
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&pids),
            true,
            ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
        );

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or_default();
        owners
            .into_iter()
            .filter_map(|(id, pid)| {
                let process = self.system.process(Pid::from_u32(pid))?;
                let running = process.status() != ProcessStatus::Zombie
                    && is_browser_main(process.cmd());
                running.then(|| {
                    let status = InstanceStatus {
                        pid,
                        uptime_seconds: now.saturating_sub(process.start_time()),
                    };
                    (id.clone(), status)
                })
            })
            .collect()
    }

    /// 检测单个环境，返回运行中的主进程 PID。
    pub fn running_pid(&mut self, id: &str, user_data_dir: &Path) -> Option<u32> {
        let candidates = [(id.to_string(), user_data_dir.to_path_buf())];
        self.detect(&candidates).remove(id).map(|status| status.pid)
    }
}

/// 安全删除环境数据目录：仅允许删除 `<prefix>/chrome_<8 位十六进制>` 这一真实目录。
///
/// Args:
///     prefix: 用户数据目录前缀（已展开 `~`）。
///     dir_name: 目录名，必须形如 `chrome_0123abcd`。
///
/// Returns:
///     删除成功返回 `Ok(true)`，目录不存在返回 `Ok(false)`，校验失败或删除失败返回错误。
pub fn remove_data_dir(prefix: &Path, dir_name: &str) -> Result<bool, String> {
    let valid_name = dir_name
        .strip_prefix("chrome_")
        .is_some_and(|suffix| suffix.len() == 8 && suffix.chars().all(|c| c.is_ascii_hexdigit()));
    if !valid_name {
        return Err(format!("数据目录名不合法，拒绝删除: {dir_name}"));
    }
    let target = prefix.join(dir_name);
    let metadata = match fs::symlink_metadata(&target) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(format!("读取数据目录失败 {}: {e}", target.display())),
    };
    if !metadata.is_dir() {
        return Err(format!("目标不是普通目录，拒绝删除: {}", target.display()));
    }
    let canonical_prefix = prefix
        .canonicalize()
        .map_err(|e| format!("解析数据目录前缀失败 {}: {e}", prefix.display()))?;
    let canonical_target = target
        .canonicalize()
        .map_err(|e| format!("解析数据目录失败 {}: {e}", target.display()))?;
    if canonical_target.parent() != Some(canonical_prefix.as_path()) {
        return Err(format!("数据目录不在前缀之下，拒绝删除: {}", target.display()));
    }
    fs::remove_dir_all(canonical_target.as_path())
        .map_err(|e| format!("删除数据目录失败 {}: {e}", target.display()))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lock_targets() {
        assert_eq!(
            parse_singleton_lock("madoka-78622"),
            Some(LockOwner {
                hostname: "madoka".to_string(),
                pid: 78622
            })
        );
        assert_eq!(
            parse_singleton_lock("my-host.local-123").map(|o| o.hostname),
            Some("my-host.local".to_string())
        );
        assert_eq!(parse_singleton_lock("nohyphen"), None);
        assert_eq!(parse_singleton_lock("host-abc"), None);
        assert_eq!(parse_singleton_lock("-12"), None);
    }

    #[test]
    fn compares_hostnames_loosely() {
        assert!(same_host("madoka", "madoka"));
        assert!(same_host("madoka.local", "Madoka"));
        assert!(!same_host("madoka", "other"));
    }

    #[test]
    fn recognizes_main_browser_process() {
        let main: Vec<OsString> = ["Chromium", "--fingerprint=1", "--user-data-dir=/d/chrome_1"]
            .iter()
            .map(OsString::from)
            .collect();
        let renderer: Vec<OsString> = ["Chromium Helper", "--type=renderer", "--user-data-dir=/d"]
            .iter()
            .map(OsString::from)
            .collect();
        let unrelated: Vec<OsString> = ["/usr/bin/vim"].iter().map(OsString::from).collect();
        assert!(is_browser_main(&main));
        assert!(!is_browser_main(&renderer));
        assert!(!is_browser_main(&unrelated));
        assert!(is_browser_main(&[]));
    }

    #[test]
    fn stale_lock_is_not_running() {
        let dir = tempfile::tempdir().unwrap();
        let lock_target = format!("{}-{}", local_hostname(), 999_999);
        std::os::unix::fs::symlink(lock_target, dir.path().join("SingletonLock")).unwrap();
        let mut detector = Detector::default();
        assert_eq!(detector.running_pid("x", dir.path()), None);
    }

    #[test]
    fn foreign_host_lock_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let lock_target = format!("another-machine-{}", std::process::id());
        std::os::unix::fs::symlink(lock_target, dir.path().join("SingletonLock")).unwrap();
        let mut detector = Detector::default();
        assert_eq!(detector.running_pid("x", dir.path()), None);
    }

    #[test]
    fn remove_data_dir_validates_target() {
        let prefix = tempfile::tempdir().unwrap();
        let good = prefix.path().join("chrome_0123abcd");
        fs::create_dir_all(good.join("Default")).unwrap();

        assert!(remove_data_dir(prefix.path(), "chrome_0123abcd").unwrap());
        assert!(!good.exists());
        assert!(!remove_data_dir(prefix.path(), "chrome_0123abcd").unwrap());

        for bad in ["../etc", "chrome_", "chrome_0123abcz", "chrome_0123abcd/..", "Default"] {
            assert!(remove_data_dir(prefix.path(), bad).is_err(), "{bad}");
        }

        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), prefix.path().join("chrome_deadbeef")).unwrap();
        assert!(remove_data_dir(prefix.path(), "chrome_deadbeef").is_err());
        assert!(outside.path().exists());
    }
}
