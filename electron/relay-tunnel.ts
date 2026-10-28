/**
 * 手机远控的**内置隧道**（10-29）：让任意用户装完就能用，不再人工装 frpc。
 *
 * 链路：手机 → 中转网关（服务器） → WebSocket → 本模块 → 本机远控服务（127.0.0.1:端口）。
 *
 * 身份：首次运行生成 `relay-device.json`（10 位设备 ID + 64 位令牌，存在 userData）。
 *   ⛔ ID 必须稳定（重启不变），手机靠它找到这台电脑；令牌只用来证明“我是这台”。
 *   ⛔ 网关做 TOFU 绑定：ID 第一次出现时记下令牌哈希，之后不一致就拒（防冒用 ID）。
 *
 * 状态：offline / connecting / online，供远控设置页显示与二维码生成使用
 *   （离线时二维码退回旧通道/临时隧道，不让用户扫到一个死地址）。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import WebSocket from "ws";

export type RelayState = "offline" | "connecting" | "online";
export type RelayStatus = { state: RelayState; id: string; base: string; publicBase: string; error: string; since: number };

type Options = {
  /** userData 目录（存 relay-device.json） */
  userData: string;
  /** 本机远控端口（每次取最新值：端口可被 remote-port.txt 覆盖） */
  localPort: () => number;
  /** 中转站根地址，如 https://remote.ppz123.asia（⛔ 不带 /t/<id>） */
  relayBase: () => string;
  onStatus?: (status: RelayStatus) => void;
};

const DEVICE_FILE = "relay-device.json";

function readIdentity(file: string): { id: string; token: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (/^[a-z0-9]{10}$/.test(String(raw?.id ?? "")) && String(raw?.token ?? "").length >= 32) {
      return { id: String(raw.id), token: String(raw.token) };
    }
  } catch { /* 没有或损坏：重建 */ }
  const id = crypto.randomBytes(8).toString("hex").slice(0, 10);
  const token = crypto.randomBytes(32).toString("hex");
  try { fs.writeFileSync(file, JSON.stringify({ version: 1, id, token }, null, 2)); } catch { /* 写不了就本次用内存值 */ }
  return { id, token };
}

export class RelayTunnel {
  private readonly file: string;
  private readonly identity: { id: string; token: string };
  private ws: any = null;
  private stopped = true;
  private retryTimer: any = null;
  private backoff = 2000;
  private status: RelayStatus;

  constructor(private readonly options: Options) {
    this.file = path.join(options.userData, DEVICE_FILE);
    this.identity = readIdentity(this.file);
    this.status = { state: "offline", id: this.identity.id, base: "", publicBase: "", error: "", since: Date.now() };
  }

  getStatus(): RelayStatus { return this.status; }
  deviceId(): string { return this.identity.id; }

  /** 在线时的公网前缀（https://…/t/<id>）；离线返回空串（调用方据此退回旧通道） */
  publicBase(): string {
    return this.status.state === "online" ? this.status.publicBase : "";
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    try { this.ws?.close(); } catch { /* 忽略 */ }
    this.ws = null;
    this.setStatus("offline", "");
  }

  private setStatus(state: RelayState, error: string): void {
    const base = this.options.relayBase().replace(/\/+$/, "");
    this.status = { state, id: this.identity.id, base, publicBase: base ? `${base}/t/${this.identity.id}` : "", error, since: Date.now() };
    try { this.options.onStatus?.(this.status); } catch { /* 忽略 */ }
  }

  private connect(): void {
    if (this.stopped) return;
    const base = this.options.relayBase().replace(/\/+$/, "");
    if (!base) { this.setStatus("offline", "未配置中转地址"); return; }
    /* ⛔ 令牌不进查询串（会进服务器访问日志）：连上后第一帧 hello 里带 */
    const wsUrl = `${base.replace(/^http/i, "ws")}/tunnel?id=${encodeURIComponent(this.identity.id)}`;
    this.setStatus("connecting", "");
    let ws: any;
    try { ws = new WebSocket(wsUrl); } catch (error: any) { this.scheduleRetry(String(error?.message ?? error)); return; }
    this.ws = ws;
    let alive = true;

    ws.on("open", () => {
      this.backoff = 2000;
      try { ws.send(JSON.stringify({ type: "hello", token: this.identity.token })); } catch { /* 忽略 */ }
      this.setStatus("connecting", "");
      const ping = setInterval(() => {
        if (!alive) { try { ws.terminate(); } catch { /* 忽略 */ } return; }
        alive = false;
        try { ws.ping(); } catch { /* 忽略 */ }
      }, 25_000);
      ws.on("pong", () => { alive = true; });
      ws.on("close", () => clearInterval(ping));
    });

    ws.on("message", (raw: any) => { void this.onFrame(raw); });
    ws.on("error", (error: any) => { this.lastError = String(error?.message ?? error); });
    ws.on("close", (code: number) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      this.scheduleRetry(this.lastError || `连接已断开（${code || "?"}）`);
      this.lastError = "";
    });
  }

  private lastError = "";

  private scheduleRetry(reason: string): void {
    if (this.stopped) return;
    this.setStatus("offline", reason);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.connect(); }, this.backoff);
    this.backoff = Math.min(30_000, this.backoff * 2);
  }

  private async onFrame(raw: any): Promise<void> {
    let frame: any;
    try { frame = JSON.parse(String(raw)); } catch { return; }
    if (frame?.type === "ready") { this.setStatus("online", ""); return; }
    if (frame?.type === "req") {
      const reqId = String(frame.reqId ?? "");
      try {
        const response = await this.forward(frame);
        this.send({ type: "res", reqId, ...response });
      } catch (error: any) {
        this.send({ type: "reserr", reqId, error: String(error?.message ?? error) });
      }
    }
  }

  private send(frame: any): void {
    try { this.ws?.send(JSON.stringify(frame)); } catch { /* 连接已断：等重连 */ }
  }

  /** 把网关转来的请求打到本机远控服务（127.0.0.1:端口），原样带回状态/头/体 */
  private forward(frame: any): Promise<{ status: number; headers: Record<string, any>; body: string }> {
    return new Promise((resolve, reject) => {
      const body = frame.body ? Buffer.from(String(frame.body), "base64") : Buffer.alloc(0);
      const headers: Record<string, any> = { ...(frame.headers ?? {}) };
      /* 本机服务的 Host 校验不敏感，但去掉网关的 host 更干净 */
      headers.host = `127.0.0.1:${this.options.localPort()}`;
      const req = http.request({
        host: "127.0.0.1",
        port: this.options.localPort(),
        method: String(frame.method || "GET"),
        path: String(frame.path || "/"),
        headers,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => resolve({
          status: res.statusCode ?? 502,
          headers: res.headers as Record<string, any>,
          body: Buffer.concat(chunks).toString("base64"),
        }));
      });
      req.on("error", reject);
      req.setTimeout(30_000, () => req.destroy(new Error("本机服务响应超时")));
      req.end(body);
    });
  }
}
