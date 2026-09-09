/**
 * 飞书扫码连接（Device Authorization Flow，复刻 ZCode）：
 * 用户扫二维码 → 飞书自动创建应用并授权 → 回传 client_id/client_secret → 走正常连接链路。
 * 用户全程零手工配置（无需去开放平台手动建应用）。
 *
 * 协议（自 ZCode 主 bundle 反编译核对）：
 * - 端点：国内 https://accounts.feishu.cn，海外 lark https://accounts.larksuite.com
 *   （轮询发现授权账号属 lark 域时自动切域继续轮询）
 * - POST /oauth/v1/app/registration，x-www-form-urlencoded：
 *     { action: "init" }                              → { supported_auth_methods }
 *     { action: "begin", archetype: "PersonalAgent",
 *       auth_method: "client_secret",
 *       request_user_info: "open_id" }                → { device_code, verification_uri_complete,
 *                                                       user_code?, expire_in?, interval? }
 *     { action: "poll", device_code }                 → pending / slow_down / access_denied /
 *                                                       expired_token / 成功 { client_id, client_secret,
 *                                                       user_info: { open_id, tenant_brand } }
 * - 成功后凭据走标准链路：tenant_access_token + WebSocket 长连接。
 */
const ACCOUNTS_FEISHU = "https://accounts.feishu.cn";
const ACCOUNTS_LARK = "https://accounts.larksuite.com";
const REGISTRATION_PATH = "/oauth/v1/app/registration";
const UA = "node-sdk/zcode";

export type FeishuQrState = "idle" | "waiting" | "connected" | "failed";
export type FeishuQrSnapshot = {
  state: FeishuQrState;
  /** 二维码 SVG（主进程渲染，内容为 verification_uri_complete） */
  qr?: string;
  /** 展示用用户码（用户也可手动打开链接输入） */
  userCode?: string;
  /** 连接成功后的应用名 */
  name?: string;
  error?: string;
};

type ConnectFn = (appId: string, appSecret: string) => Promise<{ name?: string }>;

let stopFn: (() => void) | null = null;
let abortController: AbortController | null = null;
let snapshot: FeishuQrSnapshot = { state: "idle" };
/** 二维码刷新序号：防止旧 URL 的 SVG 异步生成完覆盖新码 */
let qrSeq = 0;

export function feishuQrSnapshot(): FeishuQrSnapshot {
  return snapshot;
}

async function postRegistration(domain: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${domain}${REGISTRATION_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`飞书注册接口 HTTP ${res.status}`);
  return res.json();
}

function accountsBase(domain: string): string {
  return domain === "lark" ? ACCOUNTS_LARK : ACCOUNTS_FEISHU;
}

/** begin：发起设备授权，返回设备码与二维码链接 */
async function beginRegistration(domain: string): Promise<{ deviceCode: string; qrUrl: string; userCode: string; interval: number; expiresAt: number }> {
  const init = await postRegistration(accountsBase(domain), { action: "init" });
  if (!(init.supported_auth_methods ?? []).includes("client_secret")) {
    throw new Error("当前飞书环境不支持 client_secret 注册，请改用手动填 AppID/Secret");
  }
  const begin = await postRegistration(accountsBase(domain), {
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id",
  });
  if (!begin.device_code || !begin.verification_uri_complete) {
    throw new Error("飞书未返回设备码，请稍后重试");
  }
  // 追加来源参数（对齐官方 SDK 约定）
  const url = new URL(begin.verification_uri_complete);
  url.searchParams.set("from", "sdk");
  url.searchParams.set("source", UA);
  url.searchParams.set("tp", "sdk");
  const interval = begin.interval ?? 5;
  return {
    deviceCode: begin.device_code,
    qrUrl: url.toString(),
    userCode: begin.user_code ?? "",
    interval,
    expiresAt: Date.now() + (begin.expire_in ?? 600) * 1000,
  };
}

/** poll 单次：解析授权状态机（含 feishu→lark 自动切域） */
async function pollOnce(domain: string, deviceCode: string): Promise<{ status: "pending" | "success" | "access_denied" | "expired" | "error" | "switch"; interval?: number; domain?: string; pollDomain?: string; appId?: string; appSecret?: string; appName?: string; openId?: string; message?: string }> {
  const json = await postRegistration(accountsBase(domain), { action: "poll", device_code: deviceCode });
  const brand = json.user_info?.tenant_brand ?? domain;
  if (json.user_info?.tenant_brand === "lark" && domain !== "lark") {
    return { status: "switch", domain: "lark", pollDomain: "lark" };
  }
  if (json.client_id && json.client_secret) {
    const appName = json.app_name?.trim() || json.client_name?.trim() || json.name?.trim() || json.app?.app_name?.trim() || json.app?.name?.trim() || undefined;
    return { status: "success", appId: String(json.client_id), appSecret: String(json.client_secret), domain: brand, appName, openId: json.user_info?.open_id };
  }
  if (!json.error || json.error === "authorization_pending") return { status: "pending", interval: 5, domain: brand };
  if (json.error === "slow_down") return { status: "pending", interval: 10, domain: brand };
  if (json.error === "access_denied") return { status: "access_denied", domain: brand };
  if (json.error === "expired_token") return { status: "expired", domain: brand };
  return { status: "error", message: `${json.error}: ${json.error_description ?? "unknown"}`, domain: brand };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => resolve(), ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** 中止扫码轮询；waiting 态回 idle，已成功/失败的结果保留供查询 */
export function feishuQrCancel(): void {
  qrSeq++;
  try {
    stopFn?.();
    abortController?.abort();
  } catch {
    /* 清理失败不影响主流程 */
  }
  stopFn = null;
  abortController = null;
  if (snapshot.state === "waiting") snapshot = { state: "idle" };
}

/** 启动扫码流程。connect/qrSvg 由调用方注入（main.ts 接飞书网关与 qrcode 渲染）。
 * 授权过期自动重新出码，直到扫码成功或主动取消。首码渲染完成后才返回。 */
export async function feishuQrStart(
  connect: ConnectFn,
  qrSvg: (text: string) => Promise<string>,
): Promise<FeishuQrSnapshot> {
  feishuQrCancel();
  qrSeq = 0;
  snapshot = { state: "waiting" };
  abortController = new AbortController();
  const signal = abortController.signal;

  const finish = () => {
    stopFn?.();
    stopFn = null;
    abortController = null;
  };
  const fail = (message: string) => {
    if (snapshot.state === "waiting") snapshot = { state: "failed", error: message };
    finish();
  };
  const emitQr = async (url: string) => {
    const my = ++qrSeq;
    try {
      const svg = await qrSvg(url);
      if (my === qrSeq && snapshot.state === "waiting") snapshot = { ...snapshot, qr: svg };
    } catch {
      if (my === qrSeq && snapshot.state === "waiting") snapshot = { ...snapshot, error: "二维码渲染失败，请重试" };
    }
  };

  stopFn = () => abortController?.abort();
  void (async () => {
    let domain = "feishu";
    try {
      while (!signal.aborted) {
        // begin：出码（过期重来）
        let session: Awaited<ReturnType<typeof beginRegistration>>;
        try {
          session = await beginRegistration(domain);
        } catch (error: any) {
          fail(error?.message ?? "发起飞书授权失败，请检查网络");
          return;
        }
        await emitQr(session.qrUrl);
        if (snapshot.state === "failed") { finish(); return; }
        // poll：等授权
        let pollDomain = domain;
        for (;;) {
          if (signal.aborted) { finish(); return; }
          if (Date.now() > session.expiresAt) break; // 过期 → 重出码
          let result: Awaited<ReturnType<typeof pollOnce>>;
          try {
            result = await pollOnce(pollDomain, session.deviceCode);
          } catch {
            await sleep(session.interval * 1000, signal);
            continue;
          }
          if (result.status === "switch") { pollDomain = result.pollDomain ?? "lark"; await sleep(2000, signal); continue; }
          if (result.status === "pending") { await sleep((result.interval ?? 5) * 1000, signal); continue; }
          if (result.status === "expired") break; // 重出码
          if (result.status === "access_denied") { fail("你在飞书里拒绝了授权，请重试"); return; }
          if (result.status === "error") { fail(result.message ?? "飞书授权失败"); return; }
          // success：拿凭据连 bot
          try {
            const result2 = await connect(result.appId!, result.appSecret!);
            snapshot = { state: "connected", name: result2?.name ?? result.appName ?? "飞书机器人" };
          } catch (error: any) {
            fail(error?.message ?? "凭据有效但连接失败，请重试");
            return;
          }
          finish();
          return;
        }
      }
    } catch (error: any) {
      fail(error?.message ?? "飞书扫码流程异常");
    }
  })();
  return snapshot;
}
