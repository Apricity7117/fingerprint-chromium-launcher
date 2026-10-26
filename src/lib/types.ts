// 与 src-tauri/src/models.rs 对齐的数据契约（字段保持 snake_case）

export interface Profile {
  id: string;
  group: string;
  name: string;
  fingerprint: number;
  platform: string;
  brand: string;
  brand_version: string;
  hardware_concurrency: number;
  gpu_vendor: string;
  gpu_renderer: string;
  platform_version: string;
  timezone: string;
  lang: string;
  accept_lang: string;
  proxy_server: string;
  disable_non_proxied_udp: boolean;
  disable_gpu_fingerprint: boolean;
  disable_encryption: boolean;
  extra_args: string;
  disable_spoofing: string[];
}

export interface Settings {
  chromium_path: string;
  data_dir_prefix: string;
}

/** legacy：主版本 < 144；spoofing：≥ 144；unknown：无法识别，两套参数都输出 */
export type FlagMode = "legacy" | "spoofing" | "unknown";

export interface ChromiumInfo {
  version: string | null;
  major: number | null;
  flag_mode: FlagMode;
}

export interface Recommendation {
  fingerprint: number;
  platform: string;
  gpu_vendor: string;
  gpu_renderer: string;
  hardware_concurrency: number;
}

export interface CommandPreview {
  args: string[];
  display: string;
}

export interface LaunchResult {
  pid: number;
  command: string;
}

export interface InstanceStatus {
  pid: number;
  uptime_seconds: number;
}

export type RunningStatusMap = Record<string, InstanceStatus>;

export interface DeleteResult {
  deleted: string[];
  errors: string[];
}

export interface ImportResult {
  added: number;
  skipped: number;
  settings_imported: boolean;
}

export type ViewMode = "card" | "list";
