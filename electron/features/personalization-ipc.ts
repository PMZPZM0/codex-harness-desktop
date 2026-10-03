/**
 * personalization-ipc（10-03 从 `features/settings-app-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：personalization(6)
 * 通道：personalization:read / save / save-identity / mark-greeted / setNickname / verify
 *
 * ⛔ 写个性化后必须连做三件事（少一件就会出现"改了没生效"）：
 *     ① `applyPersonalizationToAgentsMd(config, codexHome)` —— 写进引擎的 AGENTS.md；
 *     ② `refreshSkillDiscipline()` —— 技能纪律段随之重算；
 *     ③（save 时）`applyCustomModel(model)` —— 清掉 config.toml 里残留的旧个性化段并重启引擎。
 * ⛔ `personalization:verify` 的不一致重写是**有意为之**：AGENTS.md 由引擎每请求动态读取，
 *    重写后下一条消息即生效，无需重启引擎（生成与写入共用 `buildAgentsMd`，逐字一致才算同步）。
 * ⛔ 待接缝化（阶段 2）：fs 为宿主能力。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { applyPersonalizationToAgentsMd, buildAgentsMd, readPersonalization, writePersonalization } from "../personalization";
import { applyCustomModel } from "./custom-model-apply";
import { readCustomModel } from "../main/01-model-catalog";
import { refreshSkillDiscipline } from "../main/12-skill-discipline";
import { codexHome } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const personalizationFeature = defineFeature<null>({
  id: "personalization",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("personalization: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("personalization:read", async () => readPersonalization());
    ipcHost.handle("personalization:save", async (_event, input: { nickname?: unknown; customInstructions?: unknown }) => {
      const config = await writePersonalization(input);
      await applyPersonalizationToAgentsMd(config, codexHome);
      void refreshSkillDiscipline();
      const model = await readCustomModel();
      // 重写 config.toml：把迁移前残留在 developer_instructions 里的旧个性化段清掉，并重启引擎
      if (model) await applyCustomModel(model);
      return config;
    });
    ipcHost.handle("personalization:save-identity", async (_event, input: Record<string, unknown>) => {
      const config = await writePersonalization(input);
      await applyPersonalizationToAgentsMd(config, codexHome);
      void refreshSkillDiscipline();
      return config;
    });
    ipcHost.handle("personalization:mark-greeted", async () => {
      const config = await writePersonalization({ greeted: true });
      return config;
    });
    ipcHost.handle("personalization:setNickname", async (_event, nickname: unknown) => {
      const current = await readPersonalization();
      const config = await writePersonalization({ nickname, customInstructions: current.customInstructions });
      await applyPersonalizationToAgentsMd(config, codexHome);
      void refreshSkillDiscipline();
      return config;
    });
    ipcHost.handle("personalization:verify", async () => {
      const stored = await readPersonalization();
      const expects = Boolean(stored.nickname || stored.customInstructions);
      const agentsPath = path.join(codexHome, "AGENTS.md");
      const expectedText = buildAgentsMd(stored);
      let raw = "";
      try { raw = await fs.readFile(agentsPath, "utf8"); }
      catch (error: any) {
        if (error.code !== "ENOENT") throw error;
        // 缺文件：直接补齐基础段（emoji + 中文语言规范），老实例升级后自动生效
        await fs.writeFile(agentsPath, expectedText, "utf8");
        return { exists: true, expects, applied: true, inSync: true, preview: expectedText.trim().slice(0, 2000), agentsPath };
      }
      const applied = Boolean(raw.trim());
      const inSync = raw === expectedText;
      // 生成逻辑与写入共用 buildAgentsMd，逐字一致才算同步。
      // 不一致（如新增了语言基础段、或用户手改过）时重写补齐——AGENTS.md 是
      // 引擎动态加载（每请求重读），重写后下一条消息即生效，无需重启引擎。
      if (raw !== expectedText) {
        await fs.writeFile(agentsPath, expectedText, "utf8");
        return { exists: true, expects, applied: true, inSync: true, preview: expectedText.trim().slice(0, 2000), agentsPath, replayed: true };
      }
      return {
        exists: true,
        expects,
        applied,
        inSync,
        preview: raw.trim().slice(0, 2000),
        agentsPath,
      };
    });

    ctx.effect(() => {
      for (const ch of ["personalization:read", "personalization:save", "personalization:save-identity", "personalization:mark-greeted", "personalization:setNickname", "personalization:verify"]) {
        ipcHost.removeHandler(ch);
      }
    });
  },
});
