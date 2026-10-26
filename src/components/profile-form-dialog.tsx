import { CopyIcon, DicesIcon, Loader2Icon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { GroupCombobox } from "@/components/group-combobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { defaults, presets } from "@/lib/presets";
import {
  acceptLangFor,
  appleChipCores,
  dataDirName,
  newProfileDraft,
  usesAppleGpuSelect,
} from "@/lib/profile-utils";
import type { ChromiumInfo, FlagMode, Profile } from "@/lib/types";

/** 视为「未自定义」的 GPU 厂商：切到 Chrome + macOS 时可自动改为 Apple（与旧版一致） */
const AUTO_VENDORS = ["", "Apple", "Google Inc. (Apple)", "NVIDIA", "NVIDIA Corporation"];
const SEED_PATTERN = /^\d+$/;

interface ProfileFormDialogProps {
  open: boolean;
  /** 编辑中的环境；为 null 时新建 */
  editing: Profile | null;
  profiles: Profile[];
  groups: string[];
  chromiumInfo: ChromiumInfo | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (profile: Profile, created: boolean) => void;
}

export function ProfileFormDialog({ open, editing, ...rest }: ProfileFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={rest.onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" data-testid="profile-form">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑环境" : "新建环境"}</DialogTitle>
          <DialogDescription>每个环境拥有独立的数据目录与指纹参数。</DialogDescription>
        </DialogHeader>
        {open && <ProfileForm key={editing?.id ?? "new"} editing={editing} {...rest} />}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h4 className="border-b pb-1.5 text-xs font-medium tracking-wider text-muted-foreground">{title}</h4>
      <div className="grid gap-x-5 gap-y-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, htmlFor, hint, wide = false, children }: {
  label: string;
  htmlFor?: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "space-y-1.5 md:col-span-2" : "space-y-1.5"}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** 下拉选项：保证当前值即使不在预设列表中也能显示 */
function withCurrent(options: string[], current: string): string[] {
  return current && !options.includes(current) ? [current, ...options] : options;
}

function SimpleSelect({ id, value, options, onChange, placeholder }: {
  id: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full" data-testid={id}>
        <SelectValue placeholder={placeholder ?? "请选择"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const toOptions = (values: string[]) => values.map((value) => ({ value, label: value }));

function ProfileForm({
  editing,
  profiles,
  groups,
  chromiumInfo,
  onOpenChange,
  onSaved,
}: Omit<ProfileFormDialogProps, "open">) {
  const [draft, setDraft] = useState<Profile>(() => (editing ? { ...editing } : newProfileDraft(profiles)));
  const [seedText, setSeedText] = useState(() => String(draft.fingerprint));
  const [preview, setPreview] = useState<{ text: string; error: string | null }>({ text: "", error: null });
  const [saving, setSaving] = useState(false);
  const seedTimer = useRef<number | undefined>(undefined);

  const mode: FlagMode = chromiumInfo?.flag_mode ?? "unknown";
  const showLegacyGpu = mode !== "spoofing";
  const showSpoofing = mode !== "legacy";
  const appleSelect = usesAppleGpuSelect(draft);

  const update = (patch: Partial<Profile>) => setDraft((prev) => ({ ...prev, ...patch }));

  /** 按平台与种子回填推荐的 GPU 与核心数 */
  const applyRecommendation = async (platform: string, seed: number | null) => {
    try {
      const rec = await api.recommendFingerprint(platform, seed);
      setSeedText(String(rec.fingerprint));
      update({
        fingerprint: rec.fingerprint,
        gpu_vendor: rec.gpu_vendor,
        gpu_renderer: rec.gpu_renderer,
        hardware_concurrency: rec.hardware_concurrency,
      });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const onSeedChange = (text: string) => {
    setSeedText(text);
    window.clearTimeout(seedTimer.current);
    if (!SEED_PATTERN.test(text)) return;
    const seed = Number(text);
    update({ fingerprint: seed });
    seedTimer.current = window.setTimeout(() => void applyRecommendation(draft.platform, seed), 500);
  };

  const onPlatformChange = (platform: string) => {
    update({ platform });
    const seed = SEED_PATTERN.test(seedText) ? Number(seedText) : null;
    void applyRecommendation(platform, seed);
  };

  const onBrandChange = (brand: string) => {
    const patch: Partial<Profile> = { brand };
    if (!draft.id && usesAppleGpuSelect({ brand, platform: draft.platform }) && AUTO_VENDORS.includes(draft.gpu_vendor)) {
      patch.gpu_vendor = "Apple";
    }
    update(patch);
  };

  const toggleSpoofing = (value: string, checked: boolean) => {
    const selected = new Set(draft.disable_spoofing);
    if (checked) selected.add(value);
    else selected.delete(value);
    const patch: Partial<Profile> = {
      disable_spoofing: presets.spoofing_options.map((option) => option.value).filter((item) => selected.has(item)),
    };
    if (value === "gpu" && !checked) patch.disable_gpu_fingerprint = false;
    update(patch);
  };

  useEffect(() => () => window.clearTimeout(seedTimer.current), []);

  // 命令预览：防抖调用后端，与实际启动使用同一套参数构建逻辑
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .previewCommand(draft)
        .then((result) => {
          if (!cancelled) setPreview({ text: result.display, error: null });
        })
        .catch((error: unknown) => {
          if (!cancelled) setPreview({ text: "", error: errorMessage(error) });
        });
    }, defaults.preview_debounce_ms);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draft]);

  const save = async () => {
    if (!SEED_PATTERN.test(seedText)) {
      toast.error("请填写有效的指纹种子（非负整数）");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...draft, fingerprint: Number(seedText) };
      const saved = draft.id ? await api.updateProfile(draft.id, payload) : await api.createProfile(payload);
      onSaved(saved, !draft.id);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const copyPreview = async () => {
    try {
      await copyText(preview.text);
      toast.success("已复制启动命令");
    } catch (error) {
      toast.error(`复制失败：${errorMessage(error)}`);
    }
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {draft.id && (
        <div className="grid gap-3 rounded-lg border bg-muted/40 p-3 text-xs md:grid-cols-2">
          <div>
            <div className="text-muted-foreground">环境 ID（不可变）</div>
            <div className="font-mono select-text">{draft.id}</div>
          </div>
          <div>
            <div className="text-muted-foreground">数据目录名</div>
            <div className="font-mono select-text">{dataDirName(draft.id)}</div>
          </div>
        </div>
      )}

      <Section title="基本设置">
        <Field label="环境名称" htmlFor="form-name">
          <Input
            id="form-name"
            value={draft.name}
            placeholder="留空则默认为指纹种子"
            onChange={(event) => update({ name: event.target.value })}
            data-testid="form-name"
          />
        </Field>
        <Field label="所属分组">
          <GroupCombobox value={draft.group} groups={groups} onChange={(group) => update({ group })} />
        </Field>
        <Field label="指纹种子 *" htmlFor="form-seed">
          <div className="flex gap-2">
            <Input
              id="form-seed"
              inputMode="numeric"
              className="font-mono"
              value={seedText}
              onChange={(event) => onSeedChange(event.target.value.trim())}
              data-testid="form-seed"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="随机种子"
              onClick={() => void applyRecommendation(draft.platform, null)}
              data-testid="form-random-seed"
            >
              <DicesIcon />
            </Button>
          </div>
        </Field>
        <Field label="操作系统 *">
          <SimpleSelect id="form-platform" value={draft.platform} options={presets.platforms} onChange={onPlatformChange} />
        </Field>
        <Field label="伪装品牌 *">
          <SimpleSelect id="form-brand" value={draft.brand} options={presets.brands} onChange={onBrandChange} />
        </Field>
        <Field label="品牌版本" htmlFor="form-brand-version">
          <Input
            id="form-brand-version"
            value={draft.brand_version}
            placeholder="留空则使用默认版本"
            onChange={(event) => update({ brand_version: event.target.value })}
          />
        </Field>
      </Section>

      <Section title="硬件伪装">
        {showLegacyGpu && (
          <>
            <Field label="GPU 厂商（Vendor）" htmlFor="form-gpu-vendor">
              <Input
                id="form-gpu-vendor"
                value={draft.gpu_vendor}
                placeholder="根据种子自动填充"
                onChange={(event) => update({ gpu_vendor: event.target.value })}
                data-testid="form-gpu-vendor"
              />
            </Field>
            <Field label="GPU 型号（Renderer）" htmlFor="form-gpu-renderer">
              {appleSelect ? (
                <SimpleSelect
                  id="form-gpu-renderer"
                  value={draft.gpu_renderer}
                  options={toOptions(withCurrent(presets.apple_gpu_renderers, draft.gpu_renderer))}
                  onChange={(gpu_renderer) =>
                    update({ gpu_renderer, hardware_concurrency: appleChipCores(gpu_renderer) })
                  }
                />
              ) : (
                <Input
                  id="form-gpu-renderer"
                  value={draft.gpu_renderer}
                  placeholder="根据种子自动填充"
                  onChange={(event) => update({ gpu_renderer: event.target.value })}
                  data-testid="form-gpu-renderer"
                />
              )}
            </Field>
          </>
        )}
        <Field label="CPU 核心数">
          <SimpleSelect
            id="form-cores"
            value={String(draft.hardware_concurrency)}
            options={withCurrent(presets.hardware_concurrency_options.map(String), String(draft.hardware_concurrency || "")).map(
              (value) => ({ value, label: `${value} 核心` }),
            )}
            onChange={(value) => update({ hardware_concurrency: Number(value) })}
          />
        </Field>
        <Field label="平台版本" htmlFor="form-platform-version">
          <Input
            id="form-platform-version"
            value={draft.platform_version}
            placeholder="留空则由种子自动选取"
            onChange={(event) => update({ platform_version: event.target.value })}
          />
        </Field>
        {showSpoofing && (
          <Field label="禁用伪装项（Chrome 144+）" wide hint="勾选的项目将通过 --disable-spoofing 关闭伪装。">
            <div className="flex flex-wrap gap-x-5 gap-y-2" data-testid="form-spoofing">
              {presets.spoofing_options.map((option) => (
                <label key={option.value} className="inline-flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={
                      draft.disable_spoofing.includes(option.value) ||
                      (option.value === "gpu" && draft.disable_gpu_fingerprint)
                    }
                    onCheckedChange={(checked) => toggleSpoofing(option.value, checked === true)}
                    data-testid={`form-spoofing-${option.value}`}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </Field>
        )}
        {mode === "unknown" && (
          <p className="text-xs text-amber-600 md:col-span-2 dark:text-amber-400">
            未能识别 Chromium 版本：新旧两套 GPU 参数都会输出，浏览器会忽略不支持的参数。
          </p>
        )}
      </Section>

      <Section title="区域与网络">
        <Field label="时区（Timezone）">
          <SimpleSelect
            id="form-timezone"
            value={draft.timezone}
            options={toOptions(withCurrent(presets.timezones, draft.timezone))}
            onChange={(timezone) => update({ timezone })}
          />
        </Field>
        <Field label="系统语言（Language）">
          <SimpleSelect
            id="form-lang"
            value={draft.lang}
            options={toOptions(withCurrent(presets.languages.map((item) => item.lang), draft.lang))}
            onChange={(lang) => update({ lang, accept_lang: acceptLangFor(lang) ?? draft.accept_lang })}
          />
        </Field>
        <Field label="Accept-Language" htmlFor="form-accept-lang">
          <Input
            id="form-accept-lang"
            value={draft.accept_lang}
            onChange={(event) => update({ accept_lang: event.target.value })}
            data-testid="form-accept-lang"
          />
        </Field>
        <Field label="代理服务器（Proxy）" htmlFor="form-proxy">
          <Input
            id="form-proxy"
            className="font-mono"
            value={draft.proxy_server}
            placeholder="例如 socks5://127.0.0.1:1080"
            onChange={(event) => update({ proxy_server: event.target.value })}
            data-testid="form-proxy"
          />
        </Field>
        <Field label="额外启动参数" htmlFor="form-extra-args" wide hint="按 shell 规则解析，例如 --window-size=1280,720">
          <Input
            id="form-extra-args"
            className="font-mono"
            value={draft.extra_args}
            onChange={(event) => update({ extra_args: event.target.value })}
            data-testid="form-extra-args"
          />
        </Field>
        <div className="flex flex-col gap-3 rounded-lg border p-3 md:col-span-2">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>禁用非代理 UDP（防 WebRTC IP 泄漏）</span>
            <Switch
              checked={draft.disable_non_proxied_udp}
              onCheckedChange={(checked) => update({ disable_non_proxied_udp: checked })}
              data-testid="form-udp"
            />
          </label>
          {showLegacyGpu && (
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>完全禁用 GPU 指纹伪装（Chrome 143 及以下）</span>
              <Switch
                checked={draft.disable_gpu_fingerprint}
                onCheckedChange={(checked) => update({ disable_gpu_fingerprint: checked })}
                data-testid="form-disable-gpu"
              />
            </label>
          )}
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              禁用数据加密（<code className="font-mono text-xs">--disable-encryption</code>，会降低本地数据保护）
            </span>
            <Switch
              checked={draft.disable_encryption}
              onCheckedChange={(checked) => update({ disable_encryption: checked })}
              data-testid="form-encryption"
            />
          </label>
        </div>
      </Section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium tracking-wider text-muted-foreground">启动命令预览</h4>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!preview.text}
            onClick={() => void copyPreview()}
            data-testid="copy-command"
          >
            <CopyIcon />
            复制
          </Button>
        </div>
        <pre
          className="max-h-40 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs break-all whitespace-pre-wrap text-emerald-400 select-text"
          data-testid="command-preview"
        >
          {preview.error ? <span className="text-red-400">{preview.error}</span> : preview.text || "生成中…"}
        </pre>
      </section>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button type="submit" disabled={saving} data-testid="form-save">
          {saving && <Loader2Icon className="animate-spin" />}
          保存配置
        </Button>
      </DialogFooter>
    </form>
  );
}
