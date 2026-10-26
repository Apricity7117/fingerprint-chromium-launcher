import { useCallback, useEffect, useState } from "react";

import { api, errorMessage } from "@/lib/api";
import type { Profile } from "@/lib/types";

interface ProfilesState {
  profiles: Profile[];
  loading: boolean;
  error: string | null;
}

/** 环境列表：首次自动加载，提供 reload 供增删改后刷新 */
export function useProfiles() {
  const [state, setState] = useState<ProfilesState>({ profiles: [], loading: true, error: null });

  const reload = useCallback(async () => {
    try {
      const profiles = await api.listProfiles();
      setState({ profiles, loading: false, error: null });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: errorMessage(error) }));
    }
  }, []);

  /** 失败后的手动重试：先回到加载态 */
  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    void reload();
  }, [reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload, retry };
}
