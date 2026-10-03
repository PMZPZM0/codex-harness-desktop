/**
 * bot-stream-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：bot-stream(2)
 * 通道：bot-stream:get / bot-stream:set（机器人消息流的推送开关：启用 / 思考 / 工具）
 *
 * 口径唯一真相源 = `../bot-stream`（读写与归一化都在那里），本域只做 IPC 面。
 */
import { readBotStreamSettings, writeBotStreamSettings } from "../bot-stream";
import type { BotStreamSettings } from "../bot-stream";
import { botStreamFile } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const botStreamFeature = defineFeature<null>({
  id: "bot-stream",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("bot-stream: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("bot-stream:get", async () => readBotStreamSettings(botStreamFile));
    ipcHost.handle("bot-stream:set", async (_event, input: BotStreamSettings) => {
      const settings = { enabled: Boolean(input?.enabled), thinking: Boolean(input?.thinking), tools: Boolean(input?.tools) };
      await writeBotStreamSettings(botStreamFile, settings);
      return settings;
    });

    ctx.effect(() => {
      ipcHost.removeHandler("bot-stream:get");
      ipcHost.removeHandler("bot-stream:set");
    });
  },
});
