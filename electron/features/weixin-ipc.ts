/**
 * weixin-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：weixin(6)
 * 通道：weixin:start-login / weixin:poll-login / weixin:cancel-login / weixin:status / weixin:send / weixin:logout
 *
 * ⛔ 二维码归一化逻辑不能简化：iLink 的 `qrcode_img_content` 格式不固定（裸 base64 图片 /
 *    data URL / 二维码内容文本短链），必须统一成渲染端可直接用的形式 —— 否则裸 base64 被当成
 *    HTML 注入，表现为**二维码区域白屏**（现象看着像"登录坏了"，实际是格式问题）。
 * ⛔ 09-27 加的 `weixin:send` 是**主动推送**通道（给 agent 与调度投递用）：此前 weixin 只有登录态
 *    通道，agent 想推消息没工具。`to` 缺省 = 最近对话用户（iLink 正文气泡依赖 context_token）。
 */
import { channelBotBindings, weixinGateway, writeBotBindings } from "./im-gateways";
import { qrSvg } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const weixinFeature = defineFeature<null>({
  id: "weixin",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("weixin: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("weixin:start-login", async () => {
      const result = await weixinGateway?.startLogin();
      if (!result?.qrcodeImg) return result;
      // iLink 的 qrcode_img_content 格式不固定：可能是裸 base64 图片、data URL 图片、
      // 或二维码内容文本（liteapp.weixin.qq.com/... 短链）。统一归一化成渲染端可直接
      // 使用的形式，避免裸 base64 被当成 HTML 注入导致二维码区域白屏：
      //   data:image → 原样返回（<img> 直接显示）
      //   裸 base64 图片 → 补 data:image/png;base64, 前缀（浏览器会嗅探真实格式）
      //   http URL / 短文本 → 内容文本，编码成 SVG 码
      const raw = String(result.qrcodeImg).trim();
      const compact = raw.replace(/\s+/g, "");
      const isBareB64 = compact.length > 64 && /^[A-Za-z0-9+/=]+$/.test(compact);
      const qr = raw.startsWith("data:")
        ? raw
        : isBareB64
          ? `data:image/png;base64,${compact}`
          : await qrSvg(raw);
      return { ...result, qrcodeImg: qr };
    });
    ipcHost.handle("weixin:poll-login", async () => weixinGateway?.pollLogin());
    ipcHost.handle("weixin:cancel-login", async () => {
      const gateway = weixinGateway as { cancelLogin?: () => Promise<void> | void } | null;
      try { await gateway?.cancelLogin?.(); } catch { /* 网关无 cancelLogin 时忽略 */ }
      return { ok: true };
    });
    ipcHost.handle("weixin:status", async () => ({ bound: weixinGateway?.hasSession() ?? false }));
    // 09-27：主动推送通道（给 agent 与调度投递用）——此前 weixin 域只有登录态 5 通道，agent 想推消息没工具。
    // to 缺省 = 最近对话用户（iLink 正文气泡依赖 context_token，「最近发过消息的人」最可靠）。
    ipcHost.handle("weixin:send", async (_event, input: { to?: string; text: string }) => {
      const text = String(input?.text ?? "");
      if (!text.trim()) throw new Error("发送内容不能为空");
      if (!weixinGateway) throw new Error("微信机器人未初始化");
      if (!weixinGateway.hasSession()) throw new Error("微信机器人未登录（设置 → 机器人管理 扫码绑定）");
      const to = typeof input?.to === "string" && input.to.trim() ? input.to.trim() : undefined;
      if (to) await weixinGateway.sendText(to, text);
      else await weixinGateway.sendToBoundUser(text);
      return { ok: true };
    });
    ipcHost.handle("weixin:logout", async () => { await weixinGateway?.logout(); channelBotBindings.wechat = null; await writeBotBindings(); return { ok: true }; });

    ctx.effect(() => {
      for (const ch of ["weixin:start-login", "weixin:poll-login", "weixin:cancel-login", "weixin:status", "weixin:send", "weixin:logout"]) {
        ipcHost.removeHandler(ch);
      }
    });
  },
});
