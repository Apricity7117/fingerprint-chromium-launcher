import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { errorMessage } from "@/lib/api";

export type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "fcl-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function subscribeSystemTheme(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** 主题：默认跟随系统，可切换浅色 / 深色，选择持久化到 localStorage */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const systemDark = useSyncExternalStore(
    subscribeSystemTheme,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  const resolvedTheme: ResolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  // 原生窗口外观（标题文字、红绿灯、系统对话框）跟随所选主题；「跟随系统」传 null 交还系统，
  // 否则 WebView 的 prefers-color-scheme 会停留在上次手动设置的外观上
  useEffect(() => {
    if (!isTauri()) return;
    getCurrentWindow()
      .setTheme(theme === "system" ? null : theme)
      .catch((error: unknown) => console.error("同步窗口主题失败", errorMessage(error)));
  }, [theme]);

  const setTheme = useCallback((next: string) => {
    const value: Theme = next === "light" || next === "dark" ? next : "system";
    window.localStorage.setItem(STORAGE_KEY, value);
    setThemeState(value);
  }, []);

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- 主题 Hook 与 Provider 同属一个模块
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return context;
}
