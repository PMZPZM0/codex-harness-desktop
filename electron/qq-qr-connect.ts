/** QQ 机器人官方扫码连接（协议实现，不再依赖 @tencent-connect/qqbot-connector 包）。
 * 流程：桌面出二维码 → 手机 QQ（开放平台上该机器人的管理者账号）扫码确认 →
 * 官方回传加密凭据 → 本地 AES-256-GCM 解密得到 AppID/AppSecret → 调用方走正常连接链路。
 *
 * 为什么内联协议而不是用官方 npm 包（09-09 实证）：
 * 1. 官方包 CJS 构建损坏（dist/cjs/index.js require './qr-connect.js' 解析失败），只能走 ESM；
 * 2. 本工程 electron/tsconfig.json 为 module:CommonJS，`await import()` 会被转译成 require，
 *    同样撞上坏 CJS；用 new Function 包 ESM 动态导入虽可绕开编译期，但打包成 asar 后
 *    裸 specifier 解析有挂起风险（实测 UI 二维码区无限转圈）——干脆不引包，协议只有
 *    create_bind_task / poll_bind_result 两个接口 + AES-256-GCM 解密，内联最稳，还能带超时与错误上报。
 *
 * 协议对照官方 SDK（dist/esm/qqbot-session.js）：
 * - POST https://q.qq.com/lite/create_bind_task  { key: 32B base64 }        → { task_id }
 * - 二维码 URL：https://q.qq.com/qqbot/openclaw/connect.html?task_id=..&_wv=2
 * - POST https://q.qq.com/lite/poll_bind_result  { task_id }                → { status, bot_appid, bot_encrypt_secret, user_openid }
 *   status: 0=NONE 1=PENDING 2=COMPLETED 3=EXPIRED
 * - 解密：AES-256-GCM，key=32B base64，密文布局 iv(12B) + data + authTag(16B)
 * 注意：扫码授权成功后腾讯会重置该机器人的 AppSecret，旧密钥立即失效（官方文档明示）。 */

import * as https from "node:https";
import { createDecipheriv, randomBytes } from "node:crypto";

export type QqQrState = "idle" | "waiting" | "connected" | "failed";

export type QqQrSnapshot = {
  state: QqQrState;
  /** 二维码 SVG（由主进程用官方 qrcode 包渲染，二维码过期刷新时自动更新） */
  qr?: string;
  /** 连接成功后的机器人名 */
  name?: string;
  error?: string;
};

type ConnectFn = (appId: string, appSecret: string) => Promise<{ name?: string }>;

let stopFn: (() => void) | null = null;
let abortController: AbortController | null = null;
let snapshot: QqQrSnapshot = { state: "idle" };
/** 二维码刷新序号：防止旧 URL 的 SVG 异步生成完覆盖新码 */
let qrSeq = 0;

export function qqQrSnapshot(): QqQrSnapshot {
  return snapshot;
}

/** POST JSON 到 q.qq.com，10s 超时（与官方 SDK 默认一致） */
function postJson(path: string, body: Record<string, string>, timeoutMs = 10_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "q.qq.com",
        path,
        method: "POST",
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} from ${path}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`请求 q.qq.com${path} 超时（${timeoutMs}ms），请检查网络后重试`));
    });
    req.end(payload);
  });
}

/** 创建绑定任务：key 是本次会话的 32B base64 密钥，二维码页只带 task_id，凭据加密后经轮询接口下发 */
async function createBindTask(): Promise<{ taskId: string; key: string }> {
  const key = randomBytes(32).toString("base64");
  const json = await postJson("/lite/create_bind_task", { key });
  if (json?.retcode !== 0) throw new Error(json?.msg ?? "create_bind_task 失败");
  if (!json.data?.task_id) throw new Error("create_bind_task 未返回 task_id");
  return { taskId: String(json.data.task_id), key };
}

/** AES-256-GCM 解密官方下发的加密凭据（布局：iv(12) + data + authTag(16)） */
function decryptSecret(encBase64: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  const buf = Buffer.from(encBase64, "base64");
  if (buf.length < 28) throw new Error("凭据密文过短");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]).toString("utf8");
}

function buildConnectUrl(taskId: string): string {
  return `https://q.qq.com/qqbot/openclaw/connect.html?task_id=${encodeURIComponent(taskId)}&_wv=2`;
}

/** 启动扫码流程。connect / qrSvg 由调用方注入（main.ts 接 qqGateway.connect 与官方 qrcode 渲染）。
 * 二维码过期会自动创建新任务并重新出码（onQrDisplayed 再次回调），直到扫码成功或主动取消。 */
export async function qqQrStart(
  connect: ConnectFn,
  qrSvg: (text: string) => Promise<string>,
): Promise<QqQrSnapshot> {
  qqQrCancel();
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

  // 单轮：建任务 → 出码 → 轮询。EXPIRED 重新建任务（返回 false），COMPLETED/失败返回 true
  const runOnce = async (): Promise<boolean> => {
    let task: { taskId: string; key: string };
    try {
      task = await createBindTask();
    } catch (error: any) {
      fail(error?.message ?? "获取绑定任务失败，请检查网络");
      return true;
    }
    // 首码等待渲染完成再进入轮询：qqQrStart 返回的快照就能带上 qr，
    // 前端不会卡在无码转圈（此前 emitQr 异步渲染慢于 return snapshot，竞态）。
    await emitQr(buildConnectUrl(task.taskId));
    for (;;) {
      if (signal.aborted) return true;
      let json: any;
      try {
        json = await postJson("/lite/poll_bind_result", { task_id: task.taskId });
      } catch {
        // 轮询单次失败静默重试（官方 SDK 同款行为），2s 后再试
        await sleep(2000, signal);
        continue;
      }
      const status = json?.data?.status ?? 0;
      if (status === 2) {
        // COMPLETED：解密凭据 → 走正常连接
        const appId = String(json.data.bot_appid ?? "");
        let appSecret: string;
        try {
          appSecret = decryptSecret(String(json.data.bot_encrypt_secret ?? ""), task.key);
        } catch (error: any) {
          fail(error?.message ?? "凭据解密失败，请重试");
          return true;
        }
        if (!appId || !appSecret) {
          fail("扫码成功但未返回凭据，请重试");
          return true;
        }
        try {
          const result = await connect(appId, appSecret);
          snapshot = { state: "connected", name: result?.name ?? "QQ 机器人" };
        } catch (error: any) {
          fail(error?.message ?? "凭据有效但连接失败，请重试");
        }
        finish();
        return true;
      }
      if (status === 3) return false; // EXPIRED：重新建任务出新码
      await sleep(2000, signal);
    }
  };

  stopFn = () => abortController?.abort();
  void (async () => {
    while (!signal.aborted) {
      const done = await runOnce();
      if (done) return;
    }
  })();
  return snapshot;
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
export function qqQrCancel(): void {
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
