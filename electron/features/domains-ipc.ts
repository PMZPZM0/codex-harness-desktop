/**
 * domains-ipc —— **宿主域清单与启停**（10-04 阶段 6）。
 *
 * 域：domains(3)
 * 通道：domains:list / domains:set-enabled / domains:reload-hint
 *
 * ⛔ **为什么单独成一个域而不是塞进 `runtime`**：runtime 管的是"外部工具链的下载安装"
 *   （ffmpeg / python / git），本域管的是**宿主自己的插件域**。两者生命周期与风险都不同：
 *   停用一个域 = 该功能的所有 IPC 通道消失（见下），那不是"卸载一个工具"。
 *   一板块一前缀（守卫【253】）。
 *
 * ── 语义边界（务必读，用户最容易误解的一点）──────────────────────────────
 * 停用 = **下次启动不挂载**，不是运行时卸载。两个原因：
 *   ① 生成物 `composition.gen.ts` 的 import 列表是**构建期静态**的 —— 它必须包含全部域，
 *      否则打包期的可达闭包看不见被停用的域，用户的设置一改就造出
 *      "配置启用了、包里却没有"的静默失效（那正是静态生成物存在的理由）。
 *      所以停用只能作用在 `mountFeature` 这一步。
 *   ② 真热插拔要求域卸载时把私有状态（子进程、句柄、定时器、单例）全部安全交还，
 *      而多数域的私有状态是**模块级变量**（voice 的 worker 池、relay 的 purchaseWindow），
 *      容器管不到 ⇒ 卸载后再挂载极可能拿到半初始化的单例。
 *      首版诚实地只做"重启后生效"，**不假装支持热插拔**。
 *
 * ⚠️ 停用后该域通道**不存在** ⇒ 渲染层 invoke 抛 `No handler registered`
 *   （组件 catch 成空数组 / 永远"加载中"）。所以本域回传 `affects` 字段，
 *   UI 必须把它呈现为"功能不可用"而不是"坏了"，并在重启前明确告知。
 */
import { app } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readAppSettingsSync, saveAppSettings } from "../app-settings";
import { ESSENTIAL_DOMAINS, isEssentialDomain } from "../essential-domains";
import { mountedFeatures } from "../context";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const DOMAINS_CHANNELS = ["domains:list", "domains:set-enabled", "domains:reload-hint"];

export type DomainRow = {
  id: string;
  /** 是否已挂载（本次启动） */
  mounted: boolean;
  /** 用户是否停用了它（下次启动生效） */
  disabled: boolean;
  /** 是否不可停用（essential：承载应用自身能力） */
  essential: boolean;
};

/**
 * 组合表里全部域 id（惰性读 JSON）。
 *
 * ⛔ 为什么惰性：模块体读文件会在 `app.setPath("userData")` 之前执行（【91】复发防线），
 *   而且这个域自己就在表里 —— 模块体求值期读表属于自引用。
 * ⛔ 为什么读 `composition.json` 而不是 `composition.gen.ts`：见 domains:list 里的循环依赖说明。
 * ⚠️ 路径用 `join(__dirname, …)`：`__dirname` 在 CJS 产物里 = `dist-electron/`，
 *   而 `composition.json` **不被编译**（它在 electron/ 源目录）⇒ 打包后要从
 *   `app.getAppPath()/electron/` 找。两条路径都试，找不到就返回空数组（UI 显示"读不到域清单"
 *   而不是崩溃 —— 清单是辅助功能，不该拖垮整个应用）。
 */
function listAllDomainIds(): string[] {
  const candidates = [
    join(app.getAppPath(), "electron", "composition.json"),
    join(__dirname, "..", "electron", "composition.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      const ids = (raw.domains || []).map((d: { id: string }) => d.id);
      if (ids.length) return ids;
    } catch { /* 试下一个 */ }
  }
  return [];
}

export const domainsFeature = defineFeature<null>({
  id: "domains",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("domains: 缺少 ipc 服务（宿主未提供）");

    const disabledSet = (): Set<string> => {
      try {
        const s = readAppSettingsSync(app.getPath("userData"));
        return new Set(Array.isArray(s.disabledDomains) ? s.disabledDomains : []);
      } catch {
        return new Set();
      }
    };

    ipcHost.handle("domains:list", () => {
      const mounted = new Set(mountedFeatures());
      const off = disabledSet();
      return {
        // ⛔ 全集真相源读 **composition.json（数据文件）**，不是 composition.gen.ts：
        //   生成物 import 本域、本域再 require 生成物 = **循环依赖**，CJS 下会在模块求值期
        //   拿到未完成的 exports（10-03 实测过同类事故：plugin 为 undefined ⇒ 启动即崩）。
        //   读数据文件没有这个问题，且它才是「有哪些域可选」的真身。
        domains: listAllDomainIds().map((id) => ({
          id,
          mounted: mounted.has(id),
          disabled: off.has(id),
          essential: isEssentialDomain(id),
        })) as DomainRow[],
        essentialDomains: [...ESSENTIAL_DOMAINS],
        // ⛔ 停用是"下次启动生效"，这个字段让 UI 能把话说准，而不是让用户以为立刻生效了
        requiresRestart: true,
      };
    });

    ipcHost.handle("domains:set-enabled", async (_event, input: { id?: string; enabled?: boolean }) => {
      const id = String(input?.id ?? "");
      if (!id) return { ok: false, error: "缺少域 id" };
      if (isEssentialDomain(id)) {
        return { ok: false, error: `「${id}」是应用自身能力（身份/对话主链路/基础对话框），不可停用` };
      }
      if (!listAllDomainIds().includes(id)) return { ok: false, error: `未知的域：${id}` };
      const enabled = input?.enabled !== false;
      const userData = app.getPath("userData");
      const current = disabledSet();
      if (enabled) current.delete(id);
      else current.add(id);
      await saveAppSettings(userData, { disabledDomains: [...current].sort() });
      return { ok: true, id, enabled, requiresRestart: true };
    });

    // 单独一条：让 UI 能把"重启才生效"这句话取自主进程，而不是硬编码在前端
    ipcHost.handle("domains:reload-hint", () => ({
      requiresRestart: true,
      text: "停用/启用在下次启动生效（域的通道在本次运行里已经存在或已经消失，运行时卸载不安全）",
    }));

    ctx.effect(() => {
      for (const ch of DOMAINS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
