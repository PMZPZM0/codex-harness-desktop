/**
 * auto-update-ipc（10-13 用户令）
 *
 * 域：autoUpdate(2)
 * 通道：autoUpdate:status / autoUpdate:set
 *
 * 职责：**后台静默自动更新**四类能力 + **承载全部自动更新开关的状态与读写**（含技能那条）。
 *   1. 桌面自动化     nuphus            （@nuphus/nuphus-mcp）
 *   2. 浏览器自动化   playwright-cli    （@playwright/cli）
 *   3. Mac 电脑操作   open-computer-use （仅 macOS，其它平台根本不入清单）
 *   4. Codex 引擎     @openai/codex
 *   5. 市场技能内容更新 —— ⛔ **只承载开关与显示，不在这里跑循环**：它的检查/更新流程在
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
import { readAppSettings, readAutoUpdateSwitch, saveAppSettings, type AutoUpdateSettingKey } from "../app-settings";
import { checkEngineUpdateInfo, performEngineUpdateFlow } from "./engine-ipc";
import { checkRuntimeUpdateRow, performRuntimeUpdate, updateableToolIds, updateableToolMeta } from "./runtime-ipc";
import { server } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const AUTO_UPDATE_CHANNELS = ["autoUpdate:status", "autoUpdate:set"];

/** 后台自动更新的首个周期（启动后延迟，避开启动期的密集 IO）与周期间隔。 */
const FIRST_DELAY_MS = 20_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

type AutoUpdateKind = "tool" | "engine" | "skill";

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
    "playwright-cli": "autoUpdateBrowser",
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

async function statusOf(item: AutoUpdateItem, enabled: boolean): Promise<AutoUpdateStatusRow> {
  const base: AutoUpdateStatusRow = { id: item.id, kind: item.kind, label: item.label, pkg: item.pkg, enabled, current: "", latest: "", hasUpdate: false, error: "" };
  // 技能**没有版本号**（市场技能靠内容比对判变化）⇒ 不在这里做比对：
  // 那要把市场包下下来逐个 sha256，代价远高于「看一眼开关」。要逐项比对走技能页的 skills:update-check。
  if (item.kind === "skill") return base;
  try {
    if (item.kind === "engine") {
      const info = await checkEngineUpdateInfo();
      return { ...base, current: info.current, latest: info.latest, hasUpdate: info.hasUpdate };
    }
    const row = await checkRuntimeUpdateRow(item.id);
    return { ...base, current: row.current, latest: row.latest, hasUpdate: row.hasUpdate, error: row.error };
  } catch (error) {
    // ⛔ 查不到版本**不是致命错**：界面照常显示开关与已装版本，错误原文给人看
    return { ...base, error: (error as Error)?.message ?? String(error) };
  }
}

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

    /** 更新一类（工具或引擎）。返回是否真的更新了（用于决定是否发通知）。 */
    async function updateOne(item: AutoUpdateItem): Promise<boolean> {
      if (item.kind === "engine") {
        const info = await checkEngineUpdateInfo();
        if (!info.hasUpdate) return false;
        const result = await performEngineUpdateFlow(async () => {
          // ⛔ 后台无人值守：必须自己把引擎拉起来（新二进制已落位，重启即生效）
          await server.restart().catch(() => undefined);
        });
        if (!result.ok) throw new Error(result.message || "引擎更新失败");
        notifyUpdated("Codex 引擎已自动更新", `${info.current || "旧版本"} → ${result.version}（引擎已重启生效）`);
        return true;
      }
      const row = await checkRuntimeUpdateRow(item.id);
      if (!row.hasUpdate) return false;
      const result = await performRuntimeUpdate(item.id);
      if (!result.ok || !result.to || result.to === result.from) return false;
      notifyUpdated(`${item.label}已自动更新`, `${result.from || "旧版本"} → ${result.to}`);
      return true;
    }

    /** 一轮后台检查：按开关逐个跑；单类失败只跳过该类。 */
    async function runCycle(): Promise<void> {
      // 闸 1：防重入
      if (running) return;
      running = true;
      try {
        const settings = await readAppSettings(app.getPath("userData"));
        for (const item of autoUpdateItems()) {
          // ⛔ 技能那条**不在这里跑**：它的检查/更新流程在 skills-ipc（checkSkillUpdateRows /
          //    updateSkillFolder，含安全检查）里已有独立调度器。本板块只**承载它的开关与显示**，
          //    免得同一件事出现两个调度器互相打架。它出现在列表里 = 控制台能一次看全所有开关。
          if (item.kind === "skill") continue;
          // 闸的一部分：开关关了就整类跳过（每个开关互不影响）
          if (!readAutoUpdateSwitch(settings, item.key)) continue;
          try {
            await updateOne(item);
          } catch (error) {
            // 闸 2：单类失败不拖垮其余 —— 下个周期再试
            console.warn(`[auto-update] ${item.label} 自动更新失败，下个周期再试：${(error as Error)?.message ?? error}`);
          }
        }
      } catch (error) {
        console.warn(`[auto-update] 本轮自动更新未能开始：${(error as Error)?.message ?? error}`);
      } finally {
        // 闸 3：无论如何放闸
        running = false;
      }
    }

    ipcHost.handle("autoUpdate:status", async () => {
      const settings = await readAppSettings(app.getPath("userData"));
      const items = autoUpdateItems();
      const rows = await Promise.all(items.map((item) => statusOf(item, readAutoUpdateSwitch(settings, item.key))));
      return rows;
    });

    ipcHost.handle("autoUpdate:set", async (_event, id: string, enabled: boolean) => {
      const item = autoUpdateItems().find((entry) => entry.id === String(id ?? "").trim());
      if (!item) throw new Error(`未知的自动更新项：${id}`);
      const userData = app.getPath("userData");
      // ⛔ 只写这一个字段（patch 单键）⇒ 各开关物理独立，互不影响
      const next = await saveAppSettings(userData, { [item.key]: Boolean(enabled) });
      return { id: item.id, enabled: readAutoUpdateSwitch(next, item.key) };
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
