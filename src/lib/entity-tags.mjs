/** 会话 / 项目自定义标签（10-25 用户立项）：文字 + 颜色，默认无标签。
 *  ⛔ 只存展示数据（localStorage），不参与引擎配置；键按实体 id/cwd 隔离。
 *  ⛔ 同一个 renderer 内用版本快照驱动重渲染；跨窗口由 localStorage 各自读取。 */
const THREAD_KEY = "entity-thread-tags-v1";
const PROJECT_KEY = "entity-project-tags-v1";

export const TAG_COLORS = [
  { id: "blue", label: "蓝", value: "#3b82f6" },
  { id: "green", label: "绿", value: "#22c55e" },
  { id: "amber", label: "橙", value: "#f59e0b" },
  { id: "red", label: "红", value: "#ef4444" },
  { id: "violet", label: "紫", value: "#8b5cf6" },
  { id: "cyan", label: "青", value: "#06b6d4" },
  { id: "pink", label: "粉", value: "#ec4899" },
  { id: "slate", label: "灰", value: "#64748b" },
];

/** { [id]: { text, color } }；localStorage 里的脏值在这里收口。 */
function readMap(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [id, value] of Object.entries(raw)) {
      if (!id || !value || typeof value !== "object") continue;
      const text = String(value.text ?? "").trim().slice(0, 20);
      const color = String(value.color ?? "").trim();
      if (!text) continue;
      out[id] = { text, color: /^#[0-9a-f]{6}$/i.test(color) ? color : TAG_COLORS[0].value };
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(key, map) {
  try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* 隐私模式忽略 */ }
}

let snapshot = { threads: {}, projects: {}, editor: null, version: 0 };
let loaded = false;
const listeners = new Set();

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  snapshot = { ...snapshot, threads: readMap(THREAD_KEY), projects: readMap(PROJECT_KEY) };
}

function emit(next) {
  snapshot = { ...next, version: snapshot.version + 1 };
  for (const listener of listeners) listener();
}

export function getEntityTagState() {
  ensureLoaded();
  return snapshot;
}

export function subscribeEntityTags(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 打开标签编辑弹窗；kind=thread 时 id 是 threadId，kind=project 时 id 是 cwd。 */
export function openTagEditor(editor) {
  ensureLoaded();
  emit({ ...snapshot, editor });
}

export function closeTagEditor() {
  ensureLoaded();
  if (!snapshot.editor) return;
  emit({ ...snapshot, editor: null });
}

export function setEntityTag(kind, id, tag) {
  ensureLoaded();
  const text = String(tag?.text ?? "").trim().slice(0, 20);
  if (!id || !text) return;
  const color = /^#[0-9a-f]{6}$/i.test(String(tag?.color ?? "")) ? String(tag.color) : TAG_COLORS[0].value;
  if (kind === "project") {
    const projects = { ...snapshot.projects, [id]: { text, color } };
    writeMap(PROJECT_KEY, projects);
    emit({ ...snapshot, projects, editor: null });
  } else {
    const threads = { ...snapshot.threads, [id]: { text, color } };
    writeMap(THREAD_KEY, threads);
    emit({ ...snapshot, threads, editor: null });
  }
}

export function removeEntityTag(kind, id) {
  ensureLoaded();
  if (!id) return;
  if (kind === "project") {
    const projects = { ...snapshot.projects };
    delete projects[id];
    writeMap(PROJECT_KEY, projects);
    emit({ ...snapshot, projects, editor: null });
  } else {
    const threads = { ...snapshot.threads };
    delete threads[id];
    writeMap(THREAD_KEY, threads);
    emit({ ...snapshot, threads, editor: null });
  }
}
