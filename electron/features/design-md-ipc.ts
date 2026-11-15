/**
 * design-md-ipc —— 「设计参考」域（11-15）
 *
 * 域：design-md(3)
 * 通道：list / get / export
 *
 * 数据源 = 随包 `resources/design-md/library.json`（VoltAgent/awesome-design-md，MIT，
 * 84 份品牌 DESIGN.md，生成物见 scripts/sync-design-md.mjs）。本域只做三件事：
 *   · list  浏览/搜索（不带正文，卡列表用）；
 *   · get   取一份完整 DESIGN.md（预览/复制用）；
 *   · export 把规范写到**当前项目**的 `design-references/<slug>.md`（⛔ 不覆盖项目自己的 DESIGN.md）。
 * ⛔ 导出路径口径与 fs:write 一致（10-29 用户令：编辑器保存不再判可信根）——这里只做
 *    slug 白名单 + 目录必须是绝对路径，两样都不满足即拒绝。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { designMdCategoryLabel, designMdGet, designMdList, isDesignMdSlug } from "../design-md-library";

const DESIGN_MD_CHANNELS = ["design-md:list", "design-md:get", "design-md:export"];

export const designMdFeature = defineFeature<null>({
  id: "design-md",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("design-md: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("design-md:list", async (_event, input: { category?: string; query?: string; limit?: number } = {}) => designMdList(input ?? {}));
    ipcHost.handle("design-md:get", async (_event, slug: string) => designMdGet(String(slug ?? "")));
    ipcHost.handle("design-md:export", async (_event, input: { slug?: string; dir?: string } = {}) => {
      const slug = String(input?.slug ?? "").trim();
      const dir = String(input?.dir ?? "").trim();
      if (!isDesignMdSlug(slug)) return { ok: false, error: "设计规范标识不合法" };
      if (!dir || !path.isAbsolute(dir)) return { ok: false, error: "先选择项目地址（需要绝对路径）" };
      const doc = designMdGet(slug);
      if (!doc) return { ok: false, error: "库里没有这份设计规范" };
      const targetDir = path.join(dir, "design-references");
      const target = path.join(targetDir, `${doc.slug}.md`);
      try {
        await fs.mkdir(targetDir, { recursive: true });
        await fs.writeFile(target, doc.designMd, "utf8");
        return { ok: true, path: target, category: designMdCategoryLabel(doc.category) };
      } catch (error) {
        return { ok: false, error: `写入失败：${(error as Error)?.message || error}` };
      }
    });

    ctx.effect(() => {
      for (const channel of DESIGN_MD_CHANNELS) ipcHost.removeHandler(channel);
    });
  },
});
