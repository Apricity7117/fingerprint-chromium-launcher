// 仅用于 `pnpm dev` 浏览器预览的内存 mock：数据为合成样例，只返回契约形状的数据，
// 不复刻 Rust 业务逻辑（参数构建、推荐等以 Rust 实现与 CI E2E 为准）。
import { presets } from "./presets";
import { dataDirName, newProfileDraft } from "./profile-utils";
import type { Profile, RunningStatusMap, Settings } from "./types";

const settings: Settings = {
  chromium_path: "/Applications/Chromium.app/Contents/MacOS/Chromium",
  data_dir_prefix: "~/Documents/chromium/user_data_dir",
};

function sample(id: string, name: string, group: string, fingerprint: number, proxy = ""): Profile {
  return { ...newProfileDraft([]), id, name, group, fingerprint, proxy_server: proxy };
}

let profiles: Profile[] = [
  sample("a1b2c3d4e5f60718", "demo-1@example.com", "mail", 1024),
  sample("b2c3d4e5f6071829", "demo-2@example.com", "mail", 1025),
  sample("c3d4e5f60718293a", "shop-account", "shopping", 1026, "socks5://127.0.0.1:1080"),
  sample("d4e5f60718293a4b", "research", "", 1027),
  sample("e5f60718293a4b5c", "github-bot", "dev", 1028, "http://127.0.0.1:8080"),
  sample("f60718293a4b5c6d", "staging", "dev", 1029),
];
const startedAt: Record<string, number> = { b2c3d4e5f6071829: Date.now() - 125_000 };

function randomId(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function runningStatus(): RunningStatusMap {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(startedAt).map(([id, start], index) => [
      id,
      { pid: 40000 + index, uptime_seconds: Math.floor((now - start) / 1000) },
    ]),
  );
}

function find(id: string): Profile {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) throw `环境不存在: ${id}`;
  return profile;
}

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_settings: () => ({ ...settings }),
  save_settings: (args) => Object.assign(settings, args.settings as Settings),
  get_chromium_info: () => ({ version: "142.0.7444.175", major: 142, flag_mode: "legacy" }),
  list_profiles: () => profiles.map((item) => ({ ...item })),
  create_profile: (args) => {
    const profile = { ...(args.profile as Profile), id: randomId() };
    profile.name = profile.name.trim() || String(profile.fingerprint);
    profiles = [...profiles, profile];
    return profile;
  },
  update_profile: (args) => {
    const id = args.id as string;
    find(id);
    const profile = { ...(args.profile as Profile), id };
    profiles = profiles.map((item) => (item.id === id ? profile : item));
    return profile;
  },
  duplicate_profile: (args) => {
    const source = find(args.id as string);
    const copy = { ...source, id: randomId(), name: `${source.name} (Copy)` };
    profiles = [...profiles, copy];
    return copy;
  },
  delete_profiles: (args) => {
    const ids = args.ids as string[];
    profiles = profiles.filter((item) => !ids.includes(item.id));
    ids.forEach((id) => delete startedAt[id]);
    return { deleted: ids, errors: [] };
  },
  recommend_fingerprint: (args) => {
    const platform = args.platform as keyof typeof presets.recommendations;
    const seed = (args.seed as number | null) ?? Math.floor(Math.random() * 1_000_000);
    const table = presets.recommendations[platform];
    return {
      fingerprint: seed,
      platform,
      gpu_vendor: table.gpu_vendor,
      gpu_renderer: table.gpu_renderers[seed % table.gpu_renderers.length],
      hardware_concurrency: table.hardware_concurrency[seed % table.hardware_concurrency.length],
    };
  },
  preview_command: (args) => {
    const profile = args.profile as Profile;
    const dir = profile.id ? dataDirName(profile.id) : "chrome_<保存后生成>";
    const argv = [
      `--fingerprint=${profile.fingerprint}`,
      `--fingerprint-platform=${profile.platform}`,
      `--user-data-dir=${settings.data_dir_prefix}/${dir}`,
    ];
    return { args: argv, display: `${settings.chromium_path} ${argv.join(" ")} # mock` };
  },
  launch_profile: (args) => {
    const id = args.id as string;
    if (startedAt[id]) throw "环境已在运行";
    startedAt[id] = Date.now();
    return { pid: 40000, command: "mock" };
  },
  stop_profile: (args) => {
    delete startedAt[args.id as string];
    return null;
  },
  get_running_status: () => runningStatus(),
  import_legacy_data: () => ({ added: 0, skipped: profiles.length, settings_imported: false }),
};

export async function mockInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const handler = handlers[cmd];
  if (!handler) throw `mock 未实现的命令: ${cmd}`;
  return handler(args) as T;
}
