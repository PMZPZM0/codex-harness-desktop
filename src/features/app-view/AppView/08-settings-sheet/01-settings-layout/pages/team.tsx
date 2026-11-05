/**
 * 设置页 · 团队模式（10-05）
 *
 * ⛔ 本文件只是**注册表条目**：一行渲染指向独立板块 `src/features/harness-team`。
 * 业务逻辑、状态、样式全在那里面 —— 这里不放任何团队逻辑（板块纪律：新功能不进别人的域）。
 */
import type { HarnessAppApi } from "../../../../../app-state/useHarnessApp";
import type { SettingsPage, SettingsPageEntry } from "../types";
import { lazy } from "react";

const TeamModePanel = lazy(() => import("../../../../../harness-team").then((m) => ({ default: m.TeamModePanel })));

export function teamPages(_app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  return {
    team: {
      render: () => <TeamModePanel />,
    },
  };
}
