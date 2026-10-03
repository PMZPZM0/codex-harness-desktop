// soul-market 域（SkillHub 人格市场）—— 独立板块，**一个文件只承载一个域前缀**。
// 2026-10-01 立项（用户令）：人格装进 personalization.json 的 persona 字段、随 AGENTS.md 生效
// （引擎每会话重读，即生效）。
// ⛔ 10-03 P2 批次 8：从合并文件 `skillhub-markets-ipc.ts` 拆出（见 expert-market-ipc.ts 的说明）。
//   人格读写全走 `skillhub-souls`，本域与专家市场域**零共享符号** ⇒ 拆得干净、不需要公共 helper。
import { codexHome } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { listSkillHubSouls, getSkillHubSoul, currentSkillHubSoul, applySkillHubSoul, resetSkillHubSoul } from "../skillhub-souls";

export const soulMarketFeature = defineFeature<null>({
  id: "soul-market",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    // inject 已在容器侧挡过一次；这里再挡一次只为把类型收紧（⛔ 不写 `!`：缺依赖要报得出来）
    if (!ipcHost) throw new Error("soul-market: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("soul-market:list", () => listSkillHubSouls());
    ipcHost.handle("soul-market:get", (_event, input: { slug: string }) => getSkillHubSoul(String(input?.slug ?? "")));
    ipcHost.handle("soul-market:current", () => currentSkillHubSoul());
    ipcHost.handle("soul-market:apply", async (_event, input: { slug: string | null }) => {
      if (input?.slug == null) {
        await resetSkillHubSoul(codexHome);
        return { slug: "", displayName: "" };
      }
      return applySkillHubSoul(String(input.slug), codexHome);
    });

    // 生命期：卸载时摘掉本域四条通道（人格数据留在 personalization.json，不随卸载销毁 —— 那是用户数据）
    ctx.effect(() => {
      ipcHost.removeHandler("soul-market:list");
      ipcHost.removeHandler("soul-market:get");
      ipcHost.removeHandler("soul-market:current");
      ipcHost.removeHandler("soul-market:apply");
    });
  },
});
