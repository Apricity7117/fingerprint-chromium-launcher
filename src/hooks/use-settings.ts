import { useCallback, useEffect, useState } from "react";

import { api, errorMessage } from "@/lib/api";
import type { ChromiumInfo, Settings } from "@/lib/types";

function fetchSettings() {
  return Promise.all([api.getSettings(), api.getChromiumInfo()]);
}

/** 全局设置与 Chromium 版本信息 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [chromiumInfo, setChromiumInfo] = useState<ChromiumInfo | null>(null);

  const apply = useCallback(([nextSettings, info]: [Settings, ChromiumInfo]) => {
    setSettings(nextSettings);
    setChromiumInfo(info);
  }, []);

  const reload = useCallback(
    () =>
      fetchSettings()
        .then(apply)
        .catch((error: unknown) => console.error("加载设置失败", errorMessage(error))),
    [apply],
  );

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((result) => {
        if (!cancelled) apply(result);
      })
      .catch((error: unknown) => console.error("加载设置失败", errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [apply]);

  return { settings, chromiumInfo, reload };
}
