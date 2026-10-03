/**
 * skill-discipline-ipc（10-03 从 `features/builtin-skills-ipc/02-...` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：skill-discipline(1)
 * 通道：skill-discipline:get（读 AGENTS.md 里的守则区间）
 *
 * 区间由 `DISCIPLINE_START` / `DISCIPLINE_END` 两个哨兵界定（单一真相源在 `../skill-discipline`）。
 * ⛔ 待接缝化（阶段 2）：fs 为宿主能力。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { DISCIPLINE_END, DISCIPLINE_START } from "../skill-discipline";
import { codexHome } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const skillDisciplineFeature = defineFeature<null>({
  id: "skill-discipline",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("skill-discipline: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("skill-discipline:get", async () => {
      try {
        const raw = await fs.readFile(path.join(codexHome, "AGENTS.md"), "utf8");
        const start = raw.indexOf(DISCIPLINE_START);
        const end = raw.indexOf(DISCIPLINE_END);
        return { present: start >= 0 && end > start, section: start >= 0 && end > start ? raw.slice(start, end + DISCIPLINE_END.length) : "" };
      } catch { return { present: false, section: "" }; }
    });

    ctx.effect(() => {
      ipcHost.removeHandler("skill-discipline:get");
    });
  },
});
