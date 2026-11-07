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

export function teamPages(app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  return {
    team: {
      /* ⛔ 11-07 用户令「正反向联动做好一点」：群消息里的「来源」要能打开那条会话。
         群面板挂在设置页里，自己拿不到 openThread ⇒ 宿主把动作传下去，
         并且**先关设置页再开会话**（否则会话被设置页盖住，看着像"点了没反应"）。 */
      render: () => (
        <TeamModePanel
          onOpenThread={(id) => {
            app.setSettingsOpen(false);
            void app.openThread(id);
          }}
        />
      ),
    },
  };
}
