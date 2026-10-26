# 前端目录结构

```
src/
├── App.tsx                    # LauncherPage：组合侧栏、工具栏、视图与对话框，持有页面级状态与操作
├── main.tsx / index.css       # 入口；Tailwind v4 + shadcn 主题变量（含中文字体回退）
├── components/
│   ├── ui/                    # shadcn 生成组件（radix-nova 风格），尽量不手改
│   ├── app-sidebar.tsx        # 左侧分组导航
│   ├── profile-grid.tsx       # 卡片视图
│   ├── profile-table.tsx      # 列表视图（TanStack Table v8）
│   ├── profile-actions.tsx    # 卡片与列表共用的启动/停止/编辑/更多操作
│   ├── profile-form-dialog.tsx / group-combobox.tsx
│   ├── settings-dialog.tsx / delete-profiles-dialog.tsx
│   └── theme-provider.tsx / theme-toggle.tsx / status-indicator.tsx / platform-icon.tsx
├── hooks/                     # use-profiles / use-running-status / use-settings / use-local-storage / use-mobile
└── lib/
    ├── api.ts                 # Tauri commands 的类型化封装（唯一前后端边界）
    ├── types.ts               # 与 src-tauri/src/models.rs 对齐的类型
    ├── presets.ts             # 导入 configs/*.json
    ├── profile-utils.ts(+test)# 纯函数：分组、过滤、默认值、联动规则
    ├── clipboard.ts           # 剪贴板（Tauri 插件 / Web API 回退）
    ├── dev-mock-backend.ts    # 仅 dev 浏览器预览的内存 mock
    └── utils.ts               # shadcn cn
```

- 新业务组件放 `components/`（kebab-case 文件名，PascalCase 组件名），纯逻辑放 `lib/` 并配 vitest。
- 选项表与可调参数从 `@/lib/presets` 读取，禁止在组件中硬编码。
