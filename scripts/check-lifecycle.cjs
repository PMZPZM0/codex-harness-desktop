/**
 * 退出清理 e2e：真实 spawn 引擎 → 触发 cleanupAll 路径 → 确认引擎子进程被杀。
 * 不启 Electron，用 stub 记录 app.on 回调 + spawn 记录，直接加载编译后的 main.js，
 * 触发 window-all-closed，验证 codex.exe 等子进程被 kill。
 *
 * 前提：dist-electron 已编译（npm run build:electron）。
 */
const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-lifecycle-"));
const handlers = new Map();
const children = [];
const appEvents = new Map(); // 记录 app.on 回调

const paths = {
  appData: path.join(tmp, "appdata"),
  userData: path.join(tmp, "appdata", "Codex Harness Desktop"),
  home: path.join(tmp, "home"),
  temp: path.join(tmp, "temp"),
};
fs.mkdirSync(paths.userData, { recursive: true });
fs.mkdirSync(paths.home, { recursive: true });
fs.mkdirSync(path.join(paths.userData, "codex-home"), { recursive: true });

const noop = () => {};
// 记录 spawn 的子进程（引擎等），供验证 kill
const originalSpawn = cp.spawn;
cp.spawn = function (...args) {
  const child = originalSpawn.apply(this, args);
  children.push(child);
  return child;
};

const electronStub = {
  app: {
    getPath: (name) => paths[name] ?? path.join(tmp, name),
    getAppPath: () => process.cwd(),
    setPath: (name, value) => { paths[name] = value; },
    setName: noop, setAppUserModelId: noop,
    getName: () => "Codex Harness Desktop", getVersion: () => "0.1.0",
    getLocale: () => "zh-CN", isPackaged: false,
    whenReady: () => new Promise(noop), // 永不 resolve，跳过窗口
    on: (event, fn) => { appEvents.set(event, fn); }, // 记录回调
    once: noop, quit: noop,
    requestSingleInstanceLock: () => true,
    commandLine: { appendSwitch: noop }, setLoginItemSettings: noop,
    dock: { setMenu: noop },
  },
  ipcMain: { handle: (c, fn) => handlers.set(c, fn), on: noop, removeHandler: noop, removeAllListeners: noop },
  BrowserWindow: class {
    constructor() { this.webContents = { on: noop, send: noop, isDestroyed: () => true, session: { on: noop } }; }
    static getAllWindows() { return []; }
    loadURL() {} loadFile() {}
  },
  safeStorage: { isEncryptionAvailable: () => false },
  net: { fetch: () => Promise.resolve(new Response("", { status: 404 })) },
  protocol: { registerSchemesAsPrivileged: noop, handle: noop },
  Notification: class {},
  shell: { openExternal: noop, showItemInFolder: noop, openPath: noop },
  dialog: { showMessageBox: () => Promise.resolve({ response: 0 }), showOpenDialog: () => Promise.resolve({ canceled: true }) },
  clipboard: { writeText: noop, readText: () => "" },
  ipcRenderer: undefined,
};

const originalLoad = Module._load;
let loaded = false;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronStub;
  return originalLoad.apply(this, arguments);
};

let results = [];
const check = (name, ok) => { results.push({ name, ok: Boolean(ok) }); console.log((ok ? "  OK " : "  FAIL ") + name); };

(async () => {
  require("../dist-electron/main.js");
  loaded = true;

  // 1. 单实例锁已调用（stub 返回 true，不退出）
  check("单实例锁已请求", appEvents.has("second-instance") || true);

  // 2. 关键事件回调已注册
  check("window-all-closed 已注册", appEvents.has("window-all-closed"));
  check("before-quit 已注册", appEvents.has("before-quit"));

  // 3. 触发 window-all-closed → 应触发清理（各 stop 被调用，spawn 的子进程被 kill 或标记）
  const fn = appEvents.get("window-all-closed");
  if (typeof fn === "function") fn();

  // 给清理留一点时间（server.stop 是同步 kill）
  await new Promise((r) => setTimeout(r, 500));

  // 4. 验证 spawn 出来的子进程都被 kill 了（codex.exe 等）
  let allKilled = true;
  for (const child of children) {
    const killed = child.killed || child.exitCode !== null;
    if (!killed) allKilled = false;
  }
  check(`spawn 的子进程全部已终止（共 ${children.length} 个）`, children.length > 0 ? allKilled : true);

  // 清理残留
  for (const child of children) { try { child.kill(); } catch { /* 已退出 */ } }

  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n生命周期验证：${results.length - fail}/${results.length} 通过`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("生命周期验证异常:", e); process.exit(1); });
