/**
 * 链路级验证（一直到 IPC 边界）：加载**编译后的 preload 产物**，stub 掉 electron 模块，
 * 直接调 window.codex 的调度方法，断言 ipcRenderer.invoke 收到的实参里**真的带着参数**。
 *
 * ⛔⛔ 为什么必须有这一层（10-04 用户报「开启的对象类别：（无）」）：
 *   preload 的实参**只由 manifest 的 `invokeArgs` 决定**（gen-ipc-core.mjs：
 *   `const args = e.invokeArgs ? `[${e.invokeArgs}]` : "[]"`）。`paramsImpl` 只用来数
 *   「最少几个参数」做调用校验 ⇒ 声明了参数却漏写 invokeArgs，参数就在 preload 层被静默丢掉：
 *     · dispatchToolDescription(threadId) ⇒ 主进程收到 ""（描述永远"全列三类"）
 *     · dispatchNotice(before,next) / dispatchEnabledNotice(next) ⇒ 主进程收到 undefined ⇒「（无）」
 *   tsc 过、生成段逐字节一致过、主进程纯函数守卫也全绿 —— 因为那些测的都是函数，不是这条链。
 *   静态判据（守卫【2】）只能证明"生成物文本里带了参数"；本脚本证明"运行时真的传出去了"。
 *
 * 打桩铁律（用户级记忆 §5）：桩不抛 > 桩给得准 —— Proxy 任意深度兜底、屏蔽 then、
 * getPath/toPrimitive 给真字符串；否则框架自身崩 ⇒ 后面断言全不执行（假绿比假红危险得多）。
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const PRELOAD = join(ROOT, "dist-electron", "preload.js");

if (!existsSync(PRELOAD)) {
  console.log("【preload-args】dist-electron/preload.js 不在（未构建 / 干净检出）⇒ 跳过（先 npm run build）");
  process.exit(0);
}

function deepProxy(name) {
  const fn = function () { return deepProxy(name + "()"); };
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === "then") return undefined;                     // 别被 await 当 thenable
      if (prop === Symbol.toPrimitive) return () => "";          // 模板串拿真字符串
      if (prop === "toString") return () => "";
      if (prop === "getPath") return () => ROOT;
      if (prop === "isPackaged") return false;
      if (prop === "name") return "stub";
      return deepProxy(name + "." + String(prop));
    },
    apply() { return deepProxy(name + "()"); },
    construct() { return deepProxy("new " + name); },
  });
}

const calls = [];
const ipcRenderer = {
  invoke: async (channel, ...args) => { calls.push({ channel, args }); return { text: "stub" }; },
  send: (channel, ...args) => { calls.push({ channel, args, send: true }); },
  sendSync: () => undefined,
  on: () => {}, once: () => {}, off: () => {}, addListener: () => {}, removeListener: () => {}, removeAllListeners: () => {},
  postMessage: () => {},
};

let exposed = null;
const electronBase = {
  contextBridge: {
    exposeInMainWorld: (key, value) => { exposed = value; },
    exposeInIsolatedWorld: () => {},
  },
  ipcRenderer,
  app: { getPath: () => ROOT, getAppPath: () => ROOT, isPackaged: false, name: "stub", getName: () => "stub", getVersion: () => "0.0.0" },
};
const electronStub = new Proxy(electronBase, {
  get(t, p) { if (p in t) return t[p]; if (p === "then") return undefined; return deepProxy("electron." + String(p)); },
});

const NodeModule = require("node:module");
const origLoad = NodeModule._load;
NodeModule._load = function (request) {
  if (request === "electron") return electronStub;
  return origLoad.apply(this, arguments);
};

/* 加载编译产物（不是源码）—— 验证的就是真正进沙箱的那份 */
require(PRELOAD);

let checks = 0, fails = 0;
const ok = (cond, msg) => { checks++; console.log("  " + (cond ? "✓" : "✗") + " 【preload-args】" + msg); if (!cond) fails++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (!exposed) {
  ok(false, "preload 调用了 contextBridge.exposeInMainWorld（产物没跑起来 ⇒ 后续断言无意义）");
  console.log("\n【preload-args】" + (checks - fails) + "/" + checks + " 通过");
  process.exit(1);
}
ok(typeof exposed.dispatchEnabledNotice === "function", "window.codex 上有调度通知方法（preload 产物可用）");

/** 调一次 API，回读它真正发给 ipcRenderer 的 channel 与实参 */
async function probe(method, args, expectChannel, expectArgs) {
  calls.length = 0;
  if (typeof exposed[method] !== "function") { ok(false, `${method} 不在 window.codex 上`); return; }
  await exposed[method](...args);
  const hit = calls.filter((c) => c.channel === expectChannel).pop();
  if (!hit) { ok(false, `${method} → ${expectChannel}：压根没发出调用`); return; }
  const got = hit.args.filter((x) => x !== undefined);
  ok(eq(got, expectArgs), `${method} → ${expectChannel} 实参带上参数（实得 ${JSON.stringify(got)}）`);
}

await probe("dispatchToolDescription", ["tid-abc"], "agents:tool-description", ["tid-abc"]);
await probe("dispatchEnabledNotice", [{ expert: false, team: false, subagent: true }], "agents:enabled-notice", [{ expert: false, team: false, subagent: true }]);
await probe("dispatchNotice",
  [{ expert: true, team: false, subagent: false }, { expert: true, team: false, subagent: true }],
  "agents:notice",
  [{ expert: true, team: false, subagent: false }, { expert: true, team: false, subagent: true }]);

/* 反向：无参通道不许被塞进 undefined 占位（__ipc 的 trim 语义） */
calls.length = 0;
await exposed.dispatchOffNotice();
const off = calls.filter((c) => c.channel === "agents:off-notice").pop();
ok(Boolean(off) && off.args.length === 0, "dispatchOffNotice → agents:off-notice 不带多余实参");

console.log("\n【preload-args】" + (checks - fails) + "/" + checks + " 通过" + (fails ? ` —— ${fails} 条红` : ""));
process.exit(fails ? 1 : 0);
