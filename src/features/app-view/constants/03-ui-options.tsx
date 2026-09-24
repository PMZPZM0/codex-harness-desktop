/**
 * constants 的「ui-options」部分（09-22 从同目录 constants.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { hk } from "../../../lib/hk";
export const LOCAL_MODEL_PRESETS = [
  { id: "ollama", name: "Ollama", url: "http://127.0.0.1:11434/v1", port: "11434" },
  { id: "lmstudio", name: "LM Studio", url: "http://127.0.0.1:1234/v1", port: "1234" },
  { id: "vllm", name: "vLLM", url: "http://127.0.0.1:8000/v1", port: "8000" },
  { id: "llamacpp", name: "llama.cpp", url: "http://127.0.0.1:8080/v1", port: "8080" },
];

export /** 快捷键一览：settings 快捷键弹窗用。keys 是展示用组合，实际绑定在全局 keydown 处理器。 */
const SHORTCUT_GROUPS: { group: string; shortcuts: { keys: string[]; desc: string }[] }[] = [
  {
    group: "对话",
    shortcuts: [
      { keys: ["Enter"], desc: "发送消息" },
      { keys: ["Shift+Enter", "Ctrl+Enter"], desc: "插入换行" },
      { keys: ["Ctrl+Shift+F"], desc: "搜索当前对话内容" },
      { keys: ["Ctrl+L"], desc: "聚焦输入框" },
      { keys: ["Ctrl+Shift+/"], desc: "聚焦输入框（输入命令）" },
    ],
  },
  {
    group: "新建与会话",
    shortcuts: [
      { keys: ["Ctrl+N", "Ctrl+Shift+N"], desc: "新建对话" },
      { keys: ["Ctrl+K", "Ctrl+P", "Ctrl+Shift+P"], desc: "打开命令面板" },
      { keys: ["Ctrl+O"], desc: "更换工作区目录" },
    ],
  },
  {
    group: "界面",
    shortcuts: [
      { keys: ["Ctrl+B"], desc: "打开 / 关闭右侧上下文面板" },
      { keys: ["Ctrl+J"], desc: "打开终端面板" },
      { keys: [","], desc: "打开设置（Ctrl + 逗号）" },
      { keys: ["Ctrl+Shift+S"], desc: "打开设置 · 控制台" },
      { keys: ["Esc"], desc: "关闭当前弹窗 / 面板" },
    ],
  },
  {
    group: "其它",
    shortcuts: [
      { keys: ["Ctrl+Shift+/"], desc: "输入斜杠命令" },
      { keys: ["Ctrl+Z / Ctrl+Y"], desc: "撤销 / 重做（编辑框内）" },
    ],
  },
]
  // 显示层平台化（09-17 mac 适配）：mac 上把 Ctrl+ 显示为 ⌘、Shift+ 显示为 ⇧。
  // 只改**展示**——实际按键判断在全局 keydown 处理器里由 isMacPlatform() 分叉（⌘ 才是命令键）。
  .map((group) => ({ ...group, shortcuts: group.shortcuts.map((item) => ({ ...item, keys: item.keys.map(hk), desc: hk(item.desc) })) }));

export /** 首页内置快捷站点（无收藏时兜底展示，品牌色字母块） */
const QUICK_SITES: { name: string; url: string; color: string }[] = [
  { name: "GitHub", url: "https://github.com", color: "#181717" },
  { name: "OpenAI", url: "https://openai.com", color: "#10a37f" },
  { name: "Google", url: "https://www.google.com", color: "#4285f4" },
  { name: "哔哩哔哩", url: "https://www.bilibili.com", color: "#fb7299" },
  { name: "知乎", url: "https://www.zhihu.com", color: "#0084ff" },
  { name: "百度", url: "https://www.baidu.com", color: "#2932e1" },
];

export const RRULE_DAY_NAMES: Record<string, string> = { MO: "一", TU: "二", WE: "三", TH: "四", FR: "五", SA: "六", SU: "日" };

export /** 机器人是否在线：所有渠道都看网关真实连接状态。
 *  ⚠️ 键名映射：主进程 channels:status 的微信键是 **weixin**，而机器人档案里存的是
 *  **wechat** —— 不映射的话扫码成功后状态永远 undefined，徽章永远「未连接」
 * （09-08 加轮询、09-13 用户再反馈后才定位到是这个键名不匹配）。 */
const CHANNEL_STATUS_KEY: Record<string, string> = { wechat: "weixin" };

export /** 会话自己记录的权限档位，**过白名单**（代码审查发现）。
 *  localStorage 里的值可能是旧版本写入或脏数据 —— 裸传给引擎会被拒（整条 turn/start 失败），
 *  比"不传"更糟。非法/缺失时返回 undefined，调用方落到当前 UI 值（= 改动前行为）。
 *  合法集合同一份判据见 `thread/settings/updated` 分支里的 trusted 校验。 */
const SANDBOX_MODES = ["danger-full-access", "read-only", "workspace-write"] as const;

export const APPROVAL_MODES = ["never", "on-request", "untrusted"] as const;

export /** WorkBuddy 式内联图片 chip：解析 prompt 里的 [图片:path] 占位符，渲染成可悬停/可删除的胶囊。
 *  hover → 浮动预览（预加载完成才显示，避免闪烁）；hover 时图标位变 X（visibility 交换）；
 *  点击 → 全屏 lightbox。纯展示组件，删除/预览通过回调上抛。 */
/** 对话中的文件引用面板（WorkBuddy 式）：候选文件列表由调用方收集传入，
 *  这里负责搜索框、过滤与空态展示。点选后回调 onPick 加入 files 附件。 */

/** WorkBuddy 式输入框（contentEditable）：文本与图片 chip 真正内联在文字流里，
 *  chip 粘贴/插入在光标处，退格可整体删除。prompt 仍以 [图片:路径] 占位符为数据源
 *  （prompt-images.ts 管线与发送组装零改动），DOM 只是它的可编辑视图。
 *  非受控：仅当外部 value 与 DOM 序列化结果不一致（发送清空/切会话/增强/斜杠命令）
 *  才重建 DOM；用户输入只做 DOM→prompt 序列化回流，绝不反向覆盖正在编辑的 DOM。 */

/** 序列化输入框 DOM 为 prompt 字符串：文本节点原样、图片 chip 还原为占位符、
 *  BR/块级边界还原为换行。与 rebuildComposerDom 近似互逆（经 splitPromptSegments）。 */

/** 从占位符字符串重建输入框 DOM：文本段按行拆 <br>，图片/文件段生成内联 chip。 */

const COMPOSER_FILE_CHIP_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';
