/** 用户中心的内置头像（10-21 用户要求：换掉表情预设，定制一套好看的头像）。
 *  ⛔ 文件放 public/avatars/，走 BASE_URL 拼接 —— 打包后 index.html 是 file://，
 *     写死 `/avatars/...` 会解析到盘符根目录（icon.png 同款坑）。
 */
import { agentAvatarFaceAt } from "./agent-avatars.mjs";

export type UserAvatarPreset = { id: string; label: string; file: string };

export const USER_AVATAR_PRESETS: UserAvatarPreset[] = [
  { id: "panda", label: "熊猫", file: "user-panda.png" },
  { id: "fox", label: "狐狸", file: "user-fox.png" },
  { id: "tiger", label: "小老虎", file: "user-tiger.png" },
  { id: "cat", label: "白猫", file: "user-cat.png" },
  { id: "dog", label: "柯基", file: "user-dog.png" },
  { id: "lion", label: "小狮子", file: "user-lion.png" },
  { id: "koala", label: "考拉", file: "user-koala.png" },
  { id: "unicorn", label: "独角兽", file: "user-unicorn.png" },
];

/** Codex 的内置形象（10-21 用户要求：不能只有一个头像，要能一键切换）。
 *  同一套 3D 黏土机器人，只换配色；第一项就是默认形象。
 *  ⛔ 默认项必须与 CODEX_DEFAULT_AVATAR_FILE 指向同一文件 —— 画廊靠它判断「当前是默认」。
 */
export const CODEX_AVATAR_PRESETS: UserAvatarPreset[] = [
  { id: "hero", label: "暖金", file: "codex-hero.png" },
  { id: "indigo", label: "靛蓝", file: "codex-indigo.png" },
  { id: "mint", label: "薄荷", file: "codex-mint.png" },
  { id: "amber", label: "暖橙", file: "codex-amber.png" },
  { id: "sakura", label: "樱花", file: "codex-sakura.png" },
  { id: "obsidian", label: "曜石", file: "codex-obsidian.png" },
];

export const CODEX_DEFAULT_AVATAR_FILE = "codex-hero.png";

/**
 * 群成员头像的**智能体面孔**（11-07 用户令：「把 cli 智能体 和子智能体 和 codex 的头像放到这里，
 * 不要放用户的」）。
 *  - 子智能体 / CLI 智能体：从机器人图集里各取 4 张固定面孔（CLI 与子智能体同风格，见
 *    `agentAvatarKindOf`：cli ⇒ subagent 图集）；
 *  - Codex：用户中心那 6 个黏土机器人配色。
 * ⛔ 用户那 8 张动物头像只留给用户中心，⛔ 不再出现在群成员选择器里（老群已选的仍能渲染）。
 */
export type TeamAvatarPreset =
  | { id: string; label: string; group: "子智能体" | "CLI 智能体"; face: { file: string; cell: number; x: number; y: number } }
  | { id: string; label: string; group: "Codex"; file: string };

const SUBAGENT_FACES: Array<[number, number]> = [[0, 0], [1, 2], [2, 4], [3, 6]];
const CLI_FACES: Array<[number, number]> = [[0, 1], [1, 3], [2, 5], [3, 7]];

export const TEAM_AVATAR_PRESETS: TeamAvatarPreset[] = [
  ...SUBAGENT_FACES.map(([sheet, cell], index) => ({
    id: `subagent-${index + 1}`,
    label: `子智能体 ${index + 1}`,
    group: "子智能体" as const,
    face: agentAvatarFaceAt("subagent", sheet, cell),
  })),
  ...CLI_FACES.map(([sheet, cell], index) => ({
    id: `cli-${index + 1}`,
    label: `CLI 智能体 ${index + 1}`,
    group: "CLI 智能体" as const,
    face: agentAvatarFaceAt("subagent", sheet, cell),
  })),
  ...CODEX_AVATAR_PRESETS.map((preset) => ({
    id: `codex-${preset.id}`,
    label: `Codex · ${preset.label}`,
    group: "Codex" as const,
    file: preset.file,
  })),
];

/** 按 id 取团队头像预设；没有就返回 undefined，⛔ 回退交给调用方决定。 */
export function teamAvatarPresetOf(id: string): TeamAvatarPreset | undefined {
  return TEAM_AVATAR_PRESETS.find((preset) => preset.id === id);
}

/** 把头像文件名拼成可加载的静态资源 URL（走 `BASE_URL`，dev 与打包后都对）。 */
export function avatarAsset(file: string): string {
  return `${import.meta.env.BASE_URL}avatars/${file}`;
}
