/**
 * 软件开发规范 / 应用架构规范（11-03 用户：「个性化再加软件开发规范和应用架构规范，
 * 逻辑跟设计规范一样，记得这个联动专家」）。
 *
 * 每套规范 = 规范正文 spec + 参考文档/素材 refs + 一套预设。
 * 主进程把它写进 AGENTS.md，并在派发专家 / 专家团 / 成员会话时附加到角色提示词里
 * （联动专家），保证 Codex 与专家拿的是同一份工程约束。
 *
 * ⛔ 这是项目级工程约束，不是 token：项目自己的工程规范 / 架构文档优先；
 *    这里只提供默认规范与用户自定义补充。
 * ⛔ 口径（11-03 用户）：前端设计规范只给前端 UI；软件开发规范按**后端 / 服务端**理解；
 *    应用架构规范按**后端 / 全栈架构**理解。三者都会注入 AGENTS.md 与专家会话。
 */
import { frontendDesignPrompt } from "./frontend-design-style.mjs";

const SHARED_DEV_REFS = [
  { name: "阿里巴巴 Java 开发手册（P3C）", url: "https://github.com/alibaba/p3c" },
  { name: "Google Engineering Practices", url: "https://google.github.io/eng-practices/" },
  { name: "Conventional Commits", url: "https://www.conventionalcommits.org/zh-hans/" },
  { name: "12-Factor App", url: "https://12factor.net/zh_cn/" },
];

const SHARED_ARCH_REFS = [
  { name: "凤凰架构", url: "https://icyfenix.cn/" },
  { name: "12-Factor App", url: "https://12factor.net/zh_cn/" },
  { name: "DDD Reference", url: "https://www.domainlanguage.com/ddd/reference/" },
  { name: "CNCF 云原生定义", url: "https://github.com/cncf/toc/blob/main/DEFINITION.md" },
];

export const SOFTWARE_DEV_NORMS = [
  {
    id: "auto",
    label: "跟随项目",
    desc: "不额外注入工程规范，按项目现有约定执行",
    spec:
      "规范（跟随项目）\n"
      + "- 先读项目 AGENTS.md / README / CONTRIBUTING / 相邻代码，按现有约定落地。\n"
      + "- 项目没有规范时，按「务实稳健」的默认工程底线执行。",
    refs: [],
  },
  {
    id: "pragmatic",
    label: "务实稳健",
    desc: "最小改动、修根因、非平凡逻辑有可跑检查",
    spec:
      "规范（务实稳健）\n"
      + "- 先读懂问题与调用方，再动手；最小改动修根因，不修症状。\n"
      + "- 不做没人要的抽象、不为未来需求预留脚手架；能删就不加。\n"
      + "- 非平凡逻辑（分支 / 循环 / 解析 / 金额 / 安全路径）必须留一个坏掉就会失败的检查。\n"
      + "- 错误处理只在系统边界（用户输入 / 外部接口 / 文件与网络）做，内部代码信任框架契约。\n"
      + "- 改动后跑项目已有的构建 / 测试 / 守卫；不声称「看起来对」就完成。\n"
      + "- 只提交自己改的 hunk；共享工作区里不扫走别人的在途改动。",
    refs: SHARED_DEV_REFS,
  },
  {
    id: "prototype",
    label: "快速原型",
    desc: "先跑通主路径，保留接缝，明确 TODO 与验证边界",
    spec:
      "规范（快速原型）\n"
      + "- 先交付能跑通主路径的最小版本，再迭代；不提前做性能优化与完整抽象。\n"
      + "- 临时实现要留清晰接缝（单一入口 / 明确 TODO），方便后续替换。\n"
      + "- 原型也必须验证关键路径；未验证的部分在交付时明确标注。\n"
      + "- 不把原型代码伪装成生产代码：边界、错误、安全缺口要写清楚。",
    refs: SHARED_DEV_REFS,
  },
  {
    id: "enterprise",
    label: "企业级",
    desc: "契约优先、分层清晰、可观测、可回归",
    spec:
      "规范（企业级）\n"
      + "- 接口与数据契约显式化：类型、校验、错误码、超时与重试策略写清。\n"
      + "- 分层单向依赖，禁止跨层深链；共享逻辑下沉基座，特性逻辑留在所属域。\n"
      + "- 关键路径有日志与可观测信息；错误可定位到输入、上下文与结果。\n"
      + "- 非平凡逻辑必须有自动化测试；数据迁移与兼容性要有回滚路径。\n"
      + "- 安全默认开启：最小权限、输入验证、密钥不进代码与日志。",
    refs: SHARED_DEV_REFS,
  },
  {
    id: "secure",
    label: "安全优先",
    desc: "威胁建模、最小权限、输入验证、危险操作确认",
    spec:
      "规范（安全优先）\n"
      + "- 先识别信任边界：用户输入、外部 API、文件、配置、模型输出一律不可信。\n"
      + "- 所有边界输入做校验与编码；禁止拼接 SQL / 命令 / HTML。\n"
      + "- 最小权限：只开放完成当前任务所需的通道与范围；危险操作必须显式确认。\n"
      + "- 密钥、令牌、密码不进代码、日志、错误信息与前端；使用系统安全存储。\n"
      + "- 破坏性操作（删除 / 覆盖 / 清空 / 发消息）先确认，并预留可恢复路径。\n"
      + "- 新增依赖先查来源与许可证，跑依赖审计；不执行不可信脚本。",
    refs: [
      { name: "OWASP Top 10", url: "https://owasp.org/www-project-top-ten/" },
      ...SHARED_DEV_REFS,
    ],
  },
  {
    id: "test-first",
    label: "测试先行",
    desc: "先写复现测试，再修；非平凡逻辑必须有回归",
    spec:
      "规范（测试先行）\n"
      + "- 修 bug 先写能复现的失败测试，再改代码；测试必须真的会因缺陷而红。\n"
      + "- 非平凡逻辑（分支 / 循环 / 解析 / 金额 / 安全路径）配最小回归测试。\n"
      + "- 测试跑真实实现与真实路径，不 mock 掉被测逻辑本身。\n"
      + "- 断言写行为与判据，不写实现细节；避免依赖时间、顺序与外部网络。\n"
      + "- 新断言做一次变异验证：改坏代码必须报红，否则断言是恒真的。\n"
      + "- 改动后跑项目完整检查；测试失败不提交、不声称完成。",
    refs: SHARED_DEV_REFS,
  },
];

export const APP_ARCHITECTURE_NORMS = [
  {
    id: "auto",
    label: "跟随项目",
    desc: "不额外注入架构规范，按项目现有架构执行",
    spec:
      "规范（跟随项目）\n"
      + "- 先读项目架构文档 / 目录结构 / 依赖方向，按现有边界落地。\n"
      + "- 项目没有架构约束时，按「分层单体」的默认边界执行。",
    refs: [],
  },
  {
    id: "layered",
    label: "分层单体",
    desc: "壳 → 域 → 基座单向依赖，禁止反向与深链",
    spec:
      "规范（分层单体）\n"
      + "- 依赖恒为：壳（入口 / 视图）→ 域（功能板块）→ 基座（共享 lib / 组件 / 服务）。\n"
      + "- 基座不反向 import 域；域与域只经公开入口（barrel / app / props）交互，禁止深链内部文件。\n"
      + "- 一个功能一个域；跨域共享逻辑下沉基座，不复制第二份。\n"
      + "- 状态有唯一真相源；副作用挂在动作上，不挂在渲染分支上。\n"
      + "- 新增边界先画清依赖方向；出现环就先拆环再写功能。",
    refs: SHARED_ARCH_REFS,
  },
  {
    id: "modular",
    label: "模块化",
    desc: "按业务域拆模块，接口显式、可独立替换",
    spec:
      "规范（模块化）\n"
      + "- 按业务能力拆模块，每个模块自有状态、接口与测试；不按技术层横向切碎。\n"
      + "- 模块只暴露必要接口；内部实现可替换，调用方不依赖内部文件。\n"
      + "- 模块间通过消息 / 事件 / 显式 API 协作，不共享可变全局状态。\n"
      + "- 共享基座只放稳定能力；频繁变化的业务逻辑留在所属模块。\n"
      + "- 新模块必须能单独启停 / 测试 / 删除，且删除后不留反向依赖。",
    refs: SHARED_ARCH_REFS,
  },
  {
    id: "plugin",
    label: "插件化",
    desc: "内核掌宿主与安全，扩展点能力注入、效果可逆",
    spec:
      "规范（插件化）\n"
      + "- 内核只保留宿主绑定、安全强制与插件运行时；窗口 / 协议 / 权限 / 路径校验不进插件。\n"
      + "- 扩展点通过显式契约（能力注入 / 插槽 / 通道清单）开放，不直接暴露特权对象。\n"
      + "- 插件的副作用必须可逆：注册的通道 / 监听 / 定时器要能 dispose。\n"
      + "- 插件失败不影响内核与其他插件；半注册要回滚。\n"
      + "- ⛔ 不加载不可信第三方代码到特权进程；扩展先声明能力，再按最小权限授予。",
    refs: SHARED_ARCH_REFS,
  },
  {
    id: "distributed",
    label: "服务化",
    desc: "契约、幂等、超时重试、可观测与数据隔离",
    spec:
      "规范（服务化）\n"
      + "- 服务间契约显式：请求 / 响应 / 错误码 / 版本 / 超时 / 重试策略。\n"
      + "- 写操作设计幂等键；重试安全，避免重复扣款 / 重复发消息。\n"
      + "- 跨服务调用必须有超时与熔断；不无限等待，不静默吞错。\n"
      + "- 异步事件要可追踪（trace id / 时间 / 结果），失败可重放。\n"
      + "- 数据按租户 / 用户隔离；不信任客户端自报身份，服务端双重校验。\n"
      + "- 关键路径有日志、指标与告警；部署可回滚。",
    refs: SHARED_ARCH_REFS,
  },
  {
    id: "frontend",
    label: "前端架构",
    desc: "组件边界、状态归属、设计 token、可访问性与性能预算",
    spec:
      "规范（前端架构）\n"
      + "- 组件按职责拆分：展示件只收 props，页面组件持有状态与数据编排。\n"
      + "- 状态归属清晰：全局状态只放跨页共享，局部状态留在组件；URL 可表达的状态进 URL。\n"
      + "- 样式只用项目 token；组件不写死色值 / 字号 / 圆角。\n"
      + "- 可访问性基线：键盘可达、焦点可见、语义标签、对比度达标、触控目标足够大。\n"
      + "- 性能预算：不阻塞首屏；长列表虚拟化；重计算下沉 worker；图片按需加载。\n"
      + "- 错误边界与空 / 载 / 错状态必须实现，不允许静默空白。",
    refs: SHARED_ARCH_REFS,
  },
];

export const DEFAULT_SOFTWARE_DEV_NORM = "auto";
export const DEFAULT_APP_ARCHITECTURE_NORM = "auto";

function normalize(presets, value, fallback) {
  const id = String(value ?? "").trim();
  return presets.some((preset) => preset.id === id) ? id : fallback;
}

export function normalizeSoftwareDevNorm(value) {
  return normalize(SOFTWARE_DEV_NORMS, value, DEFAULT_SOFTWARE_DEV_NORM);
}

export function normalizeAppArchitectureNorm(value) {
  return normalize(APP_ARCHITECTURE_NORMS, value, DEFAULT_APP_ARCHITECTURE_NORM);
}

function promptFor(presets, fallback, style, notes, title, scope) {
  const id = normalize(presets, style, fallback);
  const preset = presets.find((item) => item.id === id);
  const custom = String(notes ?? "").trim();
  const parts = [`Scope: ${scope}`];
  if (preset?.spec) parts.push(preset.spec);
  if (preset?.refs?.length) {
    parts.push(
      "Reference docs: "
      + preset.refs.map((ref) => `${ref.name} — ${ref.url}`).join("; "),
    );
  }
  if (custom) parts.push("User notes:\n" + custom);
  if (!parts.length) return "";
  return `## ${title}\n\n${parts.join("\n\n")}`;
}

export function softwareDevNormsPrompt(style, notes, enabled = true) {
  if (enabled === false) return "";
  return promptFor(
    SOFTWARE_DEV_NORMS,
    DEFAULT_SOFTWARE_DEV_NORM,
    style,
    notes,
    "Software development norms",
    "backend / server-side code and engineering workflow (frontend UI uses the frontend design direction)",
  );
}

export function appArchitectureNormsPrompt(style, notes, enabled = true) {
  if (enabled === false) return "";
  return promptFor(
    APP_ARCHITECTURE_NORMS,
    DEFAULT_APP_ARCHITECTURE_NORM,
    style,
    notes,
    "Application architecture norms",
    "application / backend / full-stack architecture (not visual design)",
  );
}

/** AGENTS.md 与专家会话共用的完整个人规范块（前端设计 + 后端工程 + 应用架构）。 */
export function personalNormsPrompt(input) {
  const frontend = frontendDesignPrompt(input.frontendDesignStyle, input.frontendDesignNotes, input.frontendDesignEnabled);
  const engineering = engineeringNormsPrompt(input);
  return [
    frontend ? `### Frontend design norms (frontend UI only)\n${frontend}` : "",
    engineering ? `### Engineering norms (backend / service / architecture)\n${engineering}` : "",
  ].filter(Boolean).join("\n\n");
}

/** AGENTS.md 与专家会话共用的工程规范块；两套都为空 / 关闭时返回空串。 */
export function engineeringNormsPrompt(input) {
  return [
    softwareDevNormsPrompt(input.softwareDevStyle, input.softwareDevNotes, input.softwareDevEnabled),
    appArchitectureNormsPrompt(input.appArchitectureStyle, input.appArchitectureNotes, input.appArchitectureEnabled),
  ].filter(Boolean).join("\n\n");
}
