import type { ReactNode } from "react";
import type { SettingsPage } from "../../../../app-view/types";

/** 设置页条目：二级入口页带「返回条」元数据，一级页只给渲染函数。 */
export interface SettingsPageEntry {
  back?: { to: SettingsPage; label: string };
  render: () => ReactNode;
}

export type { SettingsPage };
