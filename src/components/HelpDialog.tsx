import { createPortal } from "react-dom";
import { useEffect } from "react";
import { X, BookOpen } from "lucide-react";

/** 设置页「使用帮助」：面向新手的逐步说明弹窗。
 *
 *  为什么做成共用组件而不是各页各写一个：几页的帮助结构完全一样（步骤 / 注意 / 常见问题），
 *  各写一遍必然出现措辞与交互不一致，且加一页就要复制一遍。
 *
 *  内容只描述**当前应用真实有的入口与字段**（写之前逐页核过控件名），
 *  不写「未来可以」这类承诺——新手照着做走不通会直接失去信任。
 */
export type HelpKey = "model" | "plugins" | "skills" | "mcp" | "agentteam" | "voice" | "devtools";

type HelpSection = { title: string; steps: string[] };
export type HelpContent = { title: string; intro: string; sections: HelpSection[]; tips: string[] };

/** 设置总览：按导航分组给出「这一组干什么、新手先看哪几个」。
 *
 *  与逐页帮助的分工：逐页帮助是"这一页怎么操作"（步骤级），总览是"整个设置里有什么、我先动哪个"
 *  （地图级）。新手最容易卡住的不是不会点按钮，而是**不知道该去哪一页**——所以总览以
 *  「我想做 X → 去 Y 页」的动线组织，而不是照抄导航列表。
 */
export type OverviewGroup = {
  group: string;
  purpose: string;
  items: { page: string; what: string; when: string }[];
  /** 该组里新手最该先看的一页（会标出来）。 */
  startHere?: string;
};

export const OVERVIEW_GROUPS: OverviewGroup[] = [
  {
    group: "账户",
    purpose: "决定 Codex 用哪个「大脑」——要么登录官方账号，要么填第三方供应商的 Key。",
    startHere: "模型",
    items: [
      { page: "用户中心", what: "你的昵称、头像、个性和使用偏好", when: "想让 Codex 认识你、说话更合口味时" },
      { page: "模型", what: "供应商与模型的添加、测试、切换", when: "第一次用必须配（否则发不出消息）" },
      { page: "中转站", what: "一键接入常见中转服务", when: "手上有中转站账号、不想手填地址时" },
      { page: "OpenAI 订阅", what: "登录 ChatGPT 账号用官方额度", when: "有订阅、想直接用官方模型时" },
    ],
  },
  {
    group: "常用",
    purpose: "日常最常改的几项——界面长什么样、Codex 听谁的、装了哪些能力。",
    items: [
      { page: "控制台", what: "总开关与运行状态", when: "想确认引擎是否正常、调基础开关时" },
      { page: "外观", what: "白天/黑夜主题、消息字号、代码高亮配色", when: "觉得字小/刺眼，或想换配色时" },
      { page: "个性化", what: "称呼、回复风格、自定义指令（决定 Codex 怎么跟你说话）", when: "希望它说话更简短/更详细、别老客套时" },
      { page: "语音通话", what: "本机离线语音识别与合成、音色", when: "想用嘴跟它聊、或让它读出来时" },
      { page: "技能", what: "领域知识包（写 PPT、查数据库等）", when: "同类任务反复教它、想让它一次做对时" },
      { page: "插件", what: "从市场装插件，扩展指令/技能/钩子", when: "想要别人做好的整套能力时" },
      { page: "记忆", what: "Codex 记住的偏好与项目背景，可编辑可删", when: "发现它记错了、或想主动告诉它背景时" },
      { page: "命令", what: "自定义快捷命令（输入 / 触发）", when: "有反复要输入的模板话术时" },
    ],
  },
  {
    group: "智能体",
    purpose: "让 Codex 扮演专业角色或多角色协作，处理需要专业方法论的任务。",
    startHere: "专家/专家团",
    items: [
      { page: "专家/专家团", what: "专家中心（单个角色）与专家团（多角色协作）", when: "做投资分析、法律审查、竞品研究这类需要专业流程的活时" },
    ],
  },
  {
    group: "自动化与能力",
    purpose: "让 Codex 能操作你的电脑、连外部系统、按时间自己跑。",
    items: [
      { page: "自动化", what: "浏览器自动化、桌面自动化、RPA 配方", when: "要它帮你点网页、操作软件、复现固定流程时" },
      { page: "MCP", what: "连接器：连数据库、网盘、企业系统", when: "要它读你某个系统里的数据时" },
      { page: "定时任务", what: "让它按时间自动跑（每天/每周）", when: "有规律性的活（日报、巡检）时" },
      { page: "钩子", what: "在特定事件上自动执行脚本", when: "要在它干活前后加自动化动作时" },
      { page: "SSH 服务器", what: "管理远程连接", when: "要它连你的服务器操作时" },
    ],
  },
  {
    group: "数据与统计",
    purpose: "看用量、管占用、备份恢复、清理归档。",
    items: [
      { page: "使用统计", what: "token 用量与花费趋势", when: "想控制成本、看哪个模型烧得快时" },
      { page: "数据管理", what: "占用空间与清理", when: "磁盘紧张、想清旧数据时" },
      { page: "会话备份", what: "备份与恢复会话历史", when: "要换机器或怕丢历史时" },
      { page: "归档管理", what: "已归档会话的查看、恢复、删除", when: "侧栏看不到某个旧会话时来这儿找" },
    ],
  },
  {
    group: "开发工具",
    purpose: "Codex 干活要用的工具链（Python、Git、浏览器内核等按需下载）。",
    startHere: "开发工具",
    items: [
      { page: "开发工具", what: "工具安装状态与一键下载", when: "某个任务提示缺工具时来这里装" },
      { page: "拓展接口", what: "本项目所有可扩展点（IPC/主题/技能/守卫…）的用途、改法、生效方式与配套守卫，可一键复制说明", when: "想自己加一个接口、主题或技能，或接手这份代码想知道从哪下手时" },
      { page: "截图", what: "两种截图（全屏 / 框选）的全局快捷键绑定、是否隐藏窗口、保存目录", when: "想改截图快捷键，或截图没反应（键被别的程序占用时这里会明说）" },
      { page: "收藏夹", what: "收藏的片段/截图/文件/链接的批量管理与「加入 Agent 记忆」", when: "想整理收藏、清理旧条目，或把某条收藏固化进记忆时" },
    ],
  },
];

export type HelpTopic = HelpKey | "overview";

type HelpSectionRaw = { title: string; steps: string[] };

export const HELP_CONTENT: Record<HelpKey, HelpContent> = {
  model: {
    title: "模型配置 · 新手帮助",
    intro: "模型分两类：**订阅账号**（登录 ChatGPT 用官方额度）与**第三方供应商**（填自己的 API 地址与密钥）。二选一即可，配好后在对话框底部切换。",
    sections: [
      {
        title: "方式一：用 OpenAI 官方（有订阅最省事）",
        steps: [
          "左侧选「OpenAI 订阅」",
          "点「登录」按钮，在弹出的浏览器窗口里登录你的 ChatGPT 账号",
          "登录成功后回到应用，模型列表会自动出现——到这里就能用了",
        ],
      },
      {
        title: "方式二：用第三方供应商（自己的 Key）",
        steps: [
          "在本页点「添加供应商」",
          "名称随便填（只用于自己辨认），接口地址填服务商给的 Base URL（通常以 /v1 结尾，例如 https://api.example.com/v1）",
          "密钥粘贴你申请到的 API Key（保存后会加密存储，之后不再明文显示）",
          "协议按服务商要求选：多数中转站用 Responses，个别只支持 Chat Completions",
          "保存后点该供应商的「测试」，能列出模型才算连通",
          "勾选你要用的模型（可多选），保存",
        ],
      },
    ],
    tips: [
      "报 401/403 = 密钥不对或没权限；报 404 = 接口地址填错（多填或少填了 /v1）；连不上 = 检查网络或代理",
      "对话框底部的模型选择器可以随时切换供应商与模型，不用回设置页",
      "同一个会话换供应商时会自动接力（保留历史），不会丢消息",
    ],
  },
  plugins: {
    title: "插件 · 新手帮助",
    intro: "插件给 Codex 增加能力（新指令、新技能、钩子）。上方是**在线市场**，下方是**已安装管理**。",
    sections: [
      {
        title: "安装一个插件",
        steps: [
          "在市场区按分类浏览，或直接搜索插件名/作者",
          "点插件卡片看详情，确认后用「安装」按钮",
          "装完在下方「已安装」列表里能看到它，默认即启用",
        ],
      },
      {
        title: "管理已安装的插件",
        steps: [
          "停用：关掉该插件的开关——它提供的指令、技能、钩子会一起停用（不会删除文件）",
          "删除：点删除按钮彻底移除",
          "来源是 ChatGPT 官方精选市场的插件需要登录账号，API Key 方式装不了",
        ],
      },
    ],
    tips: [
      "装了但 Codex 好像没反应？先看「钩子」页有没有待信任的钩子——未信任的钩子不会执行",
      "插件名带特殊字符（如 @scope/pkg、中文名）也能正常安装与管理",
    ],
  },
  skills: {
    title: "技能 · 新手帮助",
    intro: "技能是给 Codex 的**领域知识包**（怎么写 PPT、怎么查数据库）。装了之后 Codex 会在合适的任务里自动用上，不用你手动挑。",
    sections: [
      {
        title: "装一个技能",
        steps: [
          "在技能清单里按分类浏览或搜索（清单来自 SkillHub 市场）",
          "点「安装」——文件会写入本机技能目录，随取随用",
          "也能从本地导入：把你已有的技能文件夹拖进来",
        ],
      },
      {
        title: "管理",
        steps: [
          "停用/启用：随时切换，停用的技能不会被 Codex 看到",
          "批量操作：选中多个技能一起启用/停用",
          "删除：移除本机文件（市场里还能再装回来）",
        ],
      },
    ],
    tips: [
      "技能太多会拖慢启动与检索——建议只留常用的，一次装十几个容易让 Codex 挑错",
      "技能不生效时先确认它是「启用」状态，再看文件是不是被破坏了（本应用会自动修一批常见格式问题）",
    ],
  },
  mcp: {
    title: "MCP · 新手帮助",
    intro: "MCP（连接器）让 Codex 能连**外部服务**：数据库、网盘、企业系统、某个网站的 API。配好后 Codex 会多出一批对应工具。",
    sections: [
      {
        title: "从一个现成的模板开始（推荐）",
        steps: [
          "在上方「工具广场」里找你要连的服务（按分类或搜索）",
          "点卡片看详情，有接入模板的可以直接「写入连接器」",
          "按表单把地址/密钥补齐，保存",
        ],
      },
      {
        title: "手动添加一个连接器",
        steps: [
          "点「添加连接器」",
          "填名称（自己认得出的名字）、启动命令（如 npx 某包）或地址",
          "需要密钥的填到环境变量区（会加密保存）",
          "保存后应用会写入 Codex 配置并重启引擎，让新工具生效（几秒钟）",
        ],
      },
      {
        title: "控制工具权限",
        steps: [
          "默认每个工具调用都要你批准",
          "想少点确认：把该工具改成自动批准，或只对写入类操作要求确认",
          "不放心的工具直接禁掉（从 Codex 的工具表里消失）",
        ],
      },
    ],
    tips: [
      "显示「已连接」= 进程起来了；工具没出现 → 重启一次引擎或看该连接器的日志",
      "密钥是加密保存的，界面上不会再明文回显——忘了就重新填一个",
    ],
  },
  agentteam: {
    title: "专家 / 专家团 · 新手帮助",
    intro: "**专家**是带专业方法论的单个角色（律师、分析师）；**专家团**是多个角色按流程协作（主理人编排 → 成员分阶段产出 → 汇总交付）。",
    sections: [
      {
        title: "用专家",
        steps: [
          "进「专家中心」按领域挑一个，点卡片直接开始对话",
          "也可以在对话框的快捷入口里 @ 某个专家，让它处理当前任务",
        ],
      },
      {
        title: "用专家团",
        steps: [
          "在「专家团」页选一个团（或自己建：填名称、成员、各自的职责）",
          "发起任务后主理人自动编排，成员各自产出、最后汇总",
          "成员在跑的时候，对话区右侧能看到进度轨与每个成员的工作过程",
        ],
      },
    ],
    tips: [
      "想让 Codex 自己派人干活：点会话**顶栏右上角的「调度」图标**（独立窗口图标左边）打开面板，先开总开关，再按需勾选专家 / 专家团 / 子智能体；**只对当前会话生效**（会话开在独立弹窗里时该按钮不显示，回主窗口开）",
      "同一时间只允许**一个会话**开着「调度」（自动派活）——被别的会话占用时面板会显示占用者",
      "上一轮跑完忘了关调度，导致一直被占用？点面板里的「释放并删除该会话」即可一键清掉",
    ],
  },
  voice: {
    title: "语音通话 · 新手帮助",
    intro: "语音分两块：**通话**（你说话→Codex 回话，全双工）与**听写**（把你说的话变成输入框里的文字）。默认在**本机**跑识别与合成，不上传音频。",
    sections: [
      {
        title: "第一次使用",
        steps: [
          "选一个音色（内置了几个，也能导入你自己的）",
          "点「开始通话」——macOS 会弹麦克风授权，**必须允许**（拒绝后系统会直接终止应用，不是报错）",
          "用快捷键（默认 ⌘/Ctrl+Shift+M）可以随时唤起/结束，不用点界面",
        ],
      },
      {
        title: "想更像真人一点",
        steps: [
          "声音克隆：录一段参考音频，导入后选它作为音色",
          "回复风格、语速、称呼这些在个性化页一起调",
        ],
      },
    ],
    tips: [
      "首次使用要先下载语音模型（几百 MB），慢是正常的；下载失败会在界面提示，重试即可",
      "识别不准：换个安静环境，或在设置里换更准的模型（更吃 CPU）",
      "macOS 上如果应用闪退过一次，去「系统设置 → 隐私与安全性 → 麦克风」里确认本应用是打开的",
    ],
  },
  devtools: {
    title: "开发工具 · 新手帮助",
    intro: "这里管理 Codex 干活需要的工具链（Python、Git、7-Zip、浏览器内核等）。**随包内置的不用装**，其余按需下载。",
    sections: [
      {
        title: "需要装哪些",
        steps: [
          "先看列表里哪些显示「未安装」——只有用到才需要装",
          "写代码：至少装 Git（首次启动可能已自动补装）",
          "跑 Python 脚本：装 Python",
          "做浏览器自动化：在「自动化工具包」里装 playwright-cli 与浏览器内核",
        ],
      },
      {
        title: "安装与排错",
        steps: [
          "点「安装」后等进度跑完（大工具有几百 MB，国内走镜像，失败会自动回落官方源）",
          "装完卡片变「已安装」即可用；Codex 在会话里能直接调用",
        ],
      },
    ],
    tips: [
      "macOS 上用系统自带的 Git / OpenSSL 即可，列表里会显示为「系统已装」",
      "装了却显示未安装？点一次刷新；仍不对就重启应用（工具目录是启动时扫描的）",
    ],
  },
};

/** 帮助弹窗：受控组件，`helpKey` 为 null 时不渲染。
 *  `overview` 是设置总览（分组地图 + 动线），其余是逐页操作帮助。 */
export function HelpDialog({ helpKey, onClose, onNavigate }: { helpKey: HelpTopic | null; onClose: () => void; onNavigate?: (page: string) => void }) {
  useEffect(() => {
    if (!helpKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [helpKey, onClose]);

  if (!helpKey) return null;

  if (helpKey === "overview") {
    return createPortal(
      <div className="modal-backdrop help-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section className="help-modal help-modal-wide" role="dialog" aria-modal="true" aria-label="设置总览">
          <header>
            <div className="help-title"><span><BookOpen size={17} /></span><strong>设置总览 · 不知道去哪一页就先看这里</strong></div>
            <button className="icon-button" title="关闭（Esc）" onClick={onClose}><X size={16} /></button>
          </header>
          <div className="help-body">
            <p className="help-intro">{renderRich(`设置分 ${OVERVIEW_GROUPS.length} 组、共 ${OVERVIEW_GROUPS.reduce((n, g) => n + g.items.length, 0)} 页。**新手只需先配「模型」**，其余按需——下面每页写了「它是干什么的」和「什么时候会用到它」，点页名可直接跳过去。`)}</p>
            {OVERVIEW_GROUPS.map((group) => (
              <div className="help-group" key={group.group}>
                <div className="help-group-head">
                  <h3>{group.group}</h3>
                  <span>{renderRich(group.purpose)}</span>
                </div>
                <div className="help-page-list">
                  {group.items.map((item) => {
                    const isStart = group.startHere === item.page;
                    return (
                      <button
                        type="button"
                        className={`help-page-row${isStart ? " start-here" : ""}`}
                        key={item.page}
                        onClick={() => { onNavigate?.(item.page); onClose(); }}
                        title={onNavigate ? `跳到「${item.page}」` : undefined}
                      >
                        <span className="help-page-name">
                          {item.page}
                          {isStart && <em>新手先看</em>}
                        </span>
                        <span className="help-page-what">{renderRich(item.what)}</span>
                        <span className="help-page-when">{renderRich(item.when)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="help-tips">
              <h3>第一次使用的最短路径</h3>
              <ul>
                <li>{renderRich("**① 模型**：登录官方账号，或添加一个供应商并填 Key（不配这条发不出消息）")}</li>
                <li>{renderRich("**② 个性化**：填你的称呼与偏好，让它说话合你口味")}</li>
                <li>{renderRich("**③ 外观**：太刺眼就切黑夜主题，觉得字小改「大字」")}</li>
                <li>{renderRich("之后用到什么再回来配什么——技能、MCP、自动化都不影响你先把对话用起来")}</li>
              </ul>
            </div>
          </div>
        </section>
      </div>,
      document.body,
    );
  }

  const content = HELP_CONTENT[helpKey];

  return createPortal(
    <div className="modal-backdrop help-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="help-modal" role="dialog" aria-modal="true" aria-label={content.title}>
        <header>
          <div className="help-title"><span><BookOpen size={17} /></span><strong>{content.title}</strong></div>
          <button className="icon-button" title="关闭（Esc）" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="help-body">
          <p className="help-intro">{renderRich(content.intro)}</p>
          {content.sections.map((section) => (
            <div className="help-section" key={section.title}>
              <h3>{section.title}</h3>
              <ol>
                {section.steps.map((step, index) => <li key={index}>{renderRich(step)}</li>)}
              </ol>
            </div>
          ))}
          {content.tips.length > 0 && (
            <div className="help-tips">
              <h3>常见问题</h3>
              <ul>
                {content.tips.map((tip, index) => <li key={index}>{renderRich(tip)}</li>)}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** 把 **重点** 标成 <b>：帮助文本要能强调关键词，但又不想给每段都写 JSX。 */
function renderRich(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <b key={index}>{part.slice(2, -2)}</b>
    : <span key={index}>{part}</span>);
}
