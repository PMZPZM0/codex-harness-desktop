/**
 * app-view/types（09-21 架构改造：从 src/App.tsx 模块级搬出，纯搬迁）
 *
 * 搬出后 `App.tsx` 与 `useHarnessApp` 都从这里取类型 ⇒ 打破 App ⇄ hook 循环。
 */

import "@xterm/xterm/css/xterm.css";
import { Turn } from "../../lib/turn";
export type Model = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort: string;
  supportsPersonality: boolean;
  isDefault: boolean;
  /** 多供应商支持：该模型所属供应商 id / 名称 / 是否当前生效 */
  provider?: string;
  providerName?: string;
  isActive?: boolean;
  /** 模型输入模态（含 image/video 时下拉显示徽标） */
  inputTypes?: ("text" | "image" | "video")[];
  /** 生效的上下文 / 最大输出（下拉徽标用；用户配置值优先，规格表兜底） */
  contextWindow?: number;
  maxOutputTokens?: number;
};

/** `rolloutMissing`：主进程在 thread/list 里标注的「引擎索引里有、磁盘上 rollout 没了」——
 *  这种会话点开必然失败（引擎报 no rollout found），侧栏据此显示「记录丢失」徽标并拦下点击。
 *  见 electron/main.ts 的 thread/list 分支（09-16 修 Bug 8）。 */
export type Thread = { id: string; preview: string; name?: string | null; cwd: string; updatedAt: number; status: any; turns: Turn[]; rolloutMissing?: boolean };

export type PendingRequest = { id: string | number; method: string; params: any };

export type SystemEvent = { id: string; title: string; text: string; tone?: "info" | "warning" | "error" | "success"; hookKey?: string; at?: number };

/** 导入记录卡上的备注行（发送包装与未发送预览共用同一文案，保证前后一致） */
export type TreeEntry = { fileName: string; isDirectory: boolean; isFile: boolean };

export type SettingsPage = "user" | "general" | "devtools" | "extensibility" | "appearance" | "personalization" | "model" | "relay" | "openai" | "browser" | "computer" | "memory" | "agents" | "teams" | "expert-center" | "plugins" | "mcp" | "ssh" | "skills" | "commands" | "hooks" | "usage" | "channel" | "schedule" | "rpa" | "archive" | "backup" | "storage" | "automation" | "agentteam" | "voice" | "screenshot" | "favorites";
