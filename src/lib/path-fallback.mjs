/**
 * 路径回落判据（10-30）：卡片给的路径打不开时，是否该改用**会话里出现过的同名真实文件**。
 *
 * ⛔⛔ 起因（用户两次同一现象）：会话 cwd 是 `D:\测试`，但模型在命令里 `cd` 到了别的仓改文件，
 * 卡片把相对路径按**会话目录**拼 ⇒ 指向一个根本不存在的位置；真文件在另一个仓里。
 * 命令卡那条链已改成「按命令自己的 cd 解析」（`resolveCommandTarget`），但
 * **引擎 fileChange / 回合产物卡 / 消息里的文件卡** 都没有命令上下文，只能靠会话台账回落。
 *
 * ⛔ 只在「直接路径**不存在**」时用（调用方负责先 stat）。⛔ 不做模糊匹配：
 *   · 文件名必须完全相同（否则会打开同名的另一个文件）；
 *   · 目录尾段必须对得上 —— 有 workspace 时用「workspace 之后的相对尾段」，
 *     没有时退到「倒数第二段目录 + 文件名」（例：`src/lib` + `command-display.mjs`）。
 *     对不上就返回空串（宁可报"文件不存在"，也不能点开一个不相干的文件）。
 *
 * @param {{ requested: string; known: string; workspace?: string }} input
 * @returns {string} 可用的绝对路径；不该回落时返回 ""
 */
export function pickKnownPathFallback({ requested, known, workspace = "" }) {
  const norm = (value) => String(value ?? "").replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  const req = norm(requested);
  const kn = norm(known);
  if (!req || !kn || req === kn) return "";
  const baseOf = (value) => (value.split("/").pop() ?? "").toLowerCase();
  if (!baseOf(req) || baseOf(req) !== baseOf(kn)) return "";

  const ws = norm(workspace);
  let tail = "";
  if (ws && req.toLowerCase().startsWith(ws.toLowerCase() + "/")) tail = req.slice(ws.length + 1);
  if (!tail) {
    const segs = req.split("/");
    /* 倒数两段做证据：目录段 + 文件名。⛔ 再短（只比文件名）会误开同名文件。 */
    if (segs.length < 2) return "";
    tail = segs.slice(-2).join("/");
  }
  return tail && kn.toLowerCase().endsWith("/" + tail.toLowerCase()) ? String(known) : "";
}

/**
 * 打开文件前的兜底：路径不存在 ⇒ 查会话台账 ⇒ 用同名真实文件（并提示）。
 *
 * ⛔ 只在 `fileExists` 明确说**不存在**时才回落；stat 失败/桥缺失一律按原路径走（不做猜测）。
 * ⛔ 台账查询函数由调用方注入（它在 `ui-channels` 里，是渲染层全局注册的），
 *    这样本文件保持纯逻辑、可离线测试。
 * @param {string} requested 卡片给的（可能死链的）路径
 * @param {{ workspace?: string; lookup?: (path: string) => (string | null); notify?: (message: string) => void }} [options]
 * @returns {Promise<string>} 最终要打开的路径（回落不了就原样返回）
 */
export async function resolveExistingFile(requested, options = {}) {
  const target = String(requested ?? "");
  if (!target) return target;
  try {
    const probe = await window.codex.fileExists(target);
    if (!probe || probe.exists !== false) return target;
    const rawKnown = options.lookup ? options.lookup(target) : null;
    /* 台账里的路径可能是 URL 编码形态（`%20` 之类，来自 file:// 链接）⇒ 先解一次再比。 */
    const known = rawKnown && /%[0-9A-Fa-f]{2}/.test(rawKnown)
      ? (() => { try { return decodeURIComponent(rawKnown); } catch { return rawKnown; } })()
      : rawKnown;
    const alt = pickKnownPathFallback({ requested: target, known: known ?? "", workspace: options.workspace ?? "" });
    if (!alt) return target;
    const check = await window.codex.fileExists(alt).catch(() => null);
    if (!check?.exists) return target;
    options.notify?.(`原路径不存在，已改用会话里出现过的同名文件：${alt}`);
    return alt;
  } catch {
    return target;
  }
}
