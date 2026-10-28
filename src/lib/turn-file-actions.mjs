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

/** 工具项 → 归类结果缓存（对象身份稳定：已完成项不会被重建）。 */
const ITEM_CACHE = new WeakMap();

const SKIP_DIR_RE = /(^|[\\/])(node_modules|\.git|dist|dist-electron|release|\.e2e-profile|\.e2e-artifacts|resources[\\/]tools)([\\/]|$)/;
/** 解释器/二进制不是"用户看过的文件"（Windows 的命令串开头就是 `"…\pwsh.exe"`，不剔会排在最前面）。 */
const BINARY_RE = /\.(exe|dll|node|bin|so|dylib)$/i;

/**
 * shell 动词白名单（读 / 写）。
 *
 * ⛔⛔ 10-28 真机实测（Windows）：命中这一步要过**三道坎**，少一道就是「胶囊整块不渲染」：
 *   ① 命令形态是 `"…\pwsh.exe" -Command "Get-Content -LiteralPath 'D:\…\package.json'"` ——
 *      **动词前面是引号**，只写 `[\s;&|]` 边界匹配不到；
 *   ② 只能认 unix 的 cat/head/tail 时，PowerShell 的 Get-Content / Select-String 一个都不匹配；
 *   ③ `pwsh.exe` 自身也像"文件路径"，会被当成"读过的文件"（纯噪音，要在 pathsIn 里剔掉）。
 *   ⇒ 边界含引号与括号；读/写分开且**先写后读**（`Get-Content a | Set-Content b` 算写更接近事实）。
 *   ⛔ 只扫**命令串**，不看输出内容 —— 拿输出里的路径当"读过"会成倍误报。
 */
const SHELL_READ_RE = /(^|[\s;&|(){}"'])(cat|head|tail|type|less|more|get-content|gc|select-string|findstr|get-childitem|gci|dir|tree|rg|grep|find|where)(\s|$)/;
const SHELL_WRITE_RE = /(^|[\s;&|(){}"'])(set-content|add-content|out-file|tee|new-item|copy-item|move-item|rename-item|del|erase|remove-item)(\s|$)/;

/** 工具名归类：⛔ 顺序有意义（先补丁/编辑，再写，再读，最后搜索类）。 */
function bucketOf(name, command) {
  const n = String(name ?? "").toLowerCase();
  const c = String(command ?? "").toLowerCase();
  if (/apply_patch|update_file|str_replace/.test(n) || /apply_patch/.test(c)) return "edited";
  if (/(^|[^a-z])(edit|edit_file|multi_edit|multiedit|patch|replace_string|insert_code)([^a-z]|$)/.test(n)) return "edited";
  if (/(^|[^a-z])(write|write_file|create|create_file|new_file|save_file)([^a-z]|$)/.test(n)) return "modified";
  /* ⛔ 写先于读：`Get-Content a | Set-Content b` 这种管道两种动词都有，算写更接近事实。 */
  if (SHELL_WRITE_RE.test(c)) return "modified";
  if (/(^|[^a-z])(read|read_file|view|view_file|open_file|get_file|cat)([^a-z]|$)/.test(n)) return "read";
  if (/(^|[^a-z])(grep|rg|search|glob|list_dir|ls|codebase_search)([^a-z]|$)/.test(n)) return "read";
  if (SHELL_READ_RE.test(c)) return "read";
  return null;
}

/** 路径前面粘着的 shell 动词（`type package.json` 会被整段当成路径 ⇒ 显成一个叫「type package.json」的文件）。 */
const LEADING_VERB_RE = /^(?:cat|head|tail|less|more|type|gc|get-content|select-string|findstr|dir|tree|grep|rg|find|where|set-content|add-content|out-file|tee|new-item|copy-item|move-item|del|erase|remove-item)\s+/i;

/** 从一段任意文本里抠出像文件路径的片段（去重、去噪）。 */
export function pathsIn(text, limit = 12) {
  const out = [];
  const seen = new Set();
  const source = String(text ?? "");
  for (const match of source.matchAll(PATH_RE)) {
    let path = match[0].trim().replace(/^["'`]+|["'`,.)]+$/g, "");
    /* ⛔ 剥前导动词（可能不止一个：`Get-Content -Path x` 的 `-Path` 不是动词，不会被剥） */
    while (LEADING_VERB_RE.test(path)) path = path.replace(LEADING_VERB_RE, "").trim();
    /* 残余的前导相对标记一律去掉（`.\src\a.ts` / `\a.ts`）：相对路径本来就相对工作区，
       留着会让「同一个文件」以两种写法各占一行，也会让预览标题显示成 `\package.json`。
       ⛔ 只去 Windows 的 `\` 与 `./`、`.\` —— POSIX 的 `/home/x/a.ts` 是**绝对路径**，不能动。 */
    path = path.replace(/^\.[\\/]/, "").replace(/^\\+/, "").trim();
    if (!path || path.length > 260) continue;
    /* 首段必须像目录/文件名（挡掉 `--- package.json` 这类输出分隔符拼出来的假路径） */
    if (!/[\w\u4e00-\u9fa5]/.test(path.split(/[\\/]/)[0])) continue;
    if (SKIP_DIR_RE.test(path)) continue;
    if (BINARY_RE.test(path)) continue;
    /* ⛔ 名字里带 `..` 的是文本不是文件（真机撞到：「从 1 加到 400」被当成文件 `1..400` 列进已查看）。 */
    if (/\.\./.test(path.split(/[\\/]/).pop() || "")) continue;
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
  const normalized = String(path ?? "").replaceAll("\\", "/").replace(/^(["'`]+)|(["'`]+)$/g, "");
  /* ⛔ 相对标记归一（`./src/a.ts` 与 `src/a.ts` 是同一个文件）；POSIX 绝对路径的 `/` 保留。
     （Windows 的前导 `\` 已在 pathsIn 里剥掉，这里不用再管。） */
  const norm = normalized.replace(/^\.\//, "").toLowerCase();
  if (!norm) return;
  /* ⛔ 同一文件会以两种写法出现（`Get-Content package.json` 的相对路径 + 另一条命令的绝对路径），
     只按字符串去重会并排显示两行同名文件。⇒ 「一个是另一个的后缀」即视为同一份，保留更完整的那个。 */
  for (let i = 0; i < list.length; i++) {
    const existing = String(list[i].path).replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
    if (existing === norm) return;
    if (existing.endsWith(`/${norm}`) || norm.endsWith(`/${existing}`)) {
      if (norm.length > existing.length) list[i] = { path: String(path), name: baseName(path) };
      return;
    }
  }
  if (seen.has(norm)) return;
  seen.add(norm);
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
    /* ⛔ 逐项缓存（WeakMap 按对象身份）：流式期间 items 数组每帧换新，但**已完成的工具项是同一对象**
       —— 没有缓存的话，一个 10KB 的 apply_patch 参数会被每帧 stringify + 正则扫一遍。 */
    const cached = ITEM_CACHE.get(item);
    if (cached) {
      for (const path of cached.paths) {
        if (cached.bucket === "read") push(read, seenRead, path);
        else if (cached.bucket === "edited") push(edited, seenEdited, path);
        else push(modified, seenModified, path);
      }
      continue;
    }
    const name = item.name ?? item.toolName ?? item.tool ?? item.type ?? "";
    const command = item.command ?? item.cmd ?? "";
    const bucket = bucketOf(name, command);
    if (!bucket) continue;
    const args = item.arguments ?? item.args ?? item.input ?? item.params ?? "";
    const blob = typeof args === "string" ? args : JSON.stringify(args ?? "");
    const paths = pathsIn(`${blob} ${command}`);
    ITEM_CACHE.set(item, { bucket, paths });
    for (const path of paths) {
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
