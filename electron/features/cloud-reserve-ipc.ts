/**
 * cloud-reserve（cloud 域，10-11）—— 云版助手的**预留接口层**
 *
 * 定位：为云版产品线的后续功能**提前占位**，让渲染层/远端从今天起就能按稳定
 * 通道名开发，后端逐步把桩换成真实现 —— 通道名一旦发布即冻结（只增不改）。
 *
 * 五组接口（命名统一 `cloud:<组>/<动作>`）：
 *   ① cloud:sync/*      云端存储（数据同步）—— handshake 里已声明 reserved，这里是 IPC 挂点
 *   ② cloud:device/*    设备/配对管理 —— 真实现（读写 HARNESS_CLOUD_HOME/users.json）
 *   ③ cloud:notify/*    站长公告/通知 —— 本地缓存已真实现，服务器拉取后续接入
 *   ④ cloud:update/*    助手自更新（检测/下载/生效）—— check 已真实现（探测服务器指纹）
 *   ⑤ cloud:tools/*     工具链按需下载（发布形态已定：精简包 + 按需拉）—— status/progress 真实现
 *
 * ⛔ 预留桩的**统一返回形状**（调用方据此做能力探测，不需要 try/catch）：
 *   { ok: false, reserved: true, code: "<原因>", error: "<人话>" }
 *   —— 真实现后返回各自的数据形状，渲染层以 `reserved !== true` 判断是否已开通。
 *
 * ⛔ 模块顶层不求值 app.getPath / homedir（【91】：域模块先于 main.ts 的 setPath 执行，
 *   路径一律在 handler 回调体内求值）。
 */
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineFeature } from "../context";
/* 10-18 接线：会话同步从"预留桩"改为**真实现**。
   ⛔ `deviceToken` 注入的是**云账号 token**（`activeCredential().token`）——
      `cloud-sync.ts` 里它直接当 `Authorization: Bearer` 用；
      服务端 1.1.8 起已允许账号 token 直接 push（device 降为可选标记），所以不再需要配对流程。 */
import { accountsBase, activeCredential } from "../cloud-api";
import { runCloudSyncOnce, pullCloudSessions, readSyncSummary, listLocalSessions } from "../cloud-sync";
import type { IpcHost } from "../ipc-host";

const CHANNELS = [
  "cloud:sync/status", "cloud:sync/push", "cloud:sync/pull", "cloud:sync/conflict/resolve",
  "cloud:device/list", "cloud:device/unbind",
  "cloud:notify/list", "cloud:notify/mark-read",
  "cloud:update/check", "cloud:update/download", "cloud:update/apply",
  "cloud:tools/status", "cloud:tools/download", "cloud:tools/progress",
];

/** 云版配置家目录 —— 与登录门/伴生服务同一落点（HARNESS_CLOUD_HOME）。运行期求值。 */
function cloudHome(): string {
  return process.env.HARNESS_CLOUD_HOME || path.join(os.homedir(), ".codex-harness-cloud");
}
type ChcUser = { name: string; code: string; token: string; createdAt: number };
function readUsers(): ChcUser[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(cloudHome(), "users.json"), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as ChcUser[]) : [];
  } catch { return []; }
}
function writeUsers(users: ChcUser[]): void {
  fs.mkdirSync(cloudHome(), { recursive: true });
  fs.writeFileSync(path.join(cloudHome(), "users.json"), JSON.stringify(users, null, 2), { mode: 0o600 });
}
/** 通知缓存：userData/cloud-notify.json（[{id,title,body,at,read}]）—— 站长公告拉取后的落点。 */
type Notice = { id: string; title: string; body: string; at: number; read?: boolean };
function noticeFile(): string { return path.join(app.getPath("userData"), "cloud-notify.json"); }
function readNotices(): Notice[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(noticeFile(), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as Notice[]) : [];
  } catch { return []; }
}
function writeNotices(list: Notice[]): void {
  fs.writeFileSync(noticeFile(), JSON.stringify(list, null, 2), { mode: 0o600 });
}
/** 助手自更新的服务器探测点：/cloud/assistant/version.json（现在没有 → available:false）。 */
const ASSISTANT_UPDATE_BASE = process.env.HARNESS_ASSISTANT_UPDATE_BASE || "https://ppz123.asia/cloud/assistant";
/** 工具链状态：探测随包/已下载的工具是否在位（发布形态 = 精简包 + 按需拉）。 */
function toolExists(rel: string): boolean {
  try { return fs.existsSync(path.join(app.getPath("userData"), "tools", rel)); } catch { return false; }
}
const RESERVED = (code: string, error: string) => ({ ok: false, reserved: true, code, error });

export const cloudReserveFeature = defineFeature<null>({
  id: "cloud",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("cloud-reserve: 缺少 ipc 服务（宿主未提供）");

    /* ── ① 数据同步（云端存储）—— **10-18 接真实现** ────────────────────────
       ⛔ 原来这 4 个是 `RESERVED("cloud-storage-not-enabled", …)` 的桩：永远返回"尚未开通"、
          一个字节都不传。接线后走 `runCloudSyncOnce` / `pullCloudSessions`（按行增量上传）。 */
    const syncDeps = () => ({
      codexHome: path.join(app.getPath("userData"), "codex-home"),
      stateFile: path.join(app.getPath("userData"), "sync", "state.json"),
      accountsBase: accountsBase(),
      /* ⛔ 这里回的是**云账号 token**（见文件头注释）：服务端 syncAuth 认它 ⇒ 未登录时为空 ⇒ 直接 not-paired */
      deviceToken: () => activeCredential()?.token || "",
      machineId: () => { try { return os.hostname(); } catch { return "unknown"; } },
    });

    ipcHost.handle("cloud:sync/status", async () => {
      const cr = activeCredential();
      if (!cr) return { enabled: false, reserved: false, quotaBytes: 0, usedBytes: 0, lastSyncAt: 0, sessions: 0, lines: 0 };
      let s = { sessions: 0, lines: 0 };
      try { s = readSyncSummary(syncDeps().stateFile); } catch { /* 首次运行没有游标文件 */ }
      return { enabled: true, reserved: false, quotaBytes: 0, usedBytes: 0, lastSyncAt: 0, sessions: s.sessions, lines: s.lines };
    });

    /* 10-18：给"勾选会话"弹窗用 —— 列出本地会话（只读，不写游标）。 */
    ipcHost.handle("cloud:sync/list", async () => {
      try {
        return { ok: true, sessions: listLocalSessions({ codexHome: path.join(app.getPath("userData"), "codex-home") }) };
      } catch (error) {
        return { ok: false, error: (error as Error).message.slice(0, 200), sessions: [] };
      }
    });

    ipcHost.handle("cloud:sync/push", async () => {
      if (!activeCredential()) return { ok: false, reserved: false, code: "not-logged-in", error: "未登录云账号" };
      try {
        const r = await runCloudSyncOnce(syncDeps());
        return r.ok
          ? { ok: true, reserved: false, pushedSessions: r.pushedSessions, pushedLines: r.pushedLines }
          : { ok: false, reserved: false, code: r.reason || "sync-failed", error: r.reason === "not-paired" ? "未登录云账号" : (r.reason || "上传失败") };
      } catch (error) {
        return { ok: false, reserved: false, code: "exception", error: (error as Error).message.slice(0, 200) };
      }
    });

    /* ⛔⛔ 第二个参数是 **`{ keys }` 对象**，不是数组 —— manifest 里 `invokeArgs: "input"`，
       preload 会把整个 input 对象作为实参传进来。原来写成 `keys?: string[]` + `Array.isArray(keys)`
       ⇒ 恒为 false ⇒ **勾选被静默忽略、永远下载全部**（审查抓到的真 bug）。 */
    ipcHost.handle("cloud:sync/pull", async (_event, input?: { keys?: string[] }) => {
      if (!activeCredential()) return { ok: false, reserved: false, code: "not-logged-in", error: "未登录云账号" };
      const keys = Array.isArray(input?.keys) ? input.keys : [];
      try {
        const r = await pullCloudSessions(syncDeps(), keys);
        return r.ok
          ? { ok: true, reserved: false, pulled: r.pulled }
          : { ok: false, reserved: false, code: r.reason || "pull-failed", error: r.reason || "下载失败" };
      } catch (error) {
        return { ok: false, reserved: false, code: "exception", error: (error as Error).message.slice(0, 200) };
      }
    });

    ipcHost.handle("cloud:sync/conflict/resolve", async (_event, key?: string, resolution?: string) => {
      void key; void resolution;
      /* ⛔ 冲突解决仍无实现（云助手侧也是桩）—— 如实说明，不假装成功。 */
      return RESERVED("conflict-not-implemented", "冲突解决尚未实现：目前按行追加，不产生冲突");
    });

    /* ── ② 设备/配对管理（真实现）─────────────────────────────────────────── */
    ipcHost.handle("cloud:device/list", async () => ({
      devices: readUsers().map((u) => ({
        name: u.name,
        createdAt: u.createdAt,
        tokenFingerprint: u.token.slice(0, 6),   // 只给指纹前 6 位：够辨认，不泄露凭据
      })),
    }));
    ipcHost.handle("cloud:device/unbind", async (_event, name?: string) => {
      const clean = String(name || "").trim();
      if (!clean) throw new Error("缺少设备/用户名");
      const users = readUsers();
      const next = users.filter((u) => u.name !== clean);
      if (next.length === users.length) throw new Error(`设备「${clean}」不存在`);
      writeUsers(next);
      return { ok: true, removed: clean, remaining: next.length };
    });

    /* ── ③ 公告/通知 ─────────────────────────────────────────────────────── */
    ipcHost.handle("cloud:notify/list", async () => ({
      notices: readNotices(),
      fetchedFromServer: false,   // 服务器公告拉取接入后置 true
    }));
    ipcHost.handle("cloud:notify/mark-read", async (_event, id?: string) => {
      const clean = String(id || "");
      if (!clean) throw new Error("缺少通知 id");
      const list = readNotices();
      const hit = list.find((n) => n.id === clean);
      if (!hit) throw new Error("通知不存在");
      hit.read = true;
      writeNotices(list);
      return { ok: true };
    });

    /* ── ④ 助手自更新 ────────────────────────────────────────────────────── */
    ipcHost.handle("cloud:update/check", async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`${ASSISTANT_UPDATE_BASE}/version.json?t=${Date.now()}`, { signal: controller.signal, cache: "no-store" });
        clearTimeout(timer);
        if (!res.ok) return { available: false, reason: `服务器 HTTP ${res.status}` };
        const meta = (await res.json()) as { version?: string; url?: string; notes?: string };
        const current = app.getVersion();
        const available = Boolean(meta.version) && meta.version !== current;
        return { available, current, latest: meta.version || "", url: meta.url || "", notes: meta.notes || "" };
      } catch (error) {
        return { available: false, reason: `探测失败：${(error as Error).message.slice(0, 80)}` };
      }
    });
    ipcHost.handle("cloud:update/download", async () =>
      RESERVED("update-download-not-wired", "下载器未接线：check 的 url 字段已预留，接下载器即通"));
    ipcHost.handle("cloud:update/apply", async () =>
      RESERVED("update-apply-not-wired", "生效器未接线（下载完成后替换 + 重启）"));

    /* ── ⑤ 工具链按需下载 ────────────────────────────────────────────────── */
    ipcHost.handle("cloud:tools/status", async () => ({
      tools: [
        { name: "node", label: "Node 运行时（MCP/脚本）", ready: toolExists(path.join("node", "node.exe")) || toolExists(path.join("node", "node")) },
        { name: "python", label: "Python（脚本/数据处理）", ready: toolExists(path.join("python", "python.exe")) || toolExists("python") },
        { name: "rg", label: "ripgrep（代码搜索）", ready: toolExists(path.join("rg", "rg.exe")) || toolExists("rg") },
      ],
      mode: "on-demand",   // 发布形态（用户定稿）：精简包 + 按需下载，不全量内置
    }));
    ipcHost.handle("cloud:tools/download", async (_event, name?: string) => {
      void name;
      return RESERVED("tool-mirror-not-configured", "工具镜像未配置：服务器 /cloud/tools/ 分发目录就绪后即通");
    });
    ipcHost.handle("cloud:tools/progress", async (_event, name?: string) => {
      void name;
      return { running: false, bytes: 0, total: 0, error: null };
    });

    ctx.effect(() => {
      for (const ch of CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
