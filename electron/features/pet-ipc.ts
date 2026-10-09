/**
 * pet-ipc（09-30 新增：桌面宠物域）
 *
 * 域：**桌面宠物**（官方 Codex 宠物格式的发现 / 校验 / 设置）。
 * 通道：pet:list / pet:settings-get / pet:settings-set / pet:state / pet:roots /
 *       pet:open-dir / pet:import / pet:rescan
 *
 * 官方宠物格式（实测自引擎二进制 + petdex 公开规范）：
 *   宠物包 = `pet.json` + `spritesheet.{png,webp}`；
 *   图集 8 列 × N 行、每帧默认 192×208；v1 九行、v2 十一行（多两行 + 方向）。
 *   九态行名（顺序即行序）：idle / running-right / running-left / waving / jumping /
 *                            failed / waiting / running / review
 *
 * ⛔ 四个宠物目录（扫描面；**单一真相源在 PET_ROOTS**，协议白名单与设置页共用它）：
 *   ① `<appPath>/dist/pets`    —— 我们内置的（随包发；public/pets 构建时复制过来）
 *   ② `<appPath>/public/pets`  —— dev 未构建时的内置宠物（同源，优先级低于 ①）
 *   ③ `<userData>/pets`        —— 用户自己的（「导入」落这里，可一键打开）
 *   ④ `~/.codex/pets`、`~/.petdex/pets` —— 官方 TUI / petdex CLI 装的（读取展示，可导入）
 *   ⛔ 外目录只读：不擅自把别处的文件搬进来，用户点「导入」才复制。
 *
 * ⛔ 惰性求值：本模块**不得**在顶层调 `app.getPath()`（【91】复发防线：模块体早于
 *    main.ts 的 `app.setPath("userData")` 执行，会拿到默认目录导致路径静默漂移）。
 */
import { app, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { petSignal } from "./pet-state";
import { applyPetSettings, hidePetWindow, isPetVisible, petWindowBounds, pushPetConfig, setPetMouseIgnore, setPetMoveHandler, showPetWindow } from "./pet-window";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

/** 官方九态行名（v1）。顺序即行序，⛔ 别重排。 */
export const PET_STATE_ROWS = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
] as const;

/** 官方默认帧尺寸与列数（pet.json 未声明时的回落值）。 */
const DEFAULT_FRAME = { width: 192, height: 208 };
const DEFAULT_COLS = 8;
const DEFAULT_ROWS = 9;

export interface PetPackage {
  /** 目录名（唯一键） */
  id: string;
  name: string;
  description: string;
  /** 宠物包目录绝对路径 */
  dir: string;
  /** 图集绝对路径（渲染层经 pet:// 协议取用） */
  spritesheet: string;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  /** 图集里的状态行名（缺省用官方九态） */
  states: string[];
  /** 来源：内置 / 用户 / 官方引擎 / petdex */
  source: "builtin" | "user" | "codex" | "petdex";
  /** 校验不通过时给出原因（渲染层灰显 + 提示） */
  problem?: string;
}

export interface PetSettings {
  /** 是否在桌面显示宠物 */
  enabled: boolean;
  /** 当前生效的宠物 id（null = 用第一只可用的） */
  active: string | null;
  /** 显示倍率（0.6 ~ 1.8） */
  scale: number;
  /** 不透明度（0.4 ~ 1） */
  opacity: number;
  /** 窗口左上角坐标（null = 默认右下角） */
  x: number | null;
  y: number | null;
}

const DEFAULT_SETTINGS: PetSettings = { enabled: false, active: null, scale: 1, opacity: 0.92, x: null, y: null };

function settingsFile(): string {
  return path.join(app.getPath("userData"), "pet-settings.json");
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** 归一化不是洁癖：手改 pet-settings.json 塞进字符串/巨大值会让窗口变成不可见的针尖。 */
export function normalizePetSettings(raw: unknown): PetSettings {
  const value = (raw ?? {}) as Partial<PetSettings>;
  return {
    enabled: Boolean(value.enabled),
    active: typeof value.active === "string" && value.active ? value.active : null,
    scale: clamp(Number(value.scale), 0.6, 1.8, DEFAULT_SETTINGS.scale),
    opacity: clamp(Number(value.opacity), 0.4, 1, DEFAULT_SETTINGS.opacity),
    x: Number.isFinite(Number(value.x)) ? Number(value.x) : null,
    y: Number.isFinite(Number(value.y)) ? Number(value.y) : null,
  };
}

export function readPetSettings(): PetSettings {
  try {
    const raw = fs.readFileSync(settingsFile(), "utf8");
    return normalizePetSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writePetSettings(next: PetSettings): PetSettings {
  const value = normalizePetSettings(next);
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn("[pet] 设置写入失败:", (error as Error)?.message ?? error);
  }
  return value;
}

/** 用户自己的宠物目录（「导入」的落点；可一键打开）。 */
export function userPetDir(): string {
  return path.join(app.getPath("userData"), "pets");
}

/* 用户拖动宠物后把坐标落盘（pet-window 只发回调，设置归属仍在本模块）。 */
setPetMoveHandler((pos) => {
  writePetSettings({ ...readPetSettings(), ...pos });
});

/**
 * 全部宠物目录（扫描面 = 协议白名单，**单一真相源**）。
 * ⛔ 外目录（codex / petdex）只读展示，导入才复制。
 */
export function petRoots(): { dir: string; source: PetPackage["source"] }[] {
  const appPath = app.getAppPath();
  return [
    { dir: path.join(appPath, "dist", "pets"), source: "builtin" },
    { dir: path.join(appPath, "public", "pets"), source: "builtin" },
    { dir: userPetDir(), source: "user" },
    { dir: path.join(os.homedir(), ".codex", "pets"), source: "codex" },
    { dir: path.join(os.homedir(), ".petdex", "pets"), source: "petdex" },
  ];
}

/** 协议白名单用的目录集合（只读这些目录下的图片）。 */
export function petAssetRoots(): string[] {
  return petRoots().map((r) => path.resolve(r.dir));
}

function readPetPackage(dir: string, id: string, source: PetPackage["source"]): PetPackage | null {
  const metaPath = path.join(dir, "pet.json");
  if (!fs.existsSync(metaPath)) return null;
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    return {
      id, name: id, description: "", dir, spritesheet: "",
      columns: DEFAULT_COLS, rows: DEFAULT_ROWS,
      frameWidth: DEFAULT_FRAME.width, frameHeight: DEFAULT_FRAME.height,
      states: [...PET_STATE_ROWS], source,
      problem: `pet.json 解析失败：${(error as Error).message}`,
    };
  }

  const sheetName = String(meta.spritesheetPath ?? "spritesheet.webp");
  let spritesheet = path.join(dir, sheetName);
  if (!fs.existsSync(spritesheet)) {
    // 官方包里两种扩展名都合法（spritesheet.webp / spritesheet.png）——按实际存在的那个回落
    const alt = path.join(dir, sheetName.replace(/\.(webp|png)$/i, (m) => (m.toLowerCase() === ".webp" ? ".png" : ".webp")));
    if (fs.existsSync(alt)) spritesheet = alt;
  }
  const frame = (meta.frameSize ?? {}) as { width?: number; height?: number };
  const rows = Number(meta.rows) || (Number(meta.spriteVersionNumber) === 2 ? 11 : DEFAULT_ROWS);
  const states = Array.isArray(meta.states) && meta.states.length ? meta.states.map(String) : [...PET_STATE_ROWS];
  const missing = !fs.existsSync(spritesheet);

  return {
    id,
    name: String(meta.displayName ?? meta.name ?? id),
    description: String(meta.description ?? ""),
    dir,
    spritesheet: missing ? "" : spritesheet,
    columns: Number(meta.columns) || DEFAULT_COLS,
    rows,
    frameWidth: Number(frame.width) || DEFAULT_FRAME.width,
    frameHeight: Number(frame.height) || DEFAULT_FRAME.height,
    states,
    source,
    problem: missing ? `缺少图集文件（pet.json 声明 ${sheetName}）` : undefined,
  };
}

/** 扫描全部宠物目录。同名 id 先到先得（内置优先），后到的标出冲突。 */
export function scanPets(): PetPackage[] {
  const byId = new Map<string, PetPackage>();
  for (const { dir, source } of petRoots()) {
    let entries: fs.Dirent[] = [];
    try {
      if (!fs.existsSync(dir)) continue;
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      if (byId.has(id)) continue;                 // 先到的（内置）优先
      const pkg = readPetPackage(path.join(dir, id), id, source);
      if (pkg) byId.set(id, pkg);
    }
  }
  // 内置排前面，其余按名字排
  return [...byId.values()].sort((a, b) => {
    const rank = (p: PetPackage) => (p.source === "builtin" ? 0 : 1);
    return rank(a) - rank(b) || a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

/** 设置变更后：算出生效的宠物包并推给浮窗（⛔ 不推的话已开着的浮窗不会换宠物 —— 09-30 实测）。 */
function publishPetConfig(settings: PetSettings) {
  try { pushPetConfig({ settings, active: resolveActivePet(settings) }); } catch { /* 浮窗可能没开，忽略 */ }
}

/** 解析「当前该显示哪只」：设置里的 active 有效就用它，否则第一只可用的。 */
export function resolveActivePet(settings = readPetSettings()): PetPackage | null {
  const pets = scanPets().filter((p) => !p.problem);
  if (!pets.length) return null;
  return pets.find((p) => p.id === settings.active) ?? pets[0];
}

/* ══════════════════════ IPC ══════════════════════ */
/* P2 批次 6（10-03）：改插件形态 —— 十个 handler 的**实现**留在模块级函数里（逐字未改），
   注册 / 卸载交给容器（`inject: ["ipc"]`，⛔ 不再直接 `ipcMain.handle`）。
   ⛔ 十个通道名是对外契约：preload 桥接面 / ipc-registry 账本 / 守卫【232】都按**字面量**锚它们。 */

function setPetSettingsFromPatch(patch: Partial<PetSettings>) {
  const next = writePetSettings({ ...readPetSettings(), ...(patch ?? {}) });
  // 应用副作用（显隐 / 位置 / 缩放）交给窗口模块；它内部自己读设置
  applyPetSettings(next);
  publishPetConfig(next);
  return { settings: next, active: resolveActivePet(next) };
}

async function openPetDir(which?: string) {
  const target = which === "user" || !which ? userPetDir() : String(which);
  // 目录不存在先建（打开不存在的路径在 Windows 上会静默什么都不发生）
  try { fs.mkdirSync(target, { recursive: true }); } catch { /* 外目录不可写时忽略 */ }
  const error = await shell.openPath(target);
  return { ok: !error, error: error || undefined, dir: target };
}

/** 导入：把外部宠物包**复制**进 `<userData>/pets`（⛔ 不移动、不覆盖已有同名目录）。 */
function importPetDir(dir: string) {
  const source = path.resolve(String(dir ?? ""));
  const allowed = petRoots().some((r) => path.resolve(r.dir) === path.dirname(source));
  if (!allowed) return { ok: false, error: "只允许从已登记的宠物目录导入" };
  if (!fs.existsSync(path.join(source, "pet.json"))) return { ok: false, error: "该目录不是宠物包（缺 pet.json）" };
  const id = path.basename(source);
  const dest = path.join(userPetDir(), id);
  if (fs.existsSync(dest)) return { ok: false, error: `已存在同名宠物：${id}` };
  try {
    fs.mkdirSync(userPetDir(), { recursive: true });
    fs.cpSync(source, dest, { recursive: true });
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  return { ok: true, id };
}

/** 显隐（走独立通道，避免设置页为了开关宠物而整份重写设置）。 */
function togglePet() {
  const settings = readPetSettings();
  const next = writePetSettings({ ...settings, enabled: !settings.enabled });
  applyPetSettings(next);
  publishPetConfig(next);
  return { settings: next, open: isPetVisible() };
}

function showPet() {
  const next = writePetSettings({ ...readPetSettings(), enabled: true });
  showPetWindow(next);
  publishPetConfig(next);
  return { settings: next, open: isPetVisible() };
}

function hidePet() {
  const next = writePetSettings({ ...readPetSettings(), enabled: false });
  hidePetWindow();
  publishPetConfig(next);
  return { settings: next, open: isPetVisible() };
}

export const petFeature = defineFeature<null>({
  id: "pet",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    // inject 已在容器侧挡过一次；这里再挡一次只为把类型收紧（⛔ 不写 `!`：缺依赖要报得出来）
    if (!ipcHost) throw new Error("pet: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("pet:list", () => scanPets());

    ipcHost.handle("pet:settings-get", () => ({ settings: readPetSettings(), active: resolveActivePet() }));

    ipcHost.handle("pet:settings-set", (_event, patch: Partial<PetSettings>) => setPetSettingsFromPatch(patch));

    ipcHost.handle("pet:state", () => ({ signal: petSignal(), open: isPetVisible(), bounds: petWindowBounds() }));

    /** 目录清单：给设置页显示"能放哪儿"+ 打开按钮。 */
    ipcHost.handle("pet:roots", () => petRoots().map(({ dir, source }) => ({
      dir,
      source,
      exists: fs.existsSync(dir),
      writable: source === "user",
    })));

    ipcHost.handle("pet:open-dir", (_event, which?: string) => openPetDir(which));

    ipcHost.handle("pet:import", (_event, dir: string) => importPetDir(dir));

    ipcHost.handle("pet:toggle", () => togglePet());

    ipcHost.handle("pet:show", () => showPet());

    ipcHost.handle("pet:hide", () => hidePet());

    /* 透明区域鼠标穿透开关（渲染层按「指针是否在宠物本体上」动态翻转；见 pet-window 头注）。
       ⛔ 高频通道但**必须走 IPC**：setIgnoreMouseEvents 只能主进程调，渲染层没有任何旁路。 */
    ipcHost.handle("pet:ignore-mouse", (_event, ignore: boolean) => {
      setPetMouseIgnore(Boolean(ignore));
      return { ok: true, ignore: Boolean(ignore) };
    });

    // 生命期：卸载时摘掉本域十一条通道（不摘 = 卸载后通道还在、实现已被回收 ⇒ 调用报错）
    ctx.effect(() => {
      ipcHost.removeHandler("pet:list");
      ipcHost.removeHandler("pet:settings-get");
      ipcHost.removeHandler("pet:settings-set");
      ipcHost.removeHandler("pet:state");
      ipcHost.removeHandler("pet:roots");
      ipcHost.removeHandler("pet:open-dir");
      ipcHost.removeHandler("pet:import");
      ipcHost.removeHandler("pet:toggle");
      ipcHost.removeHandler("pet:show");
      ipcHost.removeHandler("pet:hide");
      ipcHost.removeHandler("pet:ignore-mouse");
    });
  },
});
