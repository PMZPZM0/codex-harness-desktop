/**
 * gen-ipc-core —— gen-ipc-bridge 的纯生成逻辑（CLI 与预检守卫**共用**，防两套实现漂移）。
 *
 * 单一真相源 = electron/ipc-channels.manifest.json；本模块只做「manifest → 生成物文本」的纯函数。
 * 预检【2】用它现场重算两个生成物的应有内容并与工作树比对 ⇒ 手改生成物/改 manifest 忘了跑生成都会红。
 *
 * ⛔ 09-23 深夜教训：生成物曾放在独立文件 `preload.generated.ts`、由 preload.ts `import` 展开 ——
 *    **沙箱化的 preload 不允许 require 相对模块**（只许 electron + 内建子集），应用启动即
 *    preload 加载失败 ⇒ `window.codex` 整个没建 ⇒ 渲染层首个 codex 调用
 *    （voiceSettingsGet）炸出「界面发生错误」。⇒ 生成内容**必须内联在 preload.ts 的
 *    gen:begin…gen:end 标记区里**，preload 编译产物保持自包含单文件（无相对 require）。
 *    守卫【2】有「preload.ts 无相对 import」断言钉死这一点。
 */
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const PRELOAD_PATH = join(ROOT, "electron", "preload.ts");
export const TYPES_PATH = join(ROOT, "src", "vite-env.d.ts");
export const MANIFEST_PATH = join(ROOT, "electron", "ipc-channels.manifest.json");

export const GEN_BEGIN = "/* ═══ gen:begin（由 scripts/gen-ipc-bridge.mjs 生成，源 ipc-channels.manifest.json，勿手改）═══ */";
export const GEN_END = "/* ═══ gen:end ═══ */";

/** 数 paramsImpl 里的**必选**参数个数：按顶层逗号切（跳过 <>[]{}() 嵌套），带 `=` 默认值的不算。 */
export function minArgsOf(paramsImpl) {
  if (!paramsImpl || !paramsImpl.trim()) return 0;
  let depth = 0, current = "", parts = [];
  for (const ch of paramsImpl) {
    if ("([{<".includes(ch)) depth++;
    else if (")]}>".includes(ch)) depth--;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  parts.push(current);
  /* ⛔ 可选判定要认两种形态：`p = 默认值` 与 TS 可选参数 `p?: type`（带 ? 无默认值 ——
     remoteQrcode(botId?: string) 曾被算成必选，会把合法的零参调用拒掉）。
     判定方向故意偏松：回调类型里嵌的 `?:` 会把必选误判成可选 ⇒ 只会少校验，不会误伤合法调用。 */
  return parts.filter((p) => p.trim() && !p.includes("=") && !/\?\s*:/.test(p)).length;
}

/** manifest.channels → preload.ts 里 gen:begin…gen:end 之间的应有段落（成员内联，不再是独立文件）。
 *  09-24 起 invoke 统一走 preload 手写区的 `__ipc(channel, minArgs, args)`：
 *  参数个数前置校验 + 错误归一化（结构化 code）+ 通道级超时表（默认不超时，零行为变化）。 */
export function generatePreloadRegion(entries) {
  const body = entries.map((e) => {
    const note = e.note ? `  /* ${e.note} */\n` : "";
    const cast = e.cast ? ` as ${e.cast}` : "";
    const args = e.invokeArgs ? `[${e.invokeArgs}]` : "[]";
    return `${note}  ${e.name}: (${e.paramsImpl}) => __ipc(${JSON.stringify(e.channel)}, ${minArgsOf(e.paramsImpl)}, ${args})${cast},`;
  }).join("\n");
  return `${GEN_BEGIN}\n${body}\n  ${GEN_END}`;
}

/** 从 src 里取 gen:begin…gen:end 区间（含标记）；没有标记返回 null。 */
export function regionOf(src) {
  const a = src.indexOf(GEN_BEGIN);
  if (a < 0) return null;
  const b = src.indexOf(GEN_END);
  if (b < 0) return null;
  return src.slice(a, b + GEN_END.length);
}

/**
 * 行尾归一化（09-24 实测的维护坑）：git（autocrlf）checkout 出来的文件是 CRLF，而生成器写 LF
 * ⇒ 只要文件被 git 恢复过一次、又没重跑 `gen:ipc`，【2】就会报"生成段与 manifest 不一致"
 * —— **假红**，且是纯行尾差异（`git diff --numstat` 是空的）。
 * 修法：① 比较时一律归一化；② 写入时**跟随文件原有行尾**（避免制造混合行尾）。
 */
export function normalizeEol(text) {
  return String(text ?? "").replace(/\r\n/g, "\n");
}

/** 让 text 跟随 src 的行尾风格（src 含 CRLF 就用 CRLF）。 */
export function withEol(text, src) {
  return String(src ?? "").includes("\r\n") ? String(text ?? "").replace(/\n/g, "\r\n") : String(text ?? "");
}

/** manifest.channels → vite-env.d.ts 里 gen:begin…gen:end 之间的应有段落。 */
export function generateTypesRegion(entries) {
  const body = entries.map((e) => {
    const note = e.note ? `    /* ${e.note} */\n` : "";
    return `${note}    ${e.name}(${e.paramsDecl}): ${e.returns};`;
  }).join("\n");
  return `${GEN_BEGIN}\n${body}\n${GEN_END}`;
}
