// SkillHub 两个新市场的 IPC 域：expert-market（专家市场包）+ soul-market（人格市场）。
// 2026-10-01 立项（用户令）：① 专家包装完在专家中心新增对应专家卡片；② 人格装进
// personalization.json 的 persona 字段、随 AGENTS.md 生效（引擎每会话重读，即生效）。
// ⛔ userSkillsDir 不从 main 引（【132】棘轮只许降不许升）——它就是 codexHome/skills，
//   从 runtime-refs 的 codexHome 派生（与 main.ts:856 同源）；refreshSkillDiscipline
//   直连来源模块 main/12-skill-discipline（守卫 132 认可的「直连真正来源」路径）。
//
// ── P2 批次 4（10-03）：一个文件 = 两个插件 ─────────────────────────────────
// 这个文件承载**两个域前缀**，因此导出**两个** `defineFeature`，组合表里对应**两行**
// （同一 file、不同 export、不同 id）。⛔ 这是本项目对「一行多前缀」的定论：
// **一行恒等于一个前缀** —— 组合表的 id 就是挂载身份（重复挂载靠它挡），
// 一行挂两个前缀会让 `mountFeature` 的身份校验与 `ipc-registry` 的 prefix 对不上账。
import path from "node:path";
import { codexHome, server } from "../runtime-refs";
import { sendToWindow } from "./window-bus";
import { refreshSkillDiscipline } from "../main/12-skill-discipline";
import { defineFeature } from "../context";
import type { Context } from "../context";
import type { IpcHost } from "../ipc-host";
import { listSkillHubSkillsets, installSkillHubSkillset } from "../skillhub-packages";
import { listSkillHubSouls, getSkillHubSoul, currentSkillHubSoul, applySkillHubSoul, resetSkillHubSoul } from "../skillhub-souls";

// ⛔ 惰性求值（handler 调用时再取）：模块顶层读 codexHome 会拿到初始化前的值，路径漂移成
// 进程 cwd 下的 skills/ —— 实测技能包被装进 D:/Codex Harness Desktop/skills/（10-01 用户反馈
// 「市场里不显示已安装」的根因，AGENTS.md 【91】同型坑）。
const userSkillsDir = () => path.join(codexHome, "skills");

/** 取容器注入的 ipc 服务（缺了要报得出来，⛔ 不用 `!` 糊过去）。 */
function needIpc(ctx: Context, domain: string): IpcHost {
  const ipcHost = ctx.get<IpcHost>("ipc");
  if (!ipcHost) throw new Error(`${domain}: 缺少 ipc 服务（宿主未提供）`);
  return ipcHost;
}

// ── 专家市场包（expert-market）─────────────────────────────────────────────
export const expertMarketFeature = defineFeature<null>({
  id: "expert-market",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = needIpc(ctx, "expert-market");

    ipcHost.handle("expert-market:list", (_event, input: { page?: number; pageSize?: number; query?: string } = {}) => listSkillHubSkillsets(input));

    ipcHost.handle("expert-market:install", async (_event, input: { slug: string }) => {
      const emit = (stage: string, message: string) => sendToWindow("harness:event", { type: "expert-install", skillsetId: String(input?.slug ?? ""), stage, message, at: Date.now() });
      const result = await installSkillHubSkillset({
        slug: String(input?.slug ?? ""),
        destinationRoot: userSkillsDir(),
        onProgress: (stage, message) => emit(stage, message),
      });
      // 技能落盘后重启引擎（与技能市场安装同链）；守则区间的技能清单一并刷新
      emit("engine", "正在重启 Codex 引擎并注册技能");
      await server.restart();
      void refreshSkillDiscipline();
      emit("complete", `已安装「${result.displayName}」，专家中心已新增对应专家卡片（${result.installedChildren.length} 个子技能${result.childFailures.length ? `，${result.childFailures.length} 个未跟上` : ""}）`);
      return result;
    });

    ctx.effect(() => {
      ipcHost.removeHandler("expert-market:list");
      ipcHost.removeHandler("expert-market:install");
    });
  },
});

// ── 人格市场（soul-market）─────────────────────────────────────────────────
export const soulMarketFeature = defineFeature<null>({
  id: "soul-market",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = needIpc(ctx, "soul-market");

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

    ctx.effect(() => {
      ipcHost.removeHandler("soul-market:list");
      ipcHost.removeHandler("soul-market:get");
      ipcHost.removeHandler("soul-market:current");
      ipcHost.removeHandler("soul-market:apply");
    });
  },
});
