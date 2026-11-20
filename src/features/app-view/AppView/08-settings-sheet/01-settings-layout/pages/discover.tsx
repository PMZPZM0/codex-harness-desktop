/**
 * 设置页 · 发现（11-20）：GitHub 热门榜单。
 *
 * 页面只做数据获取 + 渲染；简介翻译走主进程 `prompt:translate`（当前模型 / MyMemory）。
 */
import type { HarnessAppApi } from "../../../../../app-state/useHarnessApp";
import type { SettingsPage, SettingsPageEntry } from "../types";
import { GithubTrendingPage } from "../../../../../github-trending";

export function discoverPages(_app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  return {
    "github-trending": { render: () => <GithubTrendingPage /> },
  };
}
