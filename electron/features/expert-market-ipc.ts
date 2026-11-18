// expert-market 域（SkillHub 专家市场包）—— 独立板块，**一个文件只承载一个域前缀**。
// 2026-10-01 立项（用户令）：专家包装完在专家中心新增对应专家卡片。
// ⛔ 10-03 P2 批次 8：从合并文件 `skillhub-markets-ipc.ts` 拆出（那时一个文件塞两个前缀，
//   是本项目的一条例外；现在硬规则是**一个文件恒等于一个域前缀**，由守卫【253】棘轮盯住）。
// ⛔ userSkillsDir 不从 main 引（【132】棘轮只许降不许升）——它就是 codexHome/skills，
//   从 runtime-refs 的 codexHome 派生（与 main.ts:856 同源）；refreshSkillDiscipline
//   直连来源模块 main/12-skill-discipline（守卫 132 认可的「直连真正来源」路径）。
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { cpSync, existsSync } from "node:fs";
import { codexHome, server } from "../runtime-refs";
import { sendToWindow } from "./window-bus";
import { refreshSkillDiscipline } from "../main/12-skill-discipline";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";
import { listSkillHubSkillsets, installSkillHubSkillset } from "../skillhub-packages";
import { expandZip } from "../skills-market";

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
      // ⛔ 同技能市场：重启失败 ≠ 安装失败 —— 技能文件已经落盘，只是引擎这一次没起来
      //   （瞬时故障由 CodexServer 内置重试消化）。降级成 pending 如实告知。
      emit("engine", "正在重启 Codex 引擎并注册技能");
      let restartError = "";
      try { await server.restart(); } catch (error: any) { restartError = error?.message ?? String(error); }
      void refreshSkillDiscipline();
      const summary = `已安装「${result.displayName}」，专家中心已新增对应专家卡片（${result.installedChildren.length} 个子技能${result.childFailures.length ? `，${result.childFailures.length} 个未跟上` : ""}）`;
      emit(restartError ? "pending" : "complete", restartError ? `${summary}；引擎本轮启动失败（${restartError}），重启应用后生效。` : summary);
      return result;
    });

    /* 11-18：本地专家技能包安装（对应 scripts/skillset-pack.mjs 的产物）。
       用户令「技能应该是专家自带的」——打包器有了，但本地包原先只能手工拷目录；
       这条通道让专家卡上能「从本地包装」，装完重启引擎即可见。
       ⛔ 只新增：同名技能目录已存在一律跳过（不覆盖用户可能改过的技能）。
       ⛔ 不写父级假 SKILL.md：会在技能列表里多出一条不存在的技能。 */
    ipcHost.handle("expert-market:install-local", async (_event, input?: { dir?: string; zip?: string }) => {
      const emit = (stage: string, message: string) => sendToWindow("harness:event", { type: "expert-install", skillsetId: String(input?.dir ?? input?.zip ?? ""), stage, message, at: Date.now() });
      const tempDirs: string[] = [];
      try {
        let dir = String(input?.dir ?? "").trim();
        const noPathGiven = !dir && !String(input?.zip ?? "").trim();
        if (noPathGiven) {
          /* 没给路径 ⇒ 弹目录选择（⛔ 不猜路径，也不扫盘） */
          const picked = await ctx.get<HostCaps>("host")?.dialog?.showOpenDialog(null as never, {
            title: "选择专家技能包目录（含 .skillhub.json，kind=skillset）",
            properties: ["openDirectory"],
          } as never) as { canceled?: boolean; filePaths?: string[] } | undefined;
          if (!picked || picked.canceled || !picked.filePaths?.length) return { ok: false, error: "已取消" };
          dir = picked.filePaths[0];
        }
        const zip = String(input?.zip ?? "").trim();
        if (!dir && zip) {
          dir = await fs.mkdtemp(path.join(os.tmpdir(), "skillset-"));
          tempDirs.push(dir);
          emit("extract", "正在解压本地技能包");
          await expandZip(zip, dir);
        }
        if (!dir) throw new Error("没有指定技能包目录或 zip");
        if (!existsSync(dir)) throw new Error(`路径不存在：${dir}`);

        /* 校验元数据：必须是一个 skillset 包（⛔ 单个技能不走这条，用技能市场） */
        const metaPath = path.join(dir, ".skillhub.json");
        let meta: any = null;
        try { meta = JSON.parse(await fs.readFile(metaPath, "utf8")); } catch { throw new Error("这不是专家技能包：缺少 .skillhub.json"); }
        if (String(meta?.kind ?? "") !== "skillset") throw new Error("这不是专家技能包：kind 不是 skillset");
        const slug = String(meta?.marketId ?? meta?.name ?? path.basename(dir));
        const children: string[] = Array.isArray(meta?.children) ? meta.children.map((x: any) => String(x)) : [];
        /* 老包可能没写 children：按子目录里 kind=skillset-child 自动发现 */
        if (!children.length) {
          for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            try {
              const child = JSON.parse(await fs.readFile(path.join(dir, entry.name, ".skillhub.json"), "utf8"));
              if (String(child?.kind ?? "") === "skillset-child") children.push(entry.name);
            } catch { /* 不是子技能目录 */ }
          }
        }
        if (!children.length) throw new Error("包里没有子技能（children 为空）");

        const root = userSkillsDir();
        emit("install", `正在安装 ${children.length} 个技能`);
        const installed: string[] = [];
        const skipped: Array<{ name: string; reason: string }> = [];
        for (const child of children) {
          const src = path.join(dir, child);
          const dst = path.join(root, child);
          if (!existsSync(path.join(src, "SKILL.md"))) { skipped.push({ name: child, reason: "缺 SKILL.md" }); continue; }
          if (existsSync(dst)) { skipped.push({ name: child, reason: "同名技能已存在（不覆盖）" }); continue; }
          try {
            cpSync(src, dst, { recursive: true });
            installed.push(child);
          } catch (error: any) { skipped.push({ name: child, reason: error?.message ?? String(error) }); }
        }

        emit("engine", "正在重启 Codex 引擎并注册技能");
        let restartError = "";
        try { await server.restart(); } catch (error: any) { restartError = error?.message ?? String(error); }
        void refreshSkillDiscipline();
        const summary = `本地技能包装好：${installed.length} 个技能${skipped.length ? `，${skipped.length} 个跳过` : ""}`;
        emit(restartError ? "pending" : "complete", restartError ? `${summary}；引擎本轮启动失败（${restartError}），重启应用后生效。` : summary);
        return { ok: true, slug, installed, skipped, restartError: restartError || undefined };
      } catch (error: any) {
        const message = error?.message ?? String(error);
        emit("error", message);
        return { ok: false, error: message };
      } finally {
        for (const dir of tempDirs) { try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* 临时目录清不掉不影响结果 */ } }
      }
    });

    // 生命期：卸载时摘掉本域两条通道（不摘 = 卸载后通道还在、实现已被回收 ⇒ 调用报错）
    ctx.effect(() => {
      ipcHost.removeHandler("expert-market:list");
      ipcHost.removeHandler("expert-market:install");
      ipcHost.removeHandler("expert-market:install-local");
    });
  },
});
