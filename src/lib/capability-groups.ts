// 能力组联动层：把分散的开关收成 3 个主开关（写代码模式 / 桌面自动化 / 浏览器自动化）。
//
// 设计：
// - 主开关状态是"派生"而非受控：依据子项快照算出 on / off / partial，杜绝主/子状态不一致；
// - 联动是"动作计划+应用"两步：先 planAction 算出 diff，再由 applyAction 通过注入的 IPC 调用聚合下发；
// - 失败聚合：每个子项的 IPC 都返回 { failures }，applyAction 把所有失败项合并返回给 UI，
//   由 UI 决定 toast / 跳转到对应 tab；
// - 单一入口：主开关打开时，子项在其他 tab（技能 / MCP / 插件）被点击关闭会被 guardOffOwner 拦下，
//   只提示「去常规页关主开关」，避免子项被主开关反复拉回导致状态漂移。

export type CapabilityGroupId = "writing-code" | "desktop-automation" | "browser-automation";

/** 主开关状态：完全开 / 完全关 / 部分开（部分子项与目标不一致）。 */
export type MasterState = "on" | "off" | "partial";

/** 各主开关在 UI 上的固定叫法（拦截提示文案用）。 */
export const GROUP_LABELS: Record<CapabilityGroupId, string> = {
  "writing-code": "写代码模式（代码钩子）",
  "desktop-automation": "桌面自动化",
  "browser-automation": "浏览器自动化",
};

/** ponytail 插件的固定 ID（来自 .zcode/hooks/ponytail 的源约定）。 */
export const PONYTAIL_PLUGIN_ID = "ponytail";

/**
 * 市场安装的插件真实 ID 形如 "ponytail@ponytail"（id@市场名），
 * config.toml 键、钩子 pluginId、技能 .plugin.json 都用全 ID；
 * 而调用方常传短名。统一按 @ 前的 base 名比较。
 */
export function basePluginId(id: string): string {
  return String(id ?? "").split("@")[0];
}

/** 两个插件 ID 是否指向同一个插件（base 名归一化）。 */
export function samePluginId(a: string, b: string): boolean {
  return basePluginId(a) === basePluginId(b);
}
/** 桌面自动化的 MCP 服务器名（内置 nuphus，注册在 config.toml [mcp_servers.nuphus]）。 */
export const NUPHUS_MCP_ID = "nuphus";
/** 桌面自动化配套技能目录名（ensureBuiltinSkills 写入 codexHome/skills/）。 */
export const DESKTOP_SKILL_ID = "desktop-automation";
/** 浏览器自动化配套技能目录名。 */
export const BROWSER_SKILL_ID = "browser-automation";

/** 一个可选子项：未安装时为 null，不参与主开关状态计算。 */
export interface SkillMember {
  folder: string;
  enabled: boolean;
}

/** 子开关快照：渲染层每次状态变化后喂给联动层一次即可。 */
export interface SubToggleSnapshot {
  /** 写代码模式（ponytail 注入开关），对应 ~/.config/ponytail/config.json:defaultMode。 */
  ponytailOn: boolean;
  /** ponytail 插件本体是否启用（config.toml [plugins."ponytail"].enabled）。 */
  ponytailPluginOn: boolean;
  /** ponytail 插件下所有子技能当前启用状态。空数组视为"该插件未安装"，不算 on 也不算 off。 */
  ponytailSkills: ReadonlyArray<{ folder: string; enabled: boolean }>;
  /** 桌面自动化总闸（app-settings.json:desktopAutomation，决定是否注册 nuphus MCP + 注入说明）。 */
  desktopAuto: boolean;
  /** 浏览器自动化总闸（app-settings.json:browserAutomation）。 */
  browserAuto: boolean;
  /** nuphus MCP 服务器在覆盖表里是否启用（默认启用，用户可在 MCP 页单独停）。 */
  nuphusMcpOn: boolean;
  /** 桌面自动化配套技能；未安装为 null。 */
  desktopSkill: SkillMember | null;
  /** 浏览器自动化配套技能；未安装为 null。 */
  browserSkill: SkillMember | null;
}

/** 同一组里所有相关子项的布尔值列表（未安装的可选子项不计入）。 */
export function collectItems(snapshot: SubToggleSnapshot, groupId: CapabilityGroupId): boolean[] {
  if (groupId === "writing-code") {
    return [
      snapshot.ponytailOn,
      snapshot.ponytailPluginOn,
      ponytailSkillsAllOn(snapshot.ponytailSkills),
    ];
  }
  if (groupId === "desktop-automation") {
    const items = [snapshot.desktopAuto, snapshot.nuphusMcpOn];
    if (snapshot.desktopSkill) items.push(snapshot.desktopSkill.enabled);
    return items;
  }
  const items = [snapshot.browserAuto];
  if (snapshot.browserSkill) items.push(snapshot.browserSkill.enabled);
  return items;
}

/** 派生一个组的主开关状态。 */
export function groupState(snapshot: SubToggleSnapshot, groupId: CapabilityGroupId): MasterState {
  const items = collectItems(snapshot, groupId);
  if (items.length === 0) return "off"; // 没装任何相关子项时，主开关默认关；UI 自行决定灰显
  const allOn = items.every((v) => v);
  const allOff = items.every((v) => !v);
  if (allOn) return "on";
  if (allOff) return "off";
  return "partial";
}

/** ponytail 包下所有子技能是否全部启用（空列表视为 false，避免插件未装时误判 on）。 */
export function ponytailSkillsAllOn(skills: ReadonlyArray<{ enabled: boolean }>): boolean {
  return skills.length > 0 && skills.every((s) => s.enabled);
}

/** 判定一个本地安装技能是否属于 ponytail 包：pluginId 或 folder/name 以 "ponytail" 开头。 */
export function isPonytailSkill(entry: { pluginId?: string; folder?: string; name?: string }): boolean {
  if (entry.pluginId === PONYTAIL_PLUGIN_ID) return true;
  const f = entry.folder ?? "";
  if (f === PONYTAIL_PLUGIN_ID || f.startsWith(`${PONYTAIL_PLUGIN_ID}-`) || f.startsWith(`${PONYTAIL_PLUGIN_ID}/`)) return true;
  const n = entry.name ?? "";
  return n === PONYTAIL_PLUGIN_ID || n.startsWith(`${PONYTAIL_PLUGIN_ID}-`) || n.startsWith(`${PONYTAIL_PLUGIN_ID}/`);
}

/** 把本地安装技能里属于 ponytail 包的项目抽出来。 */
export function ponytailSubSkills(localSkills: ReadonlyArray<{ folder?: string; name?: string; pluginId?: string; enabled?: boolean }>): { folder: string; enabled: boolean }[] {
  return localSkills
    .filter(isPonytailSkill)
    .map((entry) => ({ folder: String(entry.folder ?? entry.name ?? ""), enabled: entry.enabled !== false }))
    .filter((entry) => entry.folder.length > 0);
}

/** 按目录名或技能名找本地技能（内置技能 folder 与 name 同名，两个都匹配以防只填了一个）。 */
export function findCapabilitySkill(
  localSkills: ReadonlyArray<{ folder?: string; name?: string; enabled?: boolean }>,
  id: string,
): SkillMember | null {
  const hit = localSkills.find((entry) => entry.folder === id || entry.name === id);
  if (!hit) return null;
  return { folder: String(hit.folder ?? hit.name ?? id), enabled: hit.enabled !== false };
}

/** 一个组的「期望状态」对应的主开关目标值：on→true，off→false。 */
export function masterStateToBool(state: MasterState): boolean {
  return state === "on";
}

/** 联动动作计划：差异最小化，只发需要变化的子项。 */
export interface GroupAction {
  /** 是否要写 ponytail 注入开关（只要目标组是 writing-code 就下发，幂等 cheap）。 */
  ponytailMode?: "full" | "off";
  /** 是否要启/停 ponytail 插件（含其钩子与子技能，IPC 内置联动）。仅在子项与目标不一致时才发。 */
  ponytailLinked?: boolean;
  /** 桌面自动化总闸差异。 */
  desktopAutomation?: boolean;
  /** 浏览器自动化总闸差异。 */
  browserAutomation?: boolean;
  /** nuphus MCP 服务器目标状态（差异才发）。 */
  nuphusMcp?: boolean;
  /** 桌面自动化配套技能目标状态（差异才发，携带真实 folder）。 */
  desktopSkill?: SkillMember;
  /** 浏览器自动化配套技能目标状态。 */
  browserSkill?: SkillMember;
}

/** 计划是否为空（没有需要下发的子项）。 */
export function isEmptyAction(action: GroupAction): boolean {
  return action.ponytailMode === undefined
    && action.ponytailLinked === undefined
    && action.desktopAutomation === undefined
    && action.browserAutomation === undefined
    && action.nuphusMcp === undefined
    && action.desktopSkill === undefined
    && action.browserSkill === undefined;
}

export function planAction(snapshot: SubToggleSnapshot, groupId: CapabilityGroupId, target: boolean): GroupAction {
  if (groupId === "writing-code") {
    const action: GroupAction = { ponytailMode: target ? "full" : "off" };
    // ponytail 插件本体或任一子技能与目标不一致 → 用 setPluginLinkedEnabled 一次性联动
  const ponytailNeedsSync = snapshot.ponytailPluginOn !== target
    || snapshot.ponytailSkills.some((sk) => sk.enabled !== target);
  if (ponytailNeedsSync) action.ponytailLinked = target;
  return action;
  }
  if (groupId === "desktop-automation") {
    const action: GroupAction = {};
    // 总闸：写 app-settings，决定 nuphus MCP 是否注册 + developer_instructions 是否带说明
    if (snapshot.desktopAuto !== target) action.desktopAutomation = target;
    // 子项 1：nuphus MCP 覆盖表
    if (snapshot.nuphusMcpOn !== target) action.nuphusMcp = target;
    // 子项 2：desktop-automation 技能（未安装则跳过）
    if (snapshot.desktopSkill && snapshot.desktopSkill.enabled !== target) {
      action.desktopSkill = { folder: snapshot.desktopSkill.folder, enabled: target };
    }
    return action;
  }
  const action: GroupAction = {};
  if (snapshot.browserAuto !== target) action.browserAutomation = target;
  if (snapshot.browserSkill && snapshot.browserSkill.enabled !== target) {
    action.browserSkill = { folder: snapshot.browserSkill.folder, enabled: target };
  }
  return action;
}

/**
 * 把快照里某个组的子项全部改成 target，得到「联动成功后应有」的快照。
 * 用于联动完成后复算 partial，判断是否还有没带起来的子项（例如技能目录被改名）。
 */
export function syncedSnapshot(snapshot: SubToggleSnapshot, groupId: CapabilityGroupId, target: boolean): SubToggleSnapshot {
  if (groupId === "writing-code") {
    return {
      ...snapshot,
      ponytailOn: target,
      ponytailPluginOn: target,
      ponytailSkills: snapshot.ponytailSkills.map((sk) => ({ ...sk, enabled: target })),
    };
  }
  if (groupId === "desktop-automation") {
    return {
      ...snapshot,
      desktopAuto: target,
      nuphusMcpOn: target,
      desktopSkill: snapshot.desktopSkill ? { ...snapshot.desktopSkill, enabled: target } : null,
    };
  }
  return {
    ...snapshot,
    browserAuto: target,
    browserSkill: snapshot.browserSkill ? { ...snapshot.browserSkill, enabled: target } : null,
  };
}

/** IPC 依赖：渲染层注入，方便单测时替换为假实现。 */
export interface GroupIpc {
  ponytailModeSet(mode: "full" | "off"): Promise<unknown>;
  setPluginLinkedEnabled(pluginId: string, enabled: boolean): Promise<{ failures: string[] }>;
  saveAppSettings(patch: { desktopAutomation?: boolean; browserAutomation?: boolean }): Promise<unknown>;
  /** 引擎直管 MCP 的启停（覆盖表 / 连接器统一入口）。 */
  setMcpServersEnabled(ids: string[], enabled: boolean): Promise<unknown>;
  /** 技能启停（重命名 SKILL.md ↔ SKILL.md.disabled）。 */
  setSkillEnabled(input: { folder: string; enabled: boolean }): Promise<unknown>;
}

/** 应用联动动作：返回失败项列表（聚合），UI 用它来 toast 或提示跳转。 */
export interface ApplyResult {
  failures: string[];
  /** 实际下发的子项数量（用于 toast 文案）。 */
  applied: { ponytailMode?: boolean; ponytailLinked?: boolean; desktop?: boolean; browser?: boolean; nuphus?: boolean; desktopSkill?: boolean; browserSkill?: boolean };
}

export async function applyAction(action: GroupAction, ipc: GroupIpc): Promise<ApplyResult> {
  const failures: string[] = [];
  const applied: ApplyResult["applied"] = {};

  if (action.ponytailMode) {
    try {
      await ipc.ponytailModeSet(action.ponytailMode);
      applied.ponytailMode = true;
    } catch (error: any) {
      failures.push(`写代码模式：${error?.message ?? String(error)}`);
    }
  }

  if (action.ponytailLinked !== undefined) {
    try {
      const result = await ipc.setPluginLinkedEnabled(PONYTAIL_PLUGIN_ID, action.ponytailLinked);
      if (result?.failures?.length) failures.push(...result.failures.map((f) => `ponytail 联动：${f}`));
      else applied.ponytailLinked = true;
    } catch (error: any) {
      failures.push(`ponytail 联动：${error?.message ?? String(error)}`);
    }
  }

  if (action.desktopAutomation !== undefined || action.browserAutomation !== undefined) {
    const patch: { desktopAutomation?: boolean; browserAutomation?: boolean } = {};
    if (action.desktopAutomation !== undefined) { patch.desktopAutomation = action.desktopAutomation; applied.desktop = true; }
    if (action.browserAutomation !== undefined) { patch.browserAutomation = action.browserAutomation; applied.browser = true; }
    try {
      await ipc.saveAppSettings(patch);
    } catch (error: any) {
      failures.push(`应用设置：${error?.message ?? String(error)}`);
    }
  }

  if (action.nuphusMcp !== undefined) {
    try {
      await ipc.setMcpServersEnabled([NUPHUS_MCP_ID], action.nuphusMcp);
      applied.nuphus = true;
    } catch (error: any) {
      failures.push(`nuphus MCP：${error?.message ?? String(error)}`);
    }
  }

  if (action.desktopSkill) {
    try {
      await ipc.setSkillEnabled({ folder: action.desktopSkill.folder, enabled: action.desktopSkill.enabled });
      applied.desktopSkill = true;
    } catch (error: any) {
      failures.push(`技能 ${action.desktopSkill.folder}：${error?.message ?? String(error)}`);
    }
  }

  if (action.browserSkill) {
    try {
      await ipc.setSkillEnabled({ folder: action.browserSkill.folder, enabled: action.browserSkill.enabled });
      applied.browserSkill = true;
    } catch (error: any) {
      failures.push(`技能 ${action.browserSkill.folder}：${error?.message ?? String(error)}`);
    }
  }

  return { failures, applied };
}

/** 子项在 UI 上的展示名 key。 */
export type MemberKey =
  | "ponytail" | "ponytailPlugin" | "ponytailSkills"
  | "desktop" | "nuphusMcp" | "desktopSkill"
  | "browser" | "browserSkill";

/** 列出一个组的所有相关子项及其当前状态（未安装的可选子项不出现）。 */
export function groupMembers(snapshot: SubToggleSnapshot, groupId: CapabilityGroupId): { key: MemberKey; on: boolean }[] {
  if (groupId === "writing-code") {
    return [
      { key: "ponytail", on: snapshot.ponytailOn },
      { key: "ponytailPlugin", on: snapshot.ponytailPluginOn },
      { key: "ponytailSkills", on: ponytailSkillsAllOn(snapshot.ponytailSkills) },
    ];
  }
  if (groupId === "desktop-automation") {
    const items: { key: MemberKey; on: boolean }[] = [
      { key: "desktop", on: snapshot.desktopAuto },
      { key: "nuphusMcp", on: snapshot.nuphusMcpOn },
    ];
    if (snapshot.desktopSkill) items.push({ key: "desktopSkill", on: snapshot.desktopSkill.enabled });
    return items;
  }
  const items: { key: MemberKey; on: boolean }[] = [{ key: "browser", on: snapshot.browserAuto }];
  if (snapshot.browserSkill) items.push({ key: "browserSkill", on: snapshot.browserSkill.enabled });
  return items;
}

/** 主开关的「中间态」文案提示：用于跳转引导，告诉用户还差几项。 */
export interface PartialHint {
  groupId: CapabilityGroupId;
  /** 已就位的子项数（不包含空子项组）。 */
  onCount: number;
  /** 相关子项总数。 */
  totalCount: number;
  /** 未就位的子项简述（用于 toast 文案）。 */
  pendingLabels: string[];
}

export function describePartial(
  snapshot: SubToggleSnapshot,
  groupId: CapabilityGroupId,
  labels: Partial<Record<MemberKey, string>>,
): PartialHint | null {
  const state = groupState(snapshot, groupId);
  if (state !== "partial") return null;
  const members = groupMembers(snapshot, groupId);
  const onCount = members.filter((m) => m.on).length;
  const pendingLabels = members.filter((m) => !m.on).map((m) => labels[m.key] ?? m.key);
  return { groupId, onCount, totalCount: members.length, pendingLabels };
}

/**
 * 子项归属判定：这个子项属于哪个能力组、该组的主开关是否开着。
 * 主开关开着时，子项在其他 tab 被点击「关闭」要被拦下（返回非 null），
 * 引导用户去「常规」页关主开关，否则子项下一秒就被主开关拉回，状态永远对不上。
 */
export function guardOffOwner(
  snapshot: SubToggleSnapshot,
  member: { kind: "plugin"; id: string }
  | { kind: "skill"; folder?: string; name?: string; pluginId?: string }
  | { kind: "mcp"; name: string },
): CapabilityGroupId | null {
  if (member.kind === "plugin") {
    return samePluginId(member.id, PONYTAIL_PLUGIN_ID) && snapshot.ponytailOn ? "writing-code" : null;
  }
  if (member.kind === "mcp") {
    return member.name === NUPHUS_MCP_ID && snapshot.desktopAuto ? "desktop-automation" : null;
  }
  if (isPonytailSkill(member)) return snapshot.ponytailOn ? "writing-code" : null;
  const folder = String(member.folder ?? member.name ?? "");
  if (folder === DESKTOP_SKILL_ID) return snapshot.desktopAuto ? "desktop-automation" : null;
  if (folder === BROWSER_SKILL_ID) return snapshot.browserAuto ? "browser-automation" : null;
  return null;
}
