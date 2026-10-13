/**
 * update-registry —— 「什么东西可以更新、从哪儿更新」的**单一真相源**（10-13 用户令）。
 *
 * 为什么单列这一层：
 *   此前每类组件各有一套更新逻辑（runtime-ipc 管 npm 工具、engine-ipc 管引擎、skills-ipc 管市场技能、
 *   plugins-ipc 管市场插件、codex-official-market-ipc 管官方插件、expert-market-ipc 管专家包……），
 *   它们各自拼自己的源、各自定义"有没有更新"、各自的失败提示写法不同。结果是：用户没有办法
 *   在一处看到全部组件的版本状态，也没有"更新全部"这件东西。
 *
 * 本模块**不做任何网络请求、不写任何文件**，只回答三个问题：
 *   ① 一共有哪几类可更新组件？（COMPONENT_SPECS）
 *   ② 每一类走哪条通道？（UpdateChannel：npm / pip / github / domestic / none）
 *   ③ 这条通道的候选源顺序是什么？（mirrorOrder —— 国内镜像在前、官方兜底）
 *
 * ⛔⛔ **镜像源不在这里硬编码 URL**：npm 的表在 engine-updater（NPMMIRROR/NPMJS）、
 *    pip 的表在 features/pip-sources（清华→腾讯→阿里→中科大→官方）、GitHub 的表在 gh-mirror
 *    （gh-proxy→ghfast→直连）。本模块**引用**它们并按 `downloadSource` 重排，不抄第二份
 *    —— 抄一份就等于埋一个将来必然漂移的字面量（guard 12l 钉）。
 *
 * ⛔ **不支持更新的组件必须出现在这张表里**，并写清 reason：
 *    不写 = 用户以为漏做了；写在别处 = 又是第二份真相源。
 */
import { GH_MIRROR_PREFIXES } from "./gh-mirror";
import { PIP_INDEXES } from "./features/pip-sources";

/** npm 双源（⛔ 与 engine-updater.ts 的 NPMMIRROR / NPMJS 同一组地址，两处必须同步改）。 */
export const NPM_SOURCES = {
  mirror: "https://registry.npmmirror.com",
  official: "https://registry.npmjs.org",
} as const;

/** 更新通道：决定"从哪儿取最新版"。 */
export type UpdateChannel =
  /** npm registry 上的包 */
  | "npm"
  /** PyPI 上的包 */
  | "pip"
  /** GitHub release / tag */
  | "github"
  /** 国内平台自己的 API（CoCoLoop / SkillHub / Gitee 镜像）—— 本来就在国内，无需再镜像 */
  | "domestic"
  /** 没有独立的发布渠道 */
  | "none";

/** 组件大类（控制台按组展示）。 */
export type UpdateGroup = "工具" | "引擎" | "技能" | "插件" | "不可单独更新";

/** 更新方式：决定调用哪个后端。 */
export type UpdateKind =
  | "engine"
  | "npm-tool"
  | "pip-tool"
  | "ponytail"
  | "market-skill"
  | "expert-skill"
  | "market-plugin"
  | "official-plugin"
  | "soul"
  | "unsupported";

export type ComponentSpec = {
  /** 稳定 ID（界面/进度事件/后台调度都用它，不许复用也不会变） */
  id: string;
  kind: UpdateKind;
  label: string;
  group: UpdateGroup;
  /** 包名（没有固定包名的动态类目为 ""） */
  pkg: string;
  channel: UpdateChannel;
  /** 是否有可用的国内镜像源 */
  mirror: boolean;
  /** ⛔ `mirror:false` 时**必须**写清为什么（空串 = 没写清 = 守卫报红） */
  reason: string;
  /**
   * 是否为「动态清单」——同一类有 N 个实例（如装了 12 个市场技能），
   * 需要运行时逐个展开成行；静态的一类是 1 行。
   */
  dynamic: boolean;
  /** 仅在这些平台出现（不填 = 全平台） */
  platforms?: NodeJS.Platform[];
};

/**
 * 全组件清单（**顺序即控制台展示顺序**）。
 *
 * ⛔ 标了 `mirror:false` 的条目不是"待办"，是**结论**：它们没有独立的发布渠道，
 *    强行给它们造一个更新按钮只会让按钮永远转圈或者静默失败。
 */
export const COMPONENT_SPECS: readonly ComponentSpec[] = [
  // ── 工具 ──────────────────────────────────────────────────────────────
  {
    id: "nuphus",
    kind: "npm-tool",
    label: "桌面自动化（Nuphus MCP）",
    group: "工具",
    pkg: "@nuphus/nuphus-mcp",
    channel: "npm",
    mirror: true,
    reason: "npm 包，registry.npmmirror.com 官方镜像（阿里维护，实时同步）",
    dynamic: false,
  },
  {
    id: "playwright-cli",
    kind: "npm-tool",
    label: "浏览器自动化（Playwright CLI）",
    group: "工具",
    pkg: "@playwright/cli",
    channel: "npm",
    mirror: true,
    reason: "npm 包，走 npmmirror",
    dynamic: false,
  },
  {
    id: "computer-use",
    kind: "npm-tool",
    label: "Mac 电脑操作（Computer Use）",
    group: "工具",
    pkg: "open-computer-use",
    channel: "npm",
    mirror: true,
    reason: "npm 包，走 npmmirror",
    dynamic: false,
    // ⛔ 只在 mac 随包安装；Windows 上既没装也不该提示（列出来会永远显示「未检测到已装版本」，
    //    后台还会为它白跑一次 npm 安装）—— 由 visibleSpecs() 按平台过滤掉。
    platforms: ["darwin"],
  },
  {
    id: "cloakbrowser",
    kind: "npm-tool",
    label: "指纹浏览器（CloakBrowser）",
    group: "工具",
    pkg: "cloakbrowser",
    channel: "npm",
    mirror: true,
    reason: "npm 包，走 npmmirror",
    dynamic: false,
  },
  {
    id: "kb-embedding",
    kind: "unsupported",
    label: "知识库语义检索后端（kb-embedding）",
    group: "不可单独更新",
    pkg: "@huggingface/transformers",
    channel: "none",
    mirror: false,
    // ⛔ 诚实标注：它**不是**「装一个 npm 包」这么简单 —— 安装链还包含模型权重预下载
    //    （hf-mirror）、按平台裁剪 onnxruntime 二进制、落 worker。把它塞进普通的
    //    npm 更新路径会跳过裁剪，重装后多出几百 MB 无用二进制。要更新请走知识库页的
    //    「卸载 → 重新安装」，那条路能完整跑完三步。
    reason: "安装链是「npm 装包 + 模型权重预下载 + 按平台裁剪二进制 + 落 worker」四步，不是单包 npm install；走通用 npm 更新会跳过裁剪步骤。需要新版本请用知识库页的「卸载 → 重新安装」，那条路会完整跑完四步",
    dynamic: false,
  },
  {
    id: "markitdown",
    kind: "pip-tool",
    label: "文档转换（markitdown）",
    group: "工具",
    pkg: "markitdown",
    channel: "pip",
    mirror: true,
    reason: "PyPI 包，清华 PyPI 镜像（features/pip-sources 首选项）",
    dynamic: false,
  },
  {
    id: "phone-harness",
    kind: "pip-tool",
    label: "手机控制（phone-harness）",
    group: "工具",
    pkg: "phone-harness",
    channel: "pip",
    mirror: true,
    reason: "PyPI 包，清华 PyPI 镜像",
    dynamic: false,
  },
  {
    id: "laya",
    kind: "pip-tool",
    label: "本地决策模型（Laya）",
    group: "工具",
    pkg: "laya",
    channel: "pip",
    mirror: true,
    reason: "PyPI 包，清华 PyPI 镜像",
    dynamic: false,
  },

  // ── 引擎 ──────────────────────────────────────────────────────────────
  {
    id: "engine",
    kind: "engine",
    label: "Codex 引擎",
    group: "引擎",
    pkg: "@openai/codex",
    channel: "npm",
    mirror: true,
    reason: "npm 包，engine-updater 的「npmmirror 在前、官方源回落」",
    dynamic: false,
  },

  // ── 技能 ──────────────────────────────────────────────────────────────
  {
    id: "ponytail",
    kind: "ponytail",
    label: "ponytail 写代码模式（技能 + 钩子）",
    group: "技能",
    pkg: "DietrichGebert/ponytail",
    channel: "github",
    mirror: true,
    reason: "GitHub release，走 gh-mirror 的 gh-proxy → ghfast → 直连三级通道",
    dynamic: false,
  },
  {
    id: "market-skill",
    kind: "market-skill",
    label: "市场技能（逐个）",
    group: "技能",
    pkg: "",
    channel: "domestic",
    mirror: true,
    reason: "CoCoLoop / SkillHub 国内站 API，本身就在国内；技能没有版本号，判据是内容指纹比对",
    dynamic: true,
  },
  {
    id: "expert-skill",
    kind: "expert-skill",
    label: "专家配套技能包（逐个）",
    group: "技能",
    pkg: "",
    channel: "domestic",
    mirror: true,
    reason: "SkillHub 国内 API；专家包无版本号，按内容指纹判是否变化",
    dynamic: true,
  },

  // ── 插件 ──────────────────────────────────────────────────────────────
  {
    id: "market-plugin",
    kind: "market-plugin",
    label: "Codex 市场插件（逐个）",
    group: "插件",
    pkg: "",
    channel: "domestic",
    mirror: true,
    reason: "Gitee 上的 Codex 官方插件镜像仓库，国内直连",
    dynamic: true,
  },
  {
    id: "official-plugin",
    kind: "official-plugin",
    label: "官方插件市场（逐个）",
    group: "插件",
    pkg: "openai/plugins",
    channel: "github",
    mirror: true,
    reason: "GitHub openai/plugins，读取与下载均走 gh-mirror 加速通道",
    dynamic: true,
  },
  {
    id: "soul",
    kind: "soul",
    label: "人格包（当前应用的那一个）",
    group: "插件",
    pkg: "",
    channel: "domestic",
    mirror: true,
    reason: "SkillHub 国内 API；人格包无版本号，重新拉取即更新",
    dynamic: true,
  },

  // ⛔ 以下为**结论性不支持**：它们没有独立的发布渠道，写在这里是为了「排查没漏」，
  //    而不是留一张 TODO 清单。控制台会显示它们并给出原因。
  {
    id: "builtin-skill",
    kind: "unsupported",
    label: "内置技能（21 个）",
    group: "不可单独更新",
    pkg: "",
    channel: "none",
    mirror: false,
    // ⛔ 原因文案里别写字面噪点「斜杠加星号」这类会形成块注释起始符的组合：它会让朴素的
    //    注释剥离器错位（把从这里到下一个块注释结尾的代码整段吞掉）—— 12l 守卫吃过这个亏。
    reason: "随应用二进制分发（electron/builtin-skills 目录下的 .ts 编译进包），跟随**应用版本**升级，没有独立的发布渠道",
    dynamic: false,
  },
  {
    id: "bundled-tool",
    kind: "unsupported",
    label: "随包内置工具（Python / Node / Git / FFmpeg / jq / Ninja / 7-Zip / yt-dlp / rg / uv / CMake / adb 等）",
    group: "不可单独更新",
    pkg: "",
    channel: "none",
    mirror: false,
    reason: "它们的版本钉在 scripts/lib/tools-versions.cjs，与应用一起打包发布；单独升级会破坏「随包一致」的保证（这也是那张表的存在理由）。需要新版本请升级应用",
    dynamic: false,
  },
  {
    id: "hook",
    kind: "unsupported",
    label: "钩子（hooks）",
    group: "不可单独更新",
    pkg: "",
    channel: "none",
    mirror: false,
    reason: "钩子**没有独立的发布渠道**：它的来源是①随包 ponytail 插件、②市场插件、③用户自己在 hooks/ 目录里写。前两者随其宿主更新（见 ponytail / 官方插件 / 市场插件条目），③属于用户自己的文件，自动重写会把人改的东西冲掉",
    dynamic: false,
  },
  {
    id: "declared-plugin",
    kind: "unsupported",
    label: "声明式插件清单（declared-plugins）",
    group: "不可单独更新",
    pkg: "",
    channel: "none",
    mirror: false,
    reason: "本地 JSON 清单，由用户放置与外部供应链提供，没有版本号也没有上游",
    dynamic: false,
  },
];

/** 按 id 取（找不到返回 undefined；调用方必须判空而不是假定存在）。 */
export function componentSpec(id: string): ComponentSpec | undefined {
  const key = String(id ?? "").trim();
  return COMPONENT_SPECS.find((entry) => entry.id === key);
}

/** 当前平台可见的静态（非动态）条目。 */
export function visibleSpecs(platform: NodeJS.Platform = process.platform): ComponentSpec[] {
  return COMPONENT_SPECS.filter(
    (entry) => !entry.platforms || entry.platforms.includes(platform),
  );
}

/** 可以真正执行更新的组件 id 列表（排除结论性不支持的那批）。 */
export function updatableSpecs(platform: NodeJS.Platform = process.platform): ComponentSpec[] {
  return visibleSpecs(platform).filter((entry) => entry.channel !== "none");
}

export type DownloadSourceSetting = "auto" | "mirror" | "ghproxy" | "ghfast" | "direct" | "proxy";

/**
 * **候选源顺序的唯一真相源** —— 国内镜像在前、官方兜底。
 *
 * @param channel 通道类型
 * @param source 用户在「下载加速」里选的偏好
 * @returns 按尝试序排列的候选源；空数组 = 该通道无需换源（上游本就在国内）
 *
 * ⛔ 返回的是**候选源本身**、不是拼好的 URL：怎么拼是每个后端自己的事
 *    （npm = registry 根、pip = simple 索引、GitHub = 反代前缀）。这里只定**顺序**。
 */
export function mirrorOrder(channel: UpdateChannel, source: DownloadSourceSetting = "auto"): readonly string[] {
  switch (channel) {
    case "npm": {
      // direct → 官方在前；其余（auto / mirror / ghproxy / ghfast）一律国内镜像在前。
      // ⛔ ghproxy/ghfast 是 GitHub 加速通道，对 npm registry 没有对应实现 ⇒ 按 auto 处理。
      return source === "direct"
        ? [NPM_SOURCES.official, NPM_SOURCES.mirror]
        : [NPM_SOURCES.mirror, NPM_SOURCES.official];
    }
    case "pip": {
      // PIP_INDEXES 已是「清华→腾讯→阿里→中科大→官方」，本身就是国内优先。
      // direct 偏好下也**不**把官方提到最前：PyPI 官方在国内连通性不可用已有两次报障记录。
      return PIP_INDEXES;
    }
    case "github": {
      const all = [...GH_MIRROR_PREFIXES] as string[];
      // ⛔ 索引要用 Record<string, string | undefined> —— 直接写字面量对象再取 key，
      //    TS 会报「该属性不存在」（auto/mirror/proxy 本就是不参与选择的取值）。
      const preferred: Record<string, string | undefined> = {
        ghproxy: "https://gh-proxy.com/",
        ghfast: "https://ghfast.top/",
        direct: "",
      };
      const pick = preferred[source];
      if (pick === undefined) return all; // auto / mirror / proxy → 默认三级顺序
      return [pick, ...all.filter((entry) => entry !== pick)];
    }
    case "domestic":
      // 上游本来就在国内（CoCoLoop / SkillHub / Gitee），再加镜像反而多一跳不可控节点。
      return [];
    default:
      return [];
  }
}

/**
 * 给 GitHub 地址套镜像前缀（channel=github 时用 mirrorOrder 的输出轮换）。
 * ⛔ 只对 GitHub 自家域名改写 —— 非 GitHub 主机原样返回（gh-mirror 里的 shouldMirror 同口径）。
 */
export function withPrefix(url: string, prefix: string): string {
  if (!prefix) return url;
  return /^https?:\/\/(api\.)?github\.com\//i.test(url) ? prefix + url : url;
}
