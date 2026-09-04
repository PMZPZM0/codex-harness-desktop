import { useSyncExternalStore } from "react";

export type CodeFontScale = "small" | "default" | "large";

export type CodeSettings = {
  /** 代码高亮主题 id，见 lib/code-themes.ts */
  theme: string;
  /** 代码字体 id */
  font: string;
  /** 代码字号档位 */
  fontScale: CodeFontScale;
  /** 是否显示行号 */
  lineNumbers: boolean;
  /** 长行是否自动换行 */
  wrap: boolean;
};

const STORAGE_KEY = "code-settings";
const SCALES: Record<CodeFontScale, string> = { small: "11.5px", default: "12.5px", large: "14px" };

const defaults: CodeSettings = { theme: "one-dark", font: "system", fontScale: "default", lineNumbers: false, wrap: false };

function load(): CodeSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") ?? {};
    return {
      theme: String(raw.theme ?? defaults.theme),
      font: String(raw.font ?? defaults.font),
      fontScale: (["small", "default", "large"] as const).includes(raw.fontScale) ? raw.fontScale : defaults.fontScale,
      lineNumbers: Boolean(raw.lineNumbers),
      wrap: Boolean(raw.wrap),
    };
  } catch {
    return { ...defaults };
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getCodeSettings(): CodeSettings {
  return current;
}

export function setCodeSettings(next: Partial<CodeSettings>) {
  current = { ...current, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* 隐私模式下忽略写入失败 */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 订阅代码显示设置：设置页改完，所有已渲染的代码块立即重绘 */
export function useCodeSettings(): CodeSettings {
  return useSyncExternalStore(subscribe, getCodeSettings, getCodeSettings);
}

export function codeFontSize(scale: CodeFontScale) {
  return SCALES[scale] ?? SCALES.default;
}
