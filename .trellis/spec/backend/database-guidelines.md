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
