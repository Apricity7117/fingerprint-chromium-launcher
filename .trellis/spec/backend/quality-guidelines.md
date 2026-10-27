# 后端质量规范

## 验证（本机无 Rust，经 CI）

CI `rust-linux` 运行 `cargo clippy --all-targets -- -D warnings` 与 `cargo test`（单元 + 集成）。推送前必须逐行自审，常见会被 `-D warnings` 拦下的写法：

| 写法 | 正确做法 |
|---|---|
| `format!("{}", name)` | 内联 `format!("{name}")`（`uninlined_format_args`）；字段 / 方法调用不能内联 |
| 最后一次使用时 `fs::write(&path_buf, ..)` | `path_buf.as_path()` 或直接移动（`needless_borrows_for_generic_args`） |
| 嵌套 `if let` / `if` | edition 2024 let-chains：`if let Some(x) = a && cond { }`（`collapsible_if`） |
| `let v = vec![..]; f(&v)` | 数组 `[..]`（`useless_vec`） |
| `&[x.clone()]` | `std::slice::from_ref(&x)` |
| `starts_with("~/")` 后切片 | `strip_prefix`（`manual_strip`） |
| `let mut p = T::default(); p.x = ..` | 结构体更新语法 `T { x, ..T::default() }` |

## 设计约束

- 业务逻辑放 `AppState` / `Store` 方法，command 只做 `spawn_blocking` 包装：不在异步工作线程里阻塞（停止进程最多等待 `stop_timeout_ms`）。
- 启动参数只能由 `chromium::build_args` 生成，预览与启动共用，禁止在前端或别处拼接。
- 运行状态只来自 `SingletonLock` 检测，禁止维护内存中的「运行实例表」。
- 测试：纯逻辑写模块内单元测试；涉及进程 / 文件系统的流程写 `tests/` 集成测试（临时目录 + 假 Chromium），不得依赖真实浏览器或用户数据。

## 进程管理约定（`process.rs`）

- 启动：`Command::process_group(0)` + stdin/stdout/stderr 设为 null，并另起线程 `child.wait()` 回收，避免僵尸进程；启动器退出不影响浏览器。
- 判活：`kill(pid, 0)`，`EPERM` 视为存活；`SingletonLock` 主机名不一致、僵尸进程、命令行含 `--type=` 的子进程均视为未运行。
- 停止：SIGTERM → 每 100ms 判活 → 超过 `configs/defaults.json` 的 `stop_timeout_ms` 后 SIGKILL（再等 2 秒仍存活才报错）。
- 删除数据目录只能经 `process::remove_data_dir`，不得在别处直接 `remove_dir_all`。

## 公开仓库卫生

- 单元测试、集成测试与 fixture 使用虚构 ID（如 `0123456789abcdef`）、虚构主机名（`example`）和示例路径，禁止出现真实环境 ID、账号、代理与个人路径。
