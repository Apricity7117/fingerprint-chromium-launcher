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
