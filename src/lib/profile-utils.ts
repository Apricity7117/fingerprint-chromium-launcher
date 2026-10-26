// 环境列表相关的纯函数（分组、过滤、默认值），便于单测
import { defaults, presets } from "./presets";
import type { Profile } from "./types";

export const UNGROUPED = "未分组";
/** 侧栏「全部环境」入口的选中值 */
export const ALL_GROUPS = "__all__";

export interface GroupSummary {
  name: string;
  count: number;
}

/** 环境所属分组的显示名：空白分组归入「未分组」 */
export function groupOf(profile: Pick<Profile, "group">): string {
  return profile.group.trim() || UNGROUPED;
}

/** 汇总分组及数量：按名称排序，「未分组」置底 */
export function summarizeGroups(profiles: Profile[]): GroupSummary[] {
  const counts = new Map<string, number>();
  for (const profile of profiles) {
    const name = groupOf(profile);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (a.name === UNGROUPED) return 1;
      if (b.name === UNGROUPED) return -1;
      return a.name.localeCompare(b.name, "zh-CN");
    });
}

/** 按分组与关键字（名称 / 种子 / 代理，忽略大小写）过滤 */
export function filterProfiles(profiles: Profile[], group: string, query: string): Profile[] {
  const keyword = query.trim().toLowerCase();
  return profiles.filter((profile) => {
    if (group !== ALL_GROUPS && groupOf(profile) !== group) return false;
    if (!keyword) return true;
    return [profile.name, String(profile.fingerprint), profile.proxy_server].some((field) =>
      field.toLowerCase().includes(keyword),
    );
  });
}

/** 新建环境的默认种子：现有最大种子 + 1，无环境时取配置默认值 */
export function nextSeed(profiles: Profile[]): number {
  if (profiles.length === 0) return defaults.default_seed;
  return Math.max(...profiles.map((profile) => profile.fingerprint || 0)) + 1;
}

/** 数据目录名，与 Rust 端 chromium::data_dir_name 保持一致 */
export function dataDirName(id: string): string {
  return `chrome_${id.slice(0, 8)}`;
}

/** Apple 芯片对应的 CPU 核心数（选择 GPU 型号时联动） */
export function appleChipCores(renderer: string): number {
  const rule = presets.apple_chip_cores.find((item) => renderer.includes(item.chip));
  if (!rule) return presets.apple_chip_cores_fallback;
  const isProOrMax = renderer.includes("Pro") || renderer.includes("Max");
  return isProOrMax ? rule.pro_max : rule.base;
}

/** 语言联动的 Accept-Language；未配置的语言返回 undefined 保持原值 */
export function acceptLangFor(lang: string): string | undefined {
  return presets.languages.find((item) => item.lang === lang)?.accept_lang;
}

/** Chrome + macOS 时 GPU 型号使用 Apple 芯片下拉 */
export function usesAppleGpuSelect(profile: Pick<Profile, "brand" | "platform">): boolean {
  return profile.brand === "Chrome" && profile.platform === "macos";
}

/** 新建环境的表单初始值 */
export function newProfileDraft(profiles: Profile[]): Profile {
  return {
    ...presets.new_profile,
    id: "",
    name: "",
    fingerprint: nextSeed(profiles),
    disable_spoofing: [...presets.new_profile.disable_spoofing],
  };
}

/** 运行时长的中文展示 */
export function formatUptime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}小时 ${minutes}分`;
  if (minutes > 0) return `${minutes}分 ${rest}秒`;
  return `${rest}秒`;
}

/** 对象中选项的显示名 */
export function labelOf(options: { value: string; label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
