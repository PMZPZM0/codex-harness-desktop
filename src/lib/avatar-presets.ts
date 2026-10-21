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
];

export const CODEX_DEFAULT_AVATAR_FILE = "codex.png";

export function avatarAsset(file: string): string {
  return `${import.meta.env.BASE_URL}avatars/${file}`;
}
