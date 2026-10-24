/** 用户中心的内置头像（10-21 用户要求：换掉表情预设，定制一套好看的头像）。
 *  ⛔ 文件放 public/avatars/，走 BASE_URL 拼接 —— 打包后 index.html 是 file://，
 *     写死 `/avatars/...` 会解析到盘符根目录（icon.png 同款坑）。
 */
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
  { id: "bubu", label: "一二布布", file: "user-bubu.png" },
  { id: "bear-brown", label: "棕熊", file: "bear-brown.png" },
  { id: "bear-white", label: "白熊", file: "bear-white.png" },
  { id: "bear-pair", label: "双熊", file: "bear-pair.png" },
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
  { id: "bubu", label: "一二布布", file: "codex-bubu.png" },
  { id: "bear-brown", label: "棕熊", file: "bear-brown.png" },
  { id: "bear-white", label: "白熊", file: "bear-white.png" },
  { id: "bear-pair", label: "双熊", file: "bear-pair.png" },
];

export const CODEX_DEFAULT_AVATAR_FILE = "codex-hero.png";

export function avatarAsset(file: string): string {
  return `${import.meta.env.BASE_URL}avatars/${file}`;
}
