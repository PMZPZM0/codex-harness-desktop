/**
 * RPA 录制动作 → 人话步骤（纯函数，不 import electron；守卫/单测直接真跑）。
 */
import type { RpaAction } from "./rpa-store";

export type RpaRecordedDraft = {
  actions: RpaAction[];
  steps: string[];
  screen: { width: number; height: number };
  target: string;
  durationMs: number;
  eventCount: number;
  recordedAt: number;
  platform: "win32" | "darwin";
};

/* ── 录制数据 → 步骤（纯函数，守卫真跑） ─────────────────────── */

const VK_LABEL: Record<number, string> = {
  8: "退格", 9: "Tab", 13: "回车", 27: "Esc", 32: "空格", 33: "PageUp", 34: "PageDown",
  35: "End", 36: "Home", 37: "←", 38: "↑", 39: "→", 40: "↓", 45: "Insert", 46: "Delete",
  91: "Win", 92: "Win", 93: "菜单", 20: "CapsLock", 19: "Pause", 144: "NumLock",
};

/* macOS 虚拟键码（CGKeyCode）→ 显示名；字母/数字/标点在下方 CHAR 表里。 */
const MAC_LABEL: Record<number, string> = {
  36: "回车", 48: "Tab", 49: "空格", 51: "退格", 53: "Esc", 117: "Delete",
  115: "Home", 116: "PageUp", 119: "End", 121: "PageDown",
  123: "←", 124: "→", 125: "↓", 126: "↑",
  122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7",
  100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12",
  57: "CapsLock", 54: "Cmd", 55: "Cmd", 56: "Shift", 60: "Shift",
  58: "Option", 61: "Option", 59: "Ctrl", 62: "Ctrl",
};

/* macOS 键码 → [无 Shift, 有 Shift]（字母还要异或 CapsLock）。 */
const MAC_CHAR: Record<number, [string, string]> = {
  0: ["a", "A"], 1: ["s", "S"], 2: ["d", "D"], 3: ["f", "F"], 4: ["h", "H"], 5: ["g", "G"],
  6: ["z", "Z"], 7: ["x", "X"], 8: ["c", "C"], 9: ["v", "V"], 11: ["b", "B"], 12: ["q", "Q"],
  13: ["w", "W"], 14: ["e", "E"], 15: ["r", "R"], 16: ["y", "Y"], 17: ["t", "T"],
  18: ["1", "!"], 19: ["2", "@"], 20: ["3", "#"], 21: ["4", "$"], 22: ["6", "^"],
  23: ["5", "%"], 24: ["=", "+"], 25: ["9", "("], 26: ["7", "&"], 27: ["-", "_"],
  28: ["8", "*"], 29: ["0", ")"], 30: ["]", "}"], 31: ["o", "O"], 32: ["u", "U"],
  33: ["[", "{"], 34: ["i", "I"], 35: ["p", "P"], 37: ["l", "L"], 38: ["j", "J"],
  39: ["'", "\""], 40: ["k", "K"], 41: [";", ":"], 42: ["\\", "|"], 43: [",", "<"],
  44: ["/", "?"], 45: ["n", "N"], 46: ["m", "M"], 47: [".", ">"], 50: ["`", "~"],
};

function vkLabel(vk: number, platform: "win32" | "darwin"): string {
  if (platform === "darwin") {
    if (MAC_LABEL[vk]) return MAC_LABEL[vk];
    const pair = MAC_CHAR[vk];
    if (pair) return pair[0].toUpperCase();
    return `Key${vk}`;
  }
  if (VK_LABEL[vk]) return VK_LABEL[vk];
  if (vk >= 65 && vk <= 90) return String.fromCharCode(vk);
  if (vk >= 48 && vk <= 57) return String.fromCharCode(vk);
  if (vk >= 96 && vk <= 105) return `小键盘${vk - 96}`;
  if (vk >= 112 && vk <= 123) return `F${vk - 111}`;
  return `VK${vk}`;
}

function vkChar(vk: number, shift: boolean, caps: boolean, platform: "win32" | "darwin"): string | null {
  if (platform === "darwin") {
    const pair = MAC_CHAR[vk];
    if (!pair) return null;
    const isLetter = /[a-z]/i.test(pair[0]);
    return pair[shift !== (isLetter && caps) ? 1 : 0] ?? null;
  }
  if (vk >= 65 && vk <= 90) {
    const upper = shift !== caps;
    return String.fromCharCode(vk).toLowerCase().replace(/[a-z]/, (c) => upper ? c.toUpperCase() : c);
  }
  if (vk >= 96 && vk <= 105) return String(vk - 96);
  if (vk === 32) return " ";
  const shifted: Record<number, string> = { 48: ")", 49: "!", 50: "@", 51: "#", 52: "$", 53: "%", 54: "^", 55: "&", 56: "*", 57: "(" };
  if (vk >= 48 && vk <= 57) return shift ? shifted[vk] : String.fromCharCode(vk);
  const punct: Record<number, [string, string]> = {
    186: [";", ":"], 187: ["=", "+"], 188: [",", "<"], 189: ["-", "_"], 190: [".", ">"],
    191: ["/", "?"], 192: ["`", "~"], 219: ["[", "{"], 220: ["\\", "|"], 221: ["]", "}"], 222: ["'", "\""],
  };
  if (punct[vk]) return shift ? punct[vk][1] : punct[vk][0];
  const numpad: Record<number, string> = { 106: "*", 107: "+", 109: "-", 110: ".", 111: "/" };
  return numpad[vk] ?? null;
}

function comboLabel(a: RpaAction, platform: "win32" | "darwin"): string {
  const parts: string[] = [];
  if (platform === "darwin") {
    if (a.win) parts.push("Cmd");
    if (a.ctrl) parts.push("Ctrl");
    if (a.alt) parts.push("Option");
    if (a.shift) parts.push("Shift");
  } else {
    if (a.ctrl) parts.push("Ctrl");
    if (a.alt) parts.push("Alt");
    if (a.shift) parts.push("Shift");
    if (a.win) parts.push("Win");
  }
  parts.push(vkLabel(Number(a.vk), platform));
  return parts.join("+");
}

/** 把录制 NDJSON 转成「人话步骤 + 原始动作」；没有可回放的操作时返回错误。 */
export function convertRecording(raw: string): { ok: true; draft: RpaRecordedDraft } | { ok: false; error: string } {
  const events: RpaAction[] = [];
  let screen = { width: 0, height: 0 };
  let platform: "win32" | "darwin" = "win32";
  let endT = 0;
  for (const line of String(raw ?? "").split("\n")) {
    const text = line.trim();
    if (!text) continue;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { continue; }
    const type = String(parsed.type ?? "");
    if (type === "meta") {
      screen = { width: Number(parsed.width) || 0, height: Number(parsed.height) || 0 };
      platform = String(parsed.os ?? "") === "darwin" ? "darwin" : "win32";
      continue;
    }
    if (type === "end") { endT = Number(parsed.t) || endT; continue; }
    if (!["move", "down", "up", "keydown", "keyup", "focus"].includes(type)) continue;
    const action: RpaAction = { t: Number(parsed.t) || 0, type: type as RpaAction["type"] };
    if (type === "focus") {
      action.title = String(parsed.title ?? "");
      action.bundle = String(parsed.bundle ?? "");
    } else if (type === "down" || type === "up") {
      action.button = String(parsed.button ?? "left");
      action.x = Number(parsed.x) || 0;
      action.y = Number(parsed.y) || 0;
    } else if (type === "move") {
      action.x = Number(parsed.x) || 0;
      action.y = Number(parsed.y) || 0;
    } else {
      action.vk = Number(parsed.vk) || 0;
      action.shift = parsed.shift === true;
      action.ctrl = parsed.ctrl === true;
      action.alt = parsed.alt === true;
      action.win = parsed.win === true;
      action.caps = parsed.caps === true;
    }
    events.push(action);
  }
  const end = endT || (events.length ? events[events.length - 1].t : 0);

  /* 去掉触发停止快捷键（Ctrl+Alt+F9 / Cmd+Option+F9）的尾事件。 */
  const stopKey = platform === "darwin" ? 0x65 : 0x78;
  let stopAt = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type === "keydown" && e.vk === stopKey && (e.ctrl || e.alt || e.win)) { stopAt = e.t; break; }
  }
  const actions = events.filter((e) => {
    if (stopAt >= 0 && e.t >= stopAt - 250) {
      if (e.type === "keydown" || e.type === "keyup") {
        if (platform === "darwin") return ![0x3B, 0x3A, 0x37, 0x65].includes(Number(e.vk)); // control/option/cmd/F9
        return ![0x11, 0x12, 0x78].includes(Number(e.vk));
      }
      if (e.type === "move") return false;
    }
    return true;
  }).slice(0, 20000);

  const actionable = actions.some((e) => e.type === "down" || e.type === "keydown");
  if (!actionable) return { ok: false, error: "没有录到键盘或鼠标点击（录制期间请操作目标窗口）" };

  const steps: string[] = [];
  let title = "";
  let text = "";
  let lastStepAt = 0;
  let lastClick: { button: string; x: number; y: number; t: number; index: number } | null = null;
  type ClickMemo = { button: string; x: number; y: number; t: number; index: number };
  const titleCount = new Map<string, number>();

  const pushStep = (value: string, t: number, force = false) => {
    if (!value) return;
    if (!force && lastStepAt > 0 && t - lastStepAt > 1500) {
      steps.push(`等待 ${Math.round((t - lastStepAt) / 100) / 10} 秒`);
    }
    steps.push(value);
    lastStepAt = t;
  };
  const flushText = (t: number) => {
    if (!text) return;
    pushStep(`在「${title || "目标窗口"}」输入「${text}」`, t, true);
    text = "";
  };

  for (const e of actions) {
    if (e.type === "focus") {
      flushText(e.t);
      const nextTitle = String(e.title ?? "");
      if (nextTitle && nextTitle !== title) {
        title = nextTitle;
        titleCount.set(title, (titleCount.get(title) ?? 0) + 1);
        pushStep(`切换到「${title}」`, e.t);
      }
      continue;
    }
    if (e.type === "move" || e.type === "up") continue;
    if (e.type === "down") {
      flushText(e.t);
      const button = e.button ?? "left";
      const x = Number(e.x) || 0;
      const y = Number(e.y) || 0;
      const at = Number(e.t) || 0;
      const last = lastClick as ClickMemo | null;
      if (last && last.button === button && Math.abs(last.x - x) <= 6 && Math.abs(last.y - y) <= 6 && at - last.t <= 420) {
        const label = button === "right" ? "右键双击" : button === "middle" ? "中键双击" : "双击";
        steps[last.index] = `在「${title || "目标窗口"}」${label} (${x}, ${y})`;
        lastClick = null;
      } else {
        const label = button === "right" ? "右键点击" : button === "middle" ? "中键点击" : "点击";
        pushStep(`在「${title || "目标窗口"}」${label} (${x}, ${y})`, at);
        lastClick = { button, x, y, t: at, index: steps.length - 1 };
      }
      continue;
    }
    if (e.type === "keydown") {
      const vk = Number(e.vk) || 0;
      const modifierKeys = platform === "darwin" ? [54, 55, 56, 57, 58, 59, 60, 61, 62] : [16, 17, 18, 91, 92, 20];
      if (modifierKeys.includes(vk)) continue;
      const hasMod = Boolean(e.ctrl || e.alt || e.win);
      if (hasMod) {
        flushText(e.t);
        pushStep(`按 ${comboLabel(e, platform)}`, e.t);
        continue;
      }
      if (platform === "darwin") {
        if (vk === 51) {
          if (text) text = text.slice(0, -1);
          else pushStep("按退格", e.t);
          continue;
        }
        if (vk === 36) { flushText(e.t); pushStep("按回车", e.t); continue; }
        if (vk === 48) { flushText(e.t); pushStep("按 Tab", e.t); continue; }
        if (vk === 53) { flushText(e.t); pushStep("按 Esc", e.t); continue; }
        if ([123, 124, 125, 126].includes(vk)) { flushText(e.t); pushStep(`按 ${vkLabel(vk, platform)}`, e.t); continue; }
        if ([115, 116, 117, 119, 121, 122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111].includes(vk)) {
          flushText(e.t); pushStep(`按 ${vkLabel(vk, platform)}`, e.t); continue;
        }
        if (vk === 49) {
          text += " ";
          if (text.length >= 80) flushText(e.t);
          continue;
        }
        const macCh = vkChar(vk, Boolean(e.shift), Boolean(e.caps), platform);
        if (macCh != null) {
          text += macCh;
          if (text.length >= 80) flushText(e.t);
          continue;
        }
        flushText(e.t);
        pushStep(`按 ${vkLabel(vk, platform)}`, e.t);
        continue;
      }
      if (vk === 8) {
        if (text) text = text.slice(0, -1);
        else pushStep("按退格", e.t);
        continue;
      }
      if (vk === 13) { flushText(e.t); pushStep("按回车", e.t); continue; }
      if (vk === 9) { flushText(e.t); pushStep("按 Tab", e.t); continue; }
      if (vk === 27) { flushText(e.t); pushStep("按 Esc", e.t); continue; }
      if (vk >= 37 && vk <= 40) { flushText(e.t); pushStep(`按 ${vkLabel(vk, platform)}`, e.t); continue; }
      if (vk >= 112 && vk <= 123) { flushText(e.t); pushStep(`按 ${vkLabel(vk, platform)}`, e.t); continue; }
      if ([33, 34, 35, 36, 45, 46].includes(vk)) { flushText(e.t); pushStep(`按 ${vkLabel(vk, platform)}`, e.t); continue; }
      const ch = vkChar(vk, Boolean(e.shift), Boolean(e.caps), platform);
      if (ch != null) {
        text += ch;
        if (text.length >= 80) flushText(e.t);
        continue;
      }
      flushText(e.t);
      pushStep(`按 ${vkLabel(vk, platform)}`, e.t);
    }
  }
  flushText(end);
  if (!steps.length) return { ok: false, error: "没有生成可回放的步骤" };
  if (steps.length > 300) steps.splice(300, steps.length - 300, "（步骤过多，已截断；原始动作仍会完整回放）");

  let target = "";
  let best = -1;
  for (const [name, count] of titleCount) {
    if (count > best && name.trim()) { best = count; target = name; }
  }
  return {
    ok: true,
    draft: {
      actions,
      steps,
      screen: screen.width > 0 && screen.height > 0 ? screen : { width: 0, height: 0 },
      target,
      durationMs: Math.max(0, end),
      eventCount: actions.length,
      recordedAt: Date.now(),
      platform,
    },
  };
}
