/**
 * 自媒体工作台 · 数据层（11-09 接入 dsh-media-desk 的逻辑，MIT，见 THIRD_PARTY_NOTICES）。
 *
 * 真相源 = `<userData>/media-desk/state.json`（图片在 `files/` 子目录）。
 * ⛔ 只在函数调用时求值 userData（守卫【91】：app.setPath 晚于 import）。
 * ⛔ apiKey 只进主进程：对外返回的 state 一律抹成空串 + has*Key 布尔（渲染层不需要明文）。
 * ⛔ 写盘原子（tmp + rename）；每次变更保留一份上一版做撤销（最多 20 步）。
 */
import fs from "node:fs";
import path from "node:path";

export type Inspiration = {
  id: string; text: string; url?: string; title?: string; desc?: string; image?: string;
  tags: string[]; createdAt: number;
};
export type PostImage = { id: string; label: string; path: string };
export type PostPlan = {
  title: string; angle: string; points: string[]; coverText: string; shots: { text: string }[];
};
export type Post = {
  id: string; title: string; platform: string; kind: string; status: string;
  inspirationIds: string[]; styleId?: string; plan?: PostPlan | null; script: string;
  cover?: string; images: PostImage[]; createdAt: number; updatedAt: number;
};
export type Schedule = { id: string; postId?: string; title: string; when: number; platform: string; status: string };
export type StylePreset = { id: string; name: string; description: string; prompt: string; createdAt: number };
export type Metric = { id: string; postId?: string; date: string; views: number; likes: number; comments: number; shares: number; note?: string };
export type MediaDeskSettings = {
  assistant: { baseUrl: string; model: string; apiKey: string };
  image: { baseUrl: string; model: string; apiKey: string; size: string; quality: string };
  imageCount: number; shotCount: number; language: string;
};
export type MediaDeskState = {
  version: 1;
  inspirations: Inspiration[];
  posts: Post[];
  schedules: Schedule[];
  styles: StylePreset[];
  metrics: Metric[];
  settings: MediaDeskSettings;
};

export const COLLECTIONS = ["inspirations", "posts", "schedules", "styles", "metrics"] as const;
export type Collection = typeof COLLECTIONS[number];

const MAX_UNDO = 20;
const undoStack = new Map<string, string[]>();

function dirOf(userData: string): string {
  return path.join(userData, "media-desk");
}
function stateFile(userData: string): string {
  return path.join(dirOf(userData), "state.json");
}
/** 工作台的文件目录（生成的图片落在这里；渲染层按绝对路径经 harness-image 显示）。 */
export function filesDir(userData: string): string {
  return path.join(dirOf(userData), "files");
}

function defaultSettings(): MediaDeskSettings {
  return {
    assistant: { baseUrl: "", model: "", apiKey: "" },
    image: { baseUrl: "", model: "", apiKey: "", size: "1536x1024", quality: "" },
    imageCount: 2, shotCount: 6, language: "zh",
  };
}

function seedStyles(): StylePreset[] {
  const now = Date.now();
  return [
    { id: "style-oral", name: "干货口播", description: "结论先行、短句、可直接念", prompt: "口播风格：开头 3 秒给结论，短句，分点讲清步骤，结尾一句行动号召。", createdAt: now },
    { id: "style-story", name: "情绪故事", description: "场景代入、有起伏", prompt: "故事风格：用一个具体场景开头，写人物的处境与转折，最后落到启发。", createdAt: now },
    { id: "style-sell", name: "产品种草", description: "痛点—对比—收益", prompt: "种草风格：先点出痛点，再对比使用前后，讲清 3 个具体收益，避免夸大。", createdAt: now },
  ];
}

/** 空状态（含三套内置风格）；文件缺失/损坏时用它兜底。 */
export function emptyState(): MediaDeskState {
  return { version: 1, inspirations: [], posts: [], schedules: [], styles: seedStyles(), metrics: [], settings: defaultSettings() };
}

function migrate(input: unknown): MediaDeskState {
  const base = emptyState();
  const src = (input && typeof input === "object" ? input : {}) as Partial<MediaDeskState>;
  // ⛔ 补字段而不是整份丢弃：老版本文件缺字段时也要能打开。
  return {
    version: 1,
    inspirations: Array.isArray(src.inspirations) ? src.inspirations : [],
    posts: Array.isArray(src.posts) ? src.posts : [],
    schedules: Array.isArray(src.schedules) ? src.schedules : [],
    styles: Array.isArray(src.styles) && src.styles.length ? src.styles : base.styles,
    metrics: Array.isArray(src.metrics) ? src.metrics : [],
    settings: { ...base.settings, ...(src.settings ?? {}), assistant: { ...base.settings.assistant, ...(src.settings?.assistant ?? {}) }, image: { ...base.settings.image, ...(src.settings?.image ?? {}) } },
  };
}

/** 读整份状态（文件缺失/损坏回空态，⛔ 不抛 —— 它在 IPC 热路径上）。 */
export function readState(userData: string): MediaDeskState {
  try {
    return migrate(JSON.parse(fs.readFileSync(stateFile(userData), "utf8")));
  } catch {
    return emptyState();
  }
}

function writeState(userData: string, next: MediaDeskState, prevRaw?: string): void {
  fs.mkdirSync(dirOf(userData), { recursive: true });
  const raw = JSON.stringify(next, null, 2);
  if (prevRaw && prevRaw !== raw) {
    const stack = undoStack.get(userData) ?? [];
    stack.push(prevRaw);
    while (stack.length > MAX_UNDO) stack.shift();
    undoStack.set(userData, stack);
  }
  const tmp = `${stateFile(userData)}.tmp`;
  fs.writeFileSync(tmp, raw, "utf8");
  fs.renameSync(tmp, stateFile(userData));
}

function rawOf(userData: string): string {
  try { return fs.readFileSync(stateFile(userData), "utf8"); } catch { return ""; }
}

/** 生成带前缀的短 id（灵感/稿子/图片/指标共用）。 */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 对外状态：抹掉两处 apiKey，只给 has 标记。 */
export function publicState(state: MediaDeskState): MediaDeskState & { hasAssistantKey: boolean; hasImageKey: boolean } {
  return {
    ...state,
    settings: {
      ...state.settings,
      assistant: { ...state.settings.assistant, apiKey: "" },
      image: { ...state.settings.image, apiKey: "" },
    },
    hasAssistantKey: Boolean(state.settings.assistant.apiKey),
    hasImageKey: Boolean(state.settings.image.apiKey),
  };
}

type Mutate = (state: MediaDeskState) => { state: MediaDeskState; out?: unknown };

/** 读-改-写（单进程串行，IPC 本身是串行事件循环；这里保留统一入口便于加锁）。 */
export function mutateState(userData: string, fn: Mutate): unknown {
  const prevRaw = rawOf(userData);
  const current = readState(userData);
  const { state, out } = fn(current);
  writeState(userData, state, prevRaw);
  return out;
}

/** 新增一条（id/createdAt 由主进程给，排在最前）。 */
export function addItem(userData: string, collection: Collection, item: Record<string, unknown>): unknown {
  return mutateState(userData, (state) => {
    const list = state[collection] as Array<Record<string, unknown>>;
    const now = Date.now();
    const row = { id: newId(collection.slice(0, 2)), createdAt: now, ...item };
    list.unshift(row);
    return { state, out: row };
  });
}

/** 局部更新一条（顺带刷新 updatedAt）；id 不存在返回 null。 */
export function updateItem(userData: string, collection: Collection, id: string, patch: Record<string, unknown>): unknown {
  return mutateState(userData, (state) => {
    const list = state[collection] as Array<Record<string, unknown>>;
    const idx = list.findIndex((row) => String(row.id) === String(id));
    if (idx < 0) return { state, out: null };
    list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
    return { state, out: list[idx] };
  });
}

/** 删除一条（只认显式 id）；不存在返回 false。 */
export function deleteItem(userData: string, collection: Collection, id: string): unknown {
  return mutateState(userData, (state) => {
    const list = state[collection] as Array<Record<string, unknown>>;
    const idx = list.findIndex((row) => String(row.id) === String(id));
    if (idx < 0) return { state, out: false };
    list.splice(idx, 1);
    return { state, out: true };
  });
}

/** 设置合并：apiKey 只在**显式给了非空值**时覆盖（空串=保持不变，⛔ 别让"保存"把密钥清掉）。 */
export function mergeSettings(userData: string, patch: Partial<MediaDeskSettings>): MediaDeskSettings {
  return mutateState(userData, (state) => {
    const s = state.settings;
    const assistant = { ...s.assistant, ...(patch.assistant ?? {}) } as MediaDeskSettings["assistant"];
    const image = { ...s.image, ...(patch.image ?? {}) } as MediaDeskSettings["image"];
    if (patch.assistant && !patch.assistant.apiKey) assistant.apiKey = s.assistant.apiKey;
    if (patch.image && !patch.image.apiKey) image.apiKey = s.image.apiKey;
    state.settings = { ...s, ...patch, assistant, image };
    return { state, out: state.settings };
  }) as MediaDeskSettings;
}

/** 撤销上一步（恢复上一版整份 state；没有历史返回 false）。 */
export function undo(userData: string): boolean {
  const stack = undoStack.get(userData) ?? [];
  const prev = stack.pop();
  if (!prev) return false;
  fs.mkdirSync(dirOf(userData), { recursive: true });
  fs.writeFileSync(stateFile(userData), prev, "utf8");
  return true;
}
