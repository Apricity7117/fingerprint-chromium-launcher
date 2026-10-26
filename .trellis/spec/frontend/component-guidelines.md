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
