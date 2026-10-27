/**
 * 回合内的「文件动作」归类（10-27 用户令）：
 *   「在运行过程中展示已编辑文件、已修改文件和已查看文件的文件名列表，所有文件名均使用高亮字体呈现，
 *     并支持点击交互：点击任一文件名后，右侧预览区联动显示对应文件的内容，同时保持当前预览状态与
 *     所选文件同步更新。」
 *
 * ⛔ 为什么不用主进程的 `turn-file-changes-live`：那份只扫**磁盘改动**（新增/修改/删除），
 *   看不到「只读没改」的文件，也没有"编辑 vs 新建"的区分。这里从**本回合的工具项**里归类：
 *   · 已查看 = read / view / cat / grep / list 之类（含 shell 的 cat/head/grep）
 *   · 已编辑 = edit / patch / apply_patch（就地改）
 *   · 已修改 = write / create / new_file（写入或新建）
 *   最后把 live 扫描到的改动并进「已修改」（工具项没抓到但磁盘确实变了 —— 例如子进程写的文件）。
 *
 * ⛔ 纯函数、无 DOM 依赖：守卫可直接跑真值表（见 scripts/guards/11q-live-edits.mjs）。
 */

/** 文件名里必须像路径（带扩展名），避免把一堆普通字符串当路径。 */
const PATH_RE = /(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[\w.@\- \u4e00-\u9fa5]+(?:[\\/][\w.@\- \u4e00-\u9fa5]+)*\.[A-Za-z0-9]{1,8}/g;

const SKIP_DIR_RE = /(^|[\\/])(node_modules|\.git|dist|dist-electron|release|\.e2e-profile|\.e2e-artifacts)([\\/]|$)/;

/** 工具名归类：⛔ 顺序有意义（先补丁/编辑，再写，再读，最后搜索类）。 */
function bucketOf(name, command) {
  const n = String(name ?? "").toLowerCase();
  const c = String(command ?? "").toLowerCase();
  if (/apply_patch|update_file|str_replace/.test(n) || /apply_patch/.test(c)) return "edited";
  if (/(^|[^a-z])(edit|edit_file|multi_edit|multiedit|patch|replace_string|insert_code)([^a-z]|$)/.test(n)) return "edited";
  if (/(^|[^a-z])(write|write_file|create|create_file|new_file|save_file)([^a-z]|$)/.test(n)) return "modified";
  if (/(^|[^a-z])(read|read_file|view|view_file|open_file|get_file|cat)([^a-z]|$)/.test(n)) return "read";
  if (/(^|[^a-z])(grep|rg|search|glob|list_dir|ls|codebase_search)([^a-z]|$)/.test(n)) return "read";
  /* shell 类（commandExecution）：cat/head/tail/type = 看；strip 掉参数后仍按动词判。 */
  if (/(^|\s)(cat|head|tail|type|less|more)\s/.test(c)) return "read";
  return null;
}

/** 从一段任意文本里抠出像文件路径的片段（去重、去噪）。 */
export function pathsIn(text, limit = 12) {
  const out = [];
  const seen = new Set();
  const source = String(text ?? "");
  for (const match of source.matchAll(PATH_RE)) {
    let path = match[0].trim().replace(/^["'`]+|["'`,.)]+$/g, "");
    if (!path || path.length > 260) continue;
    if (SKIP_DIR_RE.test(path)) continue;
    /* 纯数字/版本号（1.2.3）不是路径 */
    if (/^\d+(\.\d+)+$/.test(path)) continue;
    const key = path.replaceAll("\\", "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
    if (out.length >= limit) break;
  }
  return out;
}

function baseName(path) {
  const norm = String(path ?? "").replaceAll("\\", "/");
  return norm.split("/").pop() || norm;
}

function push(list, seen, path) {
  const key = String(path ?? "").replaceAll("\\", "/").toLowerCase();
  if (!key || seen.has(key)) return;
  seen.add(key);
  list.push({ path: String(path), name: baseName(path) });
}

/**
 * @param {{ items?: any[], turns?: any[], turnId?: string|null, liveChanges?: { path: string, status?: string }[] }} input
 * @returns {{ read: {path:string,name:string}[], edited: {path:string,name:string}[], modified: {path:string,name:string}[] }}
 */
export function fileActionsOf(input = {}) {
  const turns = Array.isArray(input.turns) ? input.turns : [];
  const turn = (input.turnId && turns.find((entry) => entry?.id === input.turnId)) || turns[turns.length - 1] || null;
  /* ⛔ 调用方可以直接给 items（回合卡就在手上，少一层 turns 查找）。 */
  const items = Array.isArray(input.items) ? input.items : (Array.isArray(turn?.items) ? turn.items : []);
  const read = [];
  const edited = [];
  const modified = [];
  const seenRead = new Set();
  const seenEdited = new Set();
  const seenModified = new Set();

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const name = item.name ?? item.toolName ?? item.tool ?? item.type ?? "";
    const command = item.command ?? item.cmd ?? "";
    const bucket = bucketOf(name, command);
    if (!bucket) continue;
    const args = item.arguments ?? item.args ?? item.input ?? item.params ?? "";
    const blob = typeof args === "string" ? args : JSON.stringify(args ?? "");
    for (const path of pathsIn(`${blob} ${command}`)) {
      if (bucket === "read") push(read, seenRead, path);
      else if (bucket === "edited") push(edited, seenEdited, path);
      else push(modified, seenModified, path);
    }
  }

  /* 磁盘真改过的文件并进「已修改」（工具项没抓到的情况：子进程/外部命令写的）。
     ⛔ 已在「已编辑」里的不重复列（那是同一处改动的两种口径）。 */
  for (const change of Array.isArray(input.liveChanges) ? input.liveChanges : []) {
    const path = String(change?.path ?? "");
    if (!path) continue;
    const key = path.replaceAll("\\", "/").toLowerCase();
    if (seenEdited.has(key)) continue;
    push(modified, seenModified, path);
  }
  return { read, edited, modified };
}
