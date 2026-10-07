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
import { DOMAINS_NOT_HOT_UNLOADABLE, ESSENTIAL_DOMAINS, canHotUnload, isEssentialDomain } from "../essential-domains";
import { defineFeature } from "../context";

/**
 * 取生成物的装卸 API（**必须惰性 require**）。
 *
 * ⛔⛔ 绝不能顶层 import：composition.gen.ts 的 import 列表里**有本域** ⇒ 顶层 import
 *   生成物就是循环依赖，CJS 下生成物还没求值完 exports，本域拿到 undefined ⇒
 *   require("electron") 侧的注册炸在 "Cannot read properties of undefined"
 *   （10-04 真跑 dist-electron 复现，与 10-03 同型事故）。惰性 require 把取值推迟到
 *   **调用时** —— 那时生成物早已求值完。
 *
 * ⛔ 同时防另一头：万一生成物结构变了（例如忘了重跑 gen:domains），这里要报出可读错误，
 *   而不是让调用方看到 "undefined is not a function"（那句话指不出根因）。
 */
type RegistryApi = {
  mountedDomainIds: () => string[];
  mountDomainById: (id: string) => boolean;
  unmountDomainById: (id: string) => boolean;
};

function registry(): RegistryApi {
  const mod = require("../composition.gen") as Partial<RegistryApi>;
  if (typeof mod.mountDomainById !== "function" || typeof mod.unmountDomainById !== "function") {
    throw new Error("domains: 生成物缺少装卸 API —— 请跑 npm run gen:domains");
  }
  return mod as RegistryApi;
}
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
  /** 能否运行时卸载（即本次停用能否立即生效），见 canHotUnload */
  hotUnloadable: boolean;
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
 *
 * ⛔⛔ 这个 JSON **必须进打包白名单**（package.json → build.files 的
 *   `electron/composition.json`）。10-07 用户实测「开发工具最下面的功能域**全是 0**」的根因：
 *   electron-builder 的 `files` 一旦写了 patterns 就不再套用默认全量 glob ⇒ 它没被装进 asar
 *   ⇒ 上面两条候选路径全落空 ⇒ 返回 `[]`。**dev 态从项目根读得到 ⇒ 只在安装版复现**，
 *   本地自测永远看不见。守卫【253】③ 同时钉住「白名单」与「本文件的读取路径」两头。
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
      const mounted = new Set(registry().mountedDomainIds());
      const off = disabledSet();
      return {
        // ⛔ 全集真相源读 **composition.json（数据文件）**，不是 composition.gen.ts：
        //   生成物 import 本域、本域再 require 生成物 = **循环依赖**，CJS 下会在模块求值期
        //   拿到未完成的 exports（10-03 实测过同类事故：plugin 为 undefined ⇒ 启动即崩）。
        //   读数据文件没有这个问题，且它才是「有哪些域可选」的真身。
        domains: listAllDomainIds().map((id) => {
          const isMounted = mounted.has(id);
          return {
            id,
            mounted: isMounted,
            disabled: off.has(id),
            essential: isEssentialDomain(id),
            // ⛔ 可否运行时卸载 —— UI 要据此区分「立即生效」与「要重启」两种文案。
            //   共享单例持有方（server / codexHome / mainWindow 的主人）热卸载会让
            //   别的域拿到半初始化对象，所以必须先拒绝。
            hotUnloadable: canHotUnload(id, isMounted),
          };
        }) as DomainRow[],
        essentialDomains: [...ESSENTIAL_DOMAINS],
        notHotUnloadable: [...DOMAINS_NOT_HOT_UNLOADABLE],
        // ⛔ 不是"一律要重启"了：能热卸载的域**立即生效**。这个字段保留是因为
        //   它现在的含义是"本次操作是否需要重启"，UI 每条记录各自带 applied。
        requiresRestart: false,
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
      const wasMounted = registry().mountedDomainIds().includes(id);

      // ⛔⛔ 顺序要紧：**先落盘、再改运行时**。
      //    反过来的话，一旦运行时操作抛错（半初始化域 / dispose 副作用），配置已经写了
      //    而内存状态没变 ⇒ 下次启动行为与本次不一致，且用户看不到任何提示。
      if (enabled) current.delete(id);
      else current.add(id);
      await saveAppSettings(userData, { disabledDomains: [...current].sort() });

      // ── 运行时热插拔（10-04）────────────────────────────────────────────
      // 能热卸载 ⇒ 真的现在就把域卸掉，通道立即消失。
      // 不能热卸载（共享单例 / 模块级子进程）⇒ 配置已落盘，明说"要重启"，
      //   **不假装已经生效**（那会让用户以为功能还在，其实下个进程才真的没）。
      let applied = false;
      let hotUnloadBlocked = false;
      if (wasMounted && !enabled) {
        if (canHotUnload(id, wasMounted)) {
          try {
            applied = registry().unmountDomainById(id);
          } catch (error) {
            // 域的 dispose 抛错 ⇒ 回滚配置，否则下次启动这个域静默缺席
            const rollback = disabledSet();
            rollback.delete(id);
            await saveAppSettings(userData, { disabledDomains: [...rollback].sort() });
            return { ok: false, error: `卸载「${id}」失败：${error instanceof Error ? error.message : String(error)}（配置已回滚）` };
          }
        } else {
          hotUnloadBlocked = true;
        }
      } else if (!enabled && !wasMounted) {
        // 本来就没挂载（配置与内存一致）⇒ 无需运行时动作
        applied = true;
      } else if (enabled && !wasMounted) {
        // 之前被停用而未挂载 ⇒ 现在补装。插件本��已在包里（ENABLED 是静态 import 全集），
        // 缺的只是这次没调 mountFeature。
        try {
          applied = registry().mountDomainById(id);
        } catch (error) {
          return { ok: false, error: `挂载「${id}」失败：${error instanceof Error ? error.message : String(error)}` };
        }
      } else {
        applied = true;   // 状态本来就一致
      }

      const requiresRestart = !applied;
      return {
        ok: true,
        id,
        enabled,
        /** 运行时是否已生效（false = 要重启） */
        applied,
        requiresRestart,
        /** 为什么不热生效（UI 要把它讲清楚，而不是只说"要重启"） */
        hotUnloadBlocked,
      };
    });

    // 单独一条：让 UI 能把"要重启"这句话取自主进程，而不是硬编码在前端。
    // ⛔ 文本必须讲清**为什么**（共享单例不能热卸载），否则用户会以为这是个 bug。
    ipcHost.handle("domains:reload-hint", (_event, input: { id?: string }) => {
      const id = String(input?.id ?? "");
      const mounted = id ? registry().mountedDomainIds().includes(id) : false;
      const blocked = id ? DOMAINS_NOT_HOT_UNLOADABLE.includes(id) : false;
      return {
        requiresRestart: blocked || !id,
        text: !id
          ? "指定一个域才能给出是否需要重启的判断"
          : blocked
            ? `「${id}」与其他功能共享内部单例（或持有子进程），卸载它会影响它们 —— 需重启后生效`
            : "该域可在运行时卸载/挂载，通道立即生效（界面可能需要重载一次）",
        domain: id,
      };
    });

    ctx.effect(() => {
      for (const ch of DOMAINS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
