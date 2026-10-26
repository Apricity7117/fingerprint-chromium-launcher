# Fingerprint Chromium Launcher

[fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium) 的桌面启动器（Tauri 2 + React 19 + shadcn/ui），用图形界面管理多个相互隔离的指纹浏览器环境，替代手动拼接命令行参数。

## 功能概述

- **环境管理**：新建 / 编辑 / 克隆 / 删除环境；删除时可同时清理本地数据目录（带安全校验，只会删除 `<前缀>/chrome_<ID 前 8 位>`）。
- **左侧分组导航**：「全部环境」与各分组（含数量），记住上次选择的分组。
- **卡片 / 列表双视图**：列表视图支持按名称、分组、状态、平台、种子排序，多选后批量启动 / 停止 / 删除；支持按名称、种子、代理搜索。
- **指纹推荐**：按平台与种子确定性推荐 GPU 与 CPU 核心数；Chrome + macOS 时 GPU 型号为 Apple 芯片下拉并联动核心数，语言联动 Accept-Language。
- **Chromium 版本适配**：自动识别 Chromium 主版本。
  - < 144：使用 `--fingerprint-gpu-vendor` / `--fingerprint-gpu-renderer` / `--disable-gpu-fingerprint`；
  - ≥ 144：改用 `--disable-spoofing=font,audio,canvas,clientrects,gpu` 多选；
  - 无法识别：两套参数都输出（Chromium 会忽略不支持的参数）。
- **完整命令预览**：表单底部实时显示与实际启动完全一致的命令，可一键复制。
- **浏览器常驻**：浏览器与启动器进程脱钩，关闭启动器不影响已打开的浏览器；重启启动器后通过数据目录中的 `SingletonLock` 自动识别运行中的环境（包括旧版启动器或手动启动的实例）。
- **默认偏好**：每次启动前合并写入 `Default/Preferences`：隐藏书签栏标签页组入口，启用保存密码、自动登录与 passkey 自动升级；默认附加 `--no-default-browser-check`。
- **主题**：默认跟随系统，可切换浅色 / 深色。

## 安装（macOS，Apple Silicon）

应用由 GitHub Actions 构建，未签名、未公证。下载与安装：

```bash
# 在仓库 Actions 中找到 Build macOS 的成功运行，记下 run id
gh run download <run-id> -R Apricity7117/fingerprint-chromium-launcher -n macos-app -D /tmp/fcl
ditto -x -k /tmp/fcl/fingerprint-chromium-launcher-macos.zip /tmp/fcl/app
xattr -dr com.apple.quarantine "/tmp/fcl/app/Fingerprint Chromium Launcher.app"
mv "/tmp/fcl/app/Fingerprint Chromium Launcher.app" /Applications/
```

## 使用

1. 打开「全局设置」，确认 **Chromium 可执行文件路径**（默认 `/Applications/Chromium.app/Contents/MacOS/Chromium`，也可直接选择 `.app`）与 **用户数据目录前缀**。设置中会显示识别到的 Chromium 版本与参数模式。
2. **从旧版启动器迁移**：在「全局设置 → 导入旧版数据」中选择旧版 `data/profiles.json`。
   - 按环境 ID 去重合并，已存在的环境会跳过，旧文件不会被修改；
   - 勾选「同时导入同目录的 settings.json」可同步 Chromium 路径与数据目录前缀；
   - 数据目录命名与旧版一致（`chrome_<ID 前 8 位>`），导入后原有浏览器数据可直接继续使用。
3. 点击「新建环境」创建环境，或在卡片 / 列表中启动、停止、编辑。

## 数据位置

| 内容 | macOS 路径 |
|---|---|
| 环境配置 `profiles.json`、全局设置 `settings.json` | `~/Library/Application Support/com.apricity.fingerprint-chromium-launcher/` |
| 启动器日志（含实际启动命令） | `~/Library/Logs/com.apricity.fingerprint-chromium-launcher/` |
| 浏览器数据 | `<用户数据目录前缀>/chrome_<ID 前 8 位>/` |

## 注意事项

- 启动器默认不追加 `--disable-encryption`，沿用 Chromium 原生本地加密保护 Cookie、密码等数据；手动开启会降低本地数据保护强度。
- 本工具不提供目录级或整盘加密，不能替代 FileVault 等系统级保护。
- 可调参数（默认路径、推荐表、选项列表、轮询间隔、停止超时等）位于 `configs/`，编译时打包，修改后需重新构建。

## 开发

本机只需 Node 24 与 pnpm 11；**Rust 编译、测试与 macOS 打包均在 GitHub Actions 中完成**，开发流程规范见 [`.trellis/spec/guides/ci-dev-workflow.md`](.trellis/spec/guides/ci-dev-workflow.md)。

```bash
pnpm install
pnpm dev            # 浏览器预览（非 Tauri 环境自动使用内存 mock 后端）
pnpm lint && pnpm test && pnpm build
```

| 目录 | 说明 |
|---|---|
| `src/` | React 前端（shadcn/ui 组件、hooks、类型化 API 封装） |
| `src-tauri/` | Rust 后端：存储、指纹推荐、参数构建、进程管理；`tests/` 为集成测试 |
| `configs/` | Rust 与前端共用的可调参数与选项表 |
| `e2e/` | WebdriverIO + tauri-driver 的 Linux 端到端测试 |
| `.github/workflows/` | `ci.yml`（Rust 检查与 E2E）、`build-macos.yml`（macOS 打包） |
