import { useCallback, useState } from "react";

/** 持久化到 localStorage 的状态；读取失败时回退到初始值 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initialValue : (JSON.parse(raw) as T);
    } catch {
      return initialValue;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // 存储不可用时仅保留内存状态
      }
    },
    [key],
  );

  return [value, update] as const;
}
