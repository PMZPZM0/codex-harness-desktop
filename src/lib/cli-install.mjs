/**
 * CLI 智能体「一键安装/卸载」的**纯函数层**：把面板里那条核实过的安装命令
 * 解析成「包管理器 + 包名」，执行端（electron/cli-install.ts）照它拼参数数组。
 *
 * 为什么单独一层：守卫要能离线真跑（解析器是逻辑坏掉就会装错东西的地方），
 * 执行端不该自己再拆一遍字符串（两处各拆 = 必然漂移）。
 *
 * ⛔ 只认 npm / pip 两种形态 —— 这是内置表里核实过的全部来源；别的形态（curl 脚本、
 *   brew、二进制下载）一律拒绝并提示复制到终端执行。**宁可拒绝，不硬猜**。
 */

/**
 * @param {string} cmd 面板里的安装/卸载命令（例：`npm install -g @anthropic-ai/claude-code`）
 * @returns {{ manager: "" | "npm" | "pip", packages: string[], error: string }}
 *   error 非空 = 不能一键执行（文案直接给用户看）。
 */
export function parseInstallCommand(cmd) {
  const raw = String(cmd ?? "").trim();
  if (!raw) return { manager: "", packages: [], error: "这个 CLI 没有可一键安装的命令（按官方文档安装）" };
  const parts = raw.split(/\s+/).filter(Boolean);
  let i = 0;
  // 跳过前缀环境赋值（FOO=bar npm install -g …）
  while (i < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[i])) i++;
  const head = parts[i] ?? "";
  const rest = parts.slice(i + 1);
  if (head === "npm") {
    const sub = rest[0] ?? "";
    if (sub !== "install" && sub !== "i" && sub !== "add") {
      return { manager: "", packages: [], error: `npm 的子命令不是 install（这条是「${sub || "无"}」），请复制到终端执行` };
    }
    let global = false;
    const packages = [];
    for (const token of rest.slice(1)) {
      if (token === "-g" || token === "--global") global = true;
      else if (token.startsWith("-")) continue;
      else packages.push(token);
    }
    if (!packages.length) return { manager: "", packages: [], error: "这条命令里没有包名，请复制到终端执行" };
    if (!global) return { manager: "", packages: [], error: "只支持全局安装（npm install -g）：装进应用自己的工具目录，不污染系统" };
    return { manager: "npm", packages };
  }
  if (head === "pip" || head === "pip3") {
    const sub = rest[0] ?? "";
    if (sub !== "install" && sub !== "uninstall") return { manager: "", packages: [], error: `pip 的子命令不是 install/uninstall（这条是「${sub || "无"}」），请复制到终端执行` };
    const packages = rest.slice(1).filter((token) => !token.startsWith("-"));
    if (!packages.length) return { manager: "", packages: [], error: "这条命令里没有包名，请复制到终端执行" };
    return { manager: "pip", packages };
  }
  if (head === "python" || head === "python3") {
    if (rest[0] !== "-m" || (rest[1] !== "pip" && rest[1] !== "pip3")) {
      return { manager: "", packages: [], error: "python 形式只认 `python -m pip install …`，这条请复制到终端执行" };
    }
    const sub = rest[2] ?? "";
    if (sub !== "install" && sub !== "uninstall") return { manager: "", packages: [], error: `pip 的子命令不是 install/uninstall（这条是「${sub || "无"}」），请复制到终端执行` };
    const packages = rest.slice(3).filter((token) => !token.startsWith("-"));
    if (!packages.length) return { manager: "", packages: [], error: "这条命令里没有包名，请复制到终端执行" };
    return { manager: "pip", packages };
  }
  return { manager: "", packages: [], error: "这条安装命令不是 npm / pip 形式，请复制到终端执行" };
}

/* ── 版本比较 / 更新包名（11-06「CLI 智能体加更新功能」）──────────────────────
   纯函数：守卫直接 import 真跑；⛔ 执行端不要自己再写一份比较逻辑。 */

/** 去掉 v 前缀与预发布/构建后缀，只留数字段（`v1.2.3-beta.1` → `1.2.3`）。 */
export function normalizeVersion(value) {
  return String(value ?? "").trim().replace(/^v/i, "").split(/[-+]/)[0];
}

/** 数字段逐段比较：a<b 返回 -1，相等 0，a>b 1；无法解析返回 0（不误报更新）。 */
export function compareVersions(a, b) {
  const pa = normalizeVersion(a).split(".").map((x) => Number.parseInt(x, 10));
  const pb = normalizeVersion(b).split(".").map((x) => Number.parseInt(x, 10));
  if (!pa.length || !pb.length || pa.some((n) => !Number.isFinite(n)) || pb.some((n) => !Number.isFinite(n))) return 0;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 已装版本低于最新版本才算「可更新」；任一版本取不到就不报更新（⛔ 不拿猜测当结论）。 */
export function hasCliUpdate(current, latest) {
  const cur = normalizeVersion(current);
  const next = normalizeVersion(latest);
  if (!cur || !next) return false;
  return compareVersions(cur, next) < 0;
}

/** 更新时把包名补成 `@latest`：`@scope/name` 的 @ 在开头（不是版本），已有版本后缀的保持原样。 */
export function withLatestPackage(spec) {
  const raw = String(spec ?? "").trim();
  if (!raw) return raw;
  return raw.lastIndexOf("@") > 0 ? raw : `${raw}@latest`;
}
