/**
 * constants 的「notices-labels」部分（09-22 从同目录 constants.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
export /** 本地推理服务的常用端点（09-19 用户要求「做一下本地模型适配」）。
 *  ⛔ 本地服务与云端网关有三个关键差异，预设里直接体现，避免用户逐个踩：
 *    ① **多数不需要 API Key**（留空即可，本机服务通常不校验）——所以预设不填 Key；
 *    ② **并发默认压到 1**：单卡本地推理同时跑多路会明显变慢甚至直接 OOM
 *       （KV cache 随并发路数成倍增长），本地场景应该串行；
 *    ③ 协议用 **auto**：Ollama / LM Studio 只提供 Chat Completions（桥会自动转），
 *       vLLM 较新版本有原生 Responses（会直接透传）—— 让桥自己判定比写死更稳。 */
/** 通知队列（09-20）：单条存活时长，以及同时最多显示几条（防多会话并发刷屏糊满一屏）。 */
const NOTICE_TTL_MS = 2600;

export const NOTICE_MAX = 4;

export /** Hook 注入徽标：footer 末尾的小钩子图标，hover 展开本次注入的 hook 列表。
 *  name 是配对键（引擎原始 run.name，含序号与命令路径）；label 是人看的短名。 */

/** 钩子事件名 → 中文短名（引擎推的 run.name 形如 "session-start:0C:\Users\..."，
 *  事件名 + 序号 + 命令路径全拼在一起，直接展示是一长串谁也看不懂的地址）。
 *  展示时剥掉盘符路径、映射中文；配对仍用原始 name。 */
const HOOK_EVENT_LABELS: Record<string, string> = {
  "session-start": "会话启动钩子",
  "session-end": "会话结束钩子",
  "user-prompt-submit": "用户消息钩子",
  "subagent-start": "子代理启动钩子",
  "subagent-end": "子代理结束钩子",
  "pre-tool-use": "工具执行前钩子",
  "post-tool-use": "工具执行后钩子",
  "notification": "通知钩子",
  "stop": "回复完成钩子",
};

export const CJK_TEXT_RE = /[\u3400-\u9fff]/;

export /** 已安装技能的中文注释表：市场技能与引擎内置技能的描述多为英文，这里补齐中文说明，
 *  让「/」命令面板同款的中文注释列在技能面板里也有内容可读（key 为规范化技能名）。 */
const SKILL_ZH_NOTES: Record<string, string> = {
  "browser-automation": "浏览器自动化：网页打开抓取、自动填表、反检测指纹浏览器",
  "desktop-automation": "桌面自动化：截屏、窗口切换、鼠标点击与键盘输入",
  "find-skills": "技能发现：按需求在技能市场检索并安装合适的技能",
  ponytail: "极简编码：只写够用的最少代码，少依赖、少抽象、反对过度设计",
  "ponytail-audit": "极简审计：全仓库扫描过度设计，列出可删可简化的代码",
  "ponytail-review": "极简评审：只针对过度设计审查代码改动",
  "ponytail-debt": "极简技术债：收集代码里因简化而留下的待办",
  "ponytail-gain": "极简收益：统计极简改造节省的代码量与依赖数",
  "ponytail-help": "极简模式说明：Ponytail 全部模式与用法速查",
  "ponytail-evaluate-skill": "评估技能：检查本地技能设计是否合理",
  "self-improvement": "自我进化：记录报错、用户纠正与更好做法，持续沉淀为可复用经验",
  "smart-prompt": "提示词强化：把普通描述改写成结构化高质量提示词再执行",
  "smart-charts": "智能图表：读取数据自动生成可视化图表",
  "dev-expert": "编程专家：项目总控、接口设计、Bug 诊断、代码审查与重构",
  "evaluate-plugin": "插件评估：按工程视角评估本地 Codex 插件的质量",
  "improve-skill": "技能改进：把评估结论转成具体的重写清单",
  "metric-pack-designer": "指标包设计：为插件评估设计自定义度量指标",
  "plugin-eval": "技能/插件评估入口：解释评估结论与改进方向",
  imagegen: "生成图像：需要位图/插画时生成或编辑图片",
  "openai-docs": "官方文档：查询 Codex 模型、定价、定时任务与技能说明",
  "plugin-creator": "插件创建：脚手架式新建 Codex 插件目录",
  "review-agent": "审查代理：对目标代码做只读、缺陷优先的审查",
  "skill-creator": "技能创建：新建或更新符合规范的 Codex 技能",
  "skill-installer": "技能安装：把技能安装到 Codex 技能目录",
};
