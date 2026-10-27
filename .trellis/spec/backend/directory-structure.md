# 后端目录结构（Rust / Tauri）

> 后端位于 `src-tauri/`，单 crate（lib 名 `fingerprint_chromium_launcher_lib`），所有模块 `pub`，便于集成测试直接调用。

## 模块职责

| 文件 | 职责 |
|---|---|
| `src/lib.rs` | 声明模块、注册插件（log / dialog / clipboard-manager）、`setup` 中按 `app_data_dir` 构造 `AppState`、注册 commands |
| `src/commands.rs` | `AppState`（业务方法）+ `#[tauri::command]` 薄包装 |
| `src/store.rs` | `profiles.json` / `settings.json` 读写、CRUD、旧版导入 |
| `src/models.rs` | 与前端共享的数据结构（serde，字段 snake_case） |
| `src/config.rs` | `include_str!` 嵌入 `configs/*.json`，`LazyLock` 全局只读 |
| `src/chromium.rs` | 版本检测、数据目录命名、启动参数构建、命令展示（启动与预览共用） |
| `src/preferences.rs` | `Default/Preferences` 深合并写入 |
| `src/process.rs` | 脱钩启动、`SingletonLock` 运行检测、SIGTERM→SIGKILL、数据目录安全删除 |
| `src/fsutil.rs` | 原子写 JSON、`~` 展开 |
| `tests/backend_flow.rs` | 集成测试：假 Chromium 驱动完整生命周期 |
| `tests/fixtures/fake-chromium.sh` | 假 Chromium：写 `SingletonLock`，可选忽略 SIGTERM，响应 `--version` |

## 新增一个 command 的步骤

1. 业务逻辑写成 `AppState` 方法（或 `Store` 方法），返回 `Result<T, String>`，可在集成测试中直接调用。
2. 在 `commands.rs` 增加 `#[tauri::command] pub async fn xxx(app: AppHandle, ...) -> CmdResult<T>`，内部 `blocking(app, move |state| state.xxx(...)).await`。
3. 在 `lib.rs` 的 `generate_handler!` 注册；如用到插件能力，更新 `capabilities/default.json`。
4. 同步更新前端 `src/lib/types.ts`、`src/lib/api.ts`、`src/lib/dev-mock-backend.ts`（参数名在 JS 侧为 camelCase）。

## 约束

- 可调参数放仓库根 `configs/`（Rust 与前端共用），源码只保留稳定常量。
- 进程相关代码只支持 Unix（macOS / Linux），使用 `std::os::unix` 与 `libc`。
