/**
 * 项目级约定文件的自动维护（09-26 用户报障：「没有自动创建项目级 AGENTS.md」「DESIGN.md 没生效，
 * 让 agent 自己扫他都不知道」）。
 *
 * 背景：Codex 引擎**原生读取** `<cwd>/AGENTS.md` 并注入会话上下文（项目文档机制）；
 * 但应用此前从不在用户项目里创建它 —— 全新项目里 agent 收不到任何项目级引导，
 * `DESIGN.md` 就算摆在根目录也无人知晓（实测：让 agent 自己扫，它扫不到、也不觉得该扫）。
 *
 * 设计：
 *  - **不覆盖、不重写**用户手写的内容；只在「缺失时创建模板」「存在但从没提及 DESIGN.md、
 *    且项目根确有 DESIGN.md 时**追加**一小段引导（带标记、幂等）」。
 *  - 时机 = `thread/start` 请求转发**之前**：引擎在处理 thread/start 时就读 AGENTS.md，
 *    响应侧才创建会让本会话错过（下一个会话才生效）。
 *  - 全部 try/catch 静默降级 —— 这是启动链的旁路，绝不能让它把会话启动搞挂
 *    （纪律：启动链副作用一律 try/catch，一处裸 await = 窗口能开、功能全哑）。
 */
import fs from "node:fs";
import path from "node:path";

/** 追加段的标记（幂等判据：含它就不再追加）。 */
const HARNESS_APPEND_MARK = "Codex Harness 自动追加";

/** 本次运行内已创建/追加过的目录（专家团 fan-out 会用同一 cwd 并发起多个 thread/start，
    读→判重→追加不是原子，用这个集合挡掉同一轮内的重复写；跨运行靠文件内标记幂等）。 */
const ensuredDirs = new Set<string>();

const AGENTS_TEMPLATE = (date: string) => `# AGENTS.md

<!-- 由 Codex Harness Desktop 自动生成（${date}）。本文件给在本项目里工作的 AI agent 读；可自由修改，建议保留下面的引导。 -->

## 项目说明

（在此写下本项目的关键约定：技术栈、构建/测试命令、目录结构、注意事项。）

## 视觉规范

- 若项目根目录存在 \`DESIGN.md\`：**做任何 UI / 样式改动之前，先完整读它**，并遵守其中的色板、字体、间距与组件约定。
- 改动 \`DESIGN.md\` 所记录的变量（例如 CSS 变量）时，**同步更新该文件** —— 规范与代码一旦漂移，文档会反过来误导后续改动。
`;

const DESIGN_APPEND = (date: string) => `

<!-- 以下由 Codex Harness Desktop 自动追加（${date}），不需要可整段删除 -->
## 视觉规范（${HARNESS_APPEND_MARK}）

- 项目根目录存在 \`DESIGN.md\`（视觉规范）：**做任何 UI / 样式改动之前，先完整读它**，并遵守其中的色板、字体、间距与组件约定；改动了它记录的变量时同步更新它。
`;

/**
 * 确保 `<cwd>/AGENTS.md` 就绪：缺失则创建模板；已存在但从没提及 DESIGN.md、且项目根
 * 确有 DESIGN.md 时追加一次引导。幂等、静默降级（任何失败都不抛出）。
 */
export function ensureProjectAgentsMd(cwd: string): void {
  try {
    const dir = String(cwd ?? "").trim();
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
    const agentsPath = path.join(dir, "AGENTS.md");
    const designPath = path.join(dir, "DESIGN.md");
    const date = new Date().toISOString().slice(0, 10);
    if (!fs.existsSync(agentsPath)) {
      fs.writeFileSync(agentsPath, AGENTS_TEMPLATE(date), "utf8");
      ensuredDirs.add(dir);
      return;
    }
    if (ensuredDirs.has(dir)) return;
    // 已存在：只在「从没提过 DESIGN.md」且「项目根确有 DESIGN.md」时追加一次引导。
    // ⛔ 模板本身已含 DESIGN.md 引导 ⇒ 用追加了它的文件自然跳过（includes 命中）。
    const agents = fs.readFileSync(agentsPath, "utf8");
    if (agents.includes("DESIGN.md") || agents.includes(HARNESS_APPEND_MARK)) return;
    if (!fs.existsSync(designPath)) return;
    fs.appendFileSync(agentsPath, DESIGN_APPEND(date), "utf8");
    ensuredDirs.add(dir);
  } catch {
    // 静默降级：权限 / 只读盘 / 编码等任何失败都不影响会话启动
  }
}
