# 前端质量规范

## 本地检查（推送前必过，CI 不再重复）

```bash
pnpm lint && pnpm test && pnpm build
```

## 规则

- 界面改动在 `pnpm dev` + chrome-devtools-profile 中截图自查（亮 / 暗、卡片 / 列表、1280×820 默认窗口宽度下列表不溢出）。
- 生产构建不得包含 `dev-mock-backend`：`api.ts` 中以 `import.meta.env.DEV && !isTauri()` 包裹动态 import；改动后用 `grep -l mockInvoke dist/assets/*.js` 确认。
- 依赖版本：`@tanstack/react-table` 锁定 v8（v9 API 与 shadcn 示例不兼容）；shadcn 组件依赖其官方 `cn` 包。
- 禁止：在 mock 中实现业务逻辑；在组件中拼接启动命令；在组件中硬编码选项列表（应放 `configs/`）。
