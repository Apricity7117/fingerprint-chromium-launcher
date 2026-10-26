# 状态管理

- 不引入全局状态库。页面级状态集中在 `App.tsx` 的 `LauncherPage`，通过 props 下发。
- 服务端数据：`useProfiles`（列表 + reload）、`useRunningStatus`（轮询）、`useSettings`（设置 + Chromium 版本）。增删改后调用 `reload()`，不要在前端手动拼接 / 推算后端结果。
- 派生而非同步：当前分组在渲染时计算（记住的分组不存在时回退「全部环境」），不要用 effect 改写 state。
- 列表多选状态由页面持有（`rowSelection`），切换分组、搜索、删除后清空。
- 主题：自写 `ThemeProvider`（`localStorage` + `matchMedia`，切换 `html.dark`），未使用 next-themes（其注入的 `<script>` 在 React 19 下告警）。
