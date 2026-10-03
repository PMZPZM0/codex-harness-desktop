/**
 * bot-binding-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：bot-binding(2)
 * 通道：bot-binding:get / bot-binding:set（渠道 ↔ 会话 的绑定关系）
 *
 * ⛔ 绑定前的**预验证**（先 `thread/resume` 一次）不能省：否则发消息时 resume 失败会被自动重置回
 *    新会话，表现为「选了老会话又被弹回去」—— 这个症状排查成本很高，别当冗余逻辑删掉。
 * ⛔ 解绑要同步清 per-user 缓存（weixinBindings / telegramBindings），否则下一条消息还会走旧会话。
 * ⛔ 共享可变状态 `channelBotBindings` / `weixinBindings` / `telegramBindings` 来自基座层
 *    `./im-gateways`（活绑定），多个 IM 板块各自 import 到的是**同一个对象** ⇒ 拆分不改变行为。
 */
import { channelBotBindings, loadBotBindings, telegramBindings, weixinBindings, writeBotBindings } from "./im-gateways";
import { server } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const botBindingFeature = defineFeature<null>({
  id: "bot-binding",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("bot-binding: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("bot-binding:get", async () => { await loadBotBindings(); return channelBotBindings; });
    ipcHost.handle("bot-binding:set", async (_e, input: { channel: string; threadId: string | null; title?: string }) => {
      await loadBotBindings();
      const key = ["wechat", "telegram", "feishu", "dingtalk", "qq"].includes(String(input?.channel)) ? String(input.channel) : "wechat";
      if (input?.threadId) {
        // 预验证：绑定前先 resume 一次，确认该会话真实可用——否则发消息时 resume 失败
        // 会被自动重置回新会话，表现为「选了老会话又被弹回去」
        try {
          await server.request("thread/resume", { threadId: String(input.threadId), excludeTurns: false });
        } catch (error: any) {
          throw new Error(`该会话无法恢复（${String(error?.message ?? error).slice(0, 80)}），请换一个会话，或先在主界面打开它确认存在`);
        }
        channelBotBindings[key] = { threadId: String(input.threadId), title: String(input.title ?? ""), updatedAt: Date.now() };
      } else {
        channelBotBindings[key] = null;
        // 解绑：同步清 per-user 缓存，保证下一条消息开新会话
        if (key === "wechat") { for (const [k] of [...weixinBindings]) if (!k.startsWith("tg:")) weixinBindings.delete(k); }
        else if (key === "telegram") { for (const [k] of [...weixinBindings]) if (k.startsWith("tg:")) weixinBindings.delete(k); telegramBindings.clear(); }
        else { const prefix = { feishu: "fs:", dingtalk: "dd:", qq: "qq:" }[key] ?? ""; if (prefix) for (const [k] of [...weixinBindings]) if (k.startsWith(prefix)) weixinBindings.delete(k); }
      }
      await writeBotBindings();
      return channelBotBindings[key];
    });

    ctx.effect(() => {
      ipcHost.removeHandler("bot-binding:get");
      ipcHost.removeHandler("bot-binding:set");
    });
  },
});
