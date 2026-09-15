// scripts/e2e/lib/harness.mjs
//
// 零依赖 E2E 框架：启动已构建的 Electron 应用（隔离 profile），经 CDP 驱动渲染层。
//
// 依赖应用主进程提供的两个测试开关（electron/main.ts:60 / :65）：
//   CODEX_HARNESS_USER_DATA   —— 把 userData 重定向到临时目录（完全隔离，不碰真实数据）
//   CODEX_HARNESS_DEBUG_PORT  —— 打开 CDP 调试端口
//
// 用法见 scripts/e2e/scenarios/*.mjs。

import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import net from "node:net";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const electronPath = require("electron");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 应用名必须与 electron/main.ts 里 app.setPath("userData", …) 的那串一致 */
const APP_DIR_NAME = "Codex Harness Desktop";

/** 用户真实的 userData 目录（可用 CODEX_HARNESS_REAL_USER_DATA 覆盖） */
export function realUserDataDir() {
  if (process.env.CODEX_HARNESS_REAL_USER_DATA) return process.env.CODEX_HARNESS_REAL_USER_DATA;
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), APP_DIR_NAME);
  }
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", APP_DIR_NAME);
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), APP_DIR_NAME);
}

/** 真实配置里与「模型」有关的文件（相对真实 userData）。
 *  注意：custom-model.json 里的 encryptedKey 是本机 safeStorage 密文（机器内不出机器、不进 git）。
 *  **必须一并复制 `Local State`**：Chromium os_crypt 的解密密钥材料就存在 profile 的
 *  Local State 里，只复制密文不复制密钥材料 → 解密失败（此前「抹掉 encryptedKey」的根因）。
 *  留着真 Key，「引擎真跑了新模型」的断言才能升级成「真实后端真的回话了」。 */
const MODEL_CONFIG_FILES = [
  "custom-model.json",           // 当前生效供应商 + 它已启用的模型清单（含 encryptedKey 密文）
  "custom-models.json",          // 全部供应商清单（选择器里跨供应商的那些）
  "codex-home/config.toml",      // 引擎侧 model / model_provider / model_providers
  "codex-home/model-catalog.json",
  "Local State",                 // Chromium os_crypt 密钥材料（解 encryptedKey 用）
];

/** 递归拷贝目录（用于把真实会话历史搬进持久 profile） */
function copyDirRecursive(from, to, depth = 0) {
  if (depth > 6) return 0;
  let entries;
  try {
    entries = readdirSync(from, { withFileTypes: true });
  } catch {
    return 0;
  }
  mkdirSync(to, { recursive: true });
  let n = 0;
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) n += copyDirRecursive(src, dst, depth + 1);
    else if (entry.isFile()) {
      try {
        copyFileSync(src, dst);
        n += 1;
      } catch { /* 单个文件失败不影响其余 */ }
    }
  }
  return n;
}

/** 把**真实**会话历史（rollout 原档）搬进隔离 profile。
 *  为什么必须做（09-12 用户原话：「为啥你每次拉起来的应用都没有历史记录，那测试有什么意义呢」）：
 *  空白 profile 里侧栏一个会话都没有 —— 切会话重播、首轮不出字、会话一多就互相拖慢这类问题
 *  **只在有历史时才会现形**。搬真档进来，被测形态才和用户实际用的那个一致。
 *  只读真实目录、只写隔离目录，真实数据零改动。 */
export function seedRealSessionHistory(userDataDir, opts = {}) {
  const src = join(realUserDataDir(), "codex-home", "sessions");
  if (!existsSync(src)) return 0;
  const dst = join(userDataDir, "codex-home", "sessions");
  const max = Number(opts.maxFiles) || 400; // 兜住极端情况，别把几 G 历史整包搬过来
  const copied = copyDirRecursive(src, dst);
  return Math.min(copied, max);
}

/**
 * 把**真实模型配置**灌进隔离的 e2e profile。
 *
 * 为什么必须做：隔离 profile 如果是一张白纸，模型选择器里就没有任何模型——「每个会话独立选
 * 模型」这类断言会跑在空配置上（选择器点不开、只能摆弄假的 model id），**等于没测**。
 */
export function seedRealModelConfig(userDataDir) {
  const src = realUserDataDir();
  const copied = [];
  for (const rel of MODEL_CONFIG_FILES) {
    const from = join(src, rel);
    if (!existsSync(from)) continue;
    const to = join(userDataDir, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied.push(rel);
  }
  // **encryptedKey 一律保留**（09-11 用户指正「你没拉起真实后端」后定稿）：
  // 「切换模型真实生效」的断言必须打到**真实后端**——真实网关真的回包（rollout 里
  // token_usage_record 带网关 response_id），而不是只证明「引擎接受了 model 参数」。
  // 没 Key 就发不出真实请求，那种绿是假绿。Key 密文是本机 safeStorage 产物，配合一并
  // 复制的 `Local State`（DPAPI 密钥材料）在同一台机器、同一用户下可正常解出；
  // 隔离 profile 在系统临时目录里，密文不出这台机器、也不会进 git。
  // 想跑「无 Key」的纯逻辑测试时，设 CODEX_HARNESS_KEEP_SECRETS=0 才会抹掉密钥。
  if (process.env.CODEX_HARNESS_KEEP_SECRETS === "0") {
    for (const rel of ["custom-model.json", "custom-models.json"]) {
      const file = join(userDataDir, rel);
      if (!existsSync(file)) continue;
      try {
        const data = JSON.parse(readFileSync(file, "utf8"));
        const scrub = (obj) => {
          if (obj && typeof obj === "object") { delete obj.encryptedKey; delete obj.apiKey; }
          return obj;
        };
        if (Array.isArray(data)) data.forEach(scrub); else scrub(data);
        writeFileSync(file, JSON.stringify(data, null, 2));
      } catch { /* 解析失败就原样保留 */ }
    }
  }

  const ok = copied.includes("codex-home/config.toml");
  // config.toml 里的 model_catalog_json 是**绝对路径**，指回真实目录；改写成隔离目录，
  // 免得测试去读/依赖真实安装目录（两边内容此时一致，改写只为彻底隔离）
  const cfg = join(userDataDir, "codex-home", "config.toml");
  if (ok && existsSync(cfg)) {
    const realHome = join(src, "codex-home");
    const tempHome = join(userDataDir, "codex-home");
    const swap = (text, from, to) => text.split(from.replace(/\\/g, "\\\\")).join(to.replace(/\\/g, "\\\\")).split(from).join(to);
    writeFileSync(cfg, swap(readFileSync(cfg, "utf8"), realHome, tempHome));
  }
  return { src, copied, ok };
}

/** 取一个空闲回环端口，避免与用户正在运行的应用（9223）撞车 */
export async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

/** 持久 profile 的累计运行计数落盘名（放在 profile 根，跨轮次保留） */
const PROFILE_RUNS_FILE = "e2e-profile-runs.json";

export class ElectronHarness {
  /**
   * @param {{ root?: string, artifactsDir?: string, launchTimeoutMs?: number,
   *           profileName?: string, profileDir?: string }} opts
   */
  constructor(opts = {}) {
    this.root = opts.root || process.cwd();
    // 测试实例的工作区 = 项目根目录（用户 09-11 定：以后拉 CDP 就用这个项目地址测）。
    // 传 null 可显式关掉（需要「未选择工作区」空态的场景）。
    this.workspace = opts.workspace === null ? "" : (opts.workspace || this.root);
    this.launchTimeoutMs = opts.launchTimeoutMs ?? 60000;
    this.artifactsDir = opts.artifactsDir || join(this.root, ".e2e-artifacts");
    // 多场景共用一个截图目录时给文件名加前缀，避免不同场景的同名步骤互相覆盖
    this.namePrefix = opts.namePrefix || "";
    // 默认把真实模型配置灌进隔离 profile（否则选择器里没模型，模型类断言无从谈起）
    this.seedRealConfig = opts.seedRealConfig !== false;
    // 场景可选的 profile 预播种钩子（launch 时、真实配置灌入前调用）：用于写合成 rollout
    // 等需要在**进程启动前**落盘的夹具（引擎只在启动时扫描 sessions 目录）。
    this.seedProfile = opts.seedProfile ?? null;
    // 是否把真实会话历史也搬进 profile（默认开：见 seedRealSessionHistory 的说明）
    this.copyHistory = opts.copyHistory !== false;
    // ---- 持久测试 profile（09-12 用户要求）------------------------------------
    // 「每次 e2e 都拉一个空白临时 profile」的代价：永远测不到「会话多、历史长」才会暴露的
    // 问题（首次回复几十秒不出字、切会话重播、多会话互相拖慢……这些都是历史攒起来才现形）。
    // 给 `profileName`（或环境变量 CODEX_HARNESS_PROFILE_DIR）就走**跨轮次复用**的
    // `<root>/.e2e-profile/<name>/`：会话历史、localStorage、模型选择全部保留，
    // 每跑一次就在原有历史上再叠一层，逼近真实用户的目录形态。
    // 不传则维持一次性临时目录（需要绝对纯净起点的场景，如身份引导首/次会话）。
    this.profileName = opts.profileName ? String(opts.profileName).replace(/[^\w.-]+/g, "_") : "";
    this.profileDir = opts.profileDir || process.env.CODEX_HARNESS_PROFILE_DIR || "";
    this.persistent = false;
    /** 本次是该持久 profile 的第几次运行（1 = 首次创建） */
    this.profileRuns = 0;
    /** 本次进程启动时刻：断言「这一轮产生的数据」时用它做 mtime 下界 */
    this.launchedAt = 0;
    /** 本轮启动时 profile 里已存在的 rollout 数（上一轮及更早留下的历史） */
    this.rolloutsBefore = 0;
    this.reusedRealConfig = false;
    this.realConfig = null;
    this.checks = [];
    this.stepIndex = 0;
    this.child = null;
    this.ws = null;
    this.port = 0;
    this.userDataDir = "";
    this.consoleLog = [];
    this._reqId = 0;
    this._pending = new Map();
  }

  /** 决定本次 userData 目录：持久 profile 优先，否则一次性临时目录 */
  _resolveProfileDir() {
    const explicit = this.profileDir || (this.profileName ? join(this.root, ".e2e-profile", this.profileName) : "");
    if (!explicit) {
      this.persistent = false;
      this.freshProfile = true;
      this.profileRuns = 1;
      return mkdtempSync(join(tmpdir(), "harness-e2e-"));
    }
    const dir = resolve(explicit);
    const existed = existsSync(dir);
    mkdirSync(dir, { recursive: true });
    this.persistent = true;
    this.freshProfile = !existed;
    let prevRuns = 0;
    let firstAt = new Date().toISOString();
    try {
      const prev = JSON.parse(readFileSync(join(dir, PROFILE_RUNS_FILE), "utf8"));
      prevRuns = Number(prev?.runs) || 0;
      if (typeof prev?.firstAt === "string") firstAt = prev.firstAt;
    } catch { /* 首次或文件损坏都按 0 算 */ }
    this.profileRuns = existed ? prevRuns + 1 : 1;
    try {
      writeFileSync(
        join(dir, PROFILE_RUNS_FILE),
        JSON.stringify({ runs: this.profileRuns, firstAt, lastAt: new Date().toISOString() }, null, 2) + "\n",
        "utf8"
      );
    } catch { /* 计数写不进去不影响测试本身 */ }
    return dir;
  }


  // ---------- 启动 / 连接 ----------

  async launch() {
    this.port = await freePort();
    this.launchedAt = Date.now();
    this.userDataDir = this._resolveProfileDir();
    mkdirSync(this.artifactsDir, { recursive: true });

    // 场景自定义种子先落盘（合成 rollout 等），随后的真实配置灌入不会覆盖它。
    // 持久 profile 只在**首次创建**时播种，否则每跑一轮都会再叠一份（合成 rollout 会翻倍）。
    if (this.seedProfile && this.freshProfile) this.seedProfile(this.userDataDir);

    // 真实模型配置必须先进隔离 profile：进程一起来就读它，晚了不生效。
    // 持久 profile 已经有自己的 config.toml / custom-model.json 时不再覆盖——
    // 那份配置是上一轮留下的「活的」状态（含引擎写回的键、用户改过的模型）。
    // 想强制重灌：CODEX_HARNESS_RESEED=1。
    const hasOwnConfig =
      existsSync(join(this.userDataDir, "custom-model.json")) ||
      existsSync(join(this.userDataDir, "codex-home", "config.toml"));
    const reseed = process.env.CODEX_HARNESS_RESEED === "1";
    if (this.seedRealConfig && this.persistent && hasOwnConfig && !reseed) {
      this.reusedRealConfig = true;
      this.realConfig = { src: realUserDataDir(), copied: [], ok: true, reused: true };
      console.log(`\x1b[90m(持久 profile 第 ${this.profileRuns} 次运行，沿用既有模型配置与既有历史；强制重灌用 CODEX_HARNESS_RESEED=1)\x1b[0m`);
    } else {
      this.realConfig = this.seedRealConfig
        ? seedRealModelConfig(this.userDataDir)
        : { src: realUserDataDir(), copied: [], ok: false };
      if (this.realConfig.ok) {
        console.log(`\x1b[90m(已灌入真实模型配置：${this.realConfig.copied.join(" · ")} ← ${this.realConfig.src})\x1b[0m`);
      } else {
        console.log(`\x1b[33m(⚠ 未找到真实模型配置（${this.realConfig.src}）——模型相关断言会跑在空配置上，结论不可信)\x1b[0m`);
      }
      // 真实会话历史一并搬进来：被测的必须是「有历史」的形态（用户 09-12 原话：
      // 「为啥你每次拉起来的应用都没有历史记录，那测试有什么意义呢」）。
      if (this.copyHistory) {
        const n = seedRealSessionHistory(this.userDataDir);
        console.log(n > 0
          ? `\x1b[90m(已搬入真实会话历史：${n} 个 rollout 原档 ← ${join(realUserDataDir(), "codex-home", "sessions")})\x1b[0m`
          : `\x1b[33m(⚠ 真实 profile 里没有会话历史可搬 —— 侧栏会是空的，切会话类问题测不出来)\x1b[0m`);
      }
    }

    // 历史存量：持久 profile 里上一轮及更早留下的 rollout（「历史多」正是要测的形态）。
    // 断言「这一轮真的产生了数据」时必须配 `_rolloutFiles({ since: h.launchedAt })`，
    // 否则老文件会把新断言顶成假绿（历史越多越容易假绿）。
    this.rolloutsBefore = this._rolloutFiles().length;
    if (this.persistent) {
      console.log(
        `\x1b[90m(持久 profile：${this.userDataDir}\n` +
        `  第 ${this.profileRuns} 次运行；启动时已有 ${this.rolloutsBefore} 个会话 rollout —— 本轮在其之上继续叠加)\x1b[0m`
      );
    }

    const childEnv = {
      ...process.env,
      CODEBUDDY_SAFE_DELETE_ENABLED: "0",
      CODEX_HARNESS_USER_DATA: this.userDataDir,
      CODEX_HARNESS_DEBUG_PORT: String(this.port),
      // 把 GPU 进程合并进主进程。无 GPU 的机器 / CI / 沙箱里，Chromium 的 GPU 子进程会
      // 反复起不来并最终 `GPU process isn't usable. Goodbye.` 直接 FATAL 自杀，表现为
      // 「CDP Runtime.enable 超时」——实测连零项目代码的最小 Electron 应用也一样崩，
      // 与本项目代码无关。该开关只在测试实例上生效，不影响真实用户。
      CODEX_HARNESS_IN_PROCESS_GPU: "1",
      // 本机回环直连，绕开环境里的 HTTP_PROXY
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    };
    // 必须摘掉：宿主（WorkBuddy 桌面端等）自己可能就是 Electron 起的，环境里带着
    // ELECTRON_RUN_AS_NODE —— 继承下去会让 Electron 退化成纯 node 跑主进程
    // （require("electron") 拿不到 protocol/app），表现为「启动即崩」：
    //   TypeError: Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')
    // 且栈尾会打「Node.js vXX」而不是 Electron 版本——看到这个特征就是这个原因。
    delete childEnv.ELECTRON_RUN_AS_NODE;
    // 同时摘掉宿主注入的语言 shim（node-language-shim.cjs）：它会拦截子进程的 fs 写入，
    // 让主进程启动链在写 userData 时抛 EPERM（实测表现为「窗口能开、引擎起不来」）。
    delete childEnv.NODE_OPTIONS;
    this.child = spawn(electronPath, [".", "--no-sandbox"], {
      cwd: this.root,
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });
    let out = "";
    const collect = (d) => {
      out += d.toString();
      out = out.slice(-20000);
    };
    this.child.stdout.on("data", collect);
    this.child.stderr.on("data", collect);
    this._childOutput = () => out;

    await this._waitCdp();
    await this._connect();
    // 带真实模型配置时启动更慢（要拉引擎、探测供应商），渲染层就绪也晚——给足窗口。
    // 超时时把主进程输出一并抛出，否则只看到一句「超时」根本没法定位。
    try {
      await this._send("Runtime.enable", {}, 45000);
    } catch (error) {
      throw new Error(`${error?.message ?? error}\n--- 被测应用输出（尾部）---\n${this._childOutput()}`);
    }
    await this._send("Page.enable");
    // 工作区：测试实例统一用**项目根目录**（用户 09-11 定：以后拉 CDP 就用这个项目地址测）。
    // 应用从 localStorage.workspace 读工作区，隔离 profile 是一张白纸 → 界面会停在
    // 「尚未选择工作区」，发送链路在部分路径下会被拦（实测：点了发送键消息仍留在输入框）。
    // 用 addScriptToEvaluateOnNewDocument 在**每次新文档**执行前注入，所以首次加载 + 后续 reload 都生效。
    if (this.workspace) {
      const src = `try { localStorage.setItem("workspace", ${JSON.stringify(this.workspace)}); } catch (e) {}`;
      // 新文档注入（覆盖后续 reload）+ 当前文档直接写
      await this._send("Page.addScriptToEvaluateOnNewDocument", { source: src }).catch(() => undefined);
      await this.eval(src).catch(() => undefined);
      // 应用的 workspace 是 useState 初始化时读的（App.tsx:5972），当前文档已错过 → 重载一次
      // 让注入脚本在页面脚本之前执行。场景都在 launch 之后才等引导页/主界面，重载是透明的。
      await this._send("Page.reload", {}).catch(() => undefined);
      await sleep(1500);
      await this._send("Runtime.enable", {}, 30000).catch(() => undefined);
      await this._send("Page.enable").catch(() => undefined);
    }
    // 收集渲染层 console，便于失败定位
    this.ws.on("message", (data) => {
      try {
        const m = JSON.parse(data.toString());
        if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") {
          this.consoleLog.push((m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
        } else if (m.method === "Runtime.exceptionThrown") {
          // ⛔ 09-15 补：此前只收 console 的 error，**未捕获异常（React 渲染崩溃 = 白屏）一条都收不到**，
          //    导致「应用白屏但测试脚本无任何线索」，只能靠猜。这条必须留。
          const d = m.params?.exceptionDetails;
          const text = d?.exception?.description || d?.exception?.value || d?.text || "(未知异常)";
          this.consoleLog.push("[未捕获异常] " + String(text).split("\n").slice(0, 8).join(" ⏎ "));
        }
      } catch {}
    });
    return this;
  }

  async _waitCdp() {
    const t0 = Date.now();
    while (Date.now() - t0 < this.launchTimeoutMs) {
      if (this.child.exitCode !== null) {
        throw new Error(`Electron 提前退出（code=${this.child.exitCode}）\n${this._childOutput()}`);
      }
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (r.ok) return;
      } catch {}
      await sleep(400);
    }
    throw new Error(`CDP 端口未就绪（${this.launchTimeoutMs}ms）\n${this._childOutput()}`);
  }

  async _connect() {
    // /json/version（浏览器端点）先就绪、page target 后注册；带了真实模型配置之后启动要拉引擎、
    // 探测供应商，页面注册得更晚——给 page target 留出轮询窗口，别一上来就判死。
    const deadline = Date.now() + 20000;
    let page = null;
    let lastTypes = [];
    while (!page && Date.now() < deadline) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json();
        lastTypes = list.map((t) => t.type);
        page = list.find((t) => t.type === "page");
      } catch { /* 端口还没稳，继续等 */ }
      if (!page) await sleep(300);
    }
    if (!page) throw new Error(`未找到 page target（等待 20s，见到过：${JSON.stringify(lastTypes)}）`);
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error("CDP WebSocket 连接失败"));
    });
    // 注意：ws 库 on("message") 回调首参是原始数据（Buffer/string），不是 MessageEvent
    this.ws.on("message", (data) => {
      const m = JSON.parse(data.toString());
      if (m.id && this._pending.has(m.id)) {
        this._pending.get(m.id)(m);
        this._pending.delete(m.id);
      }
    });
  }

  _send(method, params = {}, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = ++this._reqId;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }, timeoutMs);
      this._pending.set(id, (m) => {
        clearTimeout(timer);
        if (m.error) reject(new Error(`CDP ${method} 报错: ${m.error.message}`));
        else resolve(m.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // ---------- 渲染层操作 ----------

  /** 在页面上下文求值，返回可序列化结果 */
  async eval(expression) {
    const r = await this._send("Runtime.evaluate", {
      expression: `(() => { try { return (${expression}); } catch (e) { return "__ERR__:" + e.message; } })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const v = r?.result?.value;
    if (typeof v === "string" && v.startsWith("__ERR__:")) throw new Error("页面求值失败 " + v);
    return v;
  }

  /** 轮询直到表达式为真 */
  async waitFor(expression, { timeoutMs = 20000, intervalMs = 300, label = expression } = {}) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeoutMs) {
      try {
        last = await this.eval(expression);
        if (last) return last;
      } catch (e) {
        last = "err:" + e.message;
      }
      await sleep(intervalMs);
    }
    throw new Error(`等待超时：${label}（最后取值 ${JSON.stringify(last)}）`);
  }

  /** 重载渲染层（只刷 renderer，主进程不动）：验证「启动时」逻辑（如会话模型回填）用 */
  async reload({ waitMs = 1500 } = {}) {
    await this._send("Page.reload", { ignoreCache: false });
    await sleep(waitMs);
  }

  async exists(selector) {
    return (await this.eval(`!!document.querySelector(${JSON.stringify(selector)})`)) === true;
  }

  async count(selector) {
    return await this.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  }

  async text(selector) {
    return await this.eval(
      `(document.querySelector(${JSON.stringify(selector)})?.innerText || "").trim()`
    );
  }

  async bodyText(limit = 500) {
    return await this.eval(`(document.body?.innerText || "").slice(0, ${limit})`);
  }

  // ---------- 引擎侧取证（rollout）----------
  // 「模型切换到底有没有生效」只有引擎自己说了算：UI 状态与 localStorage 都只是**意图**，
  // rollout 里的 turn_context.model 才是**实际执行**的模型（thread_settings_applied 是会话级设置）。

  /** 本次隔离 profile 下所有 rollout 文件的绝对路径。
   *  @param {{ since?: number }} [opts] `since` = 只要 mtime 不早于该时刻的文件。
   *    持久 profile 会把历史一起扫出来 —— 断言「本轮产生的数据」时必须传
   *    `{ since: h.launchedAt }`，否则上一轮的老文件会把断言顶成假绿。 */
  _rolloutFiles(opts = {}) {
    const root = join(this.userDataDir, "codex-home", "sessions");
    if (!existsSync(root)) return [];
    const since = Number(opts.since) || 0;
    const out = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/^rollout-.*\.jsonl$/.test(entry.name)) {
          if (since) {
            try {
              if (statSync(p).mtimeMs < since) continue;
            } catch { continue; }
          }
          out.push(p);
        }
      }
    };
    walk(root);
    return out;
  }

  /** 某会话引擎侧的真实模型证据。
   *  @returns {{ file: string|null, turns: number, turnModel: string|null, turnModels: string[], settingsModel: string|null, provider: string|null }}
   *    - `turnModel`：最新一条 `turn_context.model`（该回合**真正跑**在哪个模型上）
   *    - `turnModels`：历次回合的模型序列（可断言「从没跑过别的模型」）
   *    - `settingsModel` / `provider`：最新一条 `thread_settings_applied`（会话级设置） */
  engineModelOf(threadId) {
    const file = this._rolloutFiles().find((p) => p.includes(threadId)) ?? null;
    const info = { file, turns: 0, turnModel: null, turnModels: [], turnEffort: null, turnEfforts: [], settingsModel: null, settingsEffort: null, provider: null, backendResponses: [], errors: [] };
    if (!file) return info;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue; // 回合正在写：末行可能是半截 JSON
      }
      const payload = record.payload ?? {};
      if (record.type === "turn_context" && payload.model) {
        info.turnModel = payload.model;
        info.turnModels.push(payload.model);
        // 该回合引擎实际收到的思考档位（collaboration_mode.settings.reasoning_effort
        // 与顶层 effort 同值；null = 引擎兜底默认，非显式下发）
        const eff = payload.effort ?? payload.collaboration_mode?.settings?.reasoning_effort ?? null;
        info.turnEffort = eff;
        info.turnEfforts.push(eff);
        info.turns += 1;
      }
      if (record.type === "event_msg" && payload.type === "thread_settings_applied") {
        info.settingsModel = payload.thread_settings?.model ?? info.settingsModel;
        info.settingsEffort = payload.thread_settings?.reasoning_effort ?? info.settingsEffort;
        info.provider = payload.thread_settings?.model_provider_id ?? info.provider;
      }
      // 真实后端证据：token_usage_record 带 response_id（网关回包才有）+ 实际 output tokens。
      // 只有它才能证明「不是引擎本地走了个过场，而是真实模型服务真的响应了」。
      if (record.type === "token_usage_record" && payload.response_id) {
        info.backendResponses.push({
          turnId: payload.turn_id ?? null,
          responseId: payload.response_id,
          outputTokens: payload.usage?.output_tokens ?? 0,
          inputTokens: payload.usage?.input_tokens ?? 0,
        });
      }
      // 后端/流错误（401、模型不存在、断流重试失败等）：真实后端测试里出现即失败。
      // 不含 turn_aborted——那是我们自己 turn/interrupt 打断产生的正常事件。
      if (record.type === "event_msg" && /^(error|stream_error|turn_failed)$/i.test(String(payload.type))) {
        info.errors.push({ type: payload.type, message: String(payload.message ?? "").slice(0, 300) });
      }
    }
    return info;
  }

  /** 原生点击（对 React 的 onClick 有效） */
  async click(selector) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    })()`);
    if (!ok) throw new Error(`点击失败，元素不存在：${selector}`);
    await sleep(250);
  }

  /** 按可见文本点击：取「文本最短」的匹配元素（最内层），再向上找可点击祖先 */
  async clickByText(text, { exact = false } = {}) {
    const ok = await this.eval(`(() => {
      const t = ${JSON.stringify(text)};
      const all = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], [contenteditable="true"], li, span, p, div')];
      let matches = all.filter(n => {
        const s = (n.innerText || "").trim();
        return ${exact ? "s === t" : "s.includes(t)"};
      });
      if (!matches.length) return false;
      // 取文本最短者 = 最贴近文本本身的元素；同长度再取层级最深的
      matches.sort((a, b) => {
        const d = (a.innerText || "").trim().length - (b.innerText || "").trim().length;
        if (d !== 0) return d;
        const depth = (el) => { let n = 0; while (el.parentElement) { n++; el = el.parentElement; } return n; };
        return depth(b) - depth(a);
      });
      const hit = matches[0];
      const target = hit.closest('button, a, [role="button"], [role="tab"]') || hit;
      target.scrollIntoView({ block: "center" });
      target.click();
      return true;
    })()`);
    if (!ok) throw new Error(`按文本点击失败：${text}`);
    await sleep(300);
  }

  /** 按 title（或 aria-label）属性点击——本项目大量按钮只有 title，没有可见文本 */
  async clickByTitle(title) {
    const ok = await this.eval(`(() => {
      const t = ${JSON.stringify(title)};
      const el = [...document.querySelectorAll('[title], [aria-label]')]
        .find(e => (e.getAttribute('title') || '').includes(t) || (e.getAttribute('aria-label') || '').includes(t));
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    })()`);
    if (!ok) throw new Error(`按 title 点击失败：${title}`);
    await sleep(300);
  }

  /** 给 input/textarea/contenteditable 赋值并派发 React 能收到的事件 */
  async setInput(selector, value) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      if (el.isContentEditable) {
        el.textContent = ${JSON.stringify(value)};
      } else {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter ? setter.call(el, ${JSON.stringify(value)}) : (el.value = ${JSON.stringify(value)});
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`输入失败，元素不存在：${selector}`);
    await sleep(150);
  }

  /** 键盘输入（走 CDP，更接近真实用户） */
  async pressKey(key, { text } = {}) {
    const base = { key, windowsVirtualKeyCode: key === "Enter" ? 13 : undefined };
    await this._send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(text ? { text } : {}) });
    await this._send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(120);
  }

  /** 用 CDP 真实输入文本到指定元素（对 contenteditable 最可靠，会触发 React 的 onInput） */
  async typeInto(selector, text) {
    const ok = await this.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return true; })()`
    );
    if (!ok) throw new Error(`聚焦失败，元素不存在：${selector}`);
    await this._send("Input.insertText", { text });
    await sleep(250);
  }

  /** 清空输入框内容 */
  async clearInput(selector) {
    await this.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.focus(); document.execCommand("selectAll"); } })()`
    );
    const key = { key: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 };
    await this._send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
    await this._send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    await sleep(200);
  }

  /** 截图落盘，返回文件路径 */
  async screenshot(label) {
    const idx = String(++this.stepIndex).padStart(2, "0");
    const safe = String(label).replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 60);
    const dir = join(this.artifactsDir, "shots");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${this.namePrefix}${idx}-${safe}.png`);
    const r = await this._send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }

  /**
   * 在匹配 urlPart 的**另一个 page target**（如独立通话弹窗 ?view=voice-popup）里求值。
   * 每次新建短连接：弹窗 target 会关闭/重建，长连接容易挂着死 ws。
   */
  async evalInTarget(urlPart, expression, { timeoutMs = 15000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = "";
    while (Date.now() < deadline) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json();
        const target = list.find((t) => t.type === "page" && (t.url || "").includes(urlPart));
        if (target) {
          const value = await this._evalOverWs(target.webSocketDebuggerUrl, expression);
          return value;
        }
        lastErr = `未见 URL 含「${urlPart}」的 page target（当前 ${list.filter((t) => t.type === "page").length} 个）`;
      } catch (e) {
        lastErr = e?.message ?? String(e);
      }
      await sleep(300);
    }
    throw new Error(`等待 target「${urlPart}」超时：${lastErr}`);
  }

  /** 单连接 CDP Runtime.evaluate（供 evalInTarget 复用） */
  _evalOverWs(wsUrl, expression) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("CDP 求值超时")); }, 10000);
      ws.on("error", (e) => { clearTimeout(timer); reject(new Error("CDP 连接失败: " + (e?.message ?? e))); });
      ws.on("message", (data) => {
        const m = JSON.parse(data.toString());
        if (m.id === 1) {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          if (m.error) return reject(new Error("CDP 报错: " + m.error.message));
          const v = m.result?.result?.value;
          if (typeof v === "string" && v.startsWith("__ERR__:")) return reject(new Error("页面求值失败 " + v));
          resolve(v);
        }
      });
      ws.on("open", () => {
        ws.send(JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression: `(() => { try { return (${expression}); } catch (e) { return "__ERR__:" + e.message; } })()`,
            returnByValue: true,
            awaitPromise: true,
          },
        }));
      });
    });
  }

  /** 对匹配 urlPart 的另一个 page target 截图（如独立弹窗），返回文件路径 */
  async screenshotInTarget(urlPart, label) {
    const list = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json();
    const target = list.find((t) => t.type === "page" && (t.url || "").includes(urlPart));
    if (!target) throw new Error(`截图失败：未见 URL 含「${urlPart}」的 page target`);
    const idx = String(++this.stepIndex).padStart(2, "0");
    const safe = String(label).replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 60);
    const dir = join(this.artifactsDir, "shots");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${this.namePrefix}${idx}-${safe}.png`);
    const r = await this._evalOverWsCapture(target.webSocketDebuggerUrl);
    writeFileSync(file, Buffer.from(r, "base64"));
    return file;
  }

  _evalOverWsCapture(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("CDP 截图超时")); }, 10000);
      ws.on("error", (e) => { clearTimeout(timer); reject(new Error("CDP 连接失败: " + (e?.message ?? e))); });
      ws.on("message", (data) => {
        const m = JSON.parse(data.toString());
        if (m.id === 1) {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          if (m.error) return reject(new Error("CDP 报错: " + m.error.message));
          resolve(m.result?.data);
        }
      });
      ws.on("open", () => {
        ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
      });
    });
  }

  // ---------- 断言 ----------

  /** 记录一条断言结果 */
  check(label, condition, detail = "") {
    const ok = !!condition;
    this.checks.push({ label, ok, detail });
    const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`  ${mark} ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
    return ok;
  }

  // ---------- 收尾 ----------

  async close() {
    try {
      this.ws?.close();
    } catch {}
    if (this.child && this.child.exitCode === null) {
      this.child.kill();
      await sleep(600);
      // Electron 会派生多个子进程，兜底强杀本次实例
      try {
        if (process.platform === "win32") {
          execSync(`taskkill /F /PID ${this.child.pid} /T`, { stdio: "ignore" });
        }
      } catch {}
    }
    // 持久 profile **不删**：会话历史/长会话正是要跨轮次攒起来的东西（用户 09-12 定）。
    // 需要清空时手动删 .e2e-profile/<name>/，或用 CODEX_HARNESS_PROFILE_DIR 换一个目录。
    if (this.persistent) {
      const rollouts = this._rolloutFiles().length;
      console.log(`\x1b[90m(持久 profile 已保留：${this.userDataDir}；现有会话 rollout ${rollouts} 个)\x1b[0m`);
    }
  }

  /** 汇总结果；返回是否全绿 */
  summary(title) {
    const pass = this.checks.filter((c) => c.ok).length;
    const fail = this.checks.length - pass;
    console.log("");
    console.log(`${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${title}：${pass}/${this.checks.length} 通过\x1b[0m`);
    if (fail) {
      console.log("\x1b[31m失败项：\x1b[0m");
      for (const c of this.checks.filter((x) => !x.ok)) console.log(`  - ${c.label} ${c.detail}`);
      if (this.consoleLog.length) {
        console.log("\x1b[31m渲染层 console.error：\x1b[0m");
        for (const l of this.consoleLog.slice(0, 10)) console.log("  -", l);
      }
    }
    return { pass, fail, ok: fail === 0 };
  }
}
