// Linux E2E：WebdriverIO 经 tauri-driver（代理 WebKitWebDriver）驱动真实应用。
// 由 CI 在 xvfb 下运行，应用需预先以 `pnpm tauri build --debug --no-bundle` 构建。
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const application = path.resolve(here, "../src-tauri/target/debug/fingerprint-chromium-launcher");
const tauriDriverPath = process.env.TAURI_DRIVER ?? path.join(os.homedir(), ".cargo", "bin", "tauri-driver");
export const screenshotDir = path.resolve(here, "screenshots");

let tauriDriver;
let exiting = false;

function closeTauriDriver() {
  exiting = true;
  tauriDriver?.kill();
}

export const config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.e2e.mjs"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      // WebKitWebDriver 不支持 WebDriver BiDi，强制使用经典协议
      "wdio:enforceWebDriverClassic": true,
      "tauri:options": { application },
    },
  ],
  logLevel: "warn",
  waitforTimeout: 15000,
  connectionRetryCount: 2,
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 120000 },

  onPrepare() {
    if (!fs.existsSync(application)) {
      throw new Error(`未找到应用二进制，请先构建: ${application}`);
    }
    fs.mkdirSync(screenshotDir, { recursive: true });
  },

  // 每个会话前启动 tauri-driver，用于代理 WebDriver 请求
  beforeSession() {
    tauriDriver = spawn(tauriDriverPath, [], { stdio: [null, process.stdout, process.stderr] });
    tauriDriver.on("error", (error) => {
      console.error("tauri-driver 启动失败:", error);
      process.exit(1);
    });
    tauriDriver.on("exit", (code) => {
      if (!exiting) {
        console.error("tauri-driver 意外退出:", code);
        process.exit(1);
      }
    });
  },

  afterSession() {
    closeTauriDriver();
  },

  // 失败时自动截图，便于从 artifact 排查
  async afterTest(test, _context, { passed }) {
    if (!passed) {
      const { browser } = await import("@wdio/globals");
      const name = `FAILED-${test.title}`.replace(/[^\w一-龥-]+/g, "_");
      await browser.saveScreenshot(path.join(screenshotDir, `${name}.png`)).catch(() => undefined);
    }
  },
};

for (const signal of ["exit", "SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => closeTauriDriver());
}
