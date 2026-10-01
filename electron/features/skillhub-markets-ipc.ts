// SkillHub 两个新市场的 IPC 域：expert-market（专家市场包）+ soul-market（人格市场）。
// 2026-10-01 立项（用户令）：① 专家包装完在专家中心新增对应专家卡片；② 人格装进
// personalization.json 的 persona 字段、随 AGENTS.md 生效（引擎每会话重读，即生效）。
// ⛔ userSkillsDir 不从 main 引（【132】棘轮只许降不许升）——它就是 codexHome/skills，
//   从 runtime-refs 的 codexHome 派生（与 main.ts:856 同源）；refreshSkillDiscipline
//   直连来源模块 main/12-skill-discipline（守卫 132 认可的「直连真正来源」路径）。
import { ipcMain } from "electron";
import path from "node:path";
import { codexHome, server } from "../runtime-refs";
import { sendToWindow } from "./window-bus";
import { refreshSkillDiscipline } from "../main/12-skill-discipline";
import { listSkillHubSkillsets, installSkillHubSkillset } from "../skillhub-packages";
import { listSkillHubSouls, getSkillHubSoul, currentSkillHubSoul, applySkillHubSoul, resetSkillHubSoul } from "../skillhub-souls";

// ⛔ 惰性求值（handler 调用时再取）：模块顶层读 codexHome 会拿到初始化前的值，路径漂移成
// 进程 cwd 下的 skills/ —— 实测技能包被装进 D:/Codex Harness Desktop/skills/（10-01 用户反馈
// 「市场里不显示已安装」的根因，AGENTS.md 【91】同型坑）。
const userSkillsDir = () => path.join(codexHome, "skills");

// ── 专家市场包（expert-market）─────────────────────────────────────────────
ipcMain.handle("expert-market:list", (_event, input: { page?: number; pageSize?: number; query?: string } = {}) => listSkillHubSkillsets(input));

ipcMain.handle("expert-market:install", async (_event, input: { slug: string }) => {
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

// ── 人格市场（soul-market）─────────────────────────────────────────────────
ipcMain.handle("soul-market:list", () => listSkillHubSouls());
ipcMain.handle("soul-market:get", (_event, input: { slug: string }) => getSkillHubSoul(String(input?.slug ?? "")));
ipcMain.handle("soul-market:current", () => currentSkillHubSoul());
ipcMain.handle("soul-market:apply", async (_event, input: { slug: string | null }) => {
  if (input?.slug == null) {
    await resetSkillHubSoul(codexHome);
    return { slug: "", displayName: "" };
  }
  return applySkillHubSoul(String(input.slug), codexHome);
});
