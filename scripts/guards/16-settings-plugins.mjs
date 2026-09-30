/**
 * 预检守卫组：16-settings-plugins —— 「设置 → 插件」页的结构分区。
 *
 * 立此组的原因（2026-09-28 用户：「这三个是内置插件，跟下面插件市场区分开，三个布局做好看一点」）：
 *   改造前，三张**内置**卡散在同一页的两个区块里 —— 生图/视觉在页面顶部的「内置插件」块，
 *   视频生成接口在下方「内置接口」块（与**可安装的**插件市场列表同页），用户分不清
 *   「自带的能力」和「要装的东西」。改造后：三张内置卡同区同构，插件市场独立成区。
 *
 * ⛔ 另钉一个**我自己踩过的坑**：给这套卡片追加样式时，`.bi-plugin-*` 被**追加了两份**
 *    （后者覆盖前者），导致「grid 改单列」改了没生效 —— 文件里同一选择器只允许一份权威定义。
 *
 * 共享面由 ./_ctx.mjs 注入。
 */
import { C, ROOT, join, ok, fail, readFileSync, existsSync, codeOnly } from "./_ctx.mjs";

export async function run() {
  console.log(C.bold("\n【195】设置·插件页的内置卡分区"));

  const builtin = readFileSync(join(ROOT, "src", "components", "BuiltinPlugins.tsx"), "utf8");
  const market = readFileSync(join(ROOT, "src", "features", "settings-plugins", "PluginsMarketSection.tsx"), "utf8");
  const videoCard = readFileSync(join(ROOT, "src", "components", "VideoGenBuiltInCard.tsx"), "utf8");
  const css = readFileSync(join(ROOT, "src", "styles", "07-settings-mcp-connectors.css"), "utf8");

  /* ① 三张内置卡必须**同一个区块**：生图 + 视觉 + 视频 */
  (builtin.includes('<VideoGenBuiltInCard />') && builtin.includes('panel("image")') && builtin.includes('panel("vision")') ? ok : fail)(
    "【195】三张内置卡同区（生图 / 视觉辅助 / 视频生成接口 都在「内置插件」区块）"
  );
  (builtin.includes('className="bi-plugin-grid"') ? ok : fail)(
    "【195】内置卡共用同一容器 .bi-plugin-grid（单列整行）"
  );

  /* ② 插件市场页**不得**再出现内置卡（负向断言：自带能力与可安装插件必须分区）
        ⛔ 匹配前先剥注释 —— 那里的注释正好写着「『内置接口』块搬走了」，不剥会被自己打红。 */
  (!market.includes("VideoGenBuiltInCard") ? ok : fail)(
    "【195】插件市场页不再渲染内置卡（自带 ≠ 市场，混在一页会让人分不清）"
  );
  // ⛔ 判据锚**区块标题的 JSX 形态**（plugin-market-title 后面跟「内置接口」）——
  //    不要用 `/内置接口/` 裸匹配：那条「搬走了」的说明注释就在同文件里，会被自己打红（实测）。
  (!/plugin-market-title[^>]*>\s*内置接口/.test(market) ? ok : fail)(
    "【195】插件市场页不再有「内置接口」区块标题"
  );

  /* ③ 三卡同构 = **同一颗紧凑行组件**（09-28 三次改版：卡面只留一行摘要 + 二级弹窗放字段）。
        用户原话：「为啥这三个卡片要占这么多，不会做出二级弹窗吗」。 */
  const rowComp = readFileSync(join(ROOT, "src", "components", "BuiltinPluginRow.tsx"), "utf8");
  (builtin.includes("<BuiltinPluginRow") && videoCard.includes("<BuiltinPluginRow") ? ok : fail)(
    "【195】三张内置卡都渲染 BuiltinPluginRow（行结构唯一实现 —— 各画一份必然漂移）"
  );
  ([builtin, videoCard].filter((s) => s.includes('className="bi-row"')).length === 0 ? ok : fail)(
    "【195】卡面不再自绘 .bi-row（行结构只能来自 BuiltinPluginRow）"
  );
  (!/<input|textarea|select/.test(rowComp) ? ok : fail)(
    "【195】紧凑行组件里没有任何输入字段（字段只能进二级弹窗 —— 摊在卡上就是用户嫌的『占这么多』）"
  );
  (builtin.includes('className="bi-modal-body"') && videoCard.includes('className="vg-list"') ? ok : fail)(
    "【195】三卡各有二级弹窗承载字段（生图/视觉 .bi-modal-body，视频 .vg-list）"
  );
  (!/className="vg-card"/.test(videoCard) ? ok : fail)(
    "【195】不再使用早期那套 .vg-card 卡片类（已并入统一行 + 弹窗）"
  );

  /* ⑦.5 ⛔ 内置插件的二级弹窗必须 createPortal 到 body（09-28 用户截图：弹窗被嵌在设置面板里，
        左/上/下被面板裁掉、header 整个看不见）。面板祖先链上只要有**任何一级**创建了包含块
        （transform / filter / contain / will-change —— 动画容器很常见），position:fixed 就退化成
        相对该祖先定位。portal 到 body 后与 DOM 祖先彻底无关，是最稳的修法。 */
  (builtin.includes("createPortal(") && builtin.includes(", document.body)") ? ok : fail)(
    "【195】生图 / 视觉弹窗 createPortal 到 body（嵌在面板里会被祖先的包含块裁掉）"
  );
  (videoCard.includes("createPortal(") && videoCard.includes(", document.body)") ? ok : fail)(
    "【195】视频接口弹窗 createPortal 到 body（同一坑，两个弹窗都不能例外）"
  );

  /* ④ ⛔ 同一选择器只允许一份权威定义（追加式改样式的坑：后者覆盖前者，改了像没改） */
  for (const sel of [".bi-plugin-grid", ".bi-row", ".bi-row-icon", ".bi-modal-body", ".bi-modal-foot"]) {
    const n = (css.match(new RegExp(`^\\${sel} \\{`, "gm")) ?? []).length;
    (n <= 1 ? ok : fail)(`【195】${sel} 只有一份定义（实测 ${n} 份 —— 重复追加会让前面的改动静默失效）`);
  }

  /* ⑤ 主题合规：卡片与弹窗样式不许写死色值（DESIGN.md 规则 1） */
  const cardBlock = css.slice(css.indexOf(".bi-plugin-grid"));
  (!/#[0-9a-fA-F]{3,8}\b/.test(cardBlock) ? ok : fail)(
    "【195】内置卡 / 弹窗样式只用主题变量（无写死色值 —— 写死会在暗色主题下瞎掉）"
  );

  /* ⑥ 淘汰的样式类不该留残印 */
  (!/\.vg-card/.test(css) ? ok : fail)("【195】.vg-card 系列样式已清（弹层的 .vg-* 保留）");

  /* ⑦ 窄容器不许溢出（09-28 用户截图：三行右侧的「状态 + 配置」被面板边界裁掉）
        ⛔ 病根是 **grid 列写成 `1fr`** —— grid 列的默认最小值是 `auto`(=min-content)，
           而行内描述是 `nowrap` ⇒ 列的 min-content = 整句话宽（远大于面板）⇒ 列被撑宽、
           整行溢出容器。必须 `minmax(0, 1fr)`。这是"grid 子项溢出"的标准修法，
           与 flex 里给子项 `min-width: 0` 是同一件事的两面 —— 两处都要有。
        ⛔ 上一次离线预览用 900px 宽容器 ⇒ 完全没暴露（面板实际 ~620px）。**验证必须用真实宽度**。 */
  (/\.bi-plugin-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(css) ? ok : fail)(
    "【195】内置卡网格用 minmax(0,1fr) 而非 1fr（否则 nowrap 描述撑宽列 ⇒ 右侧状态/按钮被面板裁掉）"
  );
  (/\.bi-row\s*\{[^}]*min-width:\s*0/.test(css) ? ok : fail)(
    "【195】.bi-row 作为 grid 项允许收缩（min-width:0，与上一条配套）"
  );
  (/\.bi-row > \.bi-row-state,\s*\n\.bi-row > \.secondary-setting \{ flex: none; \}/.test(css) ? ok : fail)(
    "【195】行内状态胶囊与按钮 flex:none（中文 min-content 只有一个字宽，不写会被挤成一条）"
  );

  /* ⑧ 视频配套技能（15-skill-video-generation）不得与厂商源码漂移（09-28 用户要求「配套的视频技能」）
        ⛔ 技能教的矩阵若与 video-providers.mjs 不一致（改了厂商/模型没跟技能），模型会拿
        过时的 defaultModel 与首帧规则去误导用户 —— 校验技能正文里的每个 defaultModel。 */
  {
    const skillTs = readFileSync(join(ROOT, "electron", "builtin-skills", "15-skill-video-generation.ts"), "utf8");
    const registered = readFileSync(join(ROOT, "electron", "builtin-skills.ts"), "utf8");
    (registered.includes('["video-generation", VIDEO_GENERATION_SKILL]') ? ok : fail)(
      "【195】视频配套技能已注册进 builtin-skills（漏登记 = 引擎永远看不到）"
    );
    /* ⛔⛔ 09-29 反转（用户：「替换掉之前老的技能」）：上一版这条断言要求正文写
       「模型没有视频生成工具」—— 那在 09-28 是事实（视频只有渲染层 IPC）。09-29 加了
       MCP 三件套后，那句话成了**过期内容**：技能是模型的行动手册，手册说"你没这工具"
       会让它在有工具时也不敢用、退回"让用户自己去点"。新判据锚**两条路径都在**：
       工具（首选）+ 命令行（老会话兜底）—— 只留一条都会出问题。 */
    (/video_generate/.test(skillTs) && /video_status/.test(skillTs) && /video_concat/.test(skillTs) ? ok : fail)(
      "【195】视频技能教的是 MCP 三件套（缺任一 = 模型不知道有这条路径，又退回让用户手点）"
    );
    (!/模型\*\*没有\*\*视频生成工具/.test(skillTs) ? ok : fail)(
      "【195】不再宣称「模型没有视频生成工具」（09-29 起有 MCP 工具；过期声明会让模型不敢用）"
    );
    (/循环里 sleep 轮询|绝不要在循环里/.test(skillTs) ? ok : fail)(
      "【195】技能写明禁止循环轮询等视频（一条视频几分钟，循环 = 整个回合卡死）"
    );
    const providersSrc = readFileSync(join(ROOT, "src", "lib", "video-providers.mjs"), "utf8");
    const pairs = [...providersSrc.matchAll(/\{ id: "([a-z]+)",[^}]*?defaultModel: "([^"]+)"/g)];
    (pairs.length >= 8 ? ok : fail)(`【195】从厂商源码解析出默认模型（实测 ${pairs.length} 家 —— 解析失配会让本断言静默恒真）`);
    // ⛔ matchAll 元素 = [全文, 组1(id), 组2(defaultModel)]：解构必须跳过前两个。
    //    （首版写成 ([, model]) 取到的是 id ⇒ 检查变成「正文有没有 wanx/minimax 这类英文 id」，
    //     而正文用的是中文名 ⇒ 假红 4 家 —— 实测踩坑。）
    const missing = pairs.filter(([, , model]) => !skillTs.includes(model));
    (missing.length === 0 ? ok : fail)(
      `【195】技能矩阵与厂商源码一致${missing.length ? "：缺 " + missing.map((m) => m[1]).join(", ") : "（8 家 defaultModel 全在正文中）"}`
    );
    /* ⑧.5 命令行执行路径：模型能真跑的唯一方式（IPC 只有界面能调）—— 缺任一环 = 技能是空中楼阁 */
    const cli = join(ROOT, "resources", "tools", "harness-video.mjs");
    (existsSync(cli) ? ok : fail)("【195】视频命令行助手存在（resources/tools/harness-video.mjs）");
    const pkgJson = readFileSync(join(ROOT, "package.json"), "utf8");
    (pkgJson.includes('"src/lib/video-providers.mjs"') ? ok : fail)(
      "【195】打包 files 含 src/lib/video-providers.mjs（⛔ 缺了 = 安装版主进程顶层 require 失败 ⇒ 主进程起不来）"
    );
    (pkgJson.includes('"to": "tools/video-providers.mjs"') && pkgJson.includes('"to": "tools/harness-video.mjs"') ? ok : fail)(
      "【195】extraResources 带 CLI 与适配层副本（asar 外 —— 模型的 node 读不了 asar）"
    );
    (skillTs.includes("harness-video.mjs") ? ok : fail)(
      "【195】技能正文写明命令行路径（有真路径不写 = 模型只能引导用户手点）"
    );

    /* ⑨ 生图配套技能（16-skill-image-generation，09-29 用户：「去 GitHub 找热门生图 skills 内置好」）
       ⛔ 方法论可以借鉴外部（提示词结构 / 尺寸选择 / 变体策略），但**执行路径必须指向本应用的能力** ——
       那些热门 skill 本体都要求装第三方 CLI 并另配海外密钥，与本应用「用户自带密钥 + 内置通道」重复。 */
    {
      const imgSkill = readFileSync(join(ROOT, "electron", "builtin-skills", "16-skill-image-generation.ts"), "utf8");
      (registered.includes('["image-generation", IMAGE_GENERATION_SKILL]') ? ok : fail)(
        "【195】生图配套技能已注册进 builtin-skills（漏登记 = 引擎永远看不到）"
      );
      (/image_generate/.test(imgSkill) && /harness-media\.mjs/.test(imgSkill) ? ok : fail)(
        "【195】生图技能两条路径都在（工具首选 + 命令行兜底）"
      );
      // ⛔ 负向：教模型自己拼 HTTP 请求 = 绕过用户配置（读不到密钥）且行为不受控
      (/不要自己写脚本|不要自己拼请求|不要自己写脚本直接请求/.test(imgSkill) ? ok : fail)(
        "【195】生图技能明确禁止「自己写脚本调生图接口」"
      );
      (/count/.test(imgSkill) && /变体/.test(imgSkill) ? ok : fail)(
        "【195】生图技能写了多变体策略（热门 skill 的共性做法：一次出多张让用户挑）"
      );
    }
  /* ══ Codex 日志管理（09-29 用户：「加一个 Codex 日志管理功能，在数据管理里面…按项目分类，
        项目里面再按时间分类，可以批量删除和清空」）══
     ⛔ 这是**销毁性**功能：删的 rollout 是对话全文原档，引擎不会重建。判据盯三件事：
     域接线完整、删除范围收得住（越界/目录一律拒绝）、级联清索引（否则会话列表留死条目）。 */
  {
    const logs = codeOnly(readFileSync(join(ROOT, "electron", "features", "codex-logs.ts"), "utf8"));
    const mainSrc = codeOnly(readFileSync(join(ROOT, "electron", "main.ts"), "utf8"));
    const registry = codeOnly(readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8"));
    const panel = codeOnly(readFileSync(join(ROOT, "src", "features", "storage-settings", "CodexLogsSection.tsx"), "utf8"));
    const settingsSrc = codeOnly(readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "08-settings-sheet", "01-settings-layout", "00-settings-registry.tsx"), "utf8"));

    // ① 域接线（缺一处 = 页面点了没反应 / 通道不存在）
    (mainSrc.includes('import "./features/codex-logs"') ? ok : fail)(
      "【200】main.ts 加载期 import 新域（handler 注册时机 —— 漏了通道根本不存在）"
    );
    (registry.includes('prefix: "codex-logs"') && registry.includes('"codex-logs:scan"') && registry.includes('"codex-logs:delete"') ? ok : fail)(
      "【200】ipc-registry 登记 codex-logs 域两通道（不改被【107】/【90】报红）"
    );
    (settingsSrc.includes("<CodexLogsSection") && settingsSrc.includes("storage:") ? ok : fail)(
      "【200】挂在「数据管理」页（storage）—— 用户指定的位置"
    );

    // ② 删除范围收得住
    (logs.includes("ROLLOUT_RE.test(path.basename(target))") ? ok : fail)(
      "【200】只认 rollout-*.jsonl（别的文件一律不动 —— 通道是销毁性的，范围必须窄）"
    );
    (logs.includes("const inside = roots.some") ? ok : fail)(
      "【200】越界拒绝：目标必须落在 codex-home 的 sessions / archived_sessions 之内"
    );
    (logs.includes("stat.isFile()") && logs.includes("failed.push(target)") ? ok : fail)(
      "【200】目录/异常目标一律拒绝并记进 failed（不是静默跳过）"
    );
    (logs.includes("if (!stat) { continue; }") ? ok : fail)(
      "【200】文件已不存在时幂等跳过（删除按钮重跑不报错）"
    );

    // ③ 级联：索引里的死条目
    (logs.includes("session_index.jsonl") && logs.includes("indexCleaned") ? ok : fail)(
      "【200】级联剔除 session_index.jsonl 条目（不剔 = 会话列表留打不开的死条目）"
    );

    // ④ 扫描：项目归属来自 rollout 首行 cwd（按项目分类的判据）
    (logs.includes("payload?.cwd") || logs.includes("payload.cwd") ? ok : fail)(
      "【200】项目归属读 rollout 首行 session_meta 的 cwd（不然分不出项目）"
    );
    (logs.includes("archived_sessions") ? ok : fail)(
      "【200】归档目录同样纳入管理（archived_sessions 也是 Codex 写的日志）"
    );

    // ⑤ 危险护栏：删除必须过二次确认，且文案说清不可恢复
    (panel.includes("openAppConfirm") && panel.includes("不可恢复") ? ok : fail)(
      "【200】删除前二次确认且明说「不可恢复」（对话原档删了没有回收站）"
    );
    (panel.includes("清空全部") ? ok : fail)("【200】提供整库清空入口（用户点名要「清空」）");
  }

  }
  /* ══ 3D 建模 / 白模视频技能包（09-29 用户立项：「把 3D 建模和白模视频和视频生成配备好对应技能包」）══
     ⛔ 技能是模型的行动手册：**手册说有而实际没有 = 模型调不存在的工具而失败；手册只字不提 =
        模型退化去让用户自己点**。所以两条都要钉：技能存在且注册 + 边界如实（3D 通道没接入就写没接入）。 */
  {
    const reg = readFileSync(join(ROOT, "electron", "builtin-skills.ts"), "utf8");
    const m3d = readFileSync(join(ROOT, "electron", "builtin-skills", "17-skill-3d-modeling.ts"), "utf8");
    const wb = readFileSync(join(ROOT, "electron", "builtin-skills", "18-skill-whitebox-video.ts"), "utf8");
    const vg = readFileSync(join(ROOT, "electron", "builtin-skills", "15-skill-video-generation.ts"), "utf8");

    (/\["3d-modeling", MODELING_3D_SKILL\]/.test(reg) && /\["whitebox-video", WHITEBOX_VIDEO_SKILL\]/.test(reg) ? ok : fail)(
      "【209】两份新技能已注册（只写文件不注册 = 引擎永远发现不了）"
    );
    /* 用户 09-29：「只要让 Codex 清楚这个 3D建模→白模视频→视频生成 的完整流程，并说明 Blender 与 AHOLO
       之间如何搭配」⇒ 三份技能必须**互相点名**，且 3D 技能里要有分工表（Aholo 管零件 / Blender 管空间与运镜 /
       Seedance 管质感），否则模型只知道单个工具、拼不出链路。 */
    (m3d.includes("whitebox-video") && wb.includes("3d-modeling") && wb.includes("video-generation") && vg.includes("whitebox-video") ? ok : fail)(
      "【209】三技能互相点名（3D建模 ↔ 白模视频 ↔ 视频生成；各说各的 = 模型拼不出链路）"
    );
    (m3d.includes("Aholo 管「一件东西长什么样」") && m3d.includes("Blender 管「东西放在哪、镜头怎么走」") ? ok : fail)(
      "【209】3D 技能写清 Blender 与 Aholo 的分工（用户点名要说明的部分）"
    );
    (m3d.includes("没有内置 3D 生成通道") && m3d.includes("不加 Bearer 前缀") && m3d.includes("G1-Turbo") ? ok : fail)(
      "【209】3D 技能写明现状边界（通道未接入）+ 官方 API 要点（无 Bearer / G1 双档）—— 不许假装有工具"
    );
    (wb.includes("reference_video") && wb.includes("公网") && wb.includes("只保留躯体") && wb.includes("2.0/2.5") ? ok : fail)(
      "【209】白模技能写明参考视频路径（公网 URL / 仅 2.x）+ 官方「只保留躯体」注意事项"
    );
    (vg.includes("doubao-seedance-2-5-260628") && vg.includes("白模视频参考") ? ok : fail)(
      "【209】视频技能已同步 Seedance 2.5（模型 ID 与白模参考能力）"
    );
    (!/3D 生成工具|image_to_3d|\.3d:submit/.test(m3d) ? ok : fail)(
      "【209】3D 技能里不许出现不存在的能力名（说了有工具而实际没有 = 更糟）"
    );
  }

  {
    /* 【225】设置页区块不许重复挂载（09-30 实测事故）：CodexLogsSection 早已挂在
       设置页注册表的 storage 页，我这轮误判「没挂载」又在 StorageSettings 里挂了一遍
       ⇒ 同一页渲染两次（用户截图铁证）。
       ⛔ 判据：注册表里挂一次；StorageSettings.tsx 里**零次**（它只负责自己的那部分）。 */
    const regSrc225 = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "08-settings-sheet", "01-settings-layout", "00-settings-registry.tsx"), "utf8");
    const storeSrc225 = readFileSync(join(ROOT, "src", "features", "storage-settings", "StorageSettings.tsx"), "utf8");
    const regCount225 = (regSrc225.match(/<CodexLogsSection/g) || []).length;
    (regCount225 === 1 ? ok : fail)(
      "【225】设置页注册表里 CodexLogsSection 恰好挂一次（挂两次 = 同一页渲染两遍）"
    );
    (!/CodexLogsSection/.test(storeSrc225) ? ok : fail)(
      "【225】StorageSettings.tsx 里不许再挂 CodexLogsSection（注册表才是唯一挂载点）"
    );
    /* 附带：Codex 日志的项目归属靠首行 cwd，首行含 base_instructions 会远超 16KB ——
       固定小缓冲读必失败（实测 15 个文件只认出 3 个）。锚「分块读到行尾」的实现形态。 */
    const logsSrc225 = readFileSync(join(ROOT, "electron", "features", "codex-logs.ts"), "utf8");
    (/const CHUNK = 64 \* 1024/.test(logsSrc225) && /indexOf\("\\n"\)/.test(logsSrc225) && /grab\("cwd"\)/.test(logsSrc225) ? ok : fail)(
      "【225】codex-logs 首行解析：分块读到行尾 + 正则兜底（固定 16KB 缓冲会让项目分组全变「未知项目」）"
    );
    /* 09-30 用户实测三连（空白 / 取消全选无用 / 打开日志目录无用）—— 三条都钉住： */
    const logsComp225 = readFileSync(join(ROOT, "src", "features", "storage-settings", "CodexLogsSection.tsx"), "utf8");
    /* ⛔ 正确形态只有一个：toggle(allPaths, !allPicked) —— 第一个参数恒为全集、第二个决定 add/delete。
       两个错误形态都要禁：`toggle([], …)`（取消方向空循环）与 `toggle(allPicked ? …)`
       （把三元塞进第一个参数 ⇒ 总有一个方向变成空循环；09-30 我修这个 bug 时正好写反成交替失效）。 */
    (/toggle\(allPaths, !allPicked\)/.test(logsComp225) && !/toggle\(\[\],/.test(logsComp225) && !/toggle\(allPicked \?/.test(logsComp225) ? ok : fail)(
      "【225】全选/取消全选用 toggle(allPaths, !allPicked)（传空数组或把三元塞进第一个参数 = 总有一个方向点了没反应）"
    );
    (!/\.revealInFolder\(/.test(logsComp225) && /shellReveal\(data\.sessionsDir\)/.test(logsComp225) ? ok : fail)(
      "【225】「打开日志目录」用 shellReveal（fs:reveal 只收**文件**，传目录必抛错被 catch 吞掉 = 点了没反应）"
    );
    const cssFlow225 = readFileSync(join(ROOT, "src", "styles", "07-settings-mcp-connectors.css"), "utf8");
    const storeFlow225 = readFileSync(join(ROOT, "src", "features", "storage-settings", "StorageSettings.tsx"), "utf8");
    (/is-settings-flow[\s\S]{0,120}min-height: auto/.test(cssFlow225) && storeFlow225.includes("is-settings-flow") && logsComp225.includes("is-settings-flow") ? ok : fail)(
      "【225】数据管理页两段用 is-settings-flow 放开 min-height（.settings-section 默认 100% ⇒ 两段叠加中间空一整屏）"
    );
  }

  {
    /* 【226】工作日志管理（09-30 用户：「记忆有记忆管理，会话有归档管理，现在就是工作日志这个
       没有地方管理」）—— 三块各管各的，⛔ 不许把「项目工作日志」和「引擎会话原档」混成一个东西。 */
    const wlSrc226 = readFileSync(join(ROOT, "electron", "features", "work-logs.ts"), "utf8");
    const regSrc226 = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "08-settings-sheet", "01-settings-layout", "00-settings-registry.tsx"), "utf8");
    const wlComp226 = readFileSync(join(ROOT, "src", "features", "storage-settings", "WorkLogsSection.tsx"), "utf8");
    const oldBlock226 = readFileSync(join(ROOT, "src", "features", "storage-settings", "CodexLogsSection.tsx"), "utf8");
    (/work-logs:scan/.test(wlSrc226) && /work-logs:read/.test(wlSrc226) && /work-logs:delete/.test(wlSrc226) ? ok : fail)(
      "【226】work-logs 三通道齐（scan 扫各项目 memory / read 看正文 / delete 删文件）"
    );
    (wlSrc226.includes(".codex-harness") && /MEMORY\.md/.test(wlSrc226) && /logs/.test(wlSrc226) ? ok : fail)(
      "【226】数据源是**项目里的工作日志**（<项目>/.codex-harness/memory/**）—— 不是引擎会话原档"
    );
    ((regSrc226.match(/<WorkLogsSection/g) || []).length === 1 && !/WorkLogsSection/.test(readFileSync(join(ROOT, "src", "features", "storage-settings", "StorageSettings.tsx"), "utf8")) ? ok : fail)(
      "【226】WorkLogsSection 只挂在设置页注册表一次（同【225】的重复挂载坑）"
    );
    (!/Codex 工作日志/.test(oldBlock226) && /引擎会话原档/.test(oldBlock226) ? ok : fail)(
      "【226】会话原档那块不许自称「工作日志」（两个概念混淆正是用户三次纠正的点）"
    );
    (/toggle\(allPaths, !allPicked\)/.test(wlComp226) ? ok : fail)(
      "【226】工作日志的全选/取消全选也用 toggle(allPaths, !allPicked)（别重犯空循环）"
    );
  }

  {
    /* 【227】确认框必须是**全局模态层**（09-30 用户：「删除记得加上弹窗确认提醒，别在弹窗下面了哦」）。
       DESIGN.md 层级带：全局模态 400 > 画布 90 > 设置内遮罩 80~97。
       ⛔ 事故形态：确认框同时带 .modal-backdrop(400) 与 .agent-ask-backdrop，
       而后者写了 z-index:90 ⇒ 按源顺序把 400 压回 90 ⇒ 在设置页里被页面内的层盖住。 */
    const visualCss = readFileSync(join(ROOT, "src", "styles", "17-visual-cards.css"), "utf8");
    const askRule = /\.agent-ask-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(visualCss);
    (askRule && Number(askRule[1]) >= 400 ? ok : fail)(
      `【227】确认框遮罩是全局模态层（.agent-ask-backdrop 当前 z-index = ${askRule ? askRule[1] : "缺失"}，须 ≥ 400 —— 写成 90 会被设置页内部层盖住）`
    );
    (/\.modal-backdrop\s*\{[^}]*z-index:\s*400/.test(readFileSync(join(ROOT, "src", "styles", "07-settings-mcp-connectors.css"), "utf8")) ? ok : fail)(
      "【227】.modal-backdrop 保持 400（全局模态基线，别被局部样式覆盖）"
    );
  }
}
