# 后端开发规范

---

## 概览

后端为 `src-tauri/` 下的 Rust / Tauri 2 单 crate，无 HTTP 服务、无数据库；以下规范均来自真实代码。

---

## 规范索引

| 规范 | 说明 | 状态 |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Rust 模块职责与新增 command 步骤 | 已填写 |
| [Database Guidelines](./database-guidelines.md) | JSON 持久化、旧版兼容与数据目录不变量 | 已填写 |
| [Error Handling](./error-handling.md) | 中文错误字符串与数据安全错误策略 | 已填写 |
| [Quality Guidelines](./quality-guidelines.md) | CI clippy 常见拦截写法与设计约束 | 已填写 |
| [Logging Guidelines](./logging-guidelines.md) | tauri-plugin-log 与必记事件 | 已填写 |

---
