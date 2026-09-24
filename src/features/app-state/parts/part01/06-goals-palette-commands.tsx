/**
 * usePart01f（09-22：part01 按序切分出来的第 6 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import type { Bag } from "../bag-types";

export function usePart01f(bag: Bag) {
  // 收纳到右侧边（仅持久化用户点击行为；hover 由 CSS 处理，无需 React hover state）
  const [goalsDocked, setGoalsDocked] = useState(false);
bag.goalsDocked = goalsDocked as typeof bag.goalsDocked; bag.setGoalsDocked = setGoalsDocked as typeof bag.setGoalsDocked;


  const [paletteOpen, setPaletteOpen] = useState(false);
bag.paletteOpen = paletteOpen as typeof bag.paletteOpen; bag.setPaletteOpen = setPaletteOpen as typeof bag.setPaletteOpen;


  const [paletteQuery, setPaletteQuery] = useState("");
bag.paletteQuery = paletteQuery as typeof bag.paletteQuery; bag.setPaletteQuery = setPaletteQuery as typeof bag.setPaletteQuery;


  const [paletteTab, setPaletteTab] = useState<"all" | "ops" | "tasks" | "files">("all");
bag.paletteTab = paletteTab as typeof bag.paletteTab; bag.setPaletteTab = setPaletteTab as typeof bag.setPaletteTab;


  const [keepAwake, setKeepAwake] = useState(() => localStorage.getItem("keep-awake") === "true");
bag.keepAwake = keepAwake as typeof bag.keepAwake; bag.setKeepAwake = setKeepAwake as typeof bag.setKeepAwake;


  const [ctxMenuOpen, setCtxMenuOpen] = useState(false);
bag.ctxMenuOpen = ctxMenuOpen as typeof bag.ctxMenuOpen; bag.setCtxMenuOpen = setCtxMenuOpen as typeof bag.setCtxMenuOpen;


  const [skillHubCategory, setSkillHubCategory] = useState("总排行");
bag.skillHubCategory = skillHubCategory as typeof bag.skillHubCategory; bag.setSkillHubCategory = setSkillHubCategory as typeof bag.setSkillHubCategory;


  const [skillHubSearch, setSkillHubSearch] = useState("");
bag.skillHubSearch = skillHubSearch as typeof bag.skillHubSearch; bag.setSkillHubSearch = setSkillHubSearch as typeof bag.setSkillHubSearch;


  const [skillHubFilterCategory, setSkillHubFilterCategory] = useState("");
bag.skillHubFilterCategory = skillHubFilterCategory as typeof bag.skillHubFilterCategory; bag.setSkillHubFilterCategory = setSkillHubFilterCategory as typeof bag.setSkillHubFilterCategory;


  const [skillsManageOnly, setSkillsManageOnly] = useState(false);
bag.skillsManageOnly = skillsManageOnly as typeof bag.skillsManageOnly; bag.setSkillsManageOnly = setSkillsManageOnly as typeof bag.setSkillsManageOnly;


  const [connectorSearch, setConnectorSearch] = useState("");
bag.connectorSearch = connectorSearch as typeof bag.connectorSearch; bag.setConnectorSearch = setConnectorSearch as typeof bag.setConnectorSearch;


  const [connectorsManageOnly, setConnectorsManageOnly] = useState(false);
bag.connectorsManageOnly = connectorsManageOnly as typeof bag.connectorsManageOnly; bag.setConnectorsManageOnly = setConnectorsManageOnly as typeof bag.setConnectorsManageOnly;


  // 连接器卡片：勾选集合 + 单卡开关 / 批量启停的忙碌态
  const [connectorChecked, setConnectorChecked] = useState<string[]>([]);
bag.connectorChecked = connectorChecked as typeof bag.connectorChecked; bag.setConnectorChecked = setConnectorChecked as typeof bag.setConnectorChecked;


  const [connectorStatusBusy, setConnectorStatusBusy] = useState<string | null>(null);
bag.connectorStatusBusy = connectorStatusBusy as typeof bag.connectorStatusBusy; bag.setConnectorStatusBusy = setConnectorStatusBusy as typeof bag.setConnectorStatusBusy;


  const [connectorBatchBusy, setConnectorBatchBusy] = useState<"enable" | "disable" | null>(null);
bag.connectorBatchBusy = connectorBatchBusy as typeof bag.connectorBatchBusy; bag.setConnectorBatchBusy = setConnectorBatchBusy as typeof bag.setConnectorBatchBusy;
  return { goalsDocked, setGoalsDocked, paletteOpen, setPaletteOpen, paletteQuery, setPaletteQuery, paletteTab, setPaletteTab, keepAwake, setKeepAwake, ctxMenuOpen, setCtxMenuOpen, skillHubCategory, setSkillHubCategory, skillHubSearch, setSkillHubSearch, skillHubFilterCategory, setSkillHubFilterCategory, skillsManageOnly, setSkillsManageOnly, connectorSearch, setConnectorSearch, connectorsManageOnly, setConnectorsManageOnly, connectorChecked, setConnectorChecked, connectorStatusBusy, setConnectorStatusBusy, connectorBatchBusy, setConnectorBatchBusy };
}
