import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { api, errorMessage } from "@/lib/api";
import { defaults } from "@/lib/presets";
import type { ChromiumInfo, Settings } from "@/lib/types";

interface SettingsDialogProps {
  open: boolean;
  settings: Settings | null;
  chromiumInfo: ChromiumInfo | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const MODE_TEXT: Record<ChromiumInfo["flag_mode"], string> = {
  legacy: "使用 GPU vendor / renderer 参数",
  spoofing: "使用 --disable-spoofing 参数",
  unknown: "版本未知，两套参数都会输出",
};

export function SettingsDialog({ open, settings, ...rest }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={rest.onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid="settings-dialog">
        <DialogHeader>
          <DialogTitle>全局设置</DialogTitle>
          <DialogDescription>Chromium 路径与用户数据目录对所有环境生效。</DialogDescription>
        </DialogHeader>
        {open && settings && <SettingsForm settings={settings} {...rest} />}
      </DialogContent>
    </Dialog>
  );
}

/** macOS 上选择到 .app 包时，转换为包内的可执行文件路径 */
function toExecutable(path: string): string {
  const match = path.match(/([^/]+)\.app\/?$/);
  return match ? `${path.replace(/\/$/, "")}/Contents/MacOS/${match[1]}` : path;
}

function SettingsForm({
  settings,
  chromiumInfo,
  onOpenChange,
  onSaved,
}: Omit<SettingsDialogProps, "open" | "settings"> & { settings: Settings }) {
  const [chromiumPath, setChromiumPath] = useState(settings.chromium_path);
  const [dataDirPrefix, setDataDirPrefix] = useState(settings.data_dir_prefix);
  const [info, setInfo] = useState<ChromiumInfo | null>(chromiumInfo);
  const [busy, setBusy] = useState(false);

  // 路径变化后防抖检测版本
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .getChromiumInfo(chromiumPath)
        .then((result) => {
          if (!cancelled) setInfo(result);
        })
        .catch(() => undefined);
    }, defaults.version_detect_debounce_ms);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chromiumPath]);

  const browse = async (directory: boolean) => {
    try {
      const selected = await openDialog({ multiple: false, directory, title: directory ? "选择数据目录" : "选择 Chromium" });
      if (typeof selected !== "string") return;
      if (directory) setDataDirPrefix(selected);
      else setChromiumPath(toExecutable(selected));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.saveSettings({ chromium_path: chromiumPath.trim(), data_dir_prefix: dataDirPrefix.trim() });
      toast.success("全局设置已保存");
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="settings-chromium-path">Chromium 可执行文件路径</Label>
        <div className="flex gap-2">
          <Input
            id="settings-chromium-path"
            className="font-mono text-xs"
            value={chromiumPath}
            onChange={(event) => setChromiumPath(event.target.value)}
            data-testid="settings-chromium-path"
          />
          <Button type="button" variant="outline" size="icon" title="浏览" onClick={() => void browse(false)}>
            <FolderOpenIcon />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="chromium-version">
          {info?.version ? <Badge variant="secondary">Chromium {info.version}</Badge> : <Badge variant="outline">未识别版本</Badge>}
          {info && <span data-mode={info.flag_mode}>{MODE_TEXT[info.flag_mode]}</span>}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="settings-data-dir">用户数据目录前缀</Label>
        <div className="flex gap-2">
          <Input
            id="settings-data-dir"
            className="font-mono text-xs"
            value={dataDirPrefix}
            onChange={(event) => setDataDirPrefix(event.target.value)}
            data-testid="settings-data-dir"
          />
          <Button type="button" variant="outline" size="icon" title="浏览" onClick={() => void browse(true)}>
            <FolderOpenIcon />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">每个环境的数据保存在该目录下的 chrome_&lt;ID 前 8 位&gt; 子目录，支持 ~ 开头。</p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button type="submit" disabled={busy} data-testid="settings-save">
          {busy && <Loader2Icon className="animate-spin" />}
          保存设置
        </Button>
      </DialogFooter>
    </form>
  );
}
