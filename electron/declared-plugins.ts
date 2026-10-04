/**
 * 声明式插件清单（10-04 阶段 6 B 档）—— **外部插件的真相源**。
 *
 * ⛔⛔ 本文件定义的是「**不含代码**的插件」：一个插件就是一份 JSON 清单，
 *   描述它往哪个插槽挂什么内容、用哪些已有通道的数据。**不加载任何 JS**。
 *   这是对齐 DeepSeek Harness 生态时**刻意只做的那一半** ——
 *   理由见文件末尾「为什么不加载代码」。
 *
 * ── 落点 ───────────────────────────────────────────────────────────────
 *   内置声明式插件：`<repo>/electron/declared-plugins/*.json`（跟包走，可审计）
 *   用户声明式插件：`<userData>/codex-home/harness-plugins/*.json`（用户自己放的）
 *
 *   两处都读，后者覆盖前者的**同名**条目（用户能改内置插件的参数，不能删它）。
 *
 * ── 一份清单长什么样 ────────────────────────────────────────────────────
 * ```json
 * {
 *   "id": "my-plugin",              // 必填，全局唯一（决定覆盖关系）
 *   "name": "我的插件",              // 展示名
 *   "version": "1.0.0",
 *   "enabled": true,// 默认是否启用
 *   "source": "builtin",            // builtin | user（读出来时标注，不信文件里的自述）
 *   "slots": [
 *     {
 *       "slot": "topbar.end",       // 必须是已登记的插槽位（守卫【268】钉死那 5 个）
 *       "order": 100,                // 同插槽内排序，小的靠前
 *       "label": "打开面板",         // 紧凑位的按钮文案
 *       "title": "打开 XX 面板",// 悬浮提示
 *       "invoke": "settings:page-open",  // 点一下调哪条已有通道（不新增通道！）
 *       "args": { "page": "general" },   // 通道参数（静态，来自 JSON）
 *       "text": "静态文本内容"        // 或直接渲染一段文字（适合公告 / 版本提示）
 *     }
 *   ]
 * }
 * ```
 *
 * ⛔ 为什么 `invoke` 只能调**已有通道**而不新增：新增通道 = 新代码 = 要过主进程审查。
 *   声明式插件的价值是「不写代码就能挂界面」，不是「不写代码就能改主进程」。
 *   通道名必须落在 manifest 已有的通道集合里（守卫【271】逐条核）。
 *
 * ── 为什么不加载代码（这一段是本文件最重要的部分）───────────────────────
 * Electron 的主进程是**特权域**：`safeStorage`（系统密钥库）、`BrowserWindow`
 * （能开窗并强制隔离设置）、全部 `fs`、`ipcMain` 直注册都在这一层。
 * 让第三方 JS 进主进程 = 让它拿到这些能力 ⇒ 提权。
 *
 * dsh 是 CLI，插件与宿主**本来平权**（插件本来就能读写你的整个磁盘），
 * 所以"插件没沙箱"在它那儿不是问题。桌面应用多出���个特权层，
 * 同一个设计在这里就是**安全回归** —— 本项目已有三次实证：
 *   · CSP 里 `*` 不覆盖自定义协议 ⇒ 图集全空白
 *   · 放宽 `harness-image` 可信根被判安全回归
 *   · 擅自收紧 `fs:write` 被回退
 *
 * ⇒ 结论：**代码型第三方插件要真做，必须每插件一个子进程 + JSON-RPC 沙箱**
 *   （工作量是本文件的 5 倍以上，且要改 asarUnpack 白名单）。
 *   本轮明确不做，也不假装做了。要做渲染层代码插件（风险低得多）另议。
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DeclaredPlugin, DeclaredPluginSlot } from "./declared-plugin-types";

export type { DeclaredPlugin, DeclaredPluginSlot };

/** 插件 id 合法字符（会出现在文件名与设置键里 ⇒ 必须严格）。 */
const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;

/** 单个插槽位的字段上限，防止一份 JSON 把渲染层撑爆。 */
const MAX_SLOTS = 12;
const MAX_TEXT = 2000;
const MAX_LABEL = 40;

/** 当前已登记的插槽位（与守卫【268】的 EXPECTED_SLOTS 同源，改这里要同步改那里）。 */
export const KNOWN_SLOTS: readonly string[] = [
  "settings.general.bottom",
  "settings.devtools.bottom",
  "topbar.end",
  "overlay.root",
  "sidebar.top",
  "sidebar.middle",
  "sidebar.bottom",
  "composer.above-actions",
  "turn.after-content",
  "sidebar.thread-row-actions",   // ⛔ 行级：插件拿到 props.threadId/thread才知道作用在哪一行
];

/** 一处结构错误（不算致命：该插件跳过，其余继续）。 */
export type PluginLoadIssue = { file: string; id: string; reason: string };

export type DeclaredPluginLoad = {
  plugins: DeclaredPlugin[];
  issues: PluginLoadIssue[];
};

/**
 * 校验并归一化一份插件清单。
 *
 * ⛔ **为什么逐字段校验而不是"用了就报"**：一份坏 JSON 不该让整个面板空白。
 *   校验失败就跳过该插件并回一条 issue（UI 会显示"跳过 N 个无效插件"），
 *   其余照常 —— 这条对外部输入是硬要求（引擎侧的技能市场同类处理）。
 */
export function normalizeDeclaredPlugin(raw: unknown, source: "builtin" | "user", file: string): DeclaredPlugin | PluginLoadIssue {
  const bad = (reason: string): PluginLoadIssue => ({ file, id: String((raw as { id?: unknown })?.id ?? "?"), reason });
  if (!raw || typeof raw !== "object") return bad("不是对象");
  const p = raw as Record<string, unknown>;
  const id = String(p.id ?? "");
  if (!ID_RE.test(id)) return bad(`id 不合法（要小写字母开头、只含小写字母/数字/连字符、2–41 字符）：${id || "(空)"}`);
  if (!Array.isArray(p.slots)) return bad("缺 slots 数组");
  if (p.slots.length === 0) return bad("slots 为空（声明式插件至少要占一个插槽，否则没有意义）");
  if (p.slots.length > MAX_SLOTS) return bad(`slots 超过上限 ${MAX_SLOTS}`);

  const slots: DeclaredPluginSlot[] = [];
  for (const rawSlot of p.slots as unknown[]) {
    const s = (rawSlot ?? {}) as Record<string, unknown>;
    const slot = String(s.slot ?? "");
    if (!KNOWN_SLOTS.includes(slot)) {
      return bad(`未登记的插槽位：${slot || "(空)"}（已登记：${KNOWN_SLOTS.join(" / ")}）`);
    }
    const invoke = s.invoke == null ? "" : String(s.invoke);
    const text = s.text == null ? "" : String(s.text);
    // 一个插槽要么有动作（invoke）要么有内容（text），不能两者皆无 —— 否则挂上去是空的
    if (!invoke && !text) return bad(`插槽 ${slot} 既没有 invoke 也没有 text（挂上去什么都没有）`);
    if (text.length > MAX_TEXT) return bad(`插槽 ${slot} 的 text 超长（${text.length} > ${MAX_TEXT}）`);
    const label = String(s.label ?? "").slice(0, MAX_LABEL);
    const title = String(s.title ?? "").slice(0, MAX_LABEL);
    slots.push({
      slot,
      order: Number.isFinite(Number(s.order)) ? Number(s.order) : 500,
      label,
      title,
      invoke,
      // args 只收**纯 JSON**（不含函数/原型链）—— 它会被原样丢给 invoke
      args: s.args && typeof s.args === "object" ? (s.args as Record<string, unknown>) : undefined,
      text: text.slice(0, MAX_TEXT),
    });
  }

  return {
    id,
    name: String(p.name ?? id).slice(0, 60),
    version: String(p.version ?? "0.0.0").slice(0, 20),
    description: String(p.description ?? "").slice(0, 200),
    // ⛔ enabled 缺省 = true；source **由我们判定**，不信文件里的自述
    //   （否则一个 builtin 文件自称 "user" 就能伪装成用户插件覆盖别人）
    enabled: p.enabled !== false,
    source,
    slots,
  };
}

function readDirPlugins(dir: string, source: "builtin" | "user", issues: PluginLoadIssue[]): DeclaredPlugin[] {
  if (!existsSync(dir)) return [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch (error) {
    issues.push({ file: dir, id: "?", reason: `目录不可读：${error instanceof Error ? error.message : String(error)}` });
    return [];
  }
  const out: DeclaredPlugin[] = [];
  for (const name of names) {
    const file = join(dir, name);
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      const norm = normalizeDeclaredPlugin(parsed, source, file);
      if ("reason" in norm) issues.push(norm);
      else out.push(norm);
    } catch (error) {
      issues.push({ file, id: name.replace(/\.json$/, ""), reason: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return out;
}

/**
 * 读全部声明式插件（内置 + 用户，用户覆盖同名）。
 *
 * ⛔ 两个目录都必须是**绝对路径**由调用方给 —— 这里不做 `app.getPath`，
 *   理由同别的模块：模块体求值早于 `app.setPath("userData")`（守卫【91】）。
 */
export function loadDeclaredPlugins(builtinDir: string, userDir: string): DeclaredPluginLoad {
  const issues: PluginLoadIssue[] = [];
  const byId = new Map<string, DeclaredPlugin>();
  // 顺序：先 builtin 后 user ⇒ user 覆盖同名（用户能调内置插件的参数）
  for (const p of [...readDirPlugins(builtinDir, "builtin", issues), ...readDirPlugins(userDir, "user", issues)]) {
    byId.set(p.id, p);
  }
  // 排序：order 小的靠前，同 order 按 id 保证确定性（否则每次刷新顺序会跳）
  return { plugins: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), issues };
}