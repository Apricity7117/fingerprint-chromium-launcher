# 组件规范

- 界面文案使用中文；技术名词（Proxy、Accept-Language、GPU）可保留英文。
- 优先组合 `components/ui` 中的 shadcn 组件；卡片与列表共用 `ProfileActions`，不要复制操作按钮逻辑。
- 对话框的表单状态放在 `DialogContent` 内部的子组件，并以 `key` 区分新建 / 编辑，关闭即卸载、打开即重新初始化，避免用 effect 同步 props 到 state。
- **E2E 依赖 `data-testid`**：新增可交互元素必须加稳定 testid，命名 `动作-环境ID`（如 `launch-<id>`、`more-<id>`）或语义名（`new-profile`、`search-input`、`group-<分组名>`、`group-count-<分组名>`）。修改 / 删除 testid 前搜索 `e2e/specs`。
- 状态文本元素带 `data-state="running|stopped"`，供测试读取，不依赖文案。

## TanStack Table（列表视图）

- 列定义必须是模块级常量（`COLUMNS`），随轮询变化的数据（运行状态、pending、回调）通过 `meta` 传入。
- 原因：`flexRender` 把 `cell` / `header` 函数当组件渲染，列定义随渲染重建会让每次轮询（2s）都重挂载全部单元格，导致闪烁、焦点丢失与 E2E 元素失效。
- 需要按运行状态排序时，在 `data` 中附加派生字段（`running`），不要在 `sortingFn` 中读外部状态。
- 列宽集中在 `COLUMN_SIZES`，表格使用 `table-fixed` + 每列 `size`：默认窗口（1280 宽含侧栏，内容区约 974px）下含分组列的总宽须 ≤ 内容区；名称 / 硬件 / 代理等长内容用 `block truncate` + `title` 省略，不要用 `max-w-*` 撑开列宽。
- 操作列 `sticky right-0` 仅作为窄窗口（最小 960 宽）横向滚动时的兜底，默认宽度下不应出现横向滚动。新增列时先核对总宽预算（改完用 `pnpm dev` 在 1280 宽下检查 `data-slot="table-container"` 的 `scrollWidth <= clientWidth`）。

## 原生能力入口

- 文件 / 目录选择：`@tauri-apps/plugin-dialog` 的 `open`（仅 `settings-dialog.tsx` 使用）；剪贴板经 `lib/clipboard.ts`（Tauri 插件，浏览器预览回退 Web API）。
- 新增原生插件调用时，需在 `src-tauri/capabilities/default.json` 声明最小权限（当前为 `core:window:allow-start-dragging`、`core:window:allow-set-theme`、`dialog:allow-open`、`clipboard-manager:allow-write-text`），否则前端调用被沙箱拒绝。
- 标题栏为 macOS `Overlay` 样式：顶部 28px 由 `TitleBarDragRegion` 占位（侧栏与内容区各一个，带 `data-tauri-drag-region`），新增顶层布局时保留它；原生窗口外观由 `ThemeProvider` 经 `setTheme` 同步，「跟随系统」必须传 `null`。
- 批量操作（启动 / 停止）用 `Promise.allSettled` 并经 `summarize` 汇总为一条 toast，失败信息取首个错误。
