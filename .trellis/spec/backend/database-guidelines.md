# 持久化（JSON 文件，无数据库）

## 存储位置

`app.path().app_data_dir()`：macOS `~/Library/Application Support/com.apricity.fingerprint-chromium-launcher/`，Linux `$XDG_DATA_HOME/<identifier>/`（E2E 借此隔离数据）。

## 读写规则（`store.rs`）

- 所有「读 → 改 → 写」经 `Store::modify` 在同一 `Mutex` 内完成，防止前端并发 invoke（批量操作）互相覆盖。
- 写入一律 `fsutil::write_json_atomic`（临时文件 + `rename`），格式化 JSON + 结尾换行。
- 与旧版 Python 启动器 JSON 完全兼容：
  - `Profile` 使用容器级 `#[serde(default)]`（缺字段取旧版 `ProfileModel` 默认值）+ 字段级 `null_as_default`（`null` 视为默认）；
  - `#[serde(flatten)] extra` 原样保留未知字段，更新时合并旧记录的 `extra`；
  - `Settings` 忽略旧版 `port`。

## 不变量

- 环境 ID 为 16 位小写十六进制；数据目录名固定 `chrome_{id 前 8 位}`（与旧版一致），新 ID 生成时保证前 8 位不与已有环境冲突。
- 导入按数据目录名去重（已存在跳过），只读源文件。

## Chromium 启动偏好（`preferences.rs`）

### 1. 适用范围

浏览器启动前写入 `Default/Preferences`；区分启动器强制偏好与仅初始化的用户默认值，避免重置用户主动选择。

### 2. 接口

`ensure_launcher_preferences(user_data_dir: &Path) -> Result<(), String>` 由 `AppState::launch` 在创建浏览器进程前调用，继续复用 `merge_preferences` 和 `write_json_atomic`。

### 3. 字段契约

- 默认值来源：`configs/defaults.json` 的 `launcher_preferences.password_manager.biometric_authentication_filling`，默认 `false`。
- 文件字段：`password_manager.biometric_authentication_filling`；不是 `profile` 下的字段。
- 此字段仅在缺失或非布尔时初始化，已保存的布尔选择必须保留；其他启动器偏好仍按原规则覆盖。
- 配置在编译期嵌入，修改默认值需要重新构建启动器。

### 4. 校验与错误矩阵

| 输入 | 写入行为 |
|---|---|
| 已保存 `true` / `false` | 保留原值，重复启动也不重置 |
| 字段缺失、`null`、字符串、数值、数组或对象 | 使用配置默认值 |
| `password_manager` 非对象 | 沿用递归合并的对象重建规则 |
| 文件不存在、损坏或顶层非对象 | 沿用原有重建规则并初始化默认值 |
| 写入失败 | 返回原子写入函数的中文错误，阻止本次启动 |

### 5. 正常、基线与异常案例

- 正常：已有 `{"password_manager":{"biometric_authentication_filling":true}}`，合并后仍为 `true`。
- 基线：已有 `{}`，合并后该字段为 `false`。
- 异常：已有字段为字符串 `"true"`，修复为布尔 `false`；同级无关字段保留。

### 6. 必需测试

- `preferences.rs`：新建默认值、已有布尔选择、缺失与异常字段、重复执行、损坏文件，以及同级字段保留和其他默认偏好仍覆盖。
- `tests/backend_flow.rs` 的 `full_profile_lifecycle`：解析启动时实际写出的 JSON，断言该字段为 `false`。
- 文件系统测试使用临时目录；本机不执行 Rust 检查，CI 运行测试及 Clippy。

### 7. 错误与正确写法

- 错误：只新增默认配置后直接合并全部 `DEFAULTS.launcher_preferences`，会把已有开启状态覆盖成关闭。
- 正确：现有字段为有效布尔值时，从本次默认偏好副本移除该字段，再按原机制合并其他字段并原子写入；不要修改通用合并函数的覆盖语义。
