// Remote mobile control: local HTTP/WebSocket pairing server + Cloudflare quick tunnel.
// 二维码指向 https 隧道域名（微信/相机可直接打开）；隧道不可用时回退本机 IPv6/局域网地址。
import http from "node:http";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { net } from "electron";
import { existingToolPath, toolsRoot } from "./toolchain";
import { mirrorCandidates } from "./gh-mirror";
import { buildRemotePageHtml } from "./remote/web-page";

/** 手机安装包所在的 Release tag（⛔ 不是桌面版安装包的 v* 发布，别混用） */
const REMOTE_APK_RELEASE = "mobile-remote-v0.1.0";

/** 安装包校验和（GitHub 资产自带的 digest）：镜像层可能被篡改，对不上就不落盘 —— 与 updates.ts 同口径。
 *  ⛔ 重新发布同名资产时必须同步改这里，否则手机端会一直报「校验和不匹配」。 */
const REMOTE_APK_SHA256: Record<string, string> = {
  "CodexRemote-0.1.1.apk": "cbb07bab38d984d898aa59b5c1ff26071e01bf9d8d18efe29dfd820aa9c631b6",
  "PPcodeRemote-0.1.1.apk": "2c9025324f35c7eff50c1f427654dad4cb418340531ae2828687bfc7dce78f27",
};

/** cloudflared 可执行文件（手机配对的公网隧道）。
 *  ⛔ mac 适配（09-17 审计）：旧实现写死 `path.join(process.cwd(), "resources", "tools", "cloudflared.exe")` ——
 *  ① 用**进程当前目录**而不是应用资源目录：打包后能不能命中全靠「启动目录碰巧是安装目录」，
 *     mac 上（cwd 通常是 .app/Contents/MacOS）必然落空；
 *  ② 名字带 .exe：darwin 侧随包的是无后缀单文件二进制（prepare-mac-tools 下载
 *     cloudflared-darwin-<arch>.tgz）⇒ mac 上公网隧道从不启动，扫码只能局域网。
 *  按平台 + 内置工具目录统一解析，找不到返回空串（调用方已按「隧道不可用」降级到局域网）。 */
function resolveCloudflaredBin(): string {
  const isWin = process.platform === "win32";
  const candidates = [
    existingToolPath(...(isWin ? ["cloudflared.exe"] : ["cloudflared", "cloudflared"])),
    // mac 上用户自己 brew 装的那份也认（随包缺失时的兜底）
    ...(isWin ? [] : ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"]),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* 继续下一个 */ }
  }
  return "";
}

type RemoteEvents = {
  getStatus?: () => string;
  sendCommand?: (cmd: string) => void;
  onDeviceConnected?: (device: { id: string; name: string }) => void;
  onCommand?: (command: string, device: { id: string; name: string }) => void;
  /** 手机端对话 UI 需要的引擎桥：会话列表 / 读取某会话消息 / 新建会话 / 向某会话发消息 */
  listThreads?: () => Promise<{ id: string; name: string; preview: string; updatedAt: number }[]>;
  getThreadMessages?: (threadId: string) => Promise<{ role: "user" | "assistant" | "system" | "think"; text: string }[]>;
  newThread?: () => Promise<{ id: string }>;
  /** images = 本机绝对路径（只接受 /api/upload 刚落盘的 remote-uploads 内的文件）；effort ∈ low/medium/high/xhigh */
  sendMessage?: (threadId: string, text: string, images?: string[], effort?: string) => Promise<void>;
  /** 手机端能力目录：可执行指令 + 技能清单（# 引用用） */
  catalog?: () => Promise<{ commands: { id: string; label: string }[]; skills: { name: string; description?: string }[] }>;
  interruptThread?: (threadId: string) => Promise<void>;
  compactThread?: (threadId: string) => Promise<void>;
  /** 列当前会话工作区文件（相对路径，最多两层） */
  listFiles?: (threadId: string) => Promise<{ path: string; dir: boolean; size: number }[]>;
  /** 读一个工作区文件（手机只读；越界/超大/二进制会被拒） */
  readFile?: (threadId: string, relPath: string) => Promise<{ kind: string; text?: string; dataUrl?: string; error?: string }>;
  archiveThread?: (threadId: string) => Promise<void>;
  setGoal?: (threadId: string, objective: string) => Promise<void>;
  /** 本产品在 GitHub Release 上的 APK 资产文件名（按品牌不同由 main 传入） */
  apkFile?: string;
  /** 引擎流式事件转发给已连接手机（turn 增量） */
  onThreadEvent?: (listener: (event: { threadId: string; kind: string; text: string }) => void) => () => void;
  /** 设备会话记忆持久化文件（userData/remote-sessions.json）；不传则不持久化 */
  storageFile?: string;
  /** 09-13 二次加固：手机首次配对需要「6 位配对码 + 电脑端审批」。
      新设备提交正确配对码后不直接放行，而是挂起等电脑端点「允许」。 */
  onPairRequest?: (request: { rid: string; deviceId: string; name: string }) => void;
};

type Device = {
  id: string;
  name: string;
  code: string;
  connectedAt: number;
  lastSeen: number;
  socket: any;
};

/** 待审批的配对请求（手机提交正确配对码后创建，电脑端点允许/拒绝后消解） */
type PairRequest = {
  rid: string;
  deviceId: string;
  name: string;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: number;
  /** 09-24：审批通过时生成的设备秘密明文 —— 只在 /api/pair-status 那一次响应里交付，
   *  随后随请求记录一起删除（服务端只留 sha256）。 */
  secret?: string;
};

/** 已批准设备（持久化，之后凭 cookie 直接进，不再重复审批）。
 *  ⛔ 09-24 安全修复：新增 `secretHash` = 设备侧持有秘密的 sha256。
 *  背景：`/api/pair` 的「老朋友免输码」快路原先**只认 deviceId 在不在已批准表**就下发全套凭据。
 *  而 `accessToken` 每次启动重新生成、`deviceId` 却**永久持久化且无过期** ⇒ 该快路会用长期不变
 *  的 deviceId 现场重铸一枚全新有效 token ⇒ **deviceId 泄露一次 = 永久访问权**；而 deviceId 是
 *  客户端自造的非秘密（`dev-` + Math.random + Date.now），局域网 http 回退时还会明文过网。
 *  拿到凭据即可 new-thread + send-message，而手机新建的会话固定是
 *  `approvalPolicy: "never"` + `sandbox: "danger-full-access"`（见 main.ts 的 newThread）
 *  ⇒ 等于把宿主机任意命令执行权交出去。现在快路必须**同时**持有配当时下发的秘密。
 *  历史记录没有该字段 ⇒ 不认快路，自动回落完整配对流程（重新下发秘密）。 */
type ApprovedDevice = { name: string; approvedAt: number; lastSeen: number; secretHash?: string };

/** 秘密摘要（用于常量时间比对；长度恒为 64 个十六进制字符）。 */
const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/** 6 位配对码：5 分钟有效，错 10 次作废并轮换（挡暴力试码） */
const PAIR_CODE_TTL = 5 * 60_000;
const PAIR_CODE_MAX_TRIES = 10;
/** 审批请求 2 分钟没人理就作废（手机端轮询到 expired） */
const PAIR_REQUEST_TTL = 2 * 60_000;

/** 手机远控的固定本地端口：自建中转（frp）要把它转发出去，⛔ 别改回随机端口 ——
 *  端口每次启动都变，服务端的转发配置就永远对不上（安卓 App / 固定域名场景直接连不上）。 */
export const REMOTE_PORT = 17891;

/** 机器人绑定会话：扫码 → 手机确认 → 应用侧标记已绑定 */
type BindSession = {
  botId: string;
  code: string;
  status: "waiting" | "confirmed" | "expired";
  createdAt: number;
  deviceName?: string;
};

export class RemoteControlService {
  private server: http.Server | null = null;
  private port = 0;
  private devices = new Map<string, Device>();
  private bindSessions = new Map<string, BindSession>();
  private tunnelProc: ChildProcess | null = null;
  private tunnelUrl = "";
  private events: RemoteEvents;
  private storageFile: string;
  private apkFile: string;
  /** 设备（手机端 localStorage 生成的 deviceId）→ 上次使用的会话 threadId */
  private deviceThreads = new Map<string, string>();
  /** 6 位配对码（首次配对的第二道关：光拿到链接还不够，还得看得见电脑屏幕上这串数字） */
  private pairing = { code: "", expiresAt: 0, tries: 0 };
  /** 待审批队列 rid → 请求（手机提交配对码后挂起，等电脑端点允许） */
  private pairRequests = new Map<string, PairRequest>();
  /** 已批准设备 deviceId → 记录（持久化到 userData/remote-devices.json） */
  private approved = new Map<string, ApprovedDevice>();
  /** 已批准设备的持久化文件（与 storageFile 同目录） */
  private approvedFile = "";

  constructor(opts: RemoteEvents) {
    this.events = opts;
    this.storageFile = opts.storageFile ?? "";
    this.apkFile = opts.apkFile ?? "";
    this.approvedFile = this.storageFile ? path.join(path.dirname(this.storageFile), "remote-devices.json") : "";
    this.loadDeviceThreads();
    this.loadApproved();
  }

  private loadApproved() {
    if (!this.approvedFile) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.approvedFile, "utf8"));
      for (const [key, value] of Object.entries<any>(data ?? {})) {
        if (value && typeof value.name === "string") this.approved.set(key, { name: value.name, approvedAt: Number(value.approvedAt ?? 0), lastSeen: Number(value.lastSeen ?? 0) });
      }
    } catch { /* 首次运行无文件 */ }
  }

  private saveApproved() {
    if (!this.approvedFile) return;
    try {
      fs.mkdirSync(path.dirname(this.approvedFile), { recursive: true });
      fs.writeFileSync(this.approvedFile, JSON.stringify(Object.fromEntries(this.approved), null, 2), "utf8");
    } catch { /* 写盘失败忽略 */ }
  }

  private loadDeviceThreads() {
    if (!this.storageFile) return;
    try {
      const raw = fs.readFileSync(this.storageFile, "utf8");
      const data = JSON.parse(raw);
      if (data && typeof data === "object") {
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === "string") this.deviceThreads.set(key, value);
        }
      }
    } catch { /* 首次运行无文件 */ }
  }

  private saveDeviceThreads() {
    if (!this.storageFile) return;
    try {
      fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
      fs.writeFileSync(this.storageFile, JSON.stringify(Object.fromEntries(this.deviceThreads), null, 2), "utf8");
    } catch { /* 写盘失败忽略 */ }
  }

  async start(port = this.resolvedPort()) {
    if (this.server) return this.port;
    // ★ 控制面凭据（09-13 审计 P0：此前 remote 全文件**没有任何鉴权代码**…）。
    //   09-13 二次加固：**accessToken 不再出现在二维码/配对链接里**（能力式 URL 会随
    //   链接、截图、浏览器历史、隧道日志外泄）。现在手机要连上必须过两道关：
    //     ① 6 位配对码（显示在电脑端，5 分钟有效，错 10 次作废）；
    //     ② 电脑端审批（手机提交正确码后挂起，等用户在应用里点「允许」）。
    //   两关都过才种 HttpOnly cookie（accessToken + deviceId），之后手机页面的
    //   fetch 与 WebSocket 自动携带 —— **不需要改手机页面**。
    this.accessToken = require("node:crypto").randomBytes(16).toString("hex");
    this.rotatePairingCode();
    this.port = port;
    this.server = http.createServer((req, res) => this.route(req, res));
    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      // ⛔ 固定端口后 listen 可能失败（端口被占用）：不挂 error 时这个 Promise 会永远悬着，
      //    界面表现成「点了开始没反应」⇒ 失败必须清掉 server 并带端口号报错。
      const onError = (error: Error) => {
        this.server = null;
        reject(new Error(`手机远控端口 ${this.port} 监听失败（自建中转要求固定端口 ${REMOTE_PORT}）：${error.message}`));
      };
      server.once("error", onError);
      // 双栈监听 [::]（同时接受 IPv4 映射连接）：本机有公网 IPv6 时手机蜂窝网络可直连，
      // 没有时退化为同一 Wi-Fi 内 IPv4 访问——两种场景都覆盖
      server.listen(this.port, "::", () => {
        server.removeListener("error", onError);
        this.port = (server.address() as any).port;
        console.log(`[remote] listening on [::]:${this.port} (dual stack)`);
        resolve();
      });
    });
    // ⛔ 不再自动添加防火墙放行规则（09-13 审计：静默改动系统网络策略，是这次"零鉴权暴露在
    // 局域网上"的一环）。规则已存在则续用；不存在只记日志 + 在页面给出提示，由用户显式放行。
    this.reportFirewallState();
    this.startTunnel();
    // 订阅引擎流式事件 → 推给手机对话页（含轮询缓冲）
    this.events.onThreadEvent?.((event) => this.broadcastThreadEvent(event));
    return this.port;
  }

  /** Cloudflare 快速隧道（零注册）：给配对服务一个 https://xxx.trycloudflare.com 公网域名，
   * 微信/相机扫码可直接打开。失败静默回退本机地址。 */
  private startTunnel() {
    const fixed = this.fixedPublicUrl();
    if (fixed) {
      // 自建中转（frp + nginx）已经给了固定域名：再起 quick tunnel 只会让二维码指向随机地址
      console.log(`[remote] 已配置固定公网地址 ${fixed}：跳过 cloudflared 隧道`);
      return;
    }
    const bin = resolveCloudflaredBin();
    if (!bin) return;
    try { this.tunnelProc?.kill(); } catch { /* not running */ }
    const child = spawn(bin, ["tunnel", "--url", `http://127.0.0.1:${this.port}`, "--edge-ip-version", "auto"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.tunnelProc = child;
    const grab = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) this.tunnelUrl = match[0];
    };
    child.stdout?.on("data", grab);
    child.stderr?.on("data", grab);
    child.on("exit", () => { this.tunnelProc = null; this.tunnelUrl = ""; });
    // 5 秒后若仍无域名，大概率被墙或网络不通，杀掉进程避免资源浪费
    setTimeout(() => {
      if (!this.tunnelUrl && this.tunnelProc === child) {
        try { child.kill(); } catch { /* noop */ }
        this.tunnelProc = null;
      }
    }, 5_000);
  }

  /** 自建中转（frp + nginx）给出的固定公网地址：设了它就以它为唯一入口 ——
   *  二维码 / 配对链接 / https 安全 cookie 都用这个域名，cloudflared 也不起。
   *  ⛔ 只认 http(s) 开头；写错（漏协议、带空格）一律回落旧逻辑，别静默当成域名。 */
  /** 手机上传的图片目录（sendMessage 只认这个目录内的路径，见 main 侧的校验） */
  uploadsDir() {
    return this.storageFile ? path.join(path.dirname(this.storageFile), "remote-uploads") : "";
  }

  /** 手机安装包缓存：<userData>/apk-cache/<资产名>；/apk 按需从 GitHub Release 镜像链现取 */
  private apkCachePath(): string {
    if (!this.storageFile || !this.apkFile) return "";
    return path.join(path.dirname(this.storageFile), "apk-cache", this.apkFile);
  }

  /** 并发去重：连点两下「安装包」只下载一次 */
  private apkFetch: Promise<string> | null = null;

  private ensureApkCached(): Promise<string> {
    if (this.apkFetch) return this.apkFetch;
    this.apkFetch = this.fetchApk().finally(() => { this.apkFetch = null; });
    return this.apkFetch;
  }

  private apkDigestOk(file: string): boolean {
    const expected = REMOTE_APK_SHA256[this.apkFile];
    if (!expected) return false; // 没登记校验和的资产一律不认
    try {
      return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") === expected;
    } catch {
      return false;
    }
  }

  private async fetchApk(): Promise<string> {
    const target = this.apkCachePath();
    if (!target) throw new Error("安装包未配置");
    if (fs.existsSync(target)) {
      if (this.apkDigestOk(target)) return target;
      // 缓存损坏 / 是旧包：删掉重下（删不掉就直接覆盖写）
      try { fs.rmSync(target, { force: true }); } catch { /* 覆盖写也能兜住 */ }
    }
    const base = `https://github.com/PMZPZM0/codex-harness-desktop/releases/download/${REMOTE_APK_RELEASE}/${this.apkFile}`;
    const expected = REMOTE_APK_SHA256[this.apkFile];
    if (!expected) throw new Error(`没有登记 ${this.apkFile} 的校验和，拒绝下载`);
    let lastError = "未知错误";
    for (const candidate of mirrorCandidates(base)) {
      try {
        const response = await net.fetch(candidate);
        if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
        const buffer = Buffer.from(await response.arrayBuffer());
        // 镜像挂了常回一个 HTML 错误页：小于 1MB 的"APK"一定是假的
        if (buffer.length < 1024 * 1024) { lastError = "下载内容太小，疑似镜像失败"; continue; }
        if (crypto.createHash("sha256").update(buffer).digest("hex") !== expected) {
          lastError = "校验和不匹配（镜像可能被篡改）";
          continue;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buffer);
        return target;
      } catch (error: any) {
        lastError = String(error?.message ?? error);
      }
    }
    throw new Error("安装包下载失败（镜像与直连都试过了）：" + lastError);
  }

  private fixedPublicUrl() {
    // 环境变量优先；其次读数据目录里的 remote-public-url.txt（一行，给 GUI 启动的用户留的手动口）
    const raw = String(process.env.HARNESS_REMOTE_PUBLIC_URL ?? "").trim() || this.readPublicUrlFile();
    const value = raw.trim().replace(/\/+$/, "");
    return /^https?:\/\//i.test(value) ? value : "";
  }

  /** 远控端口：默认 17891。桌面版与 PPcode 是同一套代码、装在同一台机器上，
   *  两边同时开远控会抢同一个端口 ⇒ 允许用环境变量或数据目录 remote-port.txt 覆盖。 */
  private resolvedPort(): number {
    const valid = (n: number) => Number.isInteger(n) && n > 0 && n < 65536;
    const fromEnv = Number(String(process.env.HARNESS_REMOTE_PORT ?? "").trim());
    if (valid(fromEnv)) return fromEnv;
    if (this.storageFile) {
      try {
        const file = path.join(path.dirname(this.storageFile), "remote-port.txt");
        if (fs.existsSync(file)) {
          const n = Number((fs.readFileSync(file, "utf8").split(/\r?\n/)[0] ?? "").trim());
          if (valid(n)) return n;
        }
      } catch {
        // 读不到就用默认端口
      }
    }
    return REMOTE_PORT;
  }

  private readPublicUrlFile() {
    if (!this.storageFile) return "";
    try {
      const file = path.join(path.dirname(this.storageFile), "remote-public-url.txt");
      if (!fs.existsSync(file)) return "";
      return (fs.readFileSync(file, "utf8").split(/\r?\n/)[0] ?? "").trim();
    } catch {
      return "";
    }
  }

  /** 配对地址：优先固定公网地址（自建中转）；其次 https 隧道域名（微信可直接打开）；
   * 隧道不可用时只回退局域网 IPv4 地址（同一 Wi-Fi 下微信可打开）。
   * 绝不回退 IPv6 地址——微信内置浏览器会拦截纯 IP。 */
  private externalBase() {
    const fixed = this.fixedPublicUrl();
    if (fixed) return fixed;
    if (this.tunnelUrl) return this.tunnelUrl;
    const v4 = this.lanV4Address();
    if (v4) return `http://${v4}:${this.port}`;
    return "";
  }

  /** 局域网 IPv4 地址（微信在同一 Wi-Fi 下可访问） */
  private lanV4Address() {
    const os = require("node:os");
    for (const list of Object.values(os.networkInterfaces())) {
      for (const entry of list as any[]) {
        if (entry.family === "IPv4" && !entry.internal) return entry.address;
      }
    }
    return "";
  }

  /** 控制面一次性凭据（每次启动重新生成，见 start()）。 */
  private accessToken = "";

  /** 防火墙状态检查（**只查不改**）：规则已存在就续用；不存在只记日志，
   *  不再自动 `netsh advfirewall add rule`（09-13 审计：静默改动系统网络策略是
   *  "零鉴权暴露在局域网"的一环；现在改由用户显式放行，界面/配对页会给提示）。 */
  private reportFirewallState() {
    if (process.platform !== "win32") return;
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const rule = "CodexHarness-Remote";
    const check = spawn("netsh", ["advfirewall", "firewall", "show", "rule", `name=${rule}`], { windowsHide: true });
    check.on("exit", (code) => {
      if (code !== 0) {
        console.warn(`[remote] 未发现防火墙放行规则「${rule}」：手机若连不上，请在 Windows 防火墙手动放行 TCP ${this.port}（应用不再自动改系统策略）`);
      }
    });
    check.on("error", () => { /* netsh 不可用 */ });
  }

  /** 配对地址：优先公网 IPv6（手机蜂窝网络可直连，无需同一 Wi-Fi）；没有则退局域网 IPv4 */
  lanAddress() {
    const os = require("node:os");
    const nets = Object.values(os.networkInterfaces()).flat() as any[];
    const globalV6 = nets.find((entry) => entry.family === "IPv6" && !entry.internal && /^2[0-9a-f]{3}:/.test(entry.address));
    if (globalV6) return `[${globalV6.address}]`;
    for (const list of Object.values(os.networkInterfaces())) {
      for (const entry of list as any[]) {
        if (entry.family === "IPv4" && !entry.internal) return entry.address;
      }
    }
    return os.hostname();
  }

  private html(code: string, botId?: string, botName?: string) {
    return buildRemotePageHtml(code, botId, botName);
  }

  private route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url ?? "/";
    // ★ 控制面鉴权（09-13 审计 P0 + 二次加固，**所有路由的统一入口**）：
    //   - 已配对设备：cookie 里带 accessToken + deviceId，且该 deviceId 在已批准表里 → 放行；
    //   - 未配对设备：/api/pair* 是"投名状"入口（校验 6 位配对码 → 挂起等电脑端审批），
    //     允许匿名访问；其余 API 与 WebSocket 一律 401；页面请求返回**配对页**（输码/等审批），
    //     不再是冷冰冰的 401 —— 扫码的人得知道下一步该干什么。
    const pairEndpoint = url.startsWith("/api/pair");
    if (!pairEndpoint && !this.authorize(req, res, url)) return;
    // ── 配对（未鉴权入口）：① 提交 6 位配对码 → 挂起等电脑端审批；② 轮询审批结果 ──
    if (url.startsWith("/api/pair") && req.method === "POST" && !url.startsWith("/api/pair-status")) {
      void this.readBody(req).then((body) => {
        try {
          const data = JSON.parse(body);
          const deviceId = String(data.deviceId ?? "").trim();
          const name = String(data.deviceName ?? "手机").slice(0, 40);
          /* 老朋友快路：**必须同时验设备秘密**（09-24 安全修复）。
             ⛔ 绝不能退回「只看 approved.has(deviceId)」：deviceId 不是秘密、且永久持久化，
             那样等于把一次性泄漏放大成永久访问权（进而是宿主机任意命令执行 —— 见 ApprovedDevice 注释）。
             没有 secretHash 的历史记录 ⇒ 不认快路，走下面的完整配对（并重新下发秘密）。 */
          const known = deviceId ? this.approved.get(deviceId) : undefined;
          const presented = String(data.deviceSecret ?? "");
          const presentedHash = presented ? sha256Hex(presented) : "";
          if (
            known?.secretHash
            && presentedHash.length === known.secretHash.length
            && crypto.timingSafeEqual(Buffer.from(presentedHash), Buffer.from(known.secretHash))
          ) {
            this.approved.set(deviceId, { ...known, lastSeen: Date.now() });
            this.saveApproved();
            this.grantCookies(res, deviceId);
            this.json(res, 200, { ok: true, approved: true });
            return;
          }
          if (!this.checkPairingCode(String(data.code ?? ""))) {
            this.json(res, 200, { ok: false, error: "配对码错误或已过期，请对照电脑端显示的 6 位数字重输" });
            return;
          }
          // 配对码正确 → 挂起，等电脑端在应用里点「允许」
          const rid = crypto.randomBytes(6).toString("hex");
          this.pairRequests.set(rid, { rid, deviceId, name, status: "pending", createdAt: Date.now() });
          this.events.onPairRequest?.({ rid, deviceId, name });
          this.json(res, 200, { ok: true, approved: false, rid });
        } catch (error: any) {
          this.json(res, 200, { ok: false, error: error.message });
        }
      });
      return;
    }
    if (url.startsWith("/api/pair-status")) {
      const params = new URL(url, "http://x").searchParams;
      const req0 = this.pairRequests.get(params.get("rid") ?? "");
      let status: string = req0?.status ?? "expired";
      if (req0 && status === "pending" && Date.now() - req0.createdAt > PAIR_REQUEST_TTL) { req0.status = "expired"; status = "expired"; }
      let issuedSecret = "";
      if (status === "approved") {
        // 审批通过 → 发凭据（accessToken + deviceId 两个 HttpOnly cookie）+ 一次性设备秘密
        this.grantCookies(res, req0!.deviceId);
        issuedSecret = req0!.secret ?? "";
        this.pairRequests.delete(req0!.rid);
      } else if (status === "denied" || status === "expired") {
        this.pairRequests.delete(params.get("rid") ?? "");
      }
      this.json(res, 200, { ok: status === "approved", status, ...(issuedSecret ? { deviceSecret: issuedSecret } : {}) });
      return;
    }
    // WebSocket upgrade
    if (url.startsWith("/ws/") && req.headers.upgrade?.toLowerCase() === "websocket") {
      return this.handleWs(req, res);
    }
    // ⚠️ 匹配必须**忽略查询串**：配对链接自带 `?k=<凭据>`，用 `url === "/api/status"`
    // 精确比较会因为查询串而 404（09-13 冒烟测试第一次跑就复现：带凭据反而 404）。
    if (url === "/api/status" || url.startsWith("/api/status?")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: this.events.getStatus?.() ?? "", devices: this.listDevices() }));
      return;
    }
    // 手机对话页轮询增量（隧道下 WebSocket 不可靠，用 HTTP 轮询同步对话流）
    if (url.startsWith("/api/events")) {
      const params = new URL(url, "http://x").searchParams;
      const since = Number(params.get("since") ?? 0);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ events: this.pollEvents(since), now: Date.now() }));
      return;
    }
    // 设备会话记忆：GET 查询某设备上次会话；POST 保存（持久化到 userData，跨扫码恢复）
    if (url.startsWith("/api/session") && req.method === "GET") {
      const params = new URL(url, "http://x").searchParams;
      const device = params.get("device") ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ threadId: device ? this.deviceThreads.get(device) ?? null : null }));
      return;
    }
    if (url.startsWith("/api/session") && req.method === "POST") {
      void this.readBody(req).then((body) => {
        try {
          const data = JSON.parse(body);
          const device = String(data.device ?? "");
          const threadId = String(data.threadId ?? "");
          if (device && threadId) { this.deviceThreads.set(device, threadId); this.saveDeviceThreads(); }
          this.json(res, 200, { ok: true });
        } catch (error: any) {
          this.json(res, 200, { ok: false, error: error.message });
        }
      });
      return;
    }
    // 图片上传（+ 号）：只收 dataUrl 图片，落盘到 userData/remote-uploads，回本机绝对路径
    if (url === "/api/upload" && req.method === "POST") {
      void this.readBody(req).then((body) => {
        try {
          const data = JSON.parse(body);
          const match = String(data.dataUrl ?? "").match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
          if (!match) { this.json(res, 200, { ok: false, error: "只支持 png / jpeg / webp / gif" }); return; }
          const buffer = Buffer.from(match[2], "base64");
          if (!buffer.length) { this.json(res, 200, { ok: false, error: "图片是空的" }); return; }
          if (buffer.length > 8 * 1024 * 1024) { this.json(res, 200, { ok: false, error: "图片太大（上限 8MB）" }); return; }
          const dir = this.uploadsDir();
          if (!dir) { this.json(res, 200, { ok: false, error: "服务未就绪" }); return; }
          fs.mkdirSync(dir, { recursive: true });
          const ext = match[1] === "jpeg" ? "jpg" : match[1];
          const file = path.join(dir, `${crypto.randomBytes(8).toString("hex")}.${ext}`);
          fs.writeFileSync(file, buffer);
          this.json(res, 200, { ok: true, path: file });
        } catch (error: any) {
          this.json(res, 200, { ok: false, error: error.message });
        }
      });
      return;
    }
    // 手机安装包下载（＋ 菜单 → 安装包）：缓存命中直接回；未命中按镜像链现取（gh-proxy → ghfast → 直连）
    if (url === "/apk" || url.startsWith("/apk?")) {
      void (async () => {
        try {
          const file = await this.ensureApkCached();
          const buffer = fs.readFileSync(file);
          res.writeHead(200, {
            "content-type": "application/vnd.android.package-archive",
            "content-length": String(buffer.length),
            "content-disposition": `attachment; filename="${this.apkFile}"`,
          });
          res.end(buffer);
        } catch (error: any) {
          this.json(res, 502, { error: error.message });
        }
      })();
      return;
    }
    // 手机对话页 RPC over HTTP（WebSocket 不可用时的同功能入口）
    if (url.startsWith("/api/rpc") && req.method === "POST") {
      void this.readBody(req).then(async (body) => {
        try {
          const data = JSON.parse(body);
          let result: any = {};
          if (data.type === "list-threads") result = { threads: await (this.events.listThreads?.() ?? Promise.resolve([])) };
          else if (data.type === "get-messages") result = { messages: await (this.events.getThreadMessages?.(String(data.threadId ?? "")) ?? Promise.resolve([])) };
          else if (data.type === "new-thread") result = { threadId: (await (this.events.newThread?.() ?? Promise.reject(new Error("unsupported")))).id };
          else if (data.type === "send-message") {
            const images = Array.isArray(data.images) ? data.images.map((p: any) => String(p ?? "")).filter(Boolean) : [];
            const effort = ["low", "medium", "high", "xhigh"].includes(String(data.effort ?? "")) ? String(data.effort) : undefined;
            await (this.events.sendMessage?.(String(data.threadId ?? ""), String(data.text ?? ""), images, effort) ?? Promise.resolve());
            result = { ok: true };
          }
          else if (data.type === "catalog") result = await (this.events.catalog?.() ?? Promise.resolve({ commands: [], skills: [] }));
          else if (data.type === "interrupt") { await (this.events.interruptThread?.(String(data.threadId ?? "")) ?? Promise.resolve()); result = { ok: true }; }
          else if (data.type === "compact") { await (this.events.compactThread?.(String(data.threadId ?? "")) ?? Promise.resolve()); result = { ok: true }; }
          else if (data.type === "archive") { await (this.events.archiveThread?.(String(data.threadId ?? "")) ?? Promise.resolve()); result = { ok: true }; }
          else if (data.type === "goal") { await (this.events.setGoal?.(String(data.threadId ?? ""), String(data.objective ?? "")) ?? Promise.resolve()); result = { ok: true }; }
          else if (data.type === "files-list") result = { files: await (this.events.listFiles?.(String(data.threadId ?? "")) ?? Promise.resolve([])) };
          else if (data.type === "file-read") result = await (this.events.readFile?.(String(data.threadId ?? ""), String(data.path ?? "")) ?? Promise.resolve({ kind: "other" }));
          else result = { error: "unknown rpc type" };
          this.json(res, 200, { reqId: data.reqId, ...result });
        } catch (error: any) {
          this.json(res, 200, { reqId: String(JSON.parse(body || "{}").reqId ?? ""), error: error.message });
        }
      });
      return;
    }
    const m = url.match(/^\/r\/([a-z0-9]+)(\?.*)?$/);
    if (m) {
      const code = m[1];
      // /r/<code>?bot=<id>&name=<名称>：机器人绑定模式
      const params = new URL(url, "http://x").searchParams;
      const botId = params.get("bot") ?? undefined;
      const botName = params.get("name") ?? undefined;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(this.html(code, botId, botName));
      return;
    }
    // 根路径（二维码扫出来的地址）：固定跳 /r/mobile —— 会话记忆 key 稳定，
    // 手机端才能跨扫码恢复上次会话（旧逻辑每次随机 code，localStorage key 对不上，历史全丢）
    if (url === "/" || url.startsWith("/?")) {
      res.writeHead(302, { Location: "/r/mobile" });
      res.end();
      return;
    }
    // 绑定会话 API：状态查询 / 手机确认
    if (url.startsWith("/api/bind-status")) {
      const params = new URL(url, "http://x").searchParams;
      const session = this.bindSessions.get(params.get("code") ?? "");
      const ok = Boolean(session && session.botId === params.get("bot") && session.status === "waiting" && Date.now() - session.createdAt < 5 * 60_000);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok }));
      return;
    }
    if (url.startsWith("/api/bind-confirm") && req.method === "POST") {
      void this.readBody(req).then((body) => {
        try {
          const data = JSON.parse(body);
          const session = this.bindSessions.get(String(data.code ?? ""));
          if (!session || session.botId !== data.botId || session.status !== "waiting" || Date.now() - session.createdAt >= 5 * 60_000) {
            this.json(res, 200, { ok: false, error: "绑定码无效或已过期" });
            return;
          }
          session.status = "confirmed";
          session.deviceName = String(data.deviceName ?? "手机");
          this.json(res, 200, { ok: true });
        } catch (error: any) {
          this.json(res, 200, { ok: false, error: error.message });
        }
      });
      return;
    }
    // 根路径（二维码扫出来的地址）：固定跳 /r/mobile —— 会话记忆 key 稳定，
    // 手机端才能跨扫码恢复上次会话（旧逻辑每次随机 code，localStorage key 对不上，历史全丢）
    if (url === "/" || url.startsWith("/?")) {
      res.writeHead(302, { Location: "/r/mobile" });
      res.end();
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  }

  // Minimal handshake-free WebSocket server (RFC6455)
  private handleWs(req: http.IncomingMessage, res: http.ServerResponse) {
    const code = (req.url ?? "").split("/")[2] ?? "";
    const key = req.headers["sec-websocket-key"] as string;
    const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    res.writeHead(101, { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Accept": accept });
    const socket = res as any;
    const deviceId = crypto.randomUUID();
    const name = `手机设备 ${this.devices.size + 1}`;
    const device: Device = { id: deviceId, name, code, connectedAt: Date.now(), lastSeen: Date.now(), socket };
    this.devices.set(deviceId, device);
    this.events.onDeviceConnected?.({ id: deviceId, name: device.name });
    // Push status on connect
    this.send(device, JSON.stringify({ type: "status", status: this.events.getStatus?.() ?? "", devices: this.listDevices() }));
    socket.on("data", (buf: Buffer) => {
      const text = buf.toString("utf8");
      for (const frame of text.split("|")) {
        const payload = this.decodeFrame(buf, frame);
        if (payload) this.handleMessage(device, payload);
      }
    });
    socket.on("close", () => this.devices.delete(deviceId));
  }

  private decodeFrame(buf: Buffer, _frame: string) {
    // Very simplified: assume single text frame (masked). Real impl would parse opcode/length.
    if (buf.length < 6) return null;
    const len = buf[1] & 0x7f;
    if (buf.length < 6 + len) return null;
    const mask = buf.subarray(2, 6);
    const payload = buf.subarray(6, 6 + len);
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
    return out.toString("utf8");
  }

  private handleMessage(device: Device, msg: string) {
    device.lastSeen = Date.now();
    try {
      const data = JSON.parse(msg);
      if (data.type === "ping") return this.send(device, JSON.stringify({ type: "pong" }));
      if (data.type === "command") {
        const command = String(data.command ?? "");
        this.events.onCommand?.(command, { id: device.id, name: device.name });
        this.send(device, JSON.stringify({ type: "ack", command }));
        return;
      }
      // 手机对话 UI 的引擎桥请求（异步，回带 reqId）
      const reqId = String(data.reqId ?? "");
      const reply = (payload: any) => this.send(device, JSON.stringify({ type: "rpc", reqId, ...payload }));
      if (data.type === "list-threads") {
        void (this.events.listThreads?.() ?? Promise.resolve([])).then((threads) => reply({ threads })).catch((e) => reply({ error: e.message }));
        return;
      }
      if (data.type === "get-messages") {
        void (this.events.getThreadMessages?.(String(data.threadId ?? "")) ?? Promise.resolve([])).then((messages) => reply({ messages })).catch((e) => reply({ error: e.message }));
        return;
      }
      if (data.type === "new-thread") {
        void (this.events.newThread?.() ?? Promise.reject(new Error("not supported"))).then((thread) => reply({ threadId: thread.id })).catch((e) => reply({ error: e.message }));
        return;
      }
      if (data.type === "send-message") {
        const images = Array.isArray(data.images) ? data.images.map((p: any) => String(p ?? "")).filter(Boolean) : [];
        const effort = ["low", "medium", "high", "xhigh"].includes(String(data.effort ?? "")) ? String(data.effort) : undefined;
        void (this.events.sendMessage?.(String(data.threadId ?? ""), String(data.text ?? ""), images, effort) ?? Promise.resolve()).then(() => reply({ ok: true })).catch((e) => reply({ error: e.message }));
        return;
      }
    } catch { /* ignore */ }
  }

  /** 把引擎流式事件推给所有已连接手机（对话实时同步）；
   * 同时落到轮询缓冲：Cloudflare 免费隧道对裸 WebSocket 握手兼容差，手机页用 HTTP 轮询兜底 */
  broadcastThreadEvent(event: { threadId: string; kind: string; text: string }) {
    this.pollBuffer.push({ ...event, at: Date.now() });
    if (this.pollBuffer.length > 400) this.pollBuffer.splice(0, this.pollBuffer.length - 400);
    const payload = JSON.stringify({ type: "thread-event", ...event });
    for (const device of this.devices.values()) this.send(device, payload);
  }

  /** 轮询增量：since 之后的 thread-event */
  pollEvents(since: number) {
    return this.pollBuffer.filter((entry) => entry.at > since);
  }
  private pollBuffer: { threadId: string; kind: string; text: string; at: number }[] = [];

  private send(device: Device, text: string) {
    const payload = Buffer.from(text, "utf8");
    const header = Buffer.from([0x81, payload.length]);
    try { device.socket.write(Buffer.concat([header, payload])); } catch { /* closed */ }
  }

  listDevices() {
    return [...this.devices.values()].map((d) => ({ id: d.id, name: d.name, code: d.code, connectedAt: d.connectedAt, lastSeen: d.lastSeen }));
  }

  /** 创建机器人绑定会话：返回绑定页 URL（二维码内容） */
  createBindSession(botId: string, botName: string) {
    const code = crypto.randomBytes(4).toString("hex");
    this.bindSessions.set(code, { botId, code, status: "waiting", createdAt: Date.now() });
    // 清理过期会话
    for (const [key, session] of this.bindSessions) if (Date.now() - session.createdAt > 10 * 60_000) this.bindSessions.delete(key);
    // 机器人绑定二维码：路径在前、参数在后。⛔ 不再带 `k=`（二维码不夹带凭据，
    // 见 pairUrlFor 的说明）—— 绑定前同样要先过配对码 + 审批。
    return `${this.pairUrl()}/r/${code}?bot=${encodeURIComponent(botId)}&name=${encodeURIComponent(botName)}`;
  }

  /** 查询绑定会话状态：waiting / confirmed / expired（找不到即 expired） */
  bindStatus(code: string): "waiting" | "confirmed" | "expired" {
    const session = this.bindSessions.get(code);
    if (!session || Date.now() - session.createdAt > 5 * 60_000) return "expired";
    return session.status;
  }

  /** 取走已确认的绑定（取后标记 waiting 复位为 consumed——用 expired 表示已消费） */
  consumeBind(code: string): { botId: string; deviceName?: string } | null {
    const session = this.bindSessions.get(code);
    if (!session || session.status !== "confirmed") return null;
    session.status = "expired";
    return { botId: session.botId, deviceName: session.deviceName };
  }

  /** 生成新的 6 位配对码（轮换后旧码立即失效） */
  rotatePairingCode() {
    const { randomInt } = require("node:crypto") as typeof import("node:crypto");
    this.pairing = { code: String(randomInt(100000, 999999)).padStart(6, "0"), expiresAt: Date.now() + PAIR_CODE_TTL, tries: 0 };
    return this.pairing.code;
  }

  /** 当前有效的 6 位配对码（过期自动轮换；电脑端界面展示它） */
  pairingCode() {
    if (!this.pairing.code || Date.now() > this.pairing.expiresAt) this.rotatePairingCode();
    return this.pairing.code;
  }

  /** 校验 6 位配对码：过期/不匹配都算失败；连续错 PAIR_CODE_MAX_TRIES 次作废并轮换 */
  private checkPairingCode(input: string) {
    if (!this.pairing.code || Date.now() > this.pairing.expiresAt) return false;
    this.pairing.tries += 1;
    if (this.pairing.tries >= PAIR_CODE_MAX_TRIES) { this.rotatePairingCode(); return false; }
    return input.trim() === this.pairing.code;
  }

  /** 待审批的配对请求列表（电脑端渲染审批卡片用） */
  pendingPairs() {
    for (const [, req] of this.pairRequests) if (Date.now() - req.createdAt > PAIR_REQUEST_TTL) req.status = "expired";
    return [...this.pairRequests.values()].filter((r) => r.status === "pending").map((r) => ({ rid: r.rid, deviceId: r.deviceId, name: r.name, createdAt: r.createdAt }));
  }

  /** 电脑端批准：该设备写入已批准表（持久化），请求标记 approved */
  approvePair(rid: string) {
    const req = this.pairRequests.get(rid);
    if (!req || req.status !== "pending") return false;
    req.status = "approved";
    /* 09-24 安全修复：配当时生成一枚设备秘密（服务端**只留 sha256**）。
       手机在 /api/pair-status 领走它并存进 localStorage；此后「老朋友」快路必须带上它 ——
       只认 deviceId 的话，deviceId 一次性泄漏就等于永久访问权（见 ApprovedDevice 注释）。 */
    const secret = crypto.randomBytes(32).toString("base64url");
    req.secret = secret;
    this.approved.set(req.deviceId, { name: req.name, approvedAt: Date.now(), lastSeen: Date.now(), secretHash: sha256Hex(secret) });
    this.saveApproved();
    return true;
  }

  /** 电脑端拒绝（手机端会看到「已被拒绝」） */
  denyPair(rid: string) {
    const req = this.pairRequests.get(rid);
    if (!req || req.status !== "pending") return false;
    req.status = "denied";
    return true;
  }

  /** 撤销已批准设备（下次连接重新走配对码 + 审批） */
  revokeDevice(deviceId: string) {
    const gone = this.approved.delete(deviceId);
    if (gone) this.saveApproved();
    return gone;
  }

  /** 已批准设备列表（界面可撤销） */
  approvedDevices() {
    return [...this.approved.entries()].map(([deviceId, info]) => ({ deviceId, name: info.name, approvedAt: info.approvedAt, lastSeen: info.lastSeen }));
  }

  private readBody(request: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = "";
      let done = false;
      const finish = (value: string) => { if (!done) { done = true; resolve(value); } };
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
        // 图片上传是未鉴权之外唯一的写入口：超过 16MB 直接断开，别让内存被撑爆
        if (body.length > 16 * 1024 * 1024) {
          try { request.destroy(); } catch { /* noop */ }
          finish("");
        }
      });
      request.on("end", () => finish(body));
      request.on("error", () => finish(""));
    });
  }

  /** 下发凭据 cookie（配对码 + 电脑端审批都通过之后） */
  private grantCookies(res: http.ServerResponse, deviceId: string) {
    const secure = this.externalBase().startsWith("https") ? "; Secure" : "";
    res.setHeader("set-cookie", [
      `harness_remote=${this.accessToken}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=2592000`,
      `harness_device=${encodeURIComponent(deviceId)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=2592000`,
    ]);
  }

  /** 已放行设备的 deviceId（凭据 + 设备都在已批准表里才算数） */
  private authorizedDevice(req: http.IncomingMessage): string {
    if (!this.accessToken) return "";
    const cookie = String(req.headers.cookie ?? "");
    let token = "";
    let deviceId = "";
    for (const part of cookie.split(";")) {
      const bit = part.trim();
      if (bit.startsWith("harness_remote=")) token = bit.slice("harness_remote=".length);
      if (bit.startsWith("harness_device=")) deviceId = bit.slice("harness_device=".length);
    }
    if (!token || token !== this.accessToken) return "";
    deviceId = decodeURIComponent(deviceId);
    if (!deviceId || !this.approved.has(deviceId)) return "";
    const info = this.approved.get(deviceId)!;
    this.approved.set(deviceId, { ...info, lastSeen: Date.now() });
    return deviceId;
  }

  /** 控制面鉴权：只认「凭据 cookie + 已批准设备」。
   *  未配对的设备访问 API/WS → 401；访问页面 → 200 配对页（输 6 位码 / 等审批提示）。
   *  注：不再接受 URL 里的 `?k=`（09-13 二次加固：能力式 URL 会随链接与截图外泄）。 */
  private authorize(req: http.IncomingMessage, res: http.ServerResponse, url: string): boolean {
    if (this.authorizedDevice(req)) return true;
    const isUpgrade = req.headers.upgrade?.toLowerCase() === "websocket";
    if (url.startsWith("/api/") || isUpgrade) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized", hint: "请从应用里重新扫码配对" }));
    } else {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(this.pairHtml());
    }
    return false;
  }

  /** 配对页：新设备扫码后落到这里 —— 输入电脑端显示的 6 位配对码，然后等电脑端点「允许」。 */
  private pairHtml() {
    return `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>配对这台手机</title><style>
body{font-family:system-ui,sans-serif;background:#f7f7f5;margin:0;color:#23231f}
.card{background:#fff;border:1px solid #e7e7e4;border-radius:14px;padding:22px;margin:48px 16px;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{color:#6f6f69;font-size:13px;line-height:1.75;margin:10px 0}
input{width:100%;box-sizing:border-box;margin-top:14px;padding:14px;font-size:22px;letter-spacing:8px;text-align:center;border:1px solid #d7d9d4;border-radius:12px}
button{width:100%;margin-top:14px;padding:13px;border:0;border-radius:12px;background:#1e1e1c;color:#fff;font-size:15px;cursor:pointer}
.err{color:#c0392b} .ok{color:#1a7f37;font-weight:600} .wait{color:#8a6d1f}
</style>
<div class="card"><h1>配对这台手机</h1><p>打开电脑端「手机远控」，填入 <b>6 位连接码</b>。<br>首次连接需在电脑上点「允许」。</p>
<input id="code" inputmode="numeric" maxlength="6" placeholder="······" autocomplete="one-time-code">
<button onclick="submit()">配对并请求连接</button><p id="state"></p></div>
<script>
const KEY_DEVICE = "chm-pair-device";
const KEY_SECRET = "chm-pair-secret";
let deviceId = localStorage.getItem(KEY_DEVICE);
if (!deviceId) { deviceId = "dev-" + Math.random().toString(36).slice(2,10) + Date.now().toString(36); localStorage.setItem(KEY_DEVICE, deviceId); }
let deviceSecret = localStorage.getItem(KEY_SECRET) || "";
const ua = navigator.userAgent;
const deviceName = ua.includes("iPhone") ? "iPhone" : ua.includes("Android") ? "Android 手机" : "手机";
const el = document.getElementById("state");
async function submit(){
  const code = document.getElementById("code").value.trim();
  if (code.length !== 6) { el.className = "err"; el.textContent = "请输入 6 位数字"; return; }
  el.className = ""; el.textContent = "正在校验…";
  try {
    const r = await fetch("/api/pair", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ code, deviceId, deviceName, deviceSecret }) });
    const j = await r.json();
    if (!j.ok) { el.className = "err"; el.textContent = j.error || "配对失败"; return; }
    if (j.deviceSecret) { deviceSecret = j.deviceSecret; localStorage.setItem(KEY_SECRET, deviceSecret); }
    if (j.approved) { el.className = "ok"; el.textContent = "已配对，正在进入…"; setTimeout(() => location.href = "/r/mobile", 600); return; }
    el.className = "wait"; el.textContent = "配对码正确，等待电脑端批准…";
    poll(j.rid);
  } catch(e) { el.className = "err"; el.textContent = "网络错误：" + e.message; }
}
async function poll(rid){
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const r = await fetch("/api/pair-status?rid=" + rid);
      const j = await r.json();
      if (j.status === "approved") { if (j.deviceSecret) { deviceSecret = j.deviceSecret; localStorage.setItem(KEY_SECRET, deviceSecret); } el.className = "ok"; el.textContent = "已批准，正在进入…"; setTimeout(() => location.href = "/r/mobile", 600); return; }
      if (j.status === "denied") { el.className = "err"; el.textContent = "电脑端拒绝了这次连接"; return; }
      if (j.status === "expired") { el.className = "err"; el.textContent = "等待超时，请重新配对"; return; }
    } catch { /* 隧道偶尔超时，继续轮询 */ }
  }
  el.className = "err"; el.textContent = "等待批准超时，请重试";
}
// 老朋友自动登录：accessToken 每次应用启动都会重生成、旧 cookie 必然失效 ——
// 带着配对时拿到的设备秘密直接换新凭据，不再让人重新输码 + 电脑端再批一次。
async function autoLogin(){
  if (!deviceSecret) return;
  el.className = "wait"; el.textContent = "正在自动登录…";
  try {
    const r = await fetch("/api/pair", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ deviceId, deviceName, deviceSecret }) });
    const j = await r.json();
    if (j.ok && j.approved) { el.className = "ok"; el.textContent = "已登录，正在进入…"; location.href = "/r/mobile"; return; }
  } catch { /* 网络不通就留在表单 */ }
  el.className = ""; el.textContent = "";
}
// App 内置了服务器地址、只让人填 6 位连接码：码走 URL 片段（#code=…，不会进服务器日志），
// 到这里自动填好并提交；没有码才走「设备秘密自动登录」。
const hashCode = (location.hash.match(/code=([0-9]{6})/) || [])[1] || "";
if (hashCode) { document.getElementById("code").value = hashCode; submit(); }
else autoLogin();
</script></html>`;
  }

  private json(response: http.ServerResponse, status: number, value: unknown) {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  }

  pairUrl() {
    // 纯基址（**不带查询串**）：调用方会自己往后拼路径与参数（如 `/r/<code>?bot=…`），
    // 这里若带上 `?k=` 会把 URL 拼坏 —— 需要凭据的场景用下面的 pairUrlAuth / pairUrlFor。
    return this.externalBase();
  }

  /** 带一次性凭据的配对地址（界面展示 / 复制的链接用）：扫码或点开即可通过鉴权。
   *  ⛔ 09-13 二次加固：**不再带 `?k=`** —— 二维码与链接不再夹带任何凭据，
   * 手机连上必须走「6 位配对码 + 电脑端审批」（见 authorize / pairHtml）。 */
  pairUrlAuth() {
    return this.externalBase();
  }

  /** 带凭据 + 可选机器人参数的二维码地址。**由服务端拼**，调用方不要再手工拼 `?`/`&`。
   *  同样不再带 `k=`（理由同上）。 */
  pairUrlFor(botId?: string) {
    const base = this.externalBase();
    if (!base) return base;
    return `${base}?${botId ? `bot=${encodeURIComponent(botId)}` : "p=1"}`;
  }

  stop() {
    try { this.tunnelProc?.kill(); } catch { /* not running */ }
    this.tunnelProc = null;
    this.tunnelUrl = "";
    this.server?.close();
    this.server = null;
  }
}
