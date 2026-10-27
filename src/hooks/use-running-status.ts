import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { defaults } from "@/lib/presets";
import type { RunningStatusMap } from "@/lib/types";

/** 轮询运行状态；窗口隐藏时暂停，降低空闲 CPU 占用 */
export function useRunningStatus() {
  const [status, setStatus] = useState<RunningStatusMap>({});

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getRunningStatus());
    } catch {
      // 单次轮询失败忽略，等待下一次
    }
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    // 挂载时无论可见与否先取一次，仅在可见时持续轮询
    const start = () => {
      void refresh();
      if (!document.hidden) timer = window.setInterval(() => void refresh(), defaults.status_poll_interval_ms);
    };
    const stop = () => window.clearInterval(timer);
    const onVisibilityChange = () => {
      stop();
      if (!document.hidden) start();
    };

    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  return { status, refresh };
}
