/**
 * 快捷键域（10-28，用户：「面板里表情下方新增一个快捷键图标，点击后打开弹窗，集中展示应用内所有快捷键…
 * 支持在弹窗内修改快捷键并保存，且需与设置界面中的快捷键配置保持双向联动」+「还有截图快捷键，
 * 那个单独的一个设置界面，别漏了，也要保存联动性」）。
 *
 * 通道：shortcuts:read / shortcuts:save / shortcuts:reset
 *
 * ── 真相源怎么分工（⛔ 这决定了"双向联动"成不成立）─────────────────────────
 * · **应用内键（owner=renderer）**：存在 `userData/shortcuts.json`，本域独占读写；
 *   渲染层的全局 keydown 分发器按这份表匹配 —— 所以"改了立刻生效"。
 * · **截图键 / 语音键（owner=screenshot|voice）**：仍然各自存原来的文件
 *   （`screenshot-settings.json` / `voice-settings.json`），因为它们的 setter 还要
 *   **重注册 globalShortcut**（注册失败要报错、要先注册成功再落盘）。
 *   本域**只读**它们给弹窗看；写入由渲染层分别走既有的
 *   `screenshot:hotkey-set` / `voice:hotkey-set`。
 *   ⇒ 这样弹窗与"设置·截图 / 设置·语音"读写的是**同一份真相**，不存在两套数据；
 *     谁改都会被对方读到（联动天然成立），也不需要搬动老用户的既有配置。
 *
 * ⛔ 不在这里复制 globalShortcut 的注册逻辑：复制一份就会与截图/语音域各写一遍，
 *    "先注册成功再落盘"的关键顺序迟早漂移。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { broadcastHarnessEvent } from "./window-bus";
import { readScreenshotSettings } from "../screenshot";
import { loadVoiceSettings } from "../voice/voice-settings";
import {
  defaultBindings,
  editableShortcutIds,
  findConflicts,
  normalizeBindings,
} from "../../src/lib/shortcut-catalog.mjs";

type Bindings = Record<string, string[]>;

function userDataDir(): string {
  return app.getPath("userData");
}

function storeFile(): string {
  return path.join(userDataDir(), "shortcuts.json");
}

/** 只保留"可改 + 应用内"的那些 id，其余一律丢弃（前端塞垃圾也进不了存储）。 */
const EDITABLE = new Set(editableShortcutIds());

async function readUserBindings(): Promise<Bindings> {
  try {
    const raw = JSON.parse(await fs.readFile(storeFile(), "utf8"));
    const saved = raw?.bindings;
    const out: Bindings = {};
    if (saved && typeof saved === "object") {
      for (const [id, keys] of Object.entries(saved)) {
        if (!EDITABLE.has(id)) continue;
        const normalized = normalizeBindings(keys as string[]);
        if (normalized.length) out[id] = normalized;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 默认表 + 用户覆盖 = 实际生效的应用内键。 */
function mergeBindings(user: Bindings): Bindings {
  return { ...defaultBindings(), ...user };
}

/** 截图 / 语音的**实时**值（读它们各自的真存储，不缓存 —— 设置页刚改完这里就要能看到）。 */
async function readGlobalShortcuts(): Promise<Bindings> {
  const shot = await readScreenshotSettings(userDataDir()).catch(() => null);
  const voice = (() => { try { return loadVoiceSettings(userDataDir()); } catch { return null; } })();
  const out: Bindings = {};
  if (shot?.full?.accelerator) out["shot-full"] = normalizeBindings(shot.full.accelerator);
  if (shot?.region?.accelerator) out["shot-region"] = normalizeBindings(shot.region.accelerator);
  if (voice?.hotkey?.accelerator) out["voice-hotkey"] = normalizeBindings(voice.hotkey.accelerator);
  return out;
}

export const shortcutsFeature = defineFeature<null>({
  id: "shortcuts",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("shortcuts: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("shortcuts:read", async () => {
      const user = await readUserBindings();
      const globals = await readGlobalShortcuts();
      const bindings = { ...mergeBindings(user), ...globals };
      return { bindings, overrides: user, defaults: defaultBindings(), conflicts: findConflicts(bindings) };
    });

    /**
     * 只保存**应用内**的那些键（截图/语音由渲染层走各自通道）。
     * 可改键全部清空 = 视为"恢复默认"（否则用户没法撤销某一条）。
     */
    ipcHost.handle("shortcuts:save", async (_event, input: { bindings?: Bindings } = {}) => {
      const patch = input?.bindings ?? {};
      const next: Bindings = {};
      for (const [id, keys] of Object.entries(patch)) {
        if (!EDITABLE.has(id)) continue;
        const normalized = normalizeBindings(keys as string[]);
        const isDefault = normalized.length === 0;   // 空 = 回默认，不落盘
        if (!isDefault) next[id] = normalized;
      }
      const merged = { ...mergeBindings(next), ...(await readGlobalShortcuts()) };
      const conflicts = findConflicts(merged);
      /* ⛔ 冲突只**提示**不阻断：用户可能就是要先把 A 改掉、再改 B；
         阻断会让人卡死在一个"必须先改另一条"的死循环里。弹窗里会把这批 id 标红。 */
      try {
        await fs.writeFile(storeFile(), `${JSON.stringify({ version: 1, bindings: next }, null, 2)}\n`, "utf8");
      } catch (error: any) {
        return { ok: false, error: `快捷键保存失败：${String(error?.message ?? error)}` };
      }
      broadcastHarnessEvent({ type: "shortcuts-changed", at: Date.now() });
      return { ok: true, bindings: merged, conflicts };
    });

    ipcHost.handle("shortcuts:reset", async () => {
      try { await fs.unlink(storeFile()); } catch { /* 本来就没有 */ }
      const bindings = { ...defaultBindings(), ...(await readGlobalShortcuts()) };
      broadcastHarnessEvent({ type: "shortcuts-changed", at: Date.now() });
      return { ok: true, bindings, conflicts: findConflicts(bindings) };
    });

    ctx.effect(() => {
      for (const channel of ["shortcuts:read", "shortcuts:save", "shortcuts:reset"]) ipcHost.removeHandler(channel);
    });
  },
});
