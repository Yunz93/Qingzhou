import { useEffect, useState } from "react";
export function useViewPreference<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try { const raw = sessionStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw) as T; } catch { return fallback; }
  });
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional preference. */ } }, [key, value]);
  return [value, setValue] as const;
}
