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
};

/* ── 录制数据 → 步骤（纯函数，守卫真跑） ─────────────────────── */

const VK_LABEL: Record<number, string> = {
  8: "退格", 9: "Tab", 13: "回车", 27: "Esc", 32: "空格", 33: "PageUp", 34: "PageDown",
  35: "End", 36: "Home", 37: "←", 38: "↑", 39: "→", 40: "↓", 45: "Insert", 46: "Delete",
  91: "Win", 92: "Win", 93: "菜单", 20: "CapsLock", 19: "Pause", 144: "NumLock",
};

function vkLabel(vk: number): string {
  if (VK_LABEL[vk]) return VK_LABEL[vk];
  if (vk >= 65 && vk <= 90) return String.fromCharCode(vk);
  if (vk >= 48 && vk <= 57) return String.fromCharCode(vk);
  if (vk >= 96 && vk <= 105) return `小键盘${vk - 96}`;
  if (vk >= 112 && vk <= 123) return `F${vk - 111}`;
  return `VK${vk}`;
}

function vkChar(vk: number, shift: boolean, caps: boolean): string | null {
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

function comboLabel(a: RpaAction): string {
  const parts: string[] = [];
  if (a.ctrl) parts.push("Ctrl");
  if (a.alt) parts.push("Alt");
  if (a.shift) parts.push("Shift");
  if (a.win) parts.push("Win");
  parts.push(vkLabel(Number(a.vk)));
  return parts.join("+");
}

/** 把录制 NDJSON 转成「人话步骤 + 原始动作」；没有可回放的操作时返回错误。 */
export function convertRecording(raw: string): { ok: true; draft: RpaRecordedDraft } | { ok: false; error: string } {
  const events: RpaAction[] = [];
  let screen = { width: 0, height: 0 };
  let endT = 0;
  for (const line of String(raw ?? "").split("\n")) {
    const text = line.trim();
    if (!text) continue;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { continue; }
    const type = String(parsed.type ?? "");
    if (type === "meta") {
      screen = { width: Number(parsed.width) || 0, height: Number(parsed.height) || 0 };
      continue;
    }
    if (type === "end") { endT = Number(parsed.t) || endT; continue; }
    if (!["move", "down", "up", "keydown", "keyup", "focus"].includes(type)) continue;
    const action: RpaAction = { t: Number(parsed.t) || 0, type: type as RpaAction["type"] };
    if (type === "focus") action.title = String(parsed.title ?? "");
    else if (type === "down" || type === "up") {
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

  /* 去掉触发停止快捷键（Ctrl+Alt+F9）的尾事件——Electron 注册了它，录制器也会看到。 */
  let stopAt = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type === "keydown" && e.vk === 0x78 && (e.ctrl || e.alt)) { stopAt = e.t; break; }
  }
  const actions = events.filter((e) => {
    if (stopAt >= 0 && e.t >= stopAt - 250) {
      if (e.type === "keydown" || e.type === "keyup") return ![0x11, 0x12, 0x78].includes(Number(e.vk));
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
      if ([16, 17, 18, 91, 92, 20].includes(vk)) continue;
      const hasMod = Boolean(e.ctrl || e.alt || e.win);
      if (hasMod) {
        flushText(e.t);
        pushStep(`按 ${comboLabel(e)}`, e.t);
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
      if (vk >= 37 && vk <= 40) { flushText(e.t); pushStep(`按 ${vkLabel(vk)}`, e.t); continue; }
      if (vk >= 112 && vk <= 123) { flushText(e.t); pushStep(`按 ${vkLabel(vk)}`, e.t); continue; }
      if ([33, 34, 35, 36, 45, 46].includes(vk)) { flushText(e.t); pushStep(`按 ${vkLabel(vk)}`, e.t); continue; }
      const ch = vkChar(vk, Boolean(e.shift), Boolean(e.caps));
      if (ch != null) {
        text += ch;
        if (text.length >= 80) flushText(e.t);
        continue;
      }
      flushText(e.t);
      pushStep(`按 ${vkLabel(vk)}`, e.t);
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
    },
  };
}
