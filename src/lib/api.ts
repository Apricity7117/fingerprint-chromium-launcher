// Tauri commands 的类型化封装：前后端唯一边界
import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";

import type {
  ChromiumInfo,
  CommandPreview,
  DeleteResult,
  ImportResult,
  LaunchResult,
  Profile,
  Recommendation,
  RunningStatusMap,
  Settings,
} from "./types";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invokePromise: Promise<Invoke> | null = null;

/** 非 Tauri 的开发预览（浏览器）使用内存 mock；生产构建中该分支被消除 */
function getInvoke(): Promise<Invoke> {
  if (!invokePromise) {
    if (import.meta.env.DEV && !isTauri()) {
      invokePromise = import("./dev-mock-backend").then((mod) => mod.mockInvoke);
    } else {
      invokePromise = Promise.resolve(tauriInvoke as Invoke);
    }
  }
  return invokePromise;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = await getInvoke();
  return invoke<T>(cmd, args);
}

/** 统一把 command 抛出的错误（Rust 端为字符串）转成可展示文本 */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

// 注意：Tauri 2 的 command 参数名在 JS 侧使用 camelCase
export const api = {
  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
  getChromiumInfo: (path?: string) =>
    call<ChromiumInfo>("get_chromium_info", { path: path ?? null }),
  listProfiles: () => call<Profile[]>("list_profiles"),
  createProfile: (profile: Profile) => call<Profile>("create_profile", { profile }),
  updateProfile: (id: string, profile: Profile) =>
    call<Profile>("update_profile", { id, profile }),
  duplicateProfile: (id: string) => call<Profile>("duplicate_profile", { id }),
  deleteProfiles: (ids: string[], deleteData: boolean) =>
    call<DeleteResult>("delete_profiles", { ids, deleteData }),
  recommendFingerprint: (platform: string, seed: number | null) =>
    call<Recommendation>("recommend_fingerprint", { platform, seed }),
  previewCommand: (profile: Profile) => call<CommandPreview>("preview_command", { profile }),
  launchProfile: (id: string) => call<LaunchResult>("launch_profile", { id }),
  stopProfile: (id: string) => call<null>("stop_profile", { id }),
  getRunningStatus: () => call<RunningStatusMap>("get_running_status"),
  importLegacyData: (profilesPath: string, importSettings: boolean) =>
    call<ImportResult>("import_legacy_data", { profilesPath, importSettings }),
};
