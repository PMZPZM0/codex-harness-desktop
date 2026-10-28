/**
 * 应用快捷键目录（单一真相源，10-28 立）。
 *
 * 为什么放在 src/lib 而不是渲染层内部：**主进程也要用它**（校验用户改的键合法、
 * 与截图/语音的全局快捷键做重名检测），而 `electron/` 与 `src/` 互不 import 的约定
 * 只针对 `.ts` 源码域；纯数据的 `.mjs` 早就是双方共用面（先例：turn-file-actions.mjs）。
 *
 * 三层概念，别混：
 *   · owner = **谁执行**（renderer 自己监听 keydown / 主进程 globalShortcut）
 *   · scope = 生效范围（app = 应用内；global = 系统级全局；fixed = 固定不可改）
 *   · editable = 用户能不能改（global 的键注册失败会报错，仍可改；fixed 一律不可改）
 *
 * ⛔ 键位字符串统一写 `Ctrl+Shift+F` 这种形态：**Ctrl 就是"命令键"**，
 *    mac 上运行时按 Command 匹配、展示时换成 ⌘（由 bindingLabel 负责）。
 *    别在数据里写 Command / Cmd，否则两个平台各存一套、必然漂移。
 */

/** 分组顺序 = 弹窗里的分类下拉顺序，也是列表分组顺序。 */
export const SHORTCUT_GROUPS = [
  { id: "chat", label: "对话与输入" },
  { id: "session", label: "新建与会话" },
  { id: "view", label: "界面与面板" },
  { id: "capture", label: "截图" },
  { id: "voice", label: "语音" },
  { id: "fixed", label: "固定键（不可改）" },
];

/**
 * @typedef {Object} ShortcutEntry
 * @property {string} id         稳定标识（存盘用，⛔ 改名等于丢用户配置）
 * @property {string} group      见 SHORTCUT_GROUPS.id
 * @property {string} label      短名（列表主文案）
 * @property {string} [desc]     补充说明
 * @property {"renderer"|"screenshot"|"voice"} owner
 * @property {"app"|"global"|"fixed"} scope
 * @property {string[]} defaultKeys  默认键（可多套，任一命中即触发）
 * @property {boolean} editable
 */

/** @type {ShortcutEntry[]} */
export const SHORTCUT_CATALOG = [
  /* ── 对话与输入 ───────────────────────────────────────────── */
  { id: "focus-input", group: "chat", label: "聚焦输入框", owner: "renderer", scope: "app", defaultKeys: ["Ctrl+L", "Ctrl+Shift+/"], editable: true },
  { id: "chat-search", group: "chat", label: "搜索当前会话", desc: "只看当前会话的消息", owner: "renderer", scope: "app", defaultKeys: ["Ctrl+Shift+F"], editable: true },

  /* ── 新建与会话 ───────────────────────────────────────────── */
  { id: "new-thread", group: "session", label: "新建对话", owner: "renderer", scope: "app", defaultKeys: ["Ctrl+N", "Ctrl+Shift+N"], editable: true },
  { id: "palette", group: "session", label: "命令面板", desc: "搜索会话、项目、设置页", owner: "renderer", scope: "app", defaultKeys: ["Ctrl+K", "Ctrl+P", "Ctrl+Shift+P"], editable: true },
  { id: "workspace", group: "session", label: "更换工作区目录", owner: "renderer", scope: "app", defaultKeys: ["Ctrl+O"], editable: true },
  { id: "boss-session", group: "session", label: "打开指挥中枢", desc: "mac 上 ⌘M 被系统占用，默认第二套 ⌘⇧B 同样生效", owner: "renderer", scope: "app", defaultKeys: ["Ctrl+M", "Ctrl+Shift+B"], editable: true },

  /* ── 界面与面板 ───────────────────────────────────────────── */
  { id: "toggle-right", group: "view", label: "右侧面板开 / 关", owner: "renderer", scope: "app", defaultKeys: ["Ctrl+B"], editable: true },
  { id: "terminal", group: "view", label: "打开终端面板", owner: "renderer", scope: "app", defaultKeys: ["Ctrl+J"], editable: true },
  { id: "settings", group: "view", label: "打开设置", owner: "renderer", scope: "app", defaultKeys: ["Ctrl+,", "Ctrl+Shift+S"], editable: true },
  { id: "shortcuts", group: "view", label: "打开快捷键面板", desc: "就是这个窗口", owner: "renderer", scope: "app", defaultKeys: ["Ctrl+/"], editable: true },

  /* ── 截图（主进程 globalShortcut，设置·截图 里也能改）────────── */
  { id: "shot-full", group: "capture", label: "全屏截图", owner: "screenshot", scope: "global", defaultKeys: ["Ctrl+Shift+Alt+A"], editable: true },
  { id: "shot-region", group: "capture", label: "框选截图", owner: "screenshot", scope: "global", defaultKeys: ["Ctrl+Shift+Alt+S"], editable: true },

  /* ── 语音（主进程 globalShortcut，设置·语音 里也能改）────────── */
  { id: "voice-hotkey", group: "voice", label: "开始 / 结束语音通话", owner: "voice", scope: "global", defaultKeys: ["Ctrl+Shift+M"], editable: true },

  /* ── 固定键：展示但不许改（文本编辑语义，改了会伤基本操作）────── */
  { id: "send", group: "fixed", label: "发送消息", owner: "renderer", scope: "fixed", defaultKeys: ["Enter"], editable: false },
  { id: "newline", group: "fixed", label: "输入框内换行", owner: "renderer", scope: "fixed", defaultKeys: ["Shift+Enter"], editable: false },
  { id: "close", group: "fixed", label: "关闭当前弹窗 / 面板", owner: "renderer", scope: "fixed", defaultKeys: ["Esc"], editable: false },
];

/** 允许出现在绑定里的修饰键（顺序即规范化顺序）。 */
const MOD_ORDER = ["Ctrl", "Shift", "Alt"];

/** 修饰键别名 → 规范名。用户从别处粘 `Cmd` / `Control` 也能收。 */
const MOD_ALIAS = {
  ctrl: "Ctrl", control: "Ctrl", cmd: "Ctrl", command: "Ctrl", commandorcontrol: "Ctrl", mod: "Ctrl",
  shift: "Shift", alt: "Alt", option: "Alt", opt: "Alt",
};

/**
 * 把一件绑定规范成 `Ctrl+Shift+F`：修饰键去重并按固定顺序、主键小写。
 * 不合法返回 ""（调用方据此报错，别静默塞进去）。
 */
export function normalizeBinding(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const parts = raw.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return "";
  const mods = new Set();
  let key = "";
  for (const part of parts) {
    const asMod = MOD_ALIAS[part.toLowerCase()];
    if (asMod) { mods.add(asMod); continue; }
    /* 主键只能是单个字符或已知功能键名（F1..F24 / Esc / Enter / Space 等） */
    if (key) return "";              // 两个主键 ⇒ 非法
    /* ⛔ 主键统一**大写**落库：比较（冲突检测靠字符串相等）与展示（Ctrl+Shift+F 不是 f）都靠它一致 */
    key = part.length === 1 ? part.toUpperCase() : part.replace(/^./, (c) => c.toUpperCase());
  }
  if (!key) return "";
  /* 纯修饰键不可作为主键 */
  if (MOD_ALIAS[key.toLowerCase()]) return "";
  const ordered = MOD_ORDER.filter((m) => mods.has(m));
  return [...ordered, key].join("+");
}

/** 一键多套：规范全部、丢掉非法的与重复的。 */
export function normalizeBindings(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  const out = [];
  for (const item of list) {
    const normalized = normalizeBinding(item);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/** 展示用：mac 把 Ctrl 换 ⌘、Shift 换 ⇧、Alt 换 ⌥，更符合键帽。 */
export function bindingLabel(keys, isMac) {
  const list = normalizeBindings(keys);
  if (!list.length) return "未设置";
  return list
    .map((binding) => binding
      .split("+")
      .map((part) => (isMac ? ({ Ctrl: "⌘", Shift: "⇧", Alt: "⌥" }[part] ?? part) : part))
      .join(isMac ? "" : "+"))
    .join(isMac ? " / " : " / ");
}

/**
 * 事件是否命中某套绑定。
 * ⛔ 平台语义：数据里的 Ctrl 在 mac 上就是 Command（见文件头注释）；
 *    因此 mac 下 ctrlKey 反而应当**不**参与匹配（否则 ⌃⇧F 会误触发 ⌘⇧F 的动作）。
 */
export function bindingMatches(event, binding, isMac) {
  const normalized = normalizeBinding(binding);
  if (!normalized) return false;
  const parts = normalized.split("+");
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const wantMod = mods.has("Ctrl");
  const wantShift = mods.has("Shift");
  const wantAlt = mods.has("Alt");
  const hasMod = isMac ? event.metaKey : event.ctrlKey;
  const hasOtherMod = isMac ? event.ctrlKey : event.metaKey;
  if (hasOtherMod) return false;
  if (Boolean(hasMod) !== wantMod) return false;
  if (Boolean(event.shiftKey) !== wantShift) return false;
  if (Boolean(event.altKey) !== wantAlt) return false;
  const pressed = String(event.key ?? "");
  /* ⛔ 两边都要 toLowerCase：binding 里的主键已规范成大写（Ctrl+Shift+Y），
     event.key 在小写布局/未按 Shift 时是 "y" —— 只转一边就永远不等（10-28 实测：
     「改了键不生效」的真因不是分发器没跑，而是这里恒 false）。 */
  if (key.length === 1) return pressed.toLowerCase() === key.toLowerCase();
  /* 功能键名：Enter / Esc / F5 / Space 等，大小写不敏感比对 */
  return pressed.toLowerCase() === key.toLowerCase();
}

/**
 * 冲突检测：返回 `[[idA, idB], …]`。
 * ⛔ **全局**判重（不按 owner 分组）：截图/语音走的是系统级 globalShortcut，会先于窗口
 *    截获按键 —— 应用内键与截图键撞了同样"永远收不到"，必须一起报。
 */
export function findConflicts(bindings) {
  const seen = new Map();   // binding → id
  const conflicts = [];
  for (const entry of SHORTCUT_CATALOG) {
    if (entry.scope === "fixed") continue;
    const keys = normalizeBindings(bindings?.[entry.id] ?? entry.defaultKeys);
    for (const binding of keys) {
      const prev = seen.get(binding);
      if (prev) conflicts.push([prev, entry.id]);
      else seen.set(binding, entry.id);
    }
  }
  return conflicts;
}

/** 默认绑定表（id → keys），首次打开/重置时用。 */
export function defaultBindings() {
  const out = {};
  for (const entry of SHORTCUT_CATALOG) out[entry.id] = [...entry.defaultKeys];
  return out;
}

/** 目录里可改的那些 id（保存时只认这批，防止前端塞垃圾 id 进存储）。 */
export function editableShortcutIds() {
  return SHORTCUT_CATALOG.filter((entry) => entry.editable).map((entry) => entry.id);
}
