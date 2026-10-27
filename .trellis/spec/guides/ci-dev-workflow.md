# CI 开发流程规范（本机无 Rust）

> **用途**：本项目的 Rust 编译、测试与 macOS 打包全部在 GitHub Actions 中完成。任何涉及 `src-tauri/`、`.github/workflows/`、`e2e/` 的改动都必须遵循本流程验证。

---

## 环境事实

| 项 | 值 |
|---|---|
| 本机 | macOS（Apple Silicon），**不安装 Rust**，不要尝试本地 `cargo` / `pnpm tauri dev` / `pnpm tauri build` |
| Node | nvm 懒加载；非交互 shell 先执行 `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"` |
| 包管理 | pnpm 11（`pnpm.onlyBuiltDependencies` 需放行 esbuild 等构建脚本） |
| 远端 | `origin = github.com/Apricity7117/fingerprint-chromium-launcher`（**公开仓库**），本机 `gh` 已登录 |
| 已弃用 | jc-raw 等远程主机开发方案已取消，不要使用 |

---

## 分支与提交

- 开发分支：`feat/<主题>`（本次为 `feat/tauri-launcher`）。在开发分支上**允许自动 commit + push**，无需逐次确认。
- `main`：禁止直接推送开发中间提交。合入方式为 PR squash，且**必须经用户确认**；提交信息遵循 git-commit-message 约定（中文）。
- 每次推送前先在本地跑通前端检查，减少无谓的 CI 轮次：

```bash
pnpm lint && pnpm test && pnpm build
```

---

## Actions 节制使用（强制，防账号风险）

用户明确要求 Actions 只用于必要部分，不得频繁运行：

1. 本地能完成的检查（前端 lint / vitest / build）**不上 CI**，推送前必须本地通过。
2. 本地按小步 commit，**攒批到验证检查点再 push**；不要每个小改动都推送。
3. `ci.yml` 的 push 触发带 `paths` 过滤：`.trellis/**`、`*.md` 等文档改动不会触发；只推文档时无需顾虑。
4. 重型 job 按需启用：提交信息含 `[e2e]` 才跑 Linux E2E，含 `[macos]` 才跑 macOS Rust 测试与 macOS 打包。
5. 推送前自审 Rust 代码（类型、借用、clippy 常见告警、`cargo fmt` 风格），尽量一次通过。
6. 全任务运行目标 ≤ 20 次；接近上限时先复盘失败原因，再决定是否继续推送。收尾报告如实列出运行次数。

---

## 开发循环

```bash
git add -A && git commit -m "wip: <改动摘要>"          # 本地可多次提交
git pull --rebase --autostash origin feat/tauri-launcher  # CI 机器人可能已回推格式化 / Cargo.lock 提交
git push origin feat/tauri-launcher                     # 到检查点再推送；需要 E2E 时最后一个提交信息带 [e2e]

# 等待本次 CI 结果（非零退出码表示失败）
RUN_ID=$(gh run list -b feat/tauri-launcher -w ci.yml -L1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status

# 只看失败 job 的日志，定位编译 / 测试错误
gh run view "$RUN_ID" --log-failed | tail -200
```

- 推送后先确认 `gh run list` 中的最新运行对应本次提交（`headSha`），避免读到旧运行结果。
- 同分支新推送会取消旧运行（workflow 设置了 concurrency），不要依赖被取消运行的结果。

---

## Workflows

| Workflow | 触发 | Job | 条件 | 作用 |
|---|---|---|---|---|
| `ci.yml` | push `feat/**`、`main`（paths 过滤）、手动 | `rust-linux` | 总是 | 开发分支 `cargo fmt` 自动格式化（main 为 `--check`）→ clippy `--all-targets -D warnings` → test → 回推格式化与 `Cargo.lock` |
| | | `rust-macos` | `[macos]` / input | clippy → test（macOS 进程与 Info.plist 行为） |
| | | `e2e-linux` | `[e2e]` / input | Xvfb + tauri-driver + WebKitWebDriver 驱动真实应用与 Linux 版 fingerprint-chromium，上传截图 |
| `build-macos.yml` | 仅手动：`gh workflow run build-macos.yml --ref <分支>` | `build` | — | Apple Silicon `.app`（zip，artifact `macos-app`）与 `.dmg`（`macos-dmg`） |

前端检查不在 CI 中，由本地负责。

### Linux apt 依赖安装

`rust-linux` 与 `e2e-linux` 共用本地 composite action `.github/actions/setup-tauri-linux`（包列表单一来源，E2E 通过 `extra-packages` 追加）：

- 先把 runner 默认的 `azure.archive.ubuntu.com` 换成多镜像回退列表（`mirror+file:/etc/apt/ci-mirrors.txt`），并设置 `Acquire::Retries` / `Acquire::http::Timeout` / `DPkg::Lock::Timeout`；该镜像在 runner 上曾长期仅 10–50 KB/s，导致安装卡死。
- 再用 `awalsh128/cache-apt-pkgs-action` 缓存 .deb，命中后不再下载。调整包列表后如需强制重建缓存，递增 action 内的 `version`。
- 超时在调用处的 step 上设置（`timeout-minutes: 15`），composite 内部 step 不支持该字段。

---

## rustfmt 与 Cargo.lock（CI 机器人回推）

本机无法运行 `rustfmt` 与生成 `Cargo.lock`，由 `rust-linux` job 在开发分支上处理：

- 先执行 `cargo fmt`，测试结束后（无论成败）把 `src-tauri/` 下的格式化结果与 `Cargo.lock` 变更以 `💄 style: CI 自动格式化与更新 Cargo.lock` 提交回推。
- 使用 `GITHUB_TOKEN` 推送，**不会**再次触发 workflow，不额外消耗运行次数。
- 因此每次推送前必须 `git pull --rebase --autostash`；`main` 上只做 `cargo fmt --check`，不回推。

---

## 本地界面迭代

- `pnpm dev` 后在 Chrome 中打开（chrome-devtools-profile 技能截图 / 交互）。
- 非 Tauri 环境且 `import.meta.env.DEV` 时，`src/lib/api.ts` 加载 `src/lib/dev-mock-backend.ts`（内存合成数据，遵循同一 commands 契约）。
- mock 只服务界面开发：**不要**在 mock 中复刻 Rust 业务逻辑（参数构建、推荐等）；行为正确性以 Rust 测试与 CI E2E 为准。
- 修改 Tauri command 契约时，必须同步更新 `src/lib/types.ts`、`src/lib/api.ts` 与 mock。

---

## E2E 约定

- 定位元素使用稳定的 `data-testid`，不依赖文案或 CSS 类名。
- 测试数据隔离：HOME / XDG 目录指向临时目录；浏览器数据目录前缀使用临时目录。
- WebDriver 无法操作系统原生文件对话框：导入等依赖对话框的流程在 E2E 中直接 `invoke` 对应 command。
- 夹具一律为合成数据（虚构名称、示例代理地址），禁止使用真实环境数据。
- 失败排查先下载截图 artifact：`gh run download "$RUN_ID" -n e2e-screenshots -D /tmp/e2e`（失败用例自动截图 `FAILED-*.png`）。
- `e2e/` 是独立 pnpm 项目（自有 `pnpm-lock.yaml`）；pnpm 11 需在 `e2e/pnpm-workspace.yaml` 用 `allowBuilds` 显式声明依赖构建脚本（esbuild 允许，Edge / Gecko 驱动下载禁止），否则安装直接失败。
- WebKitWebDriver 不支持 BiDi：capabilities 需 `wdio:enforceWebDriverClassic: true`；WebDriver 的 clear 不一定触发 React onChange，清空输入框用键盘全选删除。
- 测试环境用 `XDG_DATA_HOME` / `XDG_CONFIG_HOME` 指向临时目录隔离应用数据；`--no-sandbox`、`--password-store=basic` 等只写在测试环境的 extra_args，不进默认配置。

---

## macOS 产物安装

```bash
gh run download "$RUN_ID" -n macos-app -D /tmp/fcl-macos
ditto -x -k /tmp/fcl-macos/*.zip /tmp/fcl-macos/app
xattr -dr com.apple.quarantine "/tmp/fcl-macos/app/Fingerprint Chromium Launcher.app"
open "/tmp/fcl-macos/app/Fingerprint Chromium Launcher.app"
```

应用未签名 / 未公证，必须移除 quarantine 才能打开。放入 `/Applications` 等正式位置前需用户确认。

---

## 公开仓库卫生（强制）

- 源码、`configs/`、测试夹具、workflow 中禁止出现：个人绝对路径（如 `/Users/<name>/…`）、真实环境名 / 账号 / 代理地址、任何凭据。
- 默认路径写在 `configs/defaults.json`，按 OS 区分并使用 `~` 展开。
- 提交前自查：

```bash
rg -n '/Users/|/home/' --glob '!.trellis/**' --glob '!.claude/**' --glob '!.codex/**' --glob '!.agents/**' --glob '!.agent/**' --glob '!.pi/**' .
```

---

## 常见错误

| 错误 | 正确做法 |
|---|---|
| 本地执行 `cargo` / `pnpm tauri dev` 验证 Rust | 推送开发分支，看 CI |
| 每个小改动都推送，频繁触发 Actions | 本地攒批提交，到检查点再推送 |
| 普通推送也带 `[e2e]` / `[macos]` | 只在需要验证 E2E / macOS 的检查点使用标记 |
| 读到上一次运行的 CI 结果就宣称通过 | 核对运行的 `headSha` 与本次提交一致 |
| 直接向 `main` 推送 | 只推开发分支；合入 `main` 走 PR 并经用户确认 |
| 在 mock 中实现业务逻辑以“让界面对” | mock 只返回契约形状的数据，逻辑以 Rust 为准 |
| E2E 夹具复制真实 `profiles.json` | 使用合成数据 |
