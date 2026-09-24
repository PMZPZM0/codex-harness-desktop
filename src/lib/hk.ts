/**
 * hk（从 src/App.tsx 原样搬来，实现未改）。
 * 搬到 lib：本域与 App 其它地方都要用，不能一边一份。
 */

import { isMacPlatform } from "./is-mac-platform";
import { macHotkeyLabel } from "./hotkey.mjs";

export function hk(label: string): string {
  return isMacPlatform() ? macHotkeyLabel(label) : String(label ?? "");
}

