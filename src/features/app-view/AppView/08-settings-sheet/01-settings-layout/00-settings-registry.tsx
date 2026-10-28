/**
 * 设置页注册表 —— **「页 id → 渲染」的唯一映射**（09-22 从 02-settings-content.tsx 抽出，纯搬迁）。
 *
 * 为什么要有它（架构体检 #2）：02-settings-content 里原先有 32 处
 * `settingsPage === "x" && <XSection/>` 硬编码分支 —— 加一个设置页要改 JSX 树、还要和 settingsNav 对齐两遍。
 * 现在一行一页：
 *   · 渲染 = 由 02-settings-content 一次派发（`settingsPagesOf(app)[settingsPage]`）；
 *   · 二级入口页（browser / computer / rpa / agents / teams / expert-center）的「返回条」
 *     从写死的三元表达式收敛为 `back: { to, label }` 元数据；
 *   · **导航仍是 settingsNav（catalogs.ts）**：本文件不 import 它，避免
 *     helpers → registry → sections → helpers 的循环依赖；两边一致性由预检守卫【101】卡死。
 *
 * 10-28 P1-2：39 个页面原先共用一份 363 行的 `const { … } = app` 解构块 —— 读一页要跨 300 行
 * 找绑定，且任何一页新增字段都往同一段里塞。现在按 settingsNav 的分组拆进 `pages/*.tsx`，
 * 每页只解构自己用到的字段；本文件退回成一张 20 行的派发表。
 * ⛔ 拆页不改变派发语义：仍是「一个 id 一个 render」，preload/插槽/返回条的行为由预检【101】守着。
 */
import type { HarnessAppApi } from "../../../../app-state/useHarnessApp";
import type { SettingsPage, SettingsPageEntry } from "./types";
import { accountModelPages } from "./pages/account-model";
import { appearancePages } from "./pages/appearance";
import { capabilitiesPages } from "./pages/capabilities";
import { memoryContentPages } from "./pages/memory-content";
import { automationAgentsPages } from "./pages/automation-agents";
import { dataPages } from "./pages/data";
import { devPages } from "./pages/dev";

export type { SettingsPageEntry } from "./types";

export function settingsPagesOf(app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  return {
    ...accountModelPages(app),
    ...appearancePages(app),
    ...capabilitiesPages(app),
    ...memoryContentPages(app),
    ...automationAgentsPages(app),
    ...dataPages(app),
    ...devPages(app),
  };
}
