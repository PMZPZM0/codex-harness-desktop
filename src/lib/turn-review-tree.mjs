/**
 * 回合审阅 · 文件树的纯函数（10-18，用户对照 Qoder 的「文件折叠展开」截图）。
 *
 * 输入 = 汇总卡给的整轮文件（绝对路径），workspace = 当前工作区；
 * 输出 = 以**相对路径**分段的文件夹树。⛔ 只做纯计算，面板只负责画。
 */
export function relativeTurnReviewPath(filePath, workspace) {
  const norm = String(filePath ?? "").replace(/\\/g, "/");
  const root = String(workspace ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (root) {
    const lower = norm.toLowerCase();
    const rootLower = root.toLowerCase();
    if (lower.startsWith(rootLower + "/")) return norm.slice(root.length + 1);
  }
  return norm;
}

/** 构建 `{ dirs: [{name,path,dirs,files}], files: [{...file,name}] }` 的目录树。 */
export function buildTurnReviewTree(files, workspace) {
  const root = { name: "", path: "", dirs: [], files: [] };
  for (const file of Array.isArray(files) ? files : []) {
    const rel = relativeTurnReviewPath(file?.path, workspace);
    const segments = rel.split("/").filter(Boolean);
    if (!segments.length) continue;
    const name = segments.pop();
    let node = root;
    for (const segment of segments) {
      let dir = node.dirs.find((entry) => entry.name === segment);
      if (!dir) {
        dir = { name: segment, path: node.path ? `${node.path}/${segment}` : segment, dirs: [], files: [] };
        node.dirs.push(dir);
      }
      node = dir;
    }
    node.files.push({ ...file, name });
  }
  const sort = (node) => {
    node.dirs.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.name.localeCompare(b.name));
    for (const dir of node.dirs) sort(dir);
  };
  sort(root);
  return root;
}

/** 收集树里全部文件夹的 path（「收起全部文件夹」用）。 */
export function collectTurnReviewFolders(node, out = []) {
  for (const dir of node?.dirs ?? []) {
    out.push(dir.path);
    collectTurnReviewFolders(dir, out);
  }
  return out;
}
