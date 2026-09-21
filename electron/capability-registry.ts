/**
 * 能力选型表：**「同一件事有多个后端」时，"现在走哪条"的唯一来源**。
 *
 * 背景（09-21 调研，对标 Agent-Reach 的「能力层」设计）：
 * 我们的选型规则原先散在四处 —— 技能文案（"首选 browser_*，判据是工具表里有 browser_navigate"）、
 * developer_instructions 的段落、代码注释、以及各处的 if 判断。后果是：
 *  ① 用户**查不到**"现在实际走哪条"（只有侧栏/设置页零散的状态），出问题只能靠猜；
 *  ② 同一个判据会被写第二遍（文案说"首选 X"，代码里实际是 Y）—— 本项目反复踩过这类漂移。
 *
 * 所以这里把「能力 → 有序后端 → 判据」收成**纯函数 + 常量表**（与 `automation-policy.ts` 同风格，
 * 无副作用、可在预检里直接跑真断言）。消费方：
 *  · 主进程 `capabilities:snapshot` IPC → 设置界面的「当前能力链路」；
 *  · 预检（离线跑 `resolveCapabilities`，钉住"关掉总闸就必须没有活动后端"这类不变量）。
 *
 * ⛔ 判据必须与**真实决策处同源**，不许在这里另写一套：
 *  · 自动化总闸 → `shouldRegisterNuphus` / `nuphusDisabledTools`（automation-policy.ts）
 *  · 视觉 env   → `nuphusVisionEnv`（nuphus-env.ts）
 *  否则又变回"两个地方各说各话"。
 */

/** 一个后端：谁来做这件事 + 为什么排在现在这个位置（理由来自实测，不是文档推测）。 */
export type CapabilityBackend = {
  id: string;
  label: string;
  /** 排序理由 / 边界条件（会显示给用户，所以写人话，不要写实现细节） */
  why: string;
};

/** 一个能力：做什么 + 有序后端（自上而下，第一个可用者胜出）。 */
export type CapabilityDefinition = {
  id: string;
  label: string;
  purpose: string;
  backends: readonly CapabilityBackend[];
};

/** 环境观测值 —— 由主进程收集（`collectCapabilityProbe`），纯函数只负责判定。 */
export type CapabilityProbe = {
  platform: string;
  arch: string;
  /** 自动化总闸（设置 → 自动化） */
  desktopSwitch: boolean;
  browserSwitch: boolean;
  /** nuphus MCP 是否可用（二进制存在 + 没被连接器覆盖表禁用） */
  nuphusAvailable: boolean;
  /** 视觉插件的配置是否已下发给 nuphus 进程（NUPHUS_MCP_VISION_*） */
  nuphusVisionEnv: boolean;
  /** 内置「视觉辅助插件」是否已配置（describe_image 用） */
  visionPlugin: boolean;
  /** 内置「生图插件」是否已配置（generate_image 用） */
  imagePlugin: boolean;
  /** 命令行兜底 playwright-cli 是否已安装 */
  playwrightCli: boolean;
  /** markitdown 是否已装（文档附件转换） */
  markitdown: boolean;
};

/** 一个能力的当前结论。 */
export type CapabilityResolution = {
  id: string;
  label: string;
  purpose: string;
  /** 现在实际走哪条；null = 当前没有任何可用后端 */
  activeId: string | null;
  activeLabel: string;
  activeWhy: string;
  /** 其余后端（用来回答"为什么没走它"） */
  alternatives: { id: string; label: string; available: boolean; why: string }[];
  /** 注意事项（边界条件、需要重启才生效之类） */
  note: string;
};

export const CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: "browser",
    label: "浏览器自动化",
    purpose: "打开网页、抓取内容、点击/填表/下载",
    backends: [
      { id: "nuphus-browser", label: "内置 MCP（nuphus browser_*）", why: "功能最全（23 个工具，含多步合一的 browser_exec、复用 Chrome 登录态的 cookie 导入）" },
      { id: "playwright-cli", label: "命令行兜底（playwright-cli）", why: "在「桌面与浏览器自动化」里装了它才可用；MCP 不可用时的替代路径" },
    ],
  },
  {
    id: "desktop",
    label: "桌面控制（键鼠 / 窗口 / 截屏）",
    purpose: "操作真实桌面应用、截屏、多窗口",
    backends: [
      { id: "nuphus-desktop", label: "内置 MCP（nuphus desktop_*）", why: "唯一的真实键鼠控制通道；关掉「桌面自动化」总闸即整体摘除" },
    ],
  },
  {
    id: "vision",
    label: "看图（理解图片内容）",
    purpose: "读取截图/图片里的文字与画面内容",
    backends: [
      { id: "nuphus-vision", label: "nuphus desktop_vision（BYOK 视觉模型）", why: "要用它必须把视觉插件配置下发给 nuphus 进程；改完插件配置需重启应用才生效" },
      { id: "describe-image", label: "内置工具 describe_image（视觉辅助插件）", why: "对图片文件/网址走一遍视觉模型；不吃本地路径以外的特殊能力，但会占用一次插件调用" },
      { id: "local-ocr", label: "本地 OCR（desktop_perceive，无需 key）", why: "纯本地、免费，返回文字 + 坐标；Intel Mac 无平台二进制所以用不了" },
    ],
  },
  {
    id: "image",
    label: "生图",
    purpose: "按描述生成图片",
    backends: [
      { id: "image-plugin", label: "内置工具 generate_image（生图插件）", why: "图片一律落盘到应用数据目录、只把路径给模型（避免几 MB 的 base64 进对话历史）" },
    ],
  },
  {
    id: "documents",
    label: "文档附件（PDF / Word / PPT / Excel）",
    purpose: "把二进制文档转成模型能读的正文",
    backends: [
      { id: "markitdown", label: "markitdown（按需下载）", why: "PDF / Word / PPT 走它；Excel 走内置 openpyxl（markitdown 的 Excel 转换器会多拉 59MB 的 pandas）" },
    ],
  },
  {
    id: "dispatch",
    label: "多智能体调度",
    purpose: "把任务派给另一个会话/子智能体执行",
    backends: [
      { id: "harness-dispatch", label: "内置 MCP（harness-dispatch · agent_invoke）", why: "已固定走 MCP（早期用 dynamicTools 的通道已废弃）；仅主会话注册，委派会话不再往下套娃" },
    ],
  },
];

/** 当前平台有没有本地 OCR（Intel Mac 没有平台二进制，且 ONNX 运行时已放弃 osx-x64）。 */
export function localOcrSupported(probe: Pick<CapabilityProbe, "platform" | "arch">): boolean {
  return !(probe.platform === "darwin" && probe.arch === "x64");
}

/** 逐条判定：每个能力现在走哪条、为什么，以及其余后端为什么没走。 */
export function resolveCapabilities(probe: CapabilityProbe): CapabilityResolution[] {
  /** 每个后端的可用性（判据集中在这里，便于预检逐条验） */
  const availability: Record<string, boolean> = {
    "nuphus-browser": probe.browserSwitch && probe.nuphusAvailable,
    "playwright-cli": probe.playwrightCli,
    "nuphus-desktop": probe.desktopSwitch && probe.nuphusAvailable,
    "nuphus-vision": probe.desktopSwitch && probe.nuphusAvailable && probe.nuphusVisionEnv,
    "describe-image": probe.visionPlugin,
    "local-ocr": probe.desktopSwitch && probe.nuphusAvailable && localOcrSupported(probe),
    "image-plugin": probe.imagePlugin,
    markitdown: probe.markitdown,
    "harness-dispatch": true,
  };

  // ⛔ fail loud：漏写判据的后端会**永远静默判为"未就绪"**（界面显示成"未就绪"，没人会去查），
  //   这比报错危险得多 —— 这属于配置错误而非运行期状态，所以直接抛，别静默降级。
  //   预检【85】加载真函数跑断言时也会因此立刻暴露。
  for (const capability of CAPABILITIES) {
    for (const backend of capability.backends) {
      if (!(backend.id in availability)) {
        throw new Error(`capability-registry: 后端 "${backend.id}" 没有可用性判据（availability 表漏写）`);
      }
    }
  }

  return CAPABILITIES.map((capability) => {
    const first = capability.backends.find((backend) => availability[backend.id]);
    const alternatives = capability.backends
      .filter((backend) => backend.id !== first?.id)
      .map((backend) => ({ id: backend.id, label: backend.label, available: Boolean(availability[backend.id]), why: backend.why }));

    let note = "";
    if (capability.id === "vision") {
      if (!localOcrSupported(probe)) note = "本机是 Intel Mac：没有本地 OCR 的平台二进制，只能靠视觉模型";
      else if (probe.nuphusAvailable && probe.desktopSwitch && !probe.nuphusVisionEnv) note = "视觉插件配置还没下发给 nuphus（想用视觉模型看图，改完插件配置后需重启应用）";
    }
    if (capability.id === "browser" && !probe.browserSwitch) note = "「浏览器自动化」总闸关着：browser_* 已从工具表整体摘除（不是提示词约束，是真移除）";
    if (capability.id === "desktop" && !probe.desktopSwitch) note = "「桌面自动化」总闸关着：desktop_* 已从工具表整体摘除";
    if (capability.id === "documents" && !probe.markitdown) note = "还没装：可在「开发工具」页一键下载，也可以直接让 Codex 自己装（清华 pip 源）";

    return {
      id: capability.id,
      label: capability.label,
      purpose: capability.purpose,
      activeId: first?.id ?? null,
      activeLabel: first?.label ?? "当前不可用",
      activeWhy: first?.why ?? "所需后端都没就绪（见下方说明）",
      alternatives,
      note,
    };
  });
}
