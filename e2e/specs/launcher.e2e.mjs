// 启动器端到端流程：真实应用 + 真实 Linux 版 fingerprint-chromium，数据目录均为临时目录。
import { $, browser, expect } from "@wdio/globals";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(here, "../screenshots");
const fixtureProfiles = path.resolve(here, "../fixtures/legacy/profiles.json");

const CHROMIUM = requiredEnv("E2E_CHROMIUM");
const BROWSER_DATA = requiredEnv("E2E_BROWSER_DATA");
// 测试专用参数：CI 环境无密钥环与 GPU，沙箱由 CI 解除 userns 限制后仍保守关闭
const EXTRA_ARGS = "--password-store=basic --no-first-run --no-sandbox --disable-dev-shm-usage --disable-gpu";
// Chromium 在 CI 的 xvfb 中冷启动较慢，等待状态切换时留足余量
const STATE_TIMEOUT = 45000;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

const byId = (id) => $(`[data-testid="${id}"]`);
const dataDir = (id) => path.join(BROWSER_DATA, `chrome_${id.slice(0, 8)}`);
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function click(id) {
  const element = await byId(id);
  await element.waitForClickable();
  await element.click();
}

/**
 * 读取元素 textContent。
 * WebDriver 的 Get Element Text 对被可见性判定为不可见的元素（如 Dialog 动画中）返回空串，故不使用 getText。
 */
async function text(id) {
  const value = await browser.execute((selector) => document.querySelector(selector)?.textContent ?? null, `[data-testid="${id}"]`);
  return value === null ? null : value.trim();
}

/** 等待元素文本等于期望值，超时信息带上最后读到的实际值 */
async function expectText(id, expected, timeout = 10000) {
  let last = null;
  await browser.waitUntil(
    async () => {
      last = await text(id);
      return last === expected;
    },
    { timeout, interval: 300, timeoutMsg: `${id} 文本应为 ${JSON.stringify(expected)}，实际为 ${JSON.stringify(last)}` },
  );
}

/** 等待元素文本包含片段，返回最终文本 */
async function waitForTextIncludes(id, fragment, timeout = 15000) {
  let last = null;
  await browser.waitUntil(
    async () => {
      last = await text(id);
      return last !== null && last.includes(fragment);
    },
    { timeout, interval: 300, timeoutMsg: `${id} 文本应包含 ${JSON.stringify(fragment)}，实际为 ${JSON.stringify(last)}` },
  );
  return last;
}

/** 关闭残留的 Dialog / Popover，避免失败用例影响后续用例 */
async function dismissOverlays() {
  for (let i = 0; i < 4; i += 1) {
    const open = await browser.execute(
      () => document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"], [data-radix-popper-content-wrapper]') !== null,
    );
    if (!open) return;
    await browser.keys("Escape");
    await browser.pause(300);
  }
}

async function screenshot(name) {
  await browser.saveScreenshot(path.join(screenshotDir, `${name}.png`));
}

/**
 * 直接调用 Tauri command（用于原生文件对话框等 WebDriver 无法操作的流程）。
 * WebdriverIO 10 已移除 executeAsync；传入真正的 async 函数时，execute 内部走 executeAsyncScript 并等待 Promise。
 */
async function invoke(cmd, args = {}) {
  return browser.execute(
    async (command, payload) => {
      try {
        return { ok: await window.__TAURI_INTERNALS__.invoke(command, payload) };
      } catch (error) {
        return { err: String(error) };
      }
    },
    cmd,
    args,
  );
}

async function profileByName(name) {
  const { ok } = await invoke("list_profiles");
  const profile = ok.find((item) => item.name === name);
  if (!profile) throw new Error(`未找到环境 ${name}`);
  return profile;
}

async function runningState(id) {
  const element = await $(`[data-testid="status-${id}"] [data-state]`);
  return element.getAttribute("data-state");
}

async function waitForState(id, state, timeout = STATE_TIMEOUT) {
  await browser.waitUntil(async () => (await runningState(id)) === state, {
    timeout,
    interval: 500,
    timeoutMsg: `环境 ${id} 未在 ${timeout}ms 内变为 ${state}`,
  });
}

async function waitForToast(fragment) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (part) => [...document.querySelectorAll("[data-sonner-toast]")].some((el) => el.textContent.includes(part)),
        fragment,
      ),
    { timeout: 10000, timeoutMsg: `未出现提示「${fragment}」` },
  );
}

async function waitForApp() {
  await (await byId("page-title")).waitForDisplayed({ timeout: 30000 });
  await browser.waitUntil(async () => !(await (await byId("profiles-loading")).isExisting()), { timeout: 15000 });
}

/** 按 DOM 顺序读取列表行的环境 ID（WebdriverIO 10 的 $$ 结果不是普通数组，改在页面内读取） */
async function rowIds() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid^="profile-row-"]'), (row) =>
      row.getAttribute("data-testid").replace("profile-row-", ""),
    ),
  );
}

/** 进程是否存活：僵尸进程（已退出待回收）视为已退出 */
function isProcessAlive(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return false;
  }
}

/** 清空受控输入框：WebDriver 的 clear 不一定触发 React onChange，改用键盘全选删除 */
async function clearInput(id) {
  const input = await byId(id);
  await input.click();
  await browser.keys(["Control", "a"]);
  await browser.keys("Backspace");
}

describe("指纹浏览器启动器", () => {
  let alpha;
  let beta;
  let launchedPid;

  before(async () => {
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.mkdirSync(BROWSER_DATA, { recursive: true });
    await waitForApp();
  });

  // 每个用例前关闭上一个用例残留的弹层，保持用例相对独立
  beforeEach(async () => {
    await dismissOverlays();
  });

  it("首次启动显示空状态", async () => {
    await expect(byId("empty-state")).toBeDisplayed();
    await screenshot("01-empty");
  });

  it("设置 Chromium 路径后识别版本为 142（使用 GPU 参数）", async () => {
    await click("open-settings");
    await (await byId("settings-chromium-path")).setValue(CHROMIUM);
    await (await byId("settings-data-dir")).setValue(BROWSER_DATA);
    await waitForTextIncludes("chromium-version", "142.0.7444.175");
    await expect($('[data-testid="chromium-version"] [data-mode="legacy"]')).toBeExisting();
    await screenshot("02-settings");
    await click("settings-save");
    await waitForToast("全局设置已保存");
  });

  it("通过表单新建环境并创建新分组", async () => {
    await click("new-profile");
    await (await byId("form-name")).setValue("e2e-alpha");
    await click("form-group");
    await (await byId("form-group-input")).setValue("alpha");
    await click("form-group-create");
    await (await byId("form-extra-args")).setValue(EXTRA_ARGS);
    const preview = await waitForTextIncludes("command-preview", "--password-store=basic");
    expect(preview).toContain("--fingerprint-gpu-vendor=Apple");
    expect(preview).toContain("chrome_<保存后生成>");
    await screenshot("03-form");
    await click("form-save");
    await (await byId("profile-form")).waitForDisplayed({ reverse: true });
    await waitForToast("已创建「e2e-alpha」");

    alpha = await profileByName("e2e-alpha");
    expect(alpha.group).toBe("alpha");
    expect(alpha.fingerprint).toBe(1018);
    await expect(byId(`profile-card-${alpha.id}`)).toBeDisplayed();
    await expectText("group-count-alpha", "1");
  });

  it("预览命令与实际启动命令一致，并写入默认偏好", async () => {
    const created = await invoke("create_profile", {
      profile: { ...alpha, id: "", name: "e2e-beta", group: "beta", fingerprint: 2000 },
    });
    beta = created.ok;
    await browser.refresh();
    await waitForApp();
    await expectText("group-count-all", "2");

    await click(`edit-${alpha.id}`);
    const preview = await waitForTextIncludes("command-preview", `chrome_${alpha.id.slice(0, 8)}`);
    await click("copy-command");
    await waitForToast("已复制启动命令");
    await browser.keys("Escape");
    await (await byId("profile-form")).waitForDisplayed({ reverse: true });

    const launched = await invoke("launch_profile", { id: alpha.id });
    expect(launched.err).toBeUndefined();
    expect(launched.ok.command).toBe(preview);
    launchedPid = launched.ok.pid;

    await waitForState(alpha.id, "running");
    await expectText("running-count", "1");
    const prefs = JSON.parse(fs.readFileSync(path.join(dataDir(alpha.id), "Default", "Preferences"), "utf8"));
    expect(prefs.bookmark_bar.show_tab_groups).toBe(false);
    expect(prefs.credentials_enable_service).toBe(true);
    await screenshot("04-running");
  });

  it("重启启动器后仍识别运行中的实例，且拒绝重复启动", async () => {
    await browser.reloadSession();
    await waitForApp();
    await waitForState(alpha.id, "running");
    expect(isProcessAlive(launchedPid)).toBe(true);

    const again = await invoke("launch_profile", { id: alpha.id });
    expect(again.err).toContain("已在运行");
  });

  it("停止后状态变为已停止，浏览器进程退出", async () => {
    await click(`stop-${alpha.id}`);
    await waitForState(alpha.id, "stopped");
    await browser.waitUntil(async () => !isProcessAlive(launchedPid), { timeout: 15000 });
  });

  it("切换列表视图并持久化，按列排序与搜索", async () => {
    await click("view-list");
    await expect(byId("profile-table")).toBeDisplayed();
    await browser.refresh();
    await waitForApp();
    await expect(byId("profile-table")).toBeDisplayed();

    await click("sort-fingerprint");
    expect(await rowIds()).toEqual([alpha.id, beta.id]);
    await click("sort-fingerprint");
    expect(await rowIds()).toEqual([beta.id, alpha.id]);

    await (await byId("search-input")).setValue("beta");
    await browser.waitUntil(async () => (await rowIds()).length === 1);
    expect(await rowIds()).toEqual([beta.id]);
    await clearInput("search-input");
    await browser.waitUntil(async () => (await rowIds()).length === 2);
    await screenshot("05-list");
  });

  it("多选后批量启动与批量停止", async () => {
    await click("view-list");
    await click("select-all");
    await click("batch-launch");
    await waitForState(alpha.id, "running");
    await waitForState(beta.id, "running");
    await expectText("running-count", "2");
    await screenshot("06-batch-running");

    await click("batch-stop");
    await waitForState(alpha.id, "stopped");
    await waitForState(beta.id, "stopped");
    await click("select-all");
  });

  it("克隆环境，并删除克隆及其数据目录", async () => {
    await click(`more-${beta.id}`);
    await click(`duplicate-${beta.id}`);
    await waitForToast("已克隆为「e2e-beta (Copy)」");
    const copy = await profileByName("e2e-beta (Copy)");
    expect(copy.id).not.toBe(beta.id);
    expect(copy.fingerprint).not.toBe(beta.fingerprint);

    fs.mkdirSync(path.join(dataDir(copy.id), "Default"), { recursive: true });
    await click(`more-${copy.id}`);
    await click(`delete-${copy.id}`);
    await click("delete-data-checkbox");
    await click("confirm-delete");
    await waitForToast("环境与本地数据已删除");
    await browser.waitUntil(async () => !(await rowIds()).includes(copy.id));
    expect(fs.existsSync(dataDir(copy.id))).toBe(false);
  });

  it("导入旧版数据按 ID 去重，且不修改源文件", async () => {
    const before = sha256(fixtureProfiles);
    const first = await invoke("import_legacy_data", { profilesPath: fixtureProfiles, importSettings: false });
    expect(first.ok).toEqual({ added: 3, skipped: 0, settings_imported: false });
    await browser.refresh();
    await waitForApp();
    await expectText("group-count-all", "5");
    await expectText("group-count-team-a", "2");
    await expectText("group-count-未分组", "1");

    const imported = (await invoke("list_profiles")).ok.find((item) => item.id === "eeee5555ffff6666");
    expect(imported.proxy_server).toBe("");
    expect(imported.disable_encryption).toBe(false);

    const second = await invoke("import_legacy_data", { profilesPath: fixtureProfiles, importSettings: false });
    expect(second.ok).toEqual({ added: 0, skipped: 3, settings_imported: false });
    expect(sha256(fixtureProfiles)).toBe(before);
  });

  it("侧栏分组切换并在重开后恢复", async () => {
    await click("group-team-a");
    await expectText("page-title", "team-a");
    await expectText("visible-count", "2 个环境");
    await browser.refresh();
    await waitForApp();
    await expectText("page-title", "team-a");
    await click("group-all");
    await expectText("page-title", "全部环境");
  });

  it("主题切换为深色并在重开后保持", async () => {
    await click("view-card");
    await click("theme-toggle");
    await click("theme-dark");
    await browser.waitUntil(async () => browser.execute(() => document.documentElement.classList.contains("dark")));
    await browser.refresh();
    await waitForApp();
    expect(await browser.execute(() => document.documentElement.classList.contains("dark"))).toBe(true);
    await screenshot("07-dark-cards");
  });

  it("编辑已有环境的名称与代理，刷新后界面与后端都保持新值", async () => {
    await click(`edit-${alpha.id}`);
    await (await byId("profile-form")).waitForDisplayed();
    await clearInput("form-name");
    await (await byId("form-name")).addValue("e2e-alpha-edited");
    await clearInput("form-proxy");
    await (await byId("form-proxy")).addValue("socks5://127.0.0.1:19999");
    await click("form-save");
    await (await byId("profile-form")).waitForDisplayed({ reverse: true });
    await waitForToast("环境已更新");

    await browser.refresh();
    await waitForApp();
    await waitForTextIncludes(`profile-card-${alpha.id}`, "e2e-alpha-edited");
    await waitForTextIncludes(`profile-card-${alpha.id}`, "socks5://127.0.0.1:19999");

    const saved = (await invoke("list_profiles")).ok.find((item) => item.id === alpha.id);
    expect(saved.name).toBe("e2e-alpha-edited");
    expect(saved.proxy_server).toBe("socks5://127.0.0.1:19999");
    // 未编辑的字段保持不变
    expect(saved.fingerprint).toBe(alpha.fingerprint);
    expect(saved.group).toBe("alpha");
  });

  it("列表视图多选批量删除并同时删除数据目录，其他环境不受影响", async () => {
    const doomed = [];
    for (const [index, name] of ["e2e-del-1", "e2e-del-2"].entries()) {
      const created = await invoke("create_profile", {
        profile: { ...alpha, id: "", name, group: "doomed", fingerprint: 3001 + index },
      });
      expect(created.err).toBeUndefined();
      fs.mkdirSync(path.join(dataDir(created.ok.id), "Default"), { recursive: true });
      doomed.push(created.ok.id);
    }
    expect(fs.existsSync(dataDir(beta.id))).toBe(true);

    await browser.refresh();
    await waitForApp();
    await click("view-list");
    await browser.waitUntil(async () => {
      const ids = await rowIds();
      return doomed.every((id) => ids.includes(id));
    });

    for (const id of doomed) await click(`select-${id}`);
    await click("batch-delete");
    await click("delete-data-checkbox");
    await click("confirm-delete");
    await waitForToast("环境与本地数据已删除");

    await browser.waitUntil(async () => {
      const ids = await rowIds();
      return doomed.every((id) => !ids.includes(id));
    });
    const remaining = (await invoke("list_profiles")).ok.map((item) => item.id);
    for (const id of doomed) {
      expect(remaining).not.toContain(id);
      expect(fs.existsSync(dataDir(id))).toBe(false);
    }
    expect(remaining).toContain(alpha.id);
    expect(remaining).toContain(beta.id);
    expect(fs.existsSync(dataDir(beta.id))).toBe(true);
    const ids = await rowIds();
    expect(ids).toContain(alpha.id);
    expect(ids).toContain(beta.id);
  });
});
