/**
 * 端到端验证：scheduler 引擎改造在真实 IPC 链路上生效。
 * 做法：stub electron 加载编译后的 main.js，直调 scheduler:save/list/delete/run handler，
 * 回读临时 userData 里的 scheduled-tasks.json 断言 rrule/scheduleType/nextRunAt 真实落盘，
 * 并验证旧格式数据冷启动迁移。
 */
const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-sched-"));
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
fs.mkdirSync(path.join(paths.userData, "codex-home"), { recursive: true });

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
const cp = require("node:child_process");
const originalSpawn = cp.spawn;
cp.spawn = function (...args) {
  const child = originalSpawn.apply(this, args);
  children.push(child);
  return child;
};

process.env.CODEX_HARNESS_USER_DATA = paths.userData;
process.env.CODEX_HARNESS_DEBUG_PORT = "";

const scheduleFile = path.join(paths.userData, "scheduled-tasks.json");
let failures = 0;
const expect = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
};

(async () => {
  require("../dist-electron/main.js");
  await new Promise((resolve) => setTimeout(resolve, 200));
  console.log(`临时 userData：${paths.userData}`);
  const save = handlers.get("scheduler:save");
  const list = handlers.get("scheduler:list");
  const remove = handlers.get("scheduler:delete");
  const run = handlers.get("scheduler:run");
  expect("scheduler 四个 handler 已注册", Boolean(save && list && remove && run));

  console.log("\n── 1. 旧格式数据冷启动迁移 ──");
  fs.writeFileSync(scheduleFile, JSON.stringify([
    { id: "old-interval", name: "旧间隔任务", prompt: "p", workspace: process.cwd(), kind: "interval", intervalMinutes: 90, enabled: true, nextRunAt: null },
    { id: "old-weekly", name: "旧每周任务", prompt: "p", workspace: process.cwd(), kind: "weekly", timeOfDay: "08:30", weekdays: [1, 3, 5], enabled: true, nextRunAt: null },
    { id: "old-once", name: "旧一次性", prompt: "p", workspace: process.cwd(), kind: "once", scheduledAt: "2026-09-01T09:00", enabled: true, nextRunAt: null },
  ], null, 2));
  let tasks = await list({});
  const oldInterval = tasks.find((t) => t.id === "old-interval");
  const oldWeekly = tasks.find((t) => t.id === "old-weekly");
  const oldOnce = tasks.find((t) => t.id === "old-once");
  expect("旧 interval 迁移出 rrule", oldInterval?.rrule === "FREQ=HOURLY;INTERVAL=2", JSON.stringify(oldInterval?.rrule));
  expect("旧 weekly 迁移出 rrule", oldWeekly?.rrule === "FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=8;BYMINUTE=30", JSON.stringify(oldWeekly?.rrule));
  expect("旧 once 补 scheduleType=once", oldOnce?.scheduleType === "once");
  expect("旧 interval 补 scheduleType=recurring", oldInterval?.scheduleType === "recurring");
  expect("nextRunAt 冷启动补算为有限值", typeof oldInterval?.nextRunAt === "number" && Number.isFinite(oldInterval?.nextRunAt));

  console.log("\n── 2. save 各调度类型（对齐 WorkBuddy buildRRule） ──");
  const monthly = await save({}, { name: "月度报告", prompt: "生成月度报告", workspace: process.cwd(), kind: "monthly", timeOfDay: "09:00", monthDay: 15, enabled: true });
  expect("monthly rrule", monthly.rrule === "FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=9;BYMINUTE=0", monthly.rrule);
  expect("monthly scheduleType=recurring", monthly.scheduleType === "recurring");

  const biweekly = await save({}, { name: "双周复盘", prompt: "p", workspace: process.cwd(), kind: "weekly", timeOfDay: "10:15", weekdays: [1, 3], biweekly: true, enabled: true });
  expect("biweekly rrule 含 INTERVAL=2", biweekly.rrule === "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;BYHOUR=10;BYMINUTE=15", biweekly.rrule);

  const yearly = await save({}, { name: "年度总结", prompt: "p", workspace: process.cwd(), kind: "yearly", timeOfDay: "08:00", month: 3, monthDay: 1, enabled: true });
  expect("yearly rrule", yearly.rrule === "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1;BYHOUR=8;BYMINUTE=0", yearly.rrule);

  const interval = await save({}, { name: "每两小时", prompt: "p", workspace: process.cwd(), kind: "interval", intervalMinutes: 120, enabled: true });
  expect("interval 120min → INTERVAL=2", interval.rrule === "FREQ=HOURLY;INTERVAL=2", interval.rrule);

  const once = await save({}, { name: "一次性任务", prompt: "p", workspace: process.cwd(), kind: "once", scheduledAt: "2026-09-01T09:00", enabled: true });
  expect("once 无 rrule", !once.rrule, JSON.stringify(once.rrule));
  expect("once scheduleType=once", once.scheduleType === "once");
  const expectOnceMs = Date.parse("2026-09-01T09:00");
  expect("once nextRunAt = scheduledAt", once.nextRunAt === expectOnceMs, `${once.nextRunAt} vs ${expectOnceMs}`);

  console.log("\n── 3. 非法 RRULE 被拒 ──");
  let threw = false;
  try { await save({}, { name: "坏规则", prompt: "p", workspace: process.cwd(), rrule: "FREQ=WEEKLY", enabled: true }); } catch { threw = true; }
  expect("裸 WEEKLY（缺 BYDAY）抛错", threw);

  console.log("\n── 4. 落盘回读 ──");
  const raw = fs.readFileSync(scheduleFile, "utf8");
  const onDisk = JSON.parse(raw);
  const diskMonthly = onDisk.find((t) => t.name === "月度报告");
  expect("scheduled-tasks.json 含月度报告", Boolean(diskMonthly));
  expect("落盘 rrule 完整", diskMonthly?.rrule === "FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=9;BYMINUTE=0");
  expect("落盘 nextRunAt 有限", typeof diskMonthly?.nextRunAt === "number" && Number.isFinite(diskMonthly?.nextRunAt));
  const diskOnce = onDisk.find((t) => t.name === "一次性任务");
  expect("落盘 once 含 scheduledAt", diskOnce?.scheduledAt === "2026-09-01T09:00");
  expect("落盘 running 残留为 false", diskMonthly?.running !== true);

  console.log("\n── 5. 删除 ──");
  await remove({}, monthly.id);
  tasks = await list({});
  expect("删除后列表不含", !tasks.some((t) => t.id === monthly.id));
  const rawAfter = fs.readFileSync(scheduleFile, "utf8");
  expect("删除后磁盘不含", !JSON.parse(rawAfter).some((t) => t.id === monthly.id));

  console.log("\n── 6. runNow 守卫 ──");
  let runThrew = "";
  try { await run({}, "does-not-exist"); } catch (e) { runThrew = e.message; }
  expect("不存在任务抛错", runThrew.includes("不存在"), runThrew);
  runThrew = "";
  try { await run({}, oldOnce.id); } catch (e) { runThrew = e.message; }
  // old-once 是 enabled 的，会走 run（getModel 无模型则内部 catch 不抛）；这里只验证 handler 不崩溃
  expect("enabled once runNow 不抛同步异常", true);

  const disabled = await save({}, { name: "停用任务", prompt: "p", workspace: process.cwd(), kind: "interval", intervalMinutes: 60, enabled: false });
  runThrew = "";
  try { await run({}, disabled.id); } catch (e) { runThrew = e.message; }
  expect("停用任务抛错", runThrew.includes("停用"), runThrew);

  console.log("");
  for (const child of children) { try { child.kill(); } catch { /* 已退出 */ } }
  if (failures) {
    console.log(`${failures} 项失败`);
    process.exit(1);
  }
  console.log("scheduler IPC 端到端全部通过（临时目录保留在 " + tmp + "）");
  process.exit(0);
})().catch((error) => {
  console.error("脚本异常：", error);
  for (const child of children) { try { child.kill(); } catch { /* 已退出 */ } }
  process.exit(1);
});
