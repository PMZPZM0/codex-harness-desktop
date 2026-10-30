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
