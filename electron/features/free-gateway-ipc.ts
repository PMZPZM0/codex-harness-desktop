/**
 * 免费模型网关（free-gateway 域，10-12）：把第三方开源项目 **dsh-our-free-model** 的
 * 独立网关（OpenAI 兼容，127.0.0.1:18900，`/v1/chat/completions` + `/v1/responses`）
 * 作为**可选下载的侧车服务**接入本应用。
 *
 * ⛔⛔ 免责边界（用户定稿「一切与开发者无关」）：上游是第三方开源项目（MIT），
 *   渠道合规性 / 可用性 / 账号安全由使用者自行承担 —— 渲染层推荐卡与新手引导必须带
 *   这行声明（守卫 12c 钉「声明在场」）。
 *
 * 本域只管四件事：下载（gh 镜像 zip + 随包 7za 解压）/ 启停（随包 node 跑 standalone cli）/
 * 健康与取 Key（读上游 settings.json 的 forwardKey）/ 管理台地址（启动期捕获一次性登录链接）。
 * ⛔ 供应商注册**不走本域**：渲染层拿到 forwardKey 后走既有 `custom-model:save`
 *   （模型配置的单一真相源），本域不碰 custom-model 存储 —— 否则两套写路径必漂移。
 */
import { app, net } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bundledNode, toolsRoot } from "../toolchain";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const REPO_ZIP = "https://codeload.github.com/Ebony-Vinyl/dsh-our-free-model/zip/refs/heads/main";
/** 镜像前缀（空串 = 直连），与 codex-official-market 同序（gh-proxy → ghfast → 直连）。 */
const MIRRORS = ["https://gh-proxy.com/", "https://ghfast.top/", ""];
const CHANNELS = ["free-gateway:status", "free-gateway:download", "free-gateway:start", "free-gateway:stop", "free-gateway:open-admin", "free-gateway:models", "free-gateway:uninstall"];
/** 生命周期状态（模块级单例；路径一律**运行期**求值 —— ⛔ 模块顶层不许求值 app.getPath）。 */
let child: ChildProcess | null = null;
let adminUrl = "";
let stage: "" | "downloading" | "extracting" = "";
let stageError = "";
let lastStartError = "";

function gatewayRoot() { return path.join(app.getPath("userData"), "free-gateway"); }
function appDir() { return path.join(gatewayRoot(), "app"); }
function dataDir() { return path.join(gatewayRoot(), "data"); }
function markerPath() { return path.join(appDir(), "packages", "standalone", "cli.mjs"); }
function settingsPath() { return path.join(dataDir(), "settings.json"); }

function readGatewaySettings(): { forwardKey?: string; port?: number } {
  try { return JSON.parse(fs.readFileSync(settingsPath(), "utf8")); } catch { return {}; }
}

async function healthOk(port: number): Promise<boolean> {
  try { const r = await net.fetch(`http://127.0.0.1:${port}/health`); return r.ok; } catch { return false; }
}

async function pickPort(): Promise<number> {
  const fromSettings = readGatewaySettings().port;
  if (fromSettings && await healthOk(fromSettings)) return fromSettings;
  if (await healthOk(18900)) return 18900;
  return 0;
}

/** 下载进度（状态通道轮询消费；10-12 用户实测「没进度条转半天」后加）*/
let dlBytes = 0;
let dlTotal = 0;

/**
 * 下载一个 URL 到文件（流式落盘，字节实时计入 dlBytes/dlTotal）。
 * ⛔ 必须带超时（10-12 用户实测：第一通道在自己的网络/代理下挂起时，无超时 = 无限转圈）——
 *   headers 25s / 整体 120s，超时或失败返回 false 让调用方切下一镜像。
 */
async function downloadTo(url: string, dest: string): Promise<boolean> {
  try {
    const r = await net.fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!r.ok || !r.body) return false;
    const totalHeader = Number(r.headers.get("content-length") ?? 0);
    dlBytes = 0;
    dlTotal = totalHeader > 0 ? totalHeader : 0;
    const chunks: Buffer[] = [];
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      dlBytes += value.byteLength;
    }
    const buf = Buffer.concat(chunks);
    if (buf.length < 1_000_000) return false; // 太小说明是错误页
    dlTotal = dlTotal || buf.length;
    fs.writeFileSync(dest, buf);
    return true;
  } catch { return false; }
}

/** 读上次实测最快的镜像前缀（空串 = 直连；没有记录 = -1 走默认序）。 */
function lastGoodMirror(): number {
  try { const v = Number(fs.readFileSync(path.join(gatewayRoot(), "mirror.txt"), "utf8").trim()); return Number.isInteger(v) && v >= 0 && v < 3 ? v : -1; } catch { return -1; }
}
function saveLastGoodMirror(i: number) {
  try { fs.mkdirSync(gatewayRoot(), { recursive: true }); fs.writeFileSync(path.join(gatewayRoot(), "mirror.txt"), String(i)); } catch { /* 记不住就按默认序 */ }
}

/** 用随包 7-Zip（完整版 7za）解 zip；缺 7za 时给可执行的中文名报错。 */
function extractZip(zipPath: string, destDir: string): Promise<void> {
  const sevenZip = path.join(toolsRoot(), "sevenzip", "7za.exe");
  if (!fs.existsSync(sevenZip)) throw new Error("缺少随包 7-Zip（设置 → 开发工具 → 7-Zip CLI 修复安装后重试）");
  return new Promise((resolve, reject) => {
    const p = spawn(sevenZip, ["x", zipPath, `-o${destDir}`, "-y"], { stdio: "ignore" });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`解压失败（7za 退出码 ${code}）`))));
  });
}

export const freeGatewayFeature = defineFeature<null>({
  id: "free-gateway",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("free-gateway: 缺少 ipc 服务（宿主未提供？）");

    ipcHost.handle("free-gateway:status", async () => {
      const downloaded = fs.existsSync(markerPath());
      let version = "";
      try { version = JSON.parse(fs.readFileSync(path.join(appDir(), "package.json"), "utf8")).version ?? ""; } catch { /* 未下载 */ }
      const running = Boolean(child && !child.killed);
      const port = await pickPort();
      const forwardKey = readGatewaySettings().forwardKey ?? "";
      return {
        downloaded, version, running, port,
        forwardKey,
        lastStartError: lastStartError || null,
        dlBytes, dlTotal,
        hasForwardKey: Boolean(forwardKey),
        adminUrl: adminUrl || (port ? `http://127.0.0.1:${port}/` : ""),
        stage: stage || null,
        stageError: stageError || null,
      };
    });

    ipcHost.handle("free-gateway:download", async (_event, input: { force?: boolean } = {}) => {
      // 幂等短路：本体已在盘上就直接返回（⛔ 不重下 12MB —— 用户重复点击/验收重跑都秒回；force 预留重下能力）
      if (!input?.force && fs.existsSync(markerPath())) {
        let version = "";
        try { version = JSON.parse(fs.readFileSync(path.join(appDir(), "package.json"), "utf8")).version ?? ""; } catch { /* 宽松 */ }
        return { ok: true, version, already: true };
      }
      if (stage) throw new Error(`正在${stage === "downloading" ? "下载" : "解压"}中，请稍候`);
      const root = gatewayRoot();
      fs.mkdirSync(root, { recursive: true });
      const zipPath = path.join(root, "ofm-main.zip");
      stage = "downloading"; stageError = "";
      try {
        let done = false;
        // ⛔ 通道顺序：上次实测最快的排最前（10-12 用户实测「转半天」——第一通道挂起又没超时切换）
        const last = lastGoodMirror();
        const order = last >= 0 ? [MIRRORS[last], ...MIRRORS.filter((_, i) => i !== last)] : MIRRORS;
        for (let mi = 0; mi < order.length && !done; mi++) {
          done = await downloadTo(order[mi] + REPO_ZIP, zipPath);
          if (done) saveLastGoodMirror(MIRRORS.indexOf(order[mi]));
        }
        if (!done) throw new Error("三个下载通道（gh-proxy / ghfast / 直连）都失败了，请检查网络后重试");
        stage = "extracting";
        const staging = path.join(root, "staging");
        fs.rmSync(staging, { recursive: true, force: true });
        fs.mkdirSync(staging, { recursive: true });
        await extractZip(zipPath, staging);
        const inner = fs.readdirSync(staging).find((f) => f.startsWith("dsh-our-free-model"));
        if (!inner) throw new Error("压缩包结构不符合预期（未找到仓库根目录）");
        fs.rmSync(appDir(), { recursive: true, force: true });
        // ⛔ Windows 上刚 rm 完的目录 rename 偶发 EPERM（杀毒/索引器瞬时握着句柄，10-12 验收实测）—— 重试 5 次
        let renamed = false;
        for (let i = 0; i < 5 && !renamed; i++) {
          try { fs.renameSync(path.join(staging, inner), appDir()); renamed = true; }
          catch (e: any) {
            if (i === 4 || !/EPERM|EBUSY|ENOTEMPTY/i.test(String(e?.code ?? e?.message ?? e))) throw e;
            await new Promise((r) => setTimeout(r, 400));
          }
        }
        fs.rmSync(staging, { recursive: true, force: true });
        fs.rmSync(zipPath, { force: true });
        let version = "";
        try { version = JSON.parse(fs.readFileSync(path.join(appDir(), "package.json"), "utf8")).version ?? ""; } catch { /* 宽松 */ }
        return { ok: true, version };
      } catch (error: any) {
        stageError = String(error?.message ?? error);
        throw error;
      } finally {
        stage = "";
      }
    });

    ipcHost.handle("free-gateway:start", async () => {
      if (!fs.existsSync(markerPath())) throw new Error("尚未下载网关本体，请先点「下载」");
      // 幂等：已有健康实例（本应用上次拉起的 / 用户自起的）就直接复用，不双开
      //（上游单数据目录限一个实例，service.lock 会让第二实例秒退）
      const existing = await pickPort();
      if (existing) { adminUrl = adminUrl || `http://127.0.0.1:${existing}/`; return { ok: true, port: existing, hasForwardKey: Boolean(readGatewaySettings().forwardKey) }; }
      const nodeExe = bundledNode() || "node";
      fs.mkdirSync(dataDir(), { recursive: true });
      // ⛔ 残锁前置清理（10-12 实测）：应用被强杀后上游的 service.lock 会残留 ⇒ 首次启动
      //   必吃 20s 锁失败再走清锁重试。启动前先探：无健康实例但有锁 = 残锁，直接摘掉。
      if (fs.existsSync(path.join(dataDir(), "service.lock")) && !(await pickPort())) {
        try { fs.rmSync(path.join(dataDir(), "service.lock"), { force: true }); } catch { /* 摘不掉就让启动路径报 */ }
      }
      /** 一次「spawn + 等健康」；失败抛出带 stderr 尾巴的错误。 */
      const bootOnce = async (): Promise<number> => {
        let errTail = "";
        child = spawn(nodeExe, [markerPath()], {
          cwd: appDir(),
          env: { ...process.env, OFM_HOME: dataDir() },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout?.on("data", (chunk: Buffer) => {
          // 启动横幅里有一条**一次性管理登录链接**（10 分钟有效）——捕获最后一行 http 地址当管理台入口
          const text = String(chunk);
          const hit = /https?:\/\/127\.0\.0\.1:\d+\/\S*/.exec(text);
          if (hit) adminUrl = hit[0];
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          // 上游把启动横幅写 stderr 的情况也接受；同时留尾巴给失败信息（10-12 实测：service.lock 残留时错误只写这里）
          const text = String(chunk);
          const hit = /https?:\/\/127\.0\.0\.1:\d+\/\S*/.exec(text);
          if (hit) adminUrl = hit[0];
          errTail = (errTail + "\n" + text).split("\n").slice(-4).join("\n");
        });
        child.on("exit", () => { child = null; });
        let port = 0;
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 500));
          port = await pickPort();
          if (port) break;
        }
        if (!port) throw new Error(`网关进程 20 秒内未就绪（端口 18900 被占用或启动报错）${errTail ? "：" + errTail.trim() : ""}`);
        return port;
      };
      let port = 0;
      try {
        port = await bootOnce();
        lastStartError = "";
      } catch (error: any) {
        lastStartError = String(error?.message ?? error);
        // ⛔ 上游单实例锁：崩溃残留的 service.lock 会让启动被拒（10-12 实测）——
        //   仅当**没有任何健康实例**时才清锁重试一次（有健康实例 = 真有人在跑，绝不能动）。
        const msg = String(error?.message ?? error);
        if (/占用|lock/i.test(msg) && !(await pickPort())) {
          try { fs.rmSync(path.join(dataDir(), "service.lock"), { force: true }); } catch { /* 锁不存在 */ }
          adminUrl = "";
          port = await bootOnce();
        } else throw error;
      }
      adminUrl = adminUrl || `http://127.0.0.1:${port}/`;
      return { ok: true, port, hasForwardKey: Boolean(readGatewaySettings().forwardKey) };
    });

    /** ⛔ 杀整棵进程树：上游网关 spawn 了 Worker 子进程，child.kill() 只杀直接子进程
     *  会留孤儿 Worker 占端口（10-12 用户实测「卸载了网关还没自动停止」）。Windows 用
     *  taskkill /F /T 杀进程树；非 Windows 用 SIGKILL。 */
    const killGatewayTree = () => {
      if (child?.pid) {
        try {
          if (process.platform === "win32") {
            spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore", windowsHide: true });
          } else {
            child.kill("SIGKILL");
          }
        } catch { /* 进程已退出 */ }
      }
      child = null;
    };
    ipcHost.handle("free-gateway:stop", async () => {
      killGatewayTree();
      return { ok: true };
    });

    ipcHost.handle("free-gateway:open-admin", async () => {
      const port = await pickPort();
      if (!port) throw new Error("网关未在运行，先启动它");
      return { url: adminUrl || `http://127.0.0.1:${port}/`, port };
    });

    // 模型清单：主进程带 Key 拉 /v1/models（⛔ 不在渲染层 fetch —— 网关未必带 CORS 头，跨 origin 会被拦）
    ipcHost.handle("free-gateway:models", async () => {
      const port = await pickPort();
      if (!port) throw new Error("网关未在运行，先启动它");
      const key = readGatewaySettings().forwardKey ?? "";
      const r = await net.fetch(`http://127.0.0.1:${port}/v1/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
      if (!r.ok) throw new Error(`拉取模型清单失败（HTTP ${r.status}）`);
      const body: any = await r.json();
      const ids = (body?.data ?? []).map((m: any) => String(m?.id ?? "")).filter(Boolean);
      return { models: ids };
    });

    // 卸载：停侧车 + 删本体 + 删数据目录（供应商注册由渲染层调 custom-model:remove 移除）
    ipcHost.handle("free-gateway:uninstall", async () => {
      killGatewayTree();
      let errors: string[] = [];
      for (const dir of [appDir(), dataDir()]) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e: any) { errors.push(e?.message ?? String(e)); }
      }
      adminUrl = "";
      if (errors.length) throw new Error("卸载失败（部分目录被占用）：" + errors.join("；"));
      return { ok: true };
    });

    // 应用退出时收掉侧车进程（不 detached：随宿主走，避免留孤儿服务占端口）
    app.on("will-quit", () => { killGatewayTree(); });

    /* ⛔ 网关跟随应用启停联动（10-12 用户令）：应用启动 → 如果之前用过（settings.json 有
       forwardKey = 网关曾被启动过）→ 自动启动网关（用户不需要每次手动点「启动网关」）。
       应用退出 → will-quit 收掉侧车（上面已有）。⛔ 延迟 5 秒 —— 等 userData 重定向完成。 */
    if (fs.existsSync(markerPath()) && fs.existsSync(settingsPath())) {
      setTimeout(async () => {
        try {
          const port = await pickPort();
          if (port) { adminUrl = adminUrl || `http://127.0.0.1:${port}/`; return; }
          const nodeExe = bundledNode() || "node";
          child = spawn(nodeExe, [markerPath()], {
            cwd: appDir(),
            env: { ...process.env, OFM_HOME: dataDir() },
            stdio: ["ignore", "pipe", "pipe"],
          });
          child.stdout?.on("data", (chunk: Buffer) => {
            const hit = /https?:\/\/127\.0\.0\.1:\d+\/\S*/.exec(String(chunk));
            if (hit) adminUrl = hit[0];
          });
          child.on("exit", () => { child = null; });
        } catch { /* 静默失败 —— 用户可从模型设置页手动启动 */ }
      }, 5000);
    }

    ctx.effect(() => {
      for (const ch of CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
