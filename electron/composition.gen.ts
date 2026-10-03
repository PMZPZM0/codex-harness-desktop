/* ⛔ 本文件由 scripts/gen-domain-registry.mjs 生成，禁手改。
   改"启用哪些域"请改 electron/composition.json，然后跑：npm run gen:domains
   守卫【253】逐字节比对生成物与 renderRegistry() 的产物 —— 手改过、或改了配置没重跑，都会红。 */
// ⛔ 下面两行是**接缝的 provide**，必须排在所有域 import 之前（域的 inject 依赖它们）：
//   "ipc"  —— 注册通道（electron/ipc-host.ts）；"host" —— app/secure/shell/dialog/window 五条宿主能力接缝。
//   顺序即契约：把接缝 import 挪到域 import 之后 ⇒ 域 setup 里 ctx.get("host") 得 undefined。
import "./ipc-host";
import "./runtime/seams";
import type { Plugin } from "./context";
import { mountFeature } from "./context";
import { queueTimerFeature as feat_queue_timer } from "./features/queue-timer-ipc";
import { clipboardFeature as feat_clipboard } from "./features/clipboard-ipc";
import { phoneHarnessFeature as feat_phone } from "./features/phone-harness-ipc";
import { updatesFeature as feat_updates } from "./features/updates-ipc";
import { dataDirFeature as feat_dataDir } from "./features/data-dir-ipc";
import { historySearchFeature as feat_history } from "./features/history-search-ipc";
import { workLogsFeature as feat_work_logs } from "./features/work-logs";
import { expertMarketFeature as feat_expert_market } from "./features/expert-market-ipc";
import { soulMarketFeature as feat_soul_market } from "./features/soul-market-ipc";
import { dramaCanvasFeature as feat_drama_canvas } from "./features/drama-canvas";
import { petFeature as feat_pet } from "./features/pet-ipc";
import { screenshotFeature as feat_screenshot } from "./features/screenshot-ipc";
import { favoritesFeature as feat_favorites } from "./features/favorites-ipc";
import { userFeature as feat_user } from "./features/user-ipc";
import { capabilitiesFeature as feat_capabilities } from "./features/capabilities-ipc";
import { notifyFeature as feat_notify } from "./features/notify-ipc";
import { awakeFeature as feat_awake } from "./features/awake-ipc";
import { externalFeature as feat_external } from "./features/external-ipc";
import { shellFeature as feat_shell } from "./features/shell-ipc";
import { botFeature as feat_bot } from "./features/bot-ipc";
import { botsFeature as feat_bots } from "./features/bots-ipc";
import { botBindingFeature as feat_bot_binding } from "./features/bot-binding-ipc";
import { botStreamFeature as feat_bot_stream } from "./features/bot-stream-ipc";
import { channelBotFeature as feat_channel_bot } from "./features/channel-bot-ipc";
import { weixinFeature as feat_weixin } from "./features/weixin-ipc";
import { telegramFeature as feat_telegram } from "./features/telegram-ipc";
import { feishuFeature as feat_feishu } from "./features/feishu-ipc";
import { dingtalkFeature as feat_dingtalk } from "./features/dingtalk-ipc";
import { qqFeature as feat_qq } from "./features/qq-ipc";
import { wecomWebhookFeature as feat_wecom_webhook } from "./features/wecom-webhook-ipc";
import { ponytailFeature as feat_ponytail } from "./features/ponytail-ipc";
import { channelsFeature as feat_channels } from "./features/channels-ipc";
import { memoryFeature as feat_memory } from "./features/memory-ipc";
import { rpaFeature as feat_rpa } from "./features/rpa-ipc";
import { tasksFeature as feat_tasks } from "./features/tasks-ipc";
import { schedulerFeature as feat_scheduler } from "./features/scheduler-ipc";
import { sshFeature as feat_ssh } from "./features/ssh-ipc";
import { terminalFeature as feat_terminal } from "./features/terminal-ipc";
import { browserFeature as feat_browser } from "./features/browser-ipc";
import { gitFeature as feat_git } from "./features/git-ipc";
import { scratchFeature as feat_scratch } from "./features/scratch-ipc";
import { pastedTextFeature as feat_pasted_text } from "./features/pasted-text-ipc";
import { appSettingsFeature as feat_appSettings } from "./features/app-settings-ipc";
import { personalizationFeature as feat_personalization } from "./features/personalization-ipc";
import { teamRunsFeature as feat_team_runs } from "./features/team-runs-ipc";
import { teamThreadsFeature as feat_team_threads } from "./features/team-threads-ipc";
import { teamsFeature as feat_teams } from "./features/teams-ipc";
import { subagentsFeature as feat_subagents } from "./features/subagents-ipc";
import { agentsFeature as feat_agents } from "./features/agents-ipc";
import { commandsFeature as feat_commands } from "./features/commands-ipc";
import { promptFeature as feat_prompt } from "./features/prompt-ipc";
import { connectorsFeature as feat_connectors } from "./features/connectors-ipc";
import { mcpServersFeature as feat_mcp_servers } from "./features/mcp-servers-ipc";
import { openaiFeature as feat_openai } from "./features/openai-ipc";
import { customModelFeature as feat_custom_model } from "./features/custom-model-ipc";
import { modelSpecsFeature as feat_model_specs } from "./features/model-specs-ipc";
import { threadRuntimeFeature as feat_thread_runtime } from "./features/thread-runtime-ipc";
import { codexFeature as feat_codex } from "./features/codex-ipc";
import { runtimeFeature as feat_runtime } from "./features/runtime-ipc";
import { threadsFeature as feat_threads } from "./features/threads-ipc";
import { bridgeFeature as feat_bridge } from "./features/bridge-ipc";
import { engineFeature as feat_engine } from "./features/engine-ipc";
import { builtinFeature as feat_builtin } from "./features/builtin-ipc";
import { pluginFeature as feat_plugin } from "./features/plugin-ipc";
import { toolsFeature as feat_tools } from "./features/tools-ipc";
import { skillsFeature as feat_skills } from "./features/skills-ipc";
import { skillDisciplineFeature as feat_skill_discipline } from "./features/skill-discipline-ipc";
import { pluginsFeature as feat_plugins } from "./features/plugins-ipc";
import { codexOfficialMarketFeature as feat_codex_official_market } from "./features/codex-official-market-ipc";
import { hooksFeature as feat_hooks } from "./features/hooks-ipc";
import { remoteFeature as feat_remote } from "./features/remote-ipc";
import { fsFeature as feat_fs } from "./features/fs-ipc";
import { dialogFeature as feat_dialog } from "./features/dialog-ipc";
import { appFeature as feat_app } from "./features/app-diagnostics";
import { relayFeature as feat_relay } from "./features/relay-ipc";
import { layaFeature as feat_laya } from "./features/laya-service";
import { videoFeature as feat_video } from "./features/video-gen";
import { voiceFeature as feat_voice } from "./features/voice-ipc";

export type EnabledDomain = { id: string; plugin: Plugin<unknown>; config: unknown };

/** 已启用的域（顺序 = composition.json 里的顺序 = 挂载顺序）。
 *  ⛔⛔ 依赖方向恒为 **本生成物 → 域**：域**绝不 import 本文件** —— 反向就是环，
 *     CJS 下 domain 还没求值完 ⇒ plugin 为 undefined ⇒ 启动即崩（10-03 实测事故）。
 *     挂载在**模块作用域**执行 = 与原 import "./features/xxx" 同时机，不改变启动顺序。
 *  ⛔⛔ 本函数体是**模板字符串**：里面**绝不能出现反引号**（会把模板提前闭合 ⇒ 生成器语法错误）。 */
export const ENABLED: EnabledDomain[] = [
  { id: "queue-timer", plugin: feat_queue_timer as Plugin<unknown>, config: null },
  { id: "clipboard", plugin: feat_clipboard as Plugin<unknown>, config: null },
  { id: "phone", plugin: feat_phone as Plugin<unknown>, config: null },
  { id: "updates", plugin: feat_updates as Plugin<unknown>, config: null },
  { id: "dataDir", plugin: feat_dataDir as Plugin<unknown>, config: null },
  { id: "history", plugin: feat_history as Plugin<unknown>, config: null },
  { id: "work-logs", plugin: feat_work_logs as Plugin<unknown>, config: null },
  { id: "expert-market", plugin: feat_expert_market as Plugin<unknown>, config: null },
  { id: "soul-market", plugin: feat_soul_market as Plugin<unknown>, config: null },
  { id: "drama-canvas", plugin: feat_drama_canvas as Plugin<unknown>, config: null },
  { id: "pet", plugin: feat_pet as Plugin<unknown>, config: null },
  { id: "screenshot", plugin: feat_screenshot as Plugin<unknown>, config: null },
  { id: "favorites", plugin: feat_favorites as Plugin<unknown>, config: null },
  { id: "user", plugin: feat_user as Plugin<unknown>, config: null },
  { id: "capabilities", plugin: feat_capabilities as Plugin<unknown>, config: null },
  { id: "notify", plugin: feat_notify as Plugin<unknown>, config: null },
  { id: "awake", plugin: feat_awake as Plugin<unknown>, config: null },
  { id: "external", plugin: feat_external as Plugin<unknown>, config: null },
  { id: "shell", plugin: feat_shell as Plugin<unknown>, config: null },
  { id: "bot", plugin: feat_bot as Plugin<unknown>, config: null },
  { id: "bots", plugin: feat_bots as Plugin<unknown>, config: null },
  { id: "bot-binding", plugin: feat_bot_binding as Plugin<unknown>, config: null },
  { id: "bot-stream", plugin: feat_bot_stream as Plugin<unknown>, config: null },
  { id: "channel-bot", plugin: feat_channel_bot as Plugin<unknown>, config: null },
  { id: "weixin", plugin: feat_weixin as Plugin<unknown>, config: null },
  { id: "telegram", plugin: feat_telegram as Plugin<unknown>, config: null },
  { id: "feishu", plugin: feat_feishu as Plugin<unknown>, config: null },
  { id: "dingtalk", plugin: feat_dingtalk as Plugin<unknown>, config: null },
  { id: "qq", plugin: feat_qq as Plugin<unknown>, config: null },
  { id: "wecom-webhook", plugin: feat_wecom_webhook as Plugin<unknown>, config: null },
  { id: "ponytail", plugin: feat_ponytail as Plugin<unknown>, config: null },
  { id: "channels", plugin: feat_channels as Plugin<unknown>, config: null },
  { id: "memory", plugin: feat_memory as Plugin<unknown>, config: null },
  { id: "rpa", plugin: feat_rpa as Plugin<unknown>, config: null },
  { id: "tasks", plugin: feat_tasks as Plugin<unknown>, config: null },
  { id: "scheduler", plugin: feat_scheduler as Plugin<unknown>, config: null },
  { id: "ssh", plugin: feat_ssh as Plugin<unknown>, config: null },
  { id: "terminal", plugin: feat_terminal as Plugin<unknown>, config: null },
  { id: "browser", plugin: feat_browser as Plugin<unknown>, config: null },
  { id: "git", plugin: feat_git as Plugin<unknown>, config: null },
  { id: "scratch", plugin: feat_scratch as Plugin<unknown>, config: null },
  { id: "pasted-text", plugin: feat_pasted_text as Plugin<unknown>, config: null },
  { id: "appSettings", plugin: feat_appSettings as Plugin<unknown>, config: null },
  { id: "personalization", plugin: feat_personalization as Plugin<unknown>, config: null },
  { id: "team-runs", plugin: feat_team_runs as Plugin<unknown>, config: null },
  { id: "team-threads", plugin: feat_team_threads as Plugin<unknown>, config: null },
  { id: "teams", plugin: feat_teams as Plugin<unknown>, config: null },
  { id: "subagents", plugin: feat_subagents as Plugin<unknown>, config: null },
  { id: "agents", plugin: feat_agents as Plugin<unknown>, config: null },
  { id: "commands", plugin: feat_commands as Plugin<unknown>, config: null },
  { id: "prompt", plugin: feat_prompt as Plugin<unknown>, config: null },
  { id: "connectors", plugin: feat_connectors as Plugin<unknown>, config: null },
  { id: "mcp-servers", plugin: feat_mcp_servers as Plugin<unknown>, config: null },
  { id: "openai", plugin: feat_openai as Plugin<unknown>, config: null },
  { id: "custom-model", plugin: feat_custom_model as Plugin<unknown>, config: null },
  { id: "model-specs", plugin: feat_model_specs as Plugin<unknown>, config: null },
  { id: "thread-runtime", plugin: feat_thread_runtime as Plugin<unknown>, config: null },
  { id: "codex", plugin: feat_codex as Plugin<unknown>, config: null },
  { id: "runtime", plugin: feat_runtime as Plugin<unknown>, config: null },
  { id: "threads", plugin: feat_threads as Plugin<unknown>, config: null },
  { id: "bridge", plugin: feat_bridge as Plugin<unknown>, config: null },
  { id: "engine", plugin: feat_engine as Plugin<unknown>, config: null },
  { id: "builtin", plugin: feat_builtin as Plugin<unknown>, config: null },
  { id: "plugin", plugin: feat_plugin as Plugin<unknown>, config: null },
  { id: "tools", plugin: feat_tools as Plugin<unknown>, config: null },
  { id: "skills", plugin: feat_skills as Plugin<unknown>, config: null },
  { id: "skill-discipline", plugin: feat_skill_discipline as Plugin<unknown>, config: null },
  { id: "plugins", plugin: feat_plugins as Plugin<unknown>, config: null },
  { id: "codex-official-market", plugin: feat_codex_official_market as Plugin<unknown>, config: null },
  { id: "hooks", plugin: feat_hooks as Plugin<unknown>, config: null },
  { id: "remote", plugin: feat_remote as Plugin<unknown>, config: null },
  { id: "fs", plugin: feat_fs as Plugin<unknown>, config: null },
  { id: "dialog", plugin: feat_dialog as Plugin<unknown>, config: null },
  { id: "app", plugin: feat_app as Plugin<unknown>, config: null },
  { id: "relay", plugin: feat_relay as Plugin<unknown>, config: null },
  { id: "laya", plugin: feat_laya as Plugin<unknown>, config: null },
  { id: "video", plugin: feat_video as Plugin<unknown>, config: null },
  { id: "voice", plugin: feat_voice as Plugin<unknown>, config: null },
];

for (const row of ENABLED) mountFeature(row.plugin, row.config);
