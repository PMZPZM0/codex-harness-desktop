/**
 * auto-update-ipc（10-13 用户令）
 *
 * 域：autoUpdate(2)
 * 通道：autoUpdate:status / autoUpdate:set
 *
 * 职责：**后台静默自动更新**四类能力 + **承载全部自动更新开关的状态与读写**（含技能那条）。
 *   1. 桌面自动化     nuphus            （@nuphus/nuphus-mcp）
 *   2. Mac 电脑操作   open-computer-use （仅 macOS，其它平台根本不入清单）
 *   3. Codex 引擎     @openai/codex
 *   4. 市场技能内容更新 —— ⛔ **只承载开关与显示，不在这里跑循环**：它的检查/更新流程在
 *      skills-ipc（checkSkillUpdateRows / updateSkillFolder，含安全检查）里已有独立调度器。
 *      放进来是为了让界面**一次请求拿到全部开关**（两个端点两套默认值 = 迟早不一致）。
 *
 * ⛔ 界面落点：**「控制台」（设置 → 控制台）的「自动更新」卡片**（10-13 用户令：开关统一到控制台）。
 *    ⛔ 别在技能页 / 自动化页再放第二个开关 —— 同一状态两个入口，用户会以为它们不一致。
 *
 * ⛔⛔ **手动链 = 自动链，物理同一份函数**（本项目在技能更新上栽过一次，别再抄第二遍）：
 *   · 三类工具 → `checkRuntimeUpdateRow` / `performRuntimeUpdate`（runtime-ipc 导出，界面按钮也只是薄包装）
 *   · 引擎     → `checkEngineUpdateInfo` / `performEngineUpdateFlow`（engine-ipc 导出）
 *   ⇒ 界面显示「已是最新」与后台「不更新」永远一致，不会出现两套判据互相打脸。
 *
 * ⛔ **更新源统一国内镜像**：不是本文件自己拼的 —— 两条链路内部各自走 `readDownloadSource()`
 *    / `registryEndpoints()`，都是「npmmirror 在前、官方源回落」（用户改 `downloadSource` 也照样生效）。
 *    本文件**不**持有任何镜像 URL 字面量。
 *
 * ⛔ **四个开关互相独立**：各自读各自的 `AppSettings` 字段，一个关掉/失败不影响其它三个。
 * ⛔ **缺省即开启**：判据统一走 `autoUpdateEnabled()`（`!== false`），老配置里没这些字段 = 全开。
 *
 * ⛔ **三道闸**（与技能自动更新同一套纪律）：
 *   1. 防重入：上轮没跑完不开新一轮（6 小时周期 + 慢网络可能重叠）；
 *   2. 单类失败只跳过该类，写 warn 日志，下周期再试 —— 一个包挂了不拖垮其余三类；
 *   3. finally 放闸 + 定时器走 `ctx.effect` 摘除，不留泄漏。
 *
 * ⛔ 引擎更新会**停引擎再替换二进制**（走 performEngineUpdateFlow：先等跑着的回合结束）。
 *    成功后必须 `server.restart()` 把引擎拉回来 —— 否则引擎一直停着、应用等于残废。
 *    （手动更新不 restart，是因为渲染层会倒计时重启整个应用；后台无人值守，必须自己拉起来。）
 *
 * 生命周期：通道在 `setup` 内注册、`ctx.effect` 内摘除；挂载时机由组合表决定（本文件不自挂载）。
 */
import { Notification, app } from "electron";
import { AUTO_UPDATE_ROW_OWNER, readAppSettings, readAutoUpdateRowSwitch, readAutoUpdateSwitch, saveAppSettings, writeAutoUpdateRowSwitch, type AutoUpdateSettingKey } from "../app-settings";
import { checkEngineUpdateInfo } from "./engine-ipc";
import { updateableToolIds, updateableToolMeta } from "./runtime-ipc";
import { egoBrowserPath, egoBrowserVersion, runEgoUpgrade } from "../toolchain";
import { componentSpec, visibleSpecs, type ComponentSpec, type DownloadSourceSetting } from "../update-registry";
import { scanRows, updateComponent, type ComponentRow, type UpdateOutcome } from "../update-backends";
import { sendToWindow } from "./window-bus";
import { codexHome } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const AUTO_UPDATE_CHANNELS = ["autoUpdate:status", "autoUpdate:set", "autoUpdate:scan", "autoUpdate:run", "autoUpdate:run-all"];

/** 后台自动更新的首个周期（启动后延迟，避开启动期的密集 IO）与周期间隔。 */
const FIRST_DELAY_MS = 20_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

type AutoUpdateKind = "tool" | "engine" | "skill" | "plugin";

type AutoUpdateItem = {
  id: string;
  kind: AutoUpdateKind;
  label: string;
  pkg: string;
  /** AppSettings 上对应的开关字段（每个字段互不相关，故各自一个） */
  key: AutoUpdateSettingKey;
};

/**
 * 四类自动更新目标的**唯一清单**。
 * ⛔ 标签与包名**一律从 runtime-ipc 的 UPDATEABLE_TOOLS 取**（updateableToolMeta），这里只补
 *    「对应哪个开关」和「是不是引擎」—— 包名写两份 = 两份真相源，迟早对不上（守卫 12k 钉）。
 */
function autoUpdateItems(): AutoUpdateItem[] {
  const toolKeys: Record<string, AutoUpdateItem["key"]> = {
    nuphus: "autoUpdateDesktop",
    "computer-use": "autoUpdateComputerUse",
  };
  const items: AutoUpdateItem[] = [];
  for (const id of updateableToolIds()) {
    const meta = updateableToolMeta(id);
    const key = toolKeys[id];
    // 清单里出现了没配开关的工具（将来新增可更新工具时）⇒ 跳过而不是静默按「默认开」跑
    if (!meta || !key) continue;
    items.push({ id, kind: "tool", label: meta.label, pkg: meta.pkg, key });
  }
  items.push({ id: "engine", kind: "engine", label: "Codex 引擎", pkg: "@openai/codex", key: "autoUpdateEngine" });
  // 技能内容更新（10-13 上一轮就有，开关原先落在技能中心）—— 10-13 用户令「开关统一到控制台」
  // 之后并入本清单，界面才能**一次请求拿到全部开关**（两个端点两套判据 = 迟早不一致）。
  // ⛔ 它的缺省是**关**（改用户技能目录里的文件，见 readAutoUpdateSwitch），与上面四类不同。
  items.push({ id: "skill", kind: "skill", label: "市场技能内容更新", pkg: "", key: "skillAutoUpdate" });
  // 插件自动更新（10-24 用户令：技能 / 插件各留一个总开关；逐插件行不再透出）。
  items.push({ id: "plugin", kind: "plugin", label: "市场插件自动更新", pkg: "", key: "pluginAutoUpdate" });
  return items;
}

export type AutoUpdateStatusRow = {
  id: string;
  kind: AutoUpdateKind;
  label: string;
  pkg: string;
  /** 开关当前是否开启（缺省 = 开） */
  enabled: boolean;
  current: string;
  latest: string;
  hasUpdate: boolean;
  error: string;
};

/** 发系统通知（更新成功的反馈）。不支持通知的环境静默跳过 —— 后台任务不许因为通知失败而失败。 */
function notifyUpdated(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return;
    const notice = new Notification({ title, body, silent: true });
    notice.show();
  } catch { /* 通知失败不影响更新结果 */ }
}

export const autoUpdateFeature = defineFeature<null>({
  id: "autoUpdate",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("autoUpdate: 缺少 ipc 服务（宿主未提供）");

    let running = false;

    /** 本次周期用的执行上下文（一路传进棋盘，避免每处再读一次配置）。 */
    function makeCtx(source: DownloadSourceSetting, settings: Awaited<ReturnType<typeof readAppSettings>>): Parameters<typeof scanRows>[1] {
      return {
        userData: app.getPath("userData"),
        codexHome,
        source,
        // ⛔ 开关的生效值**只由主进程算**（readAutoUpdateRowSwitch）：界面不持有默认值，
        //    否则「界面显示开着、后台却跳过」这类漂移只是时间问题（guard 12l 钉）。
        enabledOf: (rowId) => readAutoUpdateRowSwitch(settings, rowId),
        // 进度走既有的 runtime:progress 事件（渲染层已订阅），不新增事件通道
        progress: (id, message, percent) => {
          sendToWindow("runtime:progress", { id: String(id), message, percent, done: false, auto: true });
        },
      };
    }

    /**
     * 更新一行 —— 无论手动还是后台，都走 `updateComponent`（各后端已在里面接好既有安装链）。
     * ⛔ 别在这里按 kind 再写一遍判据：那是本项目反复栽过的坑（手动说最新、后台却在装）。
     */
    async function updateRow(row: ComponentRow, source: DownloadSourceSetting, settings: Awaited<ReturnType<typeof readAppSettings>>): Promise<UpdateOutcome> {
      if (row.id === "ego-lite") {
        const before = egoBrowserVersion();
        if (!egoBrowserPath()) return { id: row.id, label: row.label, action: "skipped", before: "", after: "", message: "未安装 Ego Lite" };
        const result = await runEgoUpgrade();
        const after = egoBrowserVersion();
        return {
          id: row.id,
          label: row.label,
          action: result.ok ? (before && after && before !== after ? "updated" : "unchanged") : "failed",
          before,
          after,
          message: result.output || (result.ok ? "已是最新版本" : "升级失败"),
        };
      }
      const spec = componentSpec(row.specId);
      if (!spec) return { id: row.id, label: row.label, action: "skipped", before: "", after: "", message: "未登记在组件清单里" };
      return updateComponent(spec, row.id, makeCtx(source, settings));
    }

    /** 一轮后台更新：**扫描全部行** → 只更新「开关开着 且 有可判定更新」的那些。 */
    async function runCycle(): Promise<void> {
      // 闸 1：防重入
      if (running) return;
      running = true;
      try {
        const settings = await readAppSettings(app.getPath("userData"));
        const source = (settings.downloadSource ?? "auto") as DownloadSourceSetting;
        const rows = await scanAll(makeCtx(source, settings));
        let updated = 0;
        for (const row of rows) {
          // ⛔⛔ 市场技能**不在这里跑**：skills-ipc 里本来就有一个技能自动更新调度器
          //    （checkSkillUpdateRows / updateSkillFolder，含安全检查）。两个调度器跑同一件事
          //    迟早互相打架（重复下载、互相覆盖）；本体系的循环只**承载它的开关与显示**，
          //    手动更新入口仍然能点到它 ⇒ 技能行在控制台里可见、可手点，但后台只有那一个 owner。
          if (row.specId === "market-skill") continue;
          // ⛔ 开关判定在**检查之前**（不是"查到了不装"）：关掉 ⇒ 连版本/内容都不比
          if (!readAutoUpdateRowSwitch(settings, row.id)) continue;
          // Ego Lite 没有可查询的远端版本号；开关开着就交给官方 updater 自己判断。
          if (row.id !== "ego-lite" && !row.hasUpdate) continue;
          try {
            const outcome = await updateRow(row, source, settings);
            if (outcome.action === "updated") {
              updated += 1;
              notifyUpdated(`${row.label} 已自动更新`, outcome.message || "内容已更新到最新");
            }
          } catch (error) {
            // 闸 2：单个失败不拖垮其余 —— 下个周期再试
            console.warn(`[auto-update] ${row.label} 自动更新失败，下个周期再试：${(error as Error)?.message ?? error}`);
          }
        }
        if (updated) console.log(`[auto-update] 本轮更新了 ${updated} 个组件`);
      } catch (error) {
        console.warn(`[auto-update] 本轮自动更新未能开始：${(error as Error)?.message ?? error}`);
      } finally {
        // 闸 3：无论如何放闸
        running = false;
      }
    }

    async function scanAll(ctx: ReturnType<typeof makeCtx>): Promise<ComponentRow[]> {
      const results = await Promise.all(visibleSpecs().map((spec) => scanRows(spec, ctx).catch((error) => [{
        id: spec.id,
        specId: spec.id,
        label: spec.label,
        group: spec.group,
        pkg: spec.pkg,
        mirror: spec.mirror,
        reason: spec.reason,
        enabled: ctx.enabledOf(spec.id),
        installed: false,
        current: "",
        latest: "",
        hasUpdate: false,
        detectable: false,
        unsupported: "",
        error: (error as Error)?.message ?? String(error),
      }])));
      // Ego Lite 是外部应用（不在组件注册表里）：单独补一行，控制台才能同时给出「更新」按钮
      // 和自动更新开关。它没有远端版本查询接口，hasUpdate 恒 false，手动/自动都交给官方 updater。
      const egoInstalled = Boolean(egoBrowserPath());
      return [
        ...results.flat(),
        {
          id: "ego-lite",
          specId: "ego-lite",
          label: "Ego Lite 浏览器自动化",
          group: "工具",
          pkg: "ego-browser",
          mirror: false,
          reason: "Ego 官方更新器（暂无国内镜像）",
          enabled: ctx.enabledOf("ego-lite"),
          installed: egoInstalled,
          current: egoInstalled ? egoBrowserVersion() : "",
          latest: "",
          hasUpdate: false,
          detectable: true,
          unsupported: "",
          error: "",
        },
      ];
    }

    ipcHost.handle("autoUpdate:status", async () => {
      const settings = await readAppSettings(app.getPath("userData"));
      const source = (settings.downloadSource ?? "auto") as DownloadSourceSetting;
      // ⛔ 版本信息来源与 `autoUpdate:scan` **同一份**（scanRows）⇒ 两个端点不可能给出矛盾的结论
      // 开关状态不能被网络版本检查卡住：扫描最多等 2.5s，超时先返回开关（版本由下方组件清单单独扫）。
      const scanned = await Promise.race([
        scanAll(makeCtx(source, settings)).catch(() => []),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 2500)),
      ]);
      const byId = new Map(scanned.map((row) => [row.id, row]));
      const rows = autoUpdateItems().map<AutoUpdateStatusRow>((item) => {
        const row = byId.get(item.id);
        return {
          id: item.id,
          kind: item.kind,
          label: item.label,
          pkg: item.pkg,
          enabled: readAutoUpdateSwitch(settings, item.key),
          current: row?.current ?? "",
          latest: row?.latest ?? "",
          hasUpdate: Boolean(row?.hasUpdate),
          error: row?.error ?? row?.unsupported ?? "",
        };
      });
      return rows;
    });

    /** 全量清单（含不支持更新的那批 —— 它们带 reason，界面显示原因而不是悄悄消失）。 */
    ipcHost.handle("autoUpdate:scan", async (_event, id?: string) => {
      const settings = await readAppSettings(app.getPath("userData"));
      const source = (settings.downloadSource ?? "auto") as DownloadSourceSetting;
      const rows = await scanAll(makeCtx(source, settings));
      const key = String(id ?? "").trim();
      return key ? rows.filter((row) => row.id === key || row.specId === key) : rows;
    });

    /** 更新指定组件（行 id）。 */
    ipcHost.handle("autoUpdate:run", async (_event, id: string) => {
      const settings = await readAppSettings(app.getPath("userData"));
      const source = (settings.downloadSource ?? "auto") as DownloadSourceSetting;
      const key = String(id ?? "").trim();
      const rows = await scanAll(makeCtx(source, settings));
      const row = rows.find((entry) => entry.id === key);
      if (!row) throw new Error(`未知组件：${key}`);
      const outcome = await updateRow(row, source, settings);
      if (outcome.action === "updated") notifyUpdated(`${row.label} 已更新`, outcome.message);
      return outcome;
    });

    /**
     * 一键更新全部。
     * ⛔ **手动入口不看开关**：开关约束的是「无人值守时动不动手」，用户自己点了"全部更新"
     *    就是明确授权。若这里也按开关过滤，关掉的那几类会永远装不回来，用户还得再找别处入口。
     */
    ipcHost.handle("autoUpdate:run-all", async () => {
      const settings = await readAppSettings(app.getPath("userData"));
      const source = (settings.downloadSource ?? "auto") as DownloadSourceSetting;
      const ctx = makeCtx(source, settings);
      const rows = await scanAll(ctx);
      const outcomes: UpdateOutcome[] = [];
      for (const row of rows) {
        if (row.unsupported) {
          outcomes.push({ id: row.id, label: row.label, action: "skipped", before: "", after: "", message: row.unsupported });
          continue;
        }
        try {
          outcomes.push(await updateRow(row, source, settings));
        } catch (error) {
          // 单个失败**必须记录成一行结果**，不能让整批变成一次异常 —— 用户要知道哪一项没成
          outcomes.push({ id: row.id, label: row.label, action: "failed", before: "", after: "", message: (error as Error)?.message ?? String(error) });
        }
      }
      const done = outcomes.filter((entry) => entry.action === "updated").length;
      if (done) notifyUpdated("组件更新完成", `${done} 个组件已更新，${outcomes.length - done} 项无需更新或跳过`);
      return outcomes;
    });

    /**
     * 开关写入。**既支持具名那四类，也支持任意组件行 id**（统一更新体系纳入了十几类组件）。
     * ⛔ 归属具名开关的行写具名字段（保持既有契约），其余行写 `autoUpdateOverrides[行id]`
     *    —— 都由 `writeAutoUpdateRowSwitch` / `AUTO_UPDATE_ROW_OWNER` 一处裁决。
     */
    ipcHost.handle("autoUpdate:set", async (_event, id: string, enabled: boolean) => {
      const key = String(id ?? "").trim();
      const userData = app.getPath("userData");
      const settings = await readAppSettings(userData);
      if (key === "ego-lite") {
        const next = await saveAppSettings(userData, { autoUpdateOverrides: writeAutoUpdateRowSwitch(settings, key, enabled) });
        return { id: key, enabled: readAutoUpdateRowSwitch(next, key) };
      }
      const owner: AutoUpdateSettingKey | undefined = AUTO_UPDATE_ROW_OWNER[key] ?? AUTO_UPDATE_ROW_OWNER[key.split("/")[0]];
      if (owner) {
        // ⛔ 只写这一个字段（patch 单键）⇒ 各开关物理独立，互不影响
        const next = await saveAppSettings(userData, { [owner]: Boolean(enabled) } as never);
        return { id: key, enabled: readAutoUpdateSwitch(next, owner) };
      }
      // 非具名：写 map。⛔ 只允许出现在 table 里的 id（防任意键污染配置）
      const exists = visibleSpecs().some((spec) => spec.id === key || key.startsWith(`${spec.id}/`));
      if (!exists) throw new Error(`未知的自动更新项：${id}`);
      const next = await saveAppSettings(userData, { autoUpdateOverrides: writeAutoUpdateRowSwitch(settings, key, enabled) });
      return { id: key, enabled: readAutoUpdateRowSwitch(next, key) };
    });

    const timer = setInterval(() => { void runCycle(); }, INTERVAL_MS);
    const first = setTimeout(() => { void runCycle(); }, FIRST_DELAY_MS);

    ctx.effect(() => {
      clearInterval(timer);
      clearTimeout(first);
      for (const ch of AUTO_UPDATE_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
