# 类型安全

- `src/lib/types.ts` 与 `src-tauri/src/models.rs` 一一对应，字段保持 snake_case；修改任一侧必须同步另一侧与 `dev-mock-backend.ts`。
- 所有 invoke 经 `src/lib/api.ts`；**command 参数名在 JS 侧为 camelCase**（Rust `delete_data` → `deleteData`，`profiles_path` → `profilesPath`），payload 结构体内部字段仍为 snake_case。
- Rust 端错误为字符串，统一用 `errorMessage(error)` 转换后展示。
- JSON 配置（`configs/*.json`）通过 `resolveJsonModule` 推断类型；需要 `string[]` 等宽类型时显式复制（如 `[...presets.new_profile.disable_spoofing]`）。
