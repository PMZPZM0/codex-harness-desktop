// expert-market 域（SkillHub 专家市场包）—— 独立板块，**一个文件只承载一个域前缀**。
// 2026-10-01 立项（用户令）：专家包装完在专家中心新增对应专家卡片。
// ⛔ 10-03 P2 批次 8：从合并文件 `skillhub-markets-ipc.ts` 拆出（那时一个文件塞两个前缀，
//   是本项目的一条例外；现在硬规则是**一个文件恒等于一个域前缀**，由守卫【253】棘轮盯住）。
// ⛔ userSkillsDir 不从 main 引（【132】棘轮只许降不许升）——它就是 codexHome/skills，
//   从 runtime-refs 的 codexHome 派生（与 main.ts:856 同源）；refreshSkillDiscipline
//   直连来源模块 main/12-skill-discipline（守卫 132 认可的「直连真正来源」路径）。
import path from "node:path";
import { codexHome, server } from "../runtime-refs";
import { sendToWindow } from "./window-bus";
import { refreshSkillDiscipline } from "../main/12-skill-discipline";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { listSkillHubSkillsets, installSkillHubSkillset } from "../skillhub-packages";

// ⛔ 惰性求值（handler 调用时再取）：模块顶层读 codexHome 会拿到初始化前的值，路径漂移成
// 进程 cwd 下的 skills/ —— 实测技能包被装进 D:/Codex Harness Desktop/skills/（10-01 用户反馈
// 「市场里不显示已安装」的根因，AGENTS.md 【91】同型坑）。
const userSkillsDir = () => path.join(codexHome, "skills");

export const expertMarketFeature = defineFeature<null>({
  id: "expert-market",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    // inject 已在容器侧挡过一次；这里再挡一次只为把类型收紧（⛔ 不写 `!`：缺依赖要报得出来）
    if (!ipcHost) throw new Error("expert-market: 缺少 ipc 服务（宿主未提供）");

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

    // 生命期：卸载时摘掉本域两条通道（不摘 = 卸载后通道还在、实现已被回收 ⇒ 调用报错）
    ctx.effect(() => {
      ipcHost.removeHandler("expert-market:list");
      ipcHost.removeHandler("expert-market:install");
    });
  },
});
