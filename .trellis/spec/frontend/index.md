# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

前端（Tauri 2 WebView 内的 React 19 + TypeScript + shadcn/ui + Tailwind v4）开发约定。后端约定见 `../backend/`，跨 CI 的流程约定见 `../guides/ci-dev-workflow.md`。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | src 目录布局与组件 / 逻辑归属 | Filled |
| [Component Guidelines](./component-guidelines.md) | shadcn 组合、data-testid 约定、TanStack 列定义稳定性 | Filled |
| [Hook Guidelines](./hook-guidelines.md) | React Compiler lint 下的数据加载与轮询 | Filled |
| [State Management](./state-management.md) | 页面级状态、派生状态、主题 | Filled |
| [Quality Guidelines](./quality-guidelines.md) | 本地检查、截图自查与禁止事项 | Filled |
| [Type Safety](./type-safety.md) | Rust/TS 契约对齐与 invoke 参数命名 | Filled |

---

## Notes

- 文档以实际代码为准（不写理想状态）；修改代码约定时同步更新对应文件。
- 本目录文档使用中文，代码标识符保持英文。
