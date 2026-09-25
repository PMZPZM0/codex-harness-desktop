#!/usr/bin/env node
/**
 * 可选的「MCP 记忆服务」按需安装器（@vheins/local-memory-mcp）。
 *
 * ⛔ 设计前提（用户 09-25 明确）：这个服务**不内置**——不进 package.json 依赖、不随包发布，
 *    由用户在 设置 → 记忆 → 记忆后端 里自主选择是否安装/启用。装到应用 userData 下的独立目录，
 *    卸载就是删目录（与语音模型 `install-voice-models.cjs` 同一套路）。
 *
 * ⛔⛔ 为什么这么绕（09-25 第二版，真机踩出来的三条）：
 *   ① **必须用「应用自带的 node」装 + 跑**，不能用 Electron 的 node：better-sqlite3 按
 *      `NODE_MODULE_VERSION`(ABI) 取预编译产物 —— 实测 Electron 43 的 ABI 是 **149**、
 *      自带 node 24 是 **137**、系统 node 22 是 **127**，三者互不通用。用 electron.exe 当
 *      runner ⇒ 装得再好也会 `Could not locate the bindings file`。
 *   ② **不能依赖 postinstall**：npm 的 postinstall 会派生子进程（prebuild-install / esbuild install.js），
 *      受限环境直接装失败。所以这里显式 `--ignore-scripts`，改为**自己把原生绑定下载解包**。
 *   ③ **必须真握手验证**：装完只判文件存在 = 把坏安装报成"已就绪"，用户选了 MCP 却写不进记忆。
 *
 * 用法：
 *   node install-memory-mcp.cjs              # 安装（已装且可用则跳过）
 *   node install-memory-mcp.cjs --check      # 只查状态（退出码 0=已装，2=未装）
 *   node install-memory-mcp.cjs --verify     # 真跑一次 MCP 握手（0=可用）
 *   node install-memory-mcp.cjs --uninstall  # 卸载（删目录）
 *   node install-memory-mcp.cjs --force      # 已装也重来一遍（修坏安装）
 *
 * 落点：<userData>/memory-mcp/（node_modules 在里面）
 * 输出：单行 JSON 到 stdout（便于 IPC 解析），人类可读进度走 stderr。
 * 退出码：0=成功/已装；1=失败；2=未安装（仅 --check）。
 */
"use strict";

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const https = require("node:https");
const { spawnSync } = require("node:child_process");

// 强制清掉宿主注入项（同 e2e harness / 语音模型安装器）
delete process.env.NODE_OPTIONS;
delete process.env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
const doCheck = args.includes("--check");
const doUninstall = args.includes("--uninstall");
const doVerify = args.includes("--verify");
const doForce = args.includes("--force");

function userDataRoot() {
  // ① 主进程 spawn 时显式传（与 app.getPath("userData") 同源，最可靠）
  if (process.env.CODEX_HARNESS_USER_DATA) return process.env.CODEX_HARNESS_USER_DATA;
  // ② 固定锚点下可能有 data-dir.json 指路牌（数据目录自定义，09-25）——
  //    ⛔ 不读它的话服务会装进旧锚点，而引擎在新目录找 ⇒ 「装了但永远显示未安装/verify 失败」
  const anchor = process.platform === "win32"
    ? path.join(process.env.APPDATA || os.homedir(), "Codex Harness Desktop")
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support", "Codex Harness Desktop")
      : path.join(os.homedir(), ".config", "Codex Harness Desktop");
  try {
    const boot = JSON.parse(fs.readFileSync(path.join(anchor, "data-dir.json"), "utf8"));
    if (boot && typeof boot.dir === "string" && path.isAbsolute(boot.dir) && path.parse(boot.dir).root !== boot.dir) return boot.dir;
  } catch { /* 无指路牌/损坏 ⇒ 默认锚点 */ }
  return anchor;
}

const ROOT = path.join(userDataRoot(), "memory-mcp");
const SERVER_REL = ["node_modules", "@vheins", "local-memory-mcp", "bin", "mcp-memory-server.js"];
const serverPath = path.join(ROOT, ...SERVER_REL);
const PKG_DIR = path.join(ROOT, "node_modules", "@vheins", "local-memory-mcp");
const NATIVE_DIR = path.join(ROOT, "node_modules", "better-sqlite3");

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function log(msg) {
  process.stderr.write(`[memory-mcp] ${msg}\n`);
}

function status() {
  const installed = fs.existsSync(serverPath);
  let version = null;
  try {
    const pkg = path.join(PKG_DIR, "package.json");
    if (fs.existsSync(pkg)) version = JSON.parse(fs.readFileSync(pkg, "utf8")).version;
  } catch (e) { /* 忽略 */ }
  return { installed, version: version || undefined, root: ROOT, serverPath: installed ? serverPath : undefined };
}

/* ── 应用自带的 node / npm（新电脑无需预装 Node.js）────────────────────────────
   两个落点：
     · 打包版：本脚本被 extraResources 放到 `<resources>/tools/install-memory-mcp.cjs`，
       自带 node 在同级 `tools/node/node.exe`；
     · 开发版：本脚本在 `<repo>/scripts/`，自带 node 在 `<repo>/resources/tools/node/node.exe`。 */
function bundledNode() {
  const cands = [
    path.join(__dirname, "node", process.platform === "win32" ? "node.exe" : "node"),
    path.join(__dirname, "..", "resources", "tools", "node", process.platform === "win32" ? "node.exe" : "node"),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}
function npmCliFor(nodeExe) {
  const cli = path.join(path.dirname(nodeExe), "node_modules", "npm", "bin", "npm-cli.js");
  return fs.existsSync(cli) ? cli : null;
}

const NODE = bundledNode();
const NPM_CLI = NODE ? npmCliFor(NODE) : null;

/* ── 极简下载器（跟随重定向；不用 spawn curl，避开受限环境的进程限制）── */
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error("重定向过多"));
    const req = https.get(url, { headers: { "user-agent": "codex-harness-installer" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} ← ${url}`));
      }
      const tmp = dest + ".part";
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on("finish", () => {
        out.close(() => {
          try { fs.renameSync(tmp, dest); } catch (e) { return reject(e); }
          resolve(dest);
        });
      });
      out.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("下载超时（60s）")));
  });
}

/* ── 多通道下载（09-25 真机：GitHub Releases 直连在国内常中断 —— curl 实测 `exit 56`；
      同一 URL 走本地代理 / ghfast 镜像则 10s 内完成且字节数一致）──
   依次试：npmmirror 二进制镜像 → 直连 → ghfast.top → gh-proxy.com，每通道 2 次；全失败才报错，
   并把各通道原因拼出来。
   ⛔ npmmirror 必须排在**前面**（09-25 用户反馈「别的用户装不了」）：国内直连 GitHub 大概率超时，
   而 ghfast/gh-proxy 这类公共服务本身也会限流；npmmirror 是国内最稳的那条。
   映射规则：`github.com/<owner>/<repo>/releases/download/<tag>/<file>`
        → `registry.npmmirror.com/-/binary/<repo>/<tag>/<file>`（npmmirror 的 GitHub release 镜像规则）。 */
function mirrorUrls(url) {
  if (!/^https:\/\/github\.com\//.test(url)) return [url];
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/.exec(url);
  const npmmirror = m ? `https://registry.npmmirror.com/-/binary/${m[2]}/${m[3]}/${m[4]}` : null;
  return [npmmirror, url, `https://ghfast.top/${url}`, `https://gh-proxy.com/${url}`].filter(Boolean);
}

async function downloadAny(url, dest) {
  const errors = [];
  for (const u of mirrorUrls(url)) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await download(u, dest);
        return { ok: true, via: u };
      } catch (e) {
        errors.push(`${new URL(u).host}${attempt > 1 ? `(第${attempt}次)` : ""}: ${e.message}`);
      }
    }
  }
  return { ok: false, error: errors.join(" / ") };
}

/* ── 解 tar.gz：**纯 JS**（zlib + 极简 tar 头解析），不 spawn tar / cmd。
   ⛔ 真机实测（09-25）：`spawnSync("tar", …, { shell:true })` 在 Windows 上会经 cmd.exe，
      受限环境直接 `EBUSY` ⇒ 安装器整个卡在「预编译包取不到」的假象里。
      自己解还顺带免掉「系统没有 tar」这一类依赖（新电脑更稳）。 */
function extractFromTarGz(tarGzPath, wantSuffix, destPath) {
  const zlib = require("node:zlib");
  const tar = zlib.gunzipSync(fs.readFileSync(tarGzPath));
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    let allZero = true;
    for (const b of header) { if (b !== 0) { allZero = false; break; } }
    if (allZero) break; // 两个全零块 = 归档结束
    const name = header.subarray(0, 100).toString("utf8").split("\0")[0];
    const size = parseInt(header.subarray(124, 136).toString("utf8").split("\0")[0].trim(), 8) || 0;
    const type = String.fromCharCode(header[156] || 48); // "0"=普通文件
    const dataOff = off + 512;
    if (name.endsWith(wantSuffix) && (type === "0" || type === "5" || type === "\0")) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, tar.subarray(dataOff, dataOff + size));
      return { ok: true, name, bytes: size };
    }
    off = dataOff + Math.ceil(size / 512) * 512;
  }
  return { ok: false };
}

/* ── 补原生绑定：better-sqlite3 的 .node 必须与**运行服务的那个 node** 的 ABI 匹配 ──
   ⛔ 本脚本自己就跑在目标 node 上（主进程用自带 node 拉起），所以 process.versions.modules
      就是正确 ABI，不需要猜、也不需要 spawn 探测。 */
async function ensureNativeBinding() {
  if (!fs.existsSync(NATIVE_DIR)) return { ok: false, error: "better-sqlite3 未安装（npm install 没成功）" };
  const target = path.join(NATIVE_DIR, "build", "Release", "better_sqlite3.node");
  if (fs.existsSync(target)) return { ok: true, already: true, abi: process.versions.modules };

  const pkg = JSON.parse(fs.readFileSync(path.join(NATIVE_DIR, "package.json"), "utf8"));
  const abi = process.versions.modules;
  const plat = process.platform === "win32" ? "win32" : process.platform;
  const arch = process.arch;
  const file = `better-sqlite3-v${pkg.version}-node-v${abi}-${plat}-${arch}.tar.gz`;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${pkg.version}/${file}`;
  const dest = path.join(ROOT, file);
  log(`补原生绑定：ABI=${abi} → ${file}`);
  try {
    const dl = await downloadAny(url, dest);
    if (!dl.ok) throw new Error(`所有下载通道都失败（${dl.error}）`);
    const ex = extractFromTarGz(dest, "better_sqlite3.node", target);
    if (!ex.ok) throw new Error("解包里没有 better_sqlite3.node");
    try { fs.rmSync(dest, { force: true }); } catch (e) { /* 忽略 */ }
  } catch (e) {
    return { ok: false, error: `预编译包取不到（${e.message}）`, url, abi };
  }
  if (!fs.existsSync(target)) return { ok: false, error: "解包后仍未找到 better_sqlite3.node", url };
  return { ok: true, downloaded: true, abi, url };
}

/* ── 跑 npm install：用**异步 spawn**（不是 spawnSync）。
   ⛔ 为什么不用 spawnSync：真机实测（09-25）宿主里 spawnSync 起 node 会失败（受限环境返回
      `status=null` 且 stdout/stderr 全空，错误只藏在 `r.error` 里 —— 旧版把这类失败报成
      「npm install 失败（多数是网络）」，把环境问题说成网络问题，误导排查）。
      异步 spawn 与 --verify 同一路子，真机可行，还能顺带把输出回传 UI。 */
function runNpmInstall(nodeExe, npmArgs) {
  const { spawn } = require("node:child_process");
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(nodeExe, npmArgs, {
        cwd: ROOT,
        windowsHide: true,
        env: { ...process.env, NODE_OPTIONS: "", ELECTRON_RUN_AS_NODE: "" },
      });
    } catch (e) {
      return resolve({ status: null, out: "", err: String(e && e.message ? e.message : e) });
    }
    let out = "", err = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) { /* 已退出 */ }
      resolve({ status: -1, out, err: err + "\n[超时 10 分钟]" });
    }, 10 * 60 * 1000);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ status: null, out, err: err + "\n" + String(e.message) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ status: code, out, err }); });
  });
}

/* ── --verify：**真起一次服务做 MCP 握手**（用自带 node，与引擎侧同一个运行时）── */
function verifySync(nodeExe) {
  if (!fs.existsSync(serverPath)) return { installed: false, verified: false, error: "未安装" };
  const { spawn } = require("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(nodeExe, [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    let out = "", err = "", done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      try { child.kill(); } catch (e) { /* 已退出 */ }
      resolve({ ...status(), ...r });
    };
    const timer = setTimeout(() => finish({ verified: false, error: "超时：15s 内未完成 MCP 握手（服务可能卡在加载原生模块）", detail: String(err || out).slice(-400) }), 15000);
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.includes('"result"')) { clearTimeout(timer); finish({ verified: true }); }
    });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); finish({ verified: false, error: "进程无法启动：" + e.message }); });
    child.on("exit", (c) => {
      if (c !== 0) { clearTimeout(timer); finish({ verified: false, error: "服务退出码 " + c, detail: String(err).slice(-400) }); }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "harness-installer", version: "2.0" } } }) + "\n");
  });
}

/* ── npm registry 默认走**国内镜像**（09-25 用户明确：「记忆 mcp 安装默认使用国内镜像」）──
   顺序（前者优先）：
     ① 用户/公司**显式**配的（env NPM_CONFIG_REGISTRY / npm_config_registry，尊重既有约定）
     ② `registry.npmmirror.com`（**默认首选**：国内直连快且稳）
     ③ `registry.npmjs.org`（仅当镜像不可用时兜底，海外可用）
   ⛔ 不要把官方源放前面：国内不仅慢，很多网络直接取不到 ⇒ 失败率极高。
   每次换通道前**清 node_modules / lock / .npmrc**：上一次失败留下的半成品与坏配置会让下一通道继续报错。
   ⛔ `--ignore-scripts` 必须保留（postinstall 会派生子进程，受限环境必挂，见文件头 ②）。 */
const NPM_REGISTRIES = (() => {
  const fromEnv = [process.env.NPM_CONFIG_REGISTRY, process.env.npm_config_registry]
    .map((s) => String(s ?? "").trim()).filter(Boolean);
  return [...new Set([...fromEnv, "https://registry.npmmirror.com", "https://registry.npmjs.org"])];
})();

function cleanInstallDir() {
  for (const target of [path.join(ROOT, "node_modules"), path.join(ROOT, "package-lock.json"), path.join(ROOT, ".npmrc")]) {
    try { fs.rmSync(target, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
}

/** registry 可达性预检（5s 超时）：不可达就**立刻换下一个**，别让 npm 自己耗满超时再失败。
    npm 的 `/-/ping` 是标准端点，npmmirror 与官方都支持。 */
function registryReachable(registry) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, note) => { if (done) return; done = true; resolve({ ok, note }); };
    try {
      const req = https.get(`${registry.replace(/\/+$/, "")}/-/ping?write=true`, { headers: { "user-agent": "codex-harness-installer" } }, (res) => {
        res.resume();
        finish(res.statusCode === 200, `HTTP ${res.statusCode}`);
      });
      req.on("error", (e) => finish(false, String(e.message).slice(0, 80)));
      req.setTimeout(5000, () => { req.destroy(); finish(false, "超时 5s"); });
    } catch (e) { finish(false, String(e.message).slice(0, 80)); }
  });
}

/** 依次换 registry 装；返回 { ok, via } 或 { ok:false, failures:[…] }。
 *
 *  ⛔⛔ **必须 fail-open**（09-25 代码审查抓到）：registryReachable 用的是**裸 https.get**，
 *  它**不走** `HTTP_PROXY` / `HTTPS_PROXY` / 系统代理，而 **npm 走**。在「只能用代理出网」或
 *  带 TLS 拦截的公司网络里，三个通道会被探测全判「不可达」⇒ 若据此直接 fail，就等于
 *  **把本来能装成功的场景拦死**（比不加预检还差）。所以：
 *    · 有任一通道探测通过 ⇒ 用探测结果提前跳过没希望的（省时间）
 *    · **全部探测失败 ⇒ 忽略探测，照样逐个真试 npm**（真正的判据是 npm 的退出码）
 */
async function installViaRegistries(nodeExe) {
  const failures = [];
  const probes = new Map();
  for (const registry of NPM_REGISTRIES) probes.set(registry, await registryReachable(registry));
  const anyReachable = [...probes.values()].some((probe) => probe.ok);
  if (!anyReachable) {
    log("所有通道的可达性预检都失败（裸 https 不带代理，可能你只能通过代理出网）⇒ 忽略预检，逐个真试 npm");
  }
  for (const registry of NPM_REGISTRIES) {
    const reach = probes.get(registry);
    if (anyReachable && !reach.ok) {
      log(`跳过不可达通道 ${registry}（${reach.note}）`);
      failures.push(`${new URL(registry).host}：不可达（${reach.note}）`);
      continue;
    }
    cleanInstallDir();
    const npmArgs = [
      NPM_CLI, "install", "@vheins/local-memory-mcp@latest",
      "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=error",
      // ⛔ fetch-timeout 是**单个请求的整体超时**（含下载正文）：20s 在慢链路上会把正常下载掐断
      //    ⇒ 取 60s（仍远小于 npm 默认的 5 分钟，且外层还有 10 分钟总闸）。
      `--registry=${registry}`, "--fetch-retries=1", "--fetch-timeout=60000",
    ];
    log(`安装通道：${registry}`);
    const r = await runNpmInstall(nodeExe, npmArgs);
    if (r.status === 0) return { ok: true, via: registry };
    const tail = String(r.out || "").concat(String(r.err || "")).split("\n").filter(Boolean).slice(-6).join(" | ");
    failures.push(`${new URL(registry).host}：${r.status === null ? "npm 进程起不来" : "退出码 " + r.status} ${tail.slice(0, 200)}`);
  }
  return { ok: false, failures };
}

async function main() {
  if (doCheck) {
    const s = status();
    emit({ ...s, node: NODE || null, abi: process.versions.modules });
    process.exit(s.installed ? 0 : 2);
  }

  if (doUninstall) {
    try {
      fs.rmSync(ROOT, { recursive: true, force: true });
      emit({ installed: false, removed: true, root: ROOT });
      process.exit(0);
    } catch (e) {
      emit({ installed: true, removed: false, error: String(e.message) });
      process.exit(1);
    }
  }

  if (!NODE) {
    emit({ installed: false, error: "找不到应用自带的 node（tools/node）。⛔ 不使用系统 Node —— ABI 可能与运行时不一致", root: ROOT });
    process.exit(1);
  }
  const nodeExe = NODE;
  const abi = process.versions.modules;

  if (doVerify) {
    const r = await verifySync(nodeExe);
    emit({ ...r, node: nodeExe, abi });
    process.exit(r.verified ? 0 : 1);
  }

  const before = status();
  if (before.installed && !doForce) {
    // 已装：顺手确保原生绑定在（老安装可能缺），再握手确认
    const nat = await ensureNativeBinding();
    const v = await verifySync(nodeExe);
    if (v.verified) {
      emit({ ...v, node: nodeExe, abi, skipped: true, native: nat });
      process.exit(0);
    }
    log(`已装但握手失败（${v.error}）⇒ 尝试修复安装`);
  }

  fs.mkdirSync(ROOT, { recursive: true });
  const manifestPath = path.join(ROOT, "package.json");
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, JSON.stringify({
      name: "codex-harness-memory-mcp",
      private: true,
      version: "1.0.0",
      description: "可选安装：@vheins/local-memory-mcp（MCP 记忆服务），由 Codex Harness Desktop 按需装入",
    }, null, 2) + "\n");
  }

  /* ⛔ 显式 --ignore-scripts：postinstall 会派生子进程（prebuild-install / esbuild install.js），
     受限环境必挂。跳过它们之后，我们**自己**把 better-sqlite3 的 .node 补上（见 ensureNativeBinding）。
     ⛔ registry 走多通道（见 installViaRegistries）：国内直连 npmjs 基本必失败。 */
  log(`安装到 ${ROOT}`);
  log(`registry 通道（按序）：${NPM_REGISTRIES.join(" → ")}`);
  const inst = await installViaRegistries(nodeExe);
  if (!inst.ok) {
    log(`安装失败（${NPM_REGISTRIES.length} 个通道全挂）：\n${inst.failures.join("\n")}`);
    emit({
      installed: false,
      error: `npm install 失败（已试 ${NPM_REGISTRIES.length} 个 registry 都没成功）`,
      detail: inst.failures.join("\n").slice(0, 700),
      registries: NPM_REGISTRIES,
      hint: "常见原因：网络/代理不可达 npm registry。可自建或公司内网 registry —— 设环境变量 NPM_CONFIG_REGISTRY=<你的 registry> 后重装；或挂上能出网的代理再用。",
      root: ROOT,
      abi,
      node: nodeExe,
    });
    process.exit(1);
  }
  log(`安装成功（registry=${inst.via}）`);

  const nat = await ensureNativeBinding();
  log(nat.ok ? `原生绑定就位（ABI ${abi}）` : `原生绑定缺失：${nat.error}`);

  const after = status();
  if (!after.installed) {
    emit({ installed: false, error: "安装后未找到服务入口", root: ROOT, expect: serverPath });
    process.exit(1);
  }

  const v = await verifySync(nodeExe);
  if (!v.verified) {
    emit({ ...v, node: nodeExe, abi, native: nat, error: v.error || "握手失败", hint: "服务装上了但起不来：看 detail（常见=原生绑定 ABI 不匹配 / 缺预编译包）" });
    process.exit(1);
  }
  log(`安装完成 v${after.version}，握手通过（ABI ${abi}）`);
  // 带上实际使用的 registry：诊断/UI 要能看到「走的是哪个镜像」
  emit({ ...v, node: nodeExe, abi, native: nat, registry: inst.via, installedAt: new Date().toISOString() });
  process.exit(0);
}

main().catch((e) => {
  emit({ installed: false, error: String(e && e.message ? e.message : e), root: ROOT });
  process.exit(1);
});
