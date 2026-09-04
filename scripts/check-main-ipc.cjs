/**
 * 一次性端到端验证：真的把个性化写进 config.toml、真的按覆盖表启停 MCP。
 * 做法是用一个假的 electron 模块加载编译后的 main.js，直接调 IPC handler，
 * 然后回读临时 userData 里的 config.toml 用 python tomllib 校验。
 */
const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-e2e-"));
const handlers = new Map();
const children = [];

const paths = {
  appData: path.join(tmp, "appdata"),
  userData: path.join(tmp, "appdata", "Codex Harness Desktop"),
  home: path.join(tmp, "home"),
  temp: path.join(tmp, "temp"),
};
fs.mkdirSync(paths.userData, { recursive: true });
fs.mkdirSync(paths.home, { recursive: true });
// 真实应用里 codex-home 是 app.whenReady 里建的，这里 whenReady 被 stub 成永不 resolve，得自己建
fs.mkdirSync(path.join(paths.userData, "codex-home"), { recursive: true });
for (const name of ["custom-model.json", "custom-models.json"]) {
  const src = path.join(os.homedir(), "AppData", "Roaming", "Codex Harness Desktop", name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(paths.userData, name));
}

const noop = () => {};
const electronStub = {
  app: {
    getPath: (name) => paths[name] ?? path.join(tmp, name),
    getAppPath: () => process.cwd(),
    setPath: (name, value) => { paths[name] = value; },
    setName: noop,
    setAppUserModelId: noop,
    getName: () => "Codex Harness Desktop",
    getVersion: () => "0.1.0",
    getLocale: () => "zh-CN",
    isPackaged: false,
    // 永不 resolve：跳过窗口创建与网关启动，只保留 IPC handler 可调用
    whenReady: () => new Promise(noop),
    on: noop,
    once: noop,
    quit: noop,
    requestSingleInstanceLock: () => true,
    commandLine: { appendSwitch: noop },
    setLoginItemSettings: noop,
    dock: { setMenu: noop },
  },
  ipcMain: {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: noop,
    removeHandler: noop,
    removeAllListeners: noop,
  },
  BrowserWindow: class {
    constructor() { this.webContents = { on: noop, send: noop, isDestroyed: () => true, session: { on: noop } }; }
    static getAllWindows() { return []; }
    loadURL() {}
    on() {}
    once() {}
    isDestroyed() { return true; }
    setMenu() {}
    show() {}
  },
  protocol: { registerSchemesAsPrivileged: noop, handle: noop },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(v), decryptString: (v) => String(v) },
  shell: { openExternal: noop, openPath: noop, showItemInFolder: noop, trashItem: async () => true },
  clipboard: { writeText: noop, readText: () => "", writeImage: noop, readImage: () => ({ isEmpty: () => true }) },
  dialog: { showOpenDialog: async () => ({ canceled: true }), showMessageBox: async () => ({ response: 0 }) },
  Notification: class { constructor() {} show() {} static isSupported() { return false; } },
  net: { fetch: async () => ({ ok: false }) },
  powerSaveBlocker: { start: () => 1, stop: noop },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1440, height: 900 } }) },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: noop },
  Tray: class { constructor() {} setToolTip() {} setContextMenu() {} on() {} },
  nativeImage: { createFromPath: () => ({}), createFromDataURL: () => ({ isEmpty: () => true }) },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};
// 记录真实 spawn 出来的 codex 进程，结束时统一收掉
const cp = require("node:child_process");
const originalSpawn = cp.spawn;
cp.spawn = function (...args) {
  const child = originalSpawn.apply(this, args);
  children.push(child);
  return child;
};

process.env.CODEX_HARNESS_USER_DATA = paths.userData;
process.env.CODEX_HARNESS_DEBUG_PORT = "";

const PY = "C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe";
function tomlCheck(label, file) {
  try {
    const out = execFileSync(PY, ["-c", "import tomllib,sys;d=tomllib.load(open(sys.argv[1],'rb'));print(sorted(d.keys()))", file], { encoding: "utf8" });
    console.log(`  ok   ${label} 合法 TOML — 顶层键 ${out.trim()}`);
    return true;
  } catch (error) {
    console.log(` FAIL  ${label} — ${String(error.stderr || error.message).split("\n").slice(-2).join(" ")}`);
    return false;
  }
}

const configPath = () => path.join(paths.userData, "codex-home", "config.toml");
let failures = 0;
const expect = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
};

(async () => {
  require("../dist-electron/main.js");
  await new Promise((resolve) => setTimeout(resolve, 200));
  console.log(`临时 userData：${paths.userData}`);
  console.log(`已注册 IPC：${handlers.size} 个\n`);

  const save = handlers.get("personalization:save");
  const verify = handlers.get("personalization:verify");
  const setEnabled = handlers.get("mcp-servers:set-enabled");
  const overrides = handlers.get("mcp-servers:overrides");
  const mcpPermissions = handlers.get("mcp-servers:permissions");
  const setToolPerm = handlers.get("mcp-servers:set-tool-permission");
  const localSkills = handlers.get("skills:local-list");
  const commandsList = handlers.get("commands:list");
  const commandsRead = handlers.get("commands:read");
  const commandsSave = handlers.get("commands:save");
  const commandsDelete = handlers.get("commands:delete");
  const commandsExpand = handlers.get("commands:expand");
  const appSettingsSave = handlers.get("appSettings:save");
  const appSettingsRead = handlers.get("appSettings:read");
  const customModelSave = handlers.get("custom-model:save");
  expect("个性化/MCP handler 都已注册", Boolean(save && verify && setEnabled && overrides));
  expect("MCP 工具权限 handler 都已注册", Boolean(mcpPermissions && setToolPerm));
  expect("本地技能 handler 已注册", Boolean(localSkills));
  expect("commands 五个 handler 都已注册", Boolean(commandsList && commandsRead && commandsSave && commandsDelete && commandsExpand));
  expect("appSettings handler 都已注册", Boolean(appSettingsSave && appSettingsRead));

  console.log("\n── 1. 保存个性化（含 Windows 路径与三连引号） ──");
  const instructions = ["回复一律用简体中文", String.raw`项目路径是 D:\Codex Harness Desktop\src`, '遇到 """三引号""" 不要慌'].join("\n");
  await save({}, { nickname: "老王", customInstructions: instructions });
  let raw = fs.readFileSync(configPath(), "utf8");
  const agentsPath = path.join(paths.userData, "codex-home", "AGENTS.md");
  expect("config.toml 已生成", raw.length > 500, `${raw.length} 字符`);
  tomlCheck("保存后", configPath());
  expect("个性化不再进 config.toml（走 AGENTS.md）", !raw.includes("PERSONALIZATION (user-specific"));
  expect("config.toml 含 otel 关闭段", /^\s*\[otel\]\s*$/m.test(raw) && raw.includes('exporter = "none"'));
  expect("config.toml web_search 默认开启", raw.includes("web_search = true"));
  expect("config.toml 无远程控制字段（env 开关，不进配置）", !raw.includes("remote_control"));
  expect("AGENTS.md 已生成", fs.existsSync(agentsPath));  const agentsRaw = fs.readFileSync(agentsPath, "utf8");
  expect("称呼已写入 AGENTS.md", agentsRaw.includes("老王"));
  expect("Windows 路径原样保留（无需转义）", agentsRaw.includes(String.raw`D:\Codex Harness Desktop\src`));
  expect("三引号原样保留", agentsRaw.includes('"""三引号"""'));

  console.log("\n── 1.5 联网搜索开关（app-settings → config.toml） ──");
  const defaultApp = await appSettingsRead({});
  expect("appSettings 默认联网搜索开启", defaultApp?.webSearch !== false);
  await appSettingsSave({}, { webSearch: false });
  raw = fs.readFileSync(configPath(), "utf8");
  const wsLine = raw.split("\n").find((line) => line.includes("web_search"));
  expect("关闭后 config.toml web_search=false", raw.includes("web_search = false"), wsLine || "未找到 web_search 行");
  expect("关闭后仍合法 TOML", tomlCheck("关闭联网后", configPath()));
  await appSettingsSave({}, { webSearch: true });
  raw = fs.readFileSync(configPath(), "utf8");
  expect("重新开启后 web_search=true", raw.includes("web_search = true"));

  console.log("\n── 1.55 模型目录 model_catalog_json（上下文窗口生效） ──");
  // 保存自定义模型（含 contextWindow + models）→ 应生成 model-catalog.json 并写入 config.toml
  const catModel = {
    provider: "catprov", name: "Catalog 供应商", model: "cat-model-1", baseUrl: "https://example.com/v1",
    contextWindow: "1000000", wireApi: "responses", apiKey: "",
    models: [{ id: "cat-model-1", contextWindow: 1000000 }, { id: "cat-model-2", contextWindow: 256000 }],
    enabled: true,
  };
  const catSaved = await customModelSave({}, catModel);
  expect("保存自定义模型成功", catSaved?.model === "cat-model-1");
  raw = fs.readFileSync(configPath(), "utf8");
  const catalogPath = path.join(paths.userData, "codex-home", "model-catalog.json");
  expect("config.toml 含 model_catalog_json", raw.includes("model_catalog_json ="));
  expect("model-catalog.json 已生成", fs.existsSync(catalogPath));
  const catalogJson = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  expect("catalog 含生效模型", catalogJson.models.some((m) => m.slug === "cat-model-1"));
  expect("catalog 生效模型上下文=1M", catalogJson.models.find((m) => m.slug === "cat-model-1")?.context_window === 1000000);
  expect("catalog 含第二模型", catalogJson.models.some((m) => m.slug === "cat-model-2"));
  expect("catalog 第二模型上下文=256K", catalogJson.models.find((m) => m.slug === "cat-model-2")?.context_window === 256000);
  expect("含 catalog 后仍合法 TOML", tomlCheck("含 model_catalog_json 后", configPath()));

  console.log("\n── 1.6 桌面/浏览器自动化开关（app-settings → config.toml） ──");
  const autoDefault = await appSettingsRead({});
  expect("appSettings 默认桌面自动化开启", autoDefault?.desktopAutomation !== false);
  expect("appSettings 默认浏览器自动化开启", autoDefault?.browserAutomation !== false);
  expect("默认 config.toml 含 nuphus 段", /^\s*\[mcp_servers\.nuphus\]\s*$/m.test(raw));
  expect("默认 config.toml 含 browser_use feature", raw.includes("browser_use = true"));
  expect("默认 developer_instructions 含浏览器说明", raw.includes("playwright-cli"));
  await appSettingsSave({}, { desktopAutomation: false });
  raw = fs.readFileSync(configPath(), "utf8");
  expect("关桌面自动化后 config.toml 无 nuphus 段", !/^\s*\[mcp_servers\.nuphus\]\s*$/m.test(raw));
  expect("关桌面自动化后仍合法 TOML", tomlCheck("关桌面自动化后", configPath()));
  expect("关桌面自动化后无 nuphus 使用指南", !raw.includes("nuphus-call — on-demand"));
  expect("关桌面自动化后注入禁用提示", raw.includes("AUTOMATION DISABLED NOTE") && raw.includes("desktop_*"));
  await appSettingsSave({}, { browserAutomation: false });
  raw = fs.readFileSync(configPath(), "utf8");
  expect("关浏览器自动化后 config.toml 无 browser_use", !raw.includes("browser_use = true"));
  expect("关浏览器自动化后无 playwright 使用指南", !raw.includes("playwright-cli — token-efficient"));
  expect("关浏览器自动化后仍合法 TOML", tomlCheck("关浏览器自动化后", configPath()));
  await appSettingsSave({}, { desktopAutomation: true, browserAutomation: true });
  raw = fs.readFileSync(configPath(), "utf8");
  expect("恢复后 nuphus 段回来了", /^\s*\[mcp_servers\.nuphus\]\s*$/m.test(raw));
  expect("恢复后 browser_use 回来了", raw.includes("browser_use = true"));
  expect("恢复后 playwright 说明回来了", raw.includes("playwright-cli"));


  const check = await verify({});
  expect("verify 回报已同步", check.exists && check.applied && check.inSync, JSON.stringify({ exists: check.exists, applied: check.applied, inSync: check.inSync }));
  expect("verify 返回 AGENTS.md 路径", String(check.agentsPath || "").endsWith("AGENTS.md"));
  // 预览有截断（2000 字符），昵称可能落在截断点之后；用 verify 返回的真实路径读全文验证称呼。
  // （语言/emoji 基础段先于昵称，加段会让昵称超出预览窗口——这是预期，不是丢数据。）
  const verifyRaw = String(check.agentsPath || "").endsWith("AGENTS.md") && fs.existsSync(check.agentsPath)
    ? fs.readFileSync(check.agentsPath, "utf8") : "";
  expect("verify 落盘内容里有称呼", verifyRaw.includes("老王"));

  // 模拟用户手工写的段落：项目信任 / 插件注册 / 钩子状态 / 一个手写 MCP 服务器
  fs.appendFileSync(configPath(), [
    "",
    "[projects.\"D:\\\\demo\"]",
    "trust_level = \"trusted\"",
    "",
    "[plugins.\"demo@builtin\"]",
    "enabled = true",
    "",
    "[hooks.state.\"D:\\\\demo\\\\hooks.json:session_start:0:0\"]",
    "trusted_hash = \"abc123\"",
    "",
    "[mcp_servers.handmade]",
    "command = \"echo\"",
    "args = [\"hi\"]",
    "",
  ].join("\r\n"));
  tomlCheck("追加手工段后", configPath());

  console.log("\n── 2. 引擎每个会话真实读到的 AGENTS.md ──");
  console.log(agentsRaw.split("\n").map((line) => `      ${line}`).join("\n"));

  console.log("\n── 3. 清空个性化 ──");
  await save({}, { nickname: "", customInstructions: "" });
  raw = fs.readFileSync(configPath(), "utf8");
  tomlCheck("清空后", configPath());
  // emoji 基础段常驻：AGENTS.md 不再删除，只是没有称呼/自定义段
  const agentsAfterClear = fs.readFileSync(agentsPath, "utf8");
  expect("清空后 AGENTS.md 仍在（emoji 基础段常驻）", fs.existsSync(agentsPath) && agentsAfterClear.includes("Emoji usage guidelines"));
  expect("清空后称呼已移除", !agentsAfterClear.includes("老王"));
  expect("verify 回报已同步（清空态）", (await verify({})).inSync);

  console.log("\n── 4. app-server MCP 停启用 ──");
  console.log(`      停前覆盖表：${JSON.stringify(await overrides({}))}`);
  const off = await setEnabled({}, { ids: ["nuphus"], enabled: false });
  raw = fs.readFileSync(configPath(), "utf8");
  expect("停用返回 updated", off.updated >= 1, JSON.stringify(off));
  expect("config.toml 里已无 nuphus 段", !/^\s*\[mcp_servers\.nuphus\]/m.test(raw));
  tomlCheck("停用 nuphus 后", configPath());

  const on = await setEnabled({}, { ids: ["nuphus"], enabled: true });
  raw = fs.readFileSync(configPath(), "utf8");
  expect("启用返回 updated", on.updated >= 1, JSON.stringify(on));
  expect("nuphus 段回来了", /^\s*\[mcp_servers\.nuphus\]/m.test(raw));
  tomlCheck("重新启用后", configPath());
  console.log(`      启后覆盖表：${JSON.stringify(await overrides({}))}`);

  console.log("\n── 4b. MCP 按工具权限（deny/ask/allow，复刻 WorkBuddy） ──");
  // 未配置时无 [permissions] 段
  expect("初始无 [permissions] 段", !/^\s*\[permissions\./m.test(raw));
  // 给 nuphus 的 desktop_screenshot 设 allow，desktop_exec 设 ask，browser_goto 设 deny
  await setToolPerm({}, { server: "nuphus", tool: "desktop_screenshot", mode: "allow" });
  await setToolPerm({}, { server: "nuphus", tool: "desktop_exec", mode: "ask" });
  await setToolPerm({}, { server: "nuphus", tool: "browser_goto", mode: "deny" });
  raw = fs.readFileSync(configPath(), "utf8");
  expect("写出 [permissions.allow]", /^\s*\[permissions\.allow\]/m.test(raw) && raw.includes('"mcp__nuphus__desktop_screenshot" = true'));
  expect("写出 [permissions.ask]", /^\s*\[permissions\.ask\]/m.test(raw) && raw.includes('"mcp__nuphus__desktop_exec" = true'));
  expect("写出 [permissions.deny]", /^\s*\[permissions\.deny\]/m.test(raw) && raw.includes('"mcp__nuphus__browser_goto" = true'));
  tomlCheck("配工具权限后", configPath());
  const permRead = await mcpPermissions({});
  expect("permissions 读回含 nuphus 三个档位", permRead?.nuphus?.desktop_screenshot === "allow" && permRead?.nuphus?.desktop_exec === "ask" && permRead?.nuphus?.browser_goto === "deny", JSON.stringify(permRead?.nuphus));
  // 清除一个：deny 规则消失，其余保留
  await setToolPerm({}, { server: "nuphus", tool: "browser_goto", mode: null });
  raw = fs.readFileSync(configPath(), "utf8");
  expect("清除 deny 后 [permissions.deny] 段消失", !/^\s*\[permissions\.deny\]/m.test(raw));
  expect("allow/ask 仍在", raw.includes('"mcp__nuphus__desktop_screenshot" = true') && raw.includes('"mcp__nuphus__desktop_exec" = true'));
  tomlCheck("清除一条权限后", configPath());
  // 未知服务器忽略
  const ghostPerm = await setToolPerm({}, { server: "ghost-server", tool: "foo", mode: "ask" });
  expect("未知服务器不落死记录", ghostPerm?.reason === "unknown-server", JSON.stringify(ghostPerm));
  // 非法档位报错
  let rejected = false;
  try { await setToolPerm({}, { server: "nuphus", tool: "x", mode: "banana" }); } catch { rejected = true; }
  expect("非法档位报错", rejected);
  tomlCheck("工具权限测试收尾", configPath());

  console.log("\n── 4c. 技能 allowed-tools 白名单解析（复刻 WorkBuddy SKILL.md） ──");
  const skillHome = path.join(paths.userData, "codex-home", "skills", "probe-skill");
  fs.mkdirSync(skillHome, { recursive: true });
  fs.writeFileSync(path.join(skillHome, "SKILL.md"), [
    "---",
    "name: probe-skill",
    "description: 探针技能",
    "allowed-tools:",
    "  - Read",
    "  - Bash(git:*)",
    "---",
    "",
    "遇到问题时用这个技能",
  ].join("\n"));
  const skillList = await localSkills({});
  const probeSkill = skillList.find((entry) => entry.folder === "probe-skill");
  expect("allowed-tools 块级列表解析", JSON.stringify(probeSkill?.allowedTools) === JSON.stringify(["Read", "Bash(git:*)"]), JSON.stringify(probeSkill?.allowedTools));
  // 行内列表写法
  fs.writeFileSync(path.join(skillHome, "SKILL.md"), "---\nname: probe-skill\nallowed-tools: [Read, WebFetch]\n---\n\n正文");
  const inlineList = (await localSkills({})).find((entry) => entry.folder === "probe-skill");
  expect("allowed-tools 行内列表解析", JSON.stringify(inlineList?.allowedTools) === JSON.stringify(["Read", "WebFetch"]), JSON.stringify(inlineList?.allowedTools));
  // 无声明
  fs.writeFileSync(path.join(skillHome, "SKILL.md"), "---\nname: probe-skill\ndescription: 无白名单\n---\n\n正文");
  const noTools = (await localSkills({})).find((entry) => entry.folder === "probe-skill");
  expect("无 allowed-tools 返回空数组", Array.isArray(noTools?.allowedTools) && noTools.allowedTools.length === 0, JSON.stringify(noTools?.allowedTools));
  fs.rmSync(path.join(paths.userData, "codex-home", "skills", "probe-skill"), { recursive: true, force: true });

  console.log("\n── 5. 用户手工段落未被抹掉 ──");
  expect("projects 保留", /^\s*\[projects\./m.test(raw));
  expect("plugins 保留", /^\s*\[plugins\./m.test(raw));
  expect("hooks 保留", /^\s*\[hooks\./m.test(raw));
  expect("手写 MCP 段保留（启用中）", /^\s*\[mcp_servers\.handmade\]/m.test(raw));

  console.log("\n── 5b. 手写 MCP 段启停 ──");
  await setEnabled({}, { ids: ["handmade"], enabled: false });
  raw = fs.readFileSync(configPath(), "utf8");
  expect("handmade 段已停用（不写入）", !/^\s*\[mcp_servers\.handmade\]/m.test(raw));
  expect("projects 仍在", /^\s*\[projects\./m.test(raw));
  tomlCheck("停用 handmade 后", configPath());
  await setEnabled({}, { ids: ["handmade"], enabled: true });
  raw = fs.readFileSync(configPath(), "utf8");
  expect("handmade 段已拼回（原文含 args）", /^\s*\[mcp_servers\.handmade\]/m.test(raw) && raw.includes("args = [\"hi\"]"));
  tomlCheck("重新启用 handmade 后", configPath());

  console.log("\n── 6. 批量停启用 ──");
  const batch = await setEnabled({}, { ids: ["nuphus", "ghost-server"], enabled: false });
  raw = fs.readFileSync(configPath(), "utf8");
  expect("批量停用忽略陌生 id", batch.updated === 1, JSON.stringify(batch));
  tomlCheck("批量停用后", configPath());
  const ghost = JSON.stringify(await overrides({}));
  expect("陌生 id 没进覆盖表", !ghost.includes("ghost-server"), ghost);

  console.log("\n── 7. 自定义斜杠命令（commands/*.md） ──");
  const commandsDir = path.join(paths.userData, "codex-home", "commands");
  expect("初始无自定义命令", (await commandsList({}, {})).length === 0);
  // 全局命令：frontmatter 完整 + 正文模板（子目录冒号命名）
  const cmd = await commandsSave({}, { name: "git:commit", source: "global", description: "创建 git 提交", argumentHint: "[message]", allowedTools: "Bash(git:*)", model: "gemini-3.1-pro", body: "!`git status`\n请基于输出创建提交：$1" });
  expect("保存返回 entry（冒号命名）", cmd?.name === "git:commit", JSON.stringify(cmd?.name));
  expect("子目录文件已落盘", fs.existsSync(path.join(commandsDir, "git", "commit.md")));
  let clist = await commandsList({}, {});
  let centry = clist.find((e) => e.name === "git:commit");
  expect("列表含 git:commit", Boolean(centry));
  expect("frontmatter 完整解析", centry?.description === "创建 git 提交" && centry?.argumentHint === "[message]" && centry?.allowedTools === "Bash(git:*)", JSON.stringify({ description: centry?.description, hint: centry?.argumentHint, tools: centry?.allowedTools }));
  expect("source=global", centry?.source === "global");
  expect("read 单条一致（子目录名完整）", (await commandsRead({}, { filePath: centry.filePath, cwd: path.join(tmp, "work") }))?.name === "git:commit");
  // 模板展开
  const expanded = await commandsExpand({}, { filePath: centry.filePath, argument: "fix auth", cwd: path.join(tmp, "work") });
  expect("$1 替换第一个参数", expanded.text.includes("fix"), JSON.stringify(expanded.text));
  expect("!`cmd` 转执行指令", expanded.text.includes("请先执行命令 `git status`"));
  // @file 引用注入
  const workDir = path.join(tmp, "work");
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, "notes.txt"), "重要上下文：重构 auth 模块");
  await commandsSave({}, { name: "ctx", source: "global", description: "注入文件", body: "请分析：@notes.txt" });
  const ctxEntry = (await commandsList({}, { cwd: workDir })).find((e) => e.name === "ctx");
  const ctxExpanded = await commandsExpand({}, { filePath: ctxEntry.filePath, argument: "", cwd: workDir });
  expect("@file 注入文件内容", ctxExpanded.text.includes("重构 auth 模块"), JSON.stringify(ctxExpanded.text));
  // 项目级命令
  await commandsSave({}, { name: "prj:deploy", source: "project", cwd: workDir, description: "部署", body: "部署到 $ARGUMENTS" });
  const prj = (await commandsList({}, { cwd: workDir })).find((e) => e.name === "prj:deploy");
  expect("项目级命令列出且 source=project", Boolean(prj) && prj?.source === "project");
  expect("项目级文件在 .codex/commands", fs.existsSync(path.join(workDir, ".codex", "commands", "prj", "deploy.md")));
  const prjExpanded = await commandsExpand({}, { filePath: prj.filePath, argument: "prod v1.2", cwd: workDir });
  expect("$ARGUMENTS 全部参数替换", prjExpanded.text.includes("prod v1.2"));
  // 重命名（prevFilePath 清旧文件）
  await commandsSave({}, { name: "git:commitx", source: "global", prevFilePath: centry.filePath, description: "创建 git 提交", argumentHint: "[message]", allowedTools: "Bash(git:*)", body: "请先执行 `git status` 并创建提交：$1" });
  expect("重命名后旧文件已删除", !fs.existsSync(centry.filePath));
  expect("重命名后新文件存在", fs.existsSync(path.join(commandsDir, "git", "commitx.md")));
  // 删除
  const lastEntry = (await commandsList({}, {})).find((e) => e.name === "git:commitx");
  await commandsDelete({}, lastEntry.filePath);
  clist = await commandsList({}, {});
  expect("删除后不在列表", !clist.some((e) => e.name === "git:commitx"));
  expect("删除后文件不存在", !fs.existsSync(lastEntry.filePath));

  console.log("");
  for (const child of children) { try { child.kill(); } catch { /* 已退出 */ } }
  if (failures) {
    console.log(`${failures} 项失败`);
    process.exit(1);
  }
  console.log("端到端全部通过（临时目录保留在 " + tmp + "）");
  process.exit(0);
})().catch((error) => {
  console.error("脚本异常：", error);
  for (const child of children) { try { child.kill(); } catch { /* 已退出 */ } }
  process.exit(1);
});
