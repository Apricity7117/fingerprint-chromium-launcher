# 类型安全

- `src/lib/types.ts` 与 `src-tauri/src/models.rs` 一一对应，字段保持 snake_case；修改任一侧必须同步另一侧与 `dev-mock-backend.ts`。
- 所有 invoke 经 `src/lib/api.ts`；**command 参数名在 JS 侧为 camelCase**（Rust `delete_data` → `deleteData`，`profiles_path` → `profilesPath`），payload 结构体内部字段仍为 snake_case。
- Rust 端错误为字符串，统一用 `errorMessage(error)` 转换后展示。
- JSON 配置（`configs/*.json`）通过 `resolveJsonModule` 推断类型；需要 `string[]` 等宽类型时显式复制（如 `[...presets.new_profile.disable_spoofing]`）。
- mock（`dev-mock-backend.ts`）必须保持契约形状：错误以字符串 `throw`（同 Rust `Err(String)`）；`stop_profile` 返回 `null`；`create_profile` 忽略传入 id 并补 id / 空名称取种子；`duplicate_profile` 生成新 id、新随机种子与 ` (Copy)` 名称；随机种子上限等取自 `configs/defaults.json`（`random_seed_max`），不在 mock 里另写常量。
- `Profile.fingerprint` 在 Rust 为 `i64`、TS 为 `number`，表单仅接受非负整数（`SEED_PATTERN`），保存时以输入文本为准。
