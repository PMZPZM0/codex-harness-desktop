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
const CHANNELS = ["free-gateway:status", "free-gateway:download", "free-gateway:start", "free-gateway:stop", "free-gateway:open-admin", "free-gateway:models"];
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

/** 下载一个 URL 到文件（net.fetch 自动跟随重定向；失败返回 null 让调用方换下一镜像）。 */
async function downloadTo(url: string, dest: string): Promise<boolean> {
  try {
    const r = await net.fetch(url);
    if (!r.ok || !r.body) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1_000_000) return false; // 太小说明是错误页
    fs.writeFileSync(dest, buf);
    return true;
  } catch { return false; }
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
        forwardKey: forwardKey ? "已保存（注册供应商时自动带入）" : "",
        lastStartError: lastStartError || null,
        hasForwardKey: Boolean(forwardKey),
        adminUrl: adminUrl || (port ? `http://127.0.0.1:${port}/` : ""),
        stage: stage || null,
        stageError: stageError || null,
      };
    });

    ipcHost.handle("free-gateway:download", async () => {
      if (stage) throw new Error(`正在${stage === "downloading" ? "下载" : "解压"}中，请稍候`);
      const root = gatewayRoot();
      fs.mkdirSync(root, { recursive: true });
      const zipPath = path.join(root, "ofm-main.zip");
      stage = "downloading"; stageError = "";
      try {
        let done = false;
        for (const prefix of MIRRORS) {
          if (await downloadTo(prefix + REPO_ZIP, zipPath)) { done = true; break; }
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

    ipcHost.handle("free-gateway:stop", async () => {
      if (child) { child.kill(); child = null; }
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

    // 应用退出时收掉侧车进程（不 detached：随宿主走，避免留孤儿服务占端口）
    app.on("will-quit", () => { try { child?.kill(); } catch { /* 已退出 */ } });

    ctx.effect(() => {
      for (const ch of CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
