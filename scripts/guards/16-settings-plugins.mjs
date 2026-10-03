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
import { C, ROOT, join, ok, fail, readFileSync, existsSync, codeOnly, walk } from "./_ctx.mjs";

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
  /* ══ 【228】会话原档管理已**回滚**（09-30 用户：「归档会话你就放归档界面啊，你放数据管理这里
     干嘛啊」「什么叫搬，回滚不会吗」）══
     ⛔ 事故背景：09-29 我在数据管理页加了一套「引擎会话原档」（扫 rollout 文件 + 按项目/日期
     批量删除 / 整库清空）。可「会话的归档 / 删除」在「归档管理」页早就有权威入口
     （ArchivePage：恢复 / 永久删除 + 二次确认 + 归档态双重门禁）—— 多出来的这个入口等于让
     同一个销毁动作有两套说法不同的 UI，用户看完直接要求回滚（**不是搬迁**）。
     ⛔ 本组是**负向断言**：文件 / IPC 域 / 通道 / 挂载点 / 导出面，任一复活即报红。 */
  {
    const mainSrc228 = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
    const registry228 = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
    const manifest228 = readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8");
    const regSrc228 = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "08-settings-sheet", "01-settings-layout", "00-settings-registry.tsx"), "utf8");
    const idx228 = readFileSync(join(ROOT, "src", "features", "storage-settings", "index.ts"), "utf8");

    (!existsSync(join(ROOT, "electron", "features", "codex-logs.ts")) ? ok : fail)(
      "【228】codex-logs 域实现已删除（会话原档的扫描 / 删除整套回滚）"
    );
    (!existsSync(join(ROOT, "src", "features", "storage-settings", "CodexLogsSection.tsx")) ? ok : fail)(
      "【228】CodexLogsSection 组件已删除（回复滚一半 = 死代码）"
    );
    (!/codex-logs/.test(mainSrc228) && !/codex-logs/.test(registry228) && !/codex-logs/.test(manifest228) ? ok : fail)(
      "【228】main / ipc-registry / manifest 零 codex-logs 残留（域登记与两通道都要清干净，否则预检按「未登记域」报红）"
    );
    (!/CodexLogsSection/.test(regSrc228) && !/CodexLogsSection/.test(idx228) ? ok : fail)(
      "【228】挂载面与导出面零残留（漏一处 = tsc 直接报错）"
    );
    /* 方向唯一性：会话的归档 / 删除只走「归档管理」页；数据管理页只留「存储占用」+「工作日志」。 */
    (/archive: \{ render: \(\) => <ArchiveSettingsSection/.test(regSrc228) && /storage: \{ render: \(\) => <>/.test(regSrc228) ? ok : fail)(
      "【228】会话销毁入口唯一 = 归档管理页；数据管理页只剩存储占用 + 工作日志"
    );
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
    /* 【225】设置页区块挂载唯一性（09-30 实测事故）：同一 Section 挂两处 = 同一页渲染两遍
       （用户截图铁证）。⛔ 判据：区块只允许挂在设置页注册表里；StorageSettings.tsx **零次**
       （它只负责「存储占用 / 会话恢复缓存」那部分）。
       ⚠️ 会话原档那块（CodexLogsSection）已于 09-30 回滚，见【228】；本节只钉仍在的 WorkLogsSection。 */
    const storeSrc225 = readFileSync(join(ROOT, "src", "features", "storage-settings", "StorageSettings.tsx"), "utf8");
    (!/CodexLogsSection|WorkLogsSection/.test(storeSrc225) ? ok : fail)(
      "【225】StorageSettings.tsx 里不许挂任何日志区块（注册表才是唯一挂载点）"
    );
    /* 附带：项目归属靠 rollout 首行的 cwd，而首行含 base_instructions 会远超 16KB ——
       固定小缓冲读必失败（实测 15 个文件只认出 3 个）。锚「分块读到行尾 + JSON/正则双路」的实现形态。 */
    const logsSrc225 = readFileSync(join(ROOT, "electron", "features", "work-logs.ts"), "utf8");
    (/const CHUNK = 64 \* 1024/.test(logsSrc225) && /indexOf\("\\n"\)/.test(logsSrc225) && /\?\.payload\?\.cwd/.test(logsSrc225) ? ok : fail)(
      "【225】work-logs 读 rollout 首行：分块读到行尾 + JSON/正则双路（固定 16KB 缓冲会让项目分组全变「未知项目」）"
    );
    /* 布局三钉：多段流式页不撑满一屏 + 子块必须横向 stretch（否则右侧留白）+ 归档页不卡窄栏。 */
    const cssFlow225 = readFileSync(join(ROOT, "src", "styles", "07-settings-mcp-connectors.css"), "utf8");
    const cssArchive225 = readFileSync(join(ROOT, "src", "styles", "08-settings-engine-update.css"), "utf8");
    (/\n\.settings-section\.is-settings-flow \{[^}]*min-height: auto;/.test(cssFlow225) ? ok : fail)(
      "【225】流式页用 is-settings-flow 放开 min-height（.settings-section 默认 100% ⇒ 多段叠加时中间空一整屏）"
    );
    /* ⛔ 09-30 用户：「自适应啊」。基类 .settings-section 带 align-items: flex-start（那是给
       「左说明 + 右控件」两栏页用的）—— 本类转成 flex column 后它**仍然生效** ⇒ 交叉轴按内容
       宽度收缩，宽屏下每个子块右侧各留一大片空白（实测 1280 视口：section 716，内部工具条 552、
       列表树 353）。必须显式 stretch。 */
    (/\n\.settings-section\.is-settings-flow \{[^}]*align-items: stretch;/.test(cssFlow225) ? ok : fail)(
      "【225】is-settings-flow 必须 align-items: stretch（不然子块按内容宽度收缩，右侧留白 —— 用户点名「自适应」）"
    );
    (!/\.archive-page \{[\s\S]{0,200}?max-width/.test(cssArchive225) ? ok : fail)(
      "【225】归档管理页不卡 max-width（用户要自适应；原来写死 720px 窄栏）"
    );
    /* 撑满宽度后暴露的配套问题：基类 .settings-actions 是 space-between（给「左说明 + 右按钮」
       两栏页用的），卡片里只有一组按钮时会被拉到两端、中间空一大片。 */
    (/\.settings-section\.is-settings-flow > \.settings-actions \{[^}]*justify-content: flex-start;/.test(cssFlow225) ? ok : fail)(
      "【225】卡片内按钮行靠左排（.settings-actions 默认 space-between 会把纯按钮组拆到两端）"
    );
  }

  {
    /* 【226】工作日志管理（09-30 用户：「记忆有记忆管理，会话有归档管理，现在就是工作日志这个
       没有地方管理」）—— 各块各管各的，⛔ 不许把「项目工作日志」和「会话本身」混成一个东西。 */
    const wlSrc226 = readFileSync(join(ROOT, "electron", "features", "work-logs.ts"), "utf8");
    const regSrc226 = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "08-settings-sheet", "01-settings-layout", "00-settings-registry.tsx"), "utf8");
    const wlComp226 = readFileSync(join(ROOT, "src", "features", "storage-settings", "WorkLogsSection.tsx"), "utf8");
    (/work-logs:scan/.test(wlSrc226) && /work-logs:read/.test(wlSrc226) && /work-logs:delete/.test(wlSrc226) ? ok : fail)(
      "【226】work-logs 三通道齐（scan 扫各项目 memory / read 看正文 / delete 删文件）"
    );
    (wlSrc226.includes(".codex-harness") && /MEMORY\.md/.test(wlSrc226) && /logs/.test(wlSrc226) ? ok : fail)(
      "【226】数据源是**项目里的工作日志**（<项目>/.codex-harness/memory/**）—— 不是引擎会话原档"
    );
    ((regSrc226.match(/<WorkLogsSection/g) || []).length === 1 && !/WorkLogsSection/.test(readFileSync(join(ROOT, "src", "features", "storage-settings", "StorageSettings.tsx"), "utf8")) ? ok : fail)(
      "【226】WorkLogsSection 只挂在设置页注册表一次（同【225】的重复挂载坑）"
    );
    /* ⛔ 会话原档那块已回滚（见【228】），但「工作日志 ≠ 对话记录」这条界线仍要写在 UI 上：
       用户为这个概念连纠了三次。 */
    (/不是对话记录/.test(wlComp226) && /归档管理/.test(wlComp226) ? ok : fail)(
      "【226】工作日志面板写明「这不是对话记录」并指向「归档管理」页（用户三次纠正的概念混淆）"
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
    const settingsCss227 = readFileSync(join(ROOT, "src", "styles", "07-settings-mcp-connectors.css"), "utf8");
    const askRule = /\.agent-ask-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(visualCss);
    const baseRule = /\.modal-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(settingsCss227);
    /* ⛔ 判据用**取值比较**、而不是"是否大于某个常量"：真正的约束是「确认框 > 设置弹窗」。
       09-30 实测踩了两次 —— 90（被同元素上 .modal-backdrop 的 400 压回）→ 400（与设置弹窗
       **同级**，而确认框渲染在设置弹窗之前，同级按 DOM 顺序仍然输）⇒ 写成等于基准值同样是 bug。 */
    (askRule && baseRule && Number(askRule[1]) > Number(baseRule[1]) ? ok : fail)(
      `【227】确认框必须严格高于设置弹窗层级（.agent-ask-backdrop = ${askRule ? askRule[1] : "缺失"} vs .modal-backdrop = ${baseRule ? baseRule[1] : "缺失"}）—— 同级或更低，设置页里的确认框就会被设置面板压住（用户现场截图）`
    );
    /* ⛔ 09-30 第三次实测（隔离实例 + elementFromPoint）：确认框 900 与模型引导 / 帮助**同值**，
       又回到「比 DOM 顺序」的老坑 —— 设置页里点「清理」，elementFromPoint 命中的是
       model-guide-lines，确认框整个被压。判据仍是取值比较：确认框必须严格高于所有 900 系弹层。 */
    const css14 = readFileSync(join(ROOT, "src", "styles", "14-model-onboarding.css"), "utf8");
    const guideRule227 = /\.model-guide-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(css14);
    const helpRule227 = /\.help-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(css14);
    (askRule && (!guideRule227 || Number(askRule[1]) > Number(guideRule227[1])) && (!helpRule227 || Number(askRule[1]) > Number(helpRule227[1])) ? ok : fail)(
      `【227】确认框必须严格高于引导/帮助弹层（.agent-ask-backdrop = ${askRule ? askRule[1] : "缺失"} vs .model-guide-backdrop = ${guideRule227 ? guideRule227[1] : "缺失"} / .help-backdrop = ${helpRule227 ? helpRule227[1] : "缺失"}）—— 同值又比 DOM 顺序，确认框照样被压`
    );
    /* ⛔⛔ 同类问题不止确认框（09-30 用户第二次报「弹窗全在设置界面弹窗下面」）：
       `.<X>-backdrop` 与 .modal-backdrop 写在同一元素上时**特异性相同** ⇒ 按**源顺序**决定，
       后加载的 CSS 文件赢 ⇒ 实际生效值 = 那个类自己的 z-index（实测 40~260，它们的本意是
       「设置内遮罩」的语义）⇒ 二级弹窗被设置弹窗整个盖住。
       判据：**动态扫源码**里所有 `modal-backdrop <X>` 的组合，逐个查 CSS 里的 z-index，必须 ≥ 900。
       ⛔ 不写成固定清单 —— 以后新加同类弹窗必须被这条自动抓到（否则就是第三次踩）。 */
    const cssAll227 = walk(join(ROOT, "src", "styles"), [".css"]).map((f) => readFileSync(f.path, "utf8")).join("\n");
    const stacked = new Set();
    for (const f of walk(join(ROOT, "src"), [".tsx", ".ts"])) {
      const text = readFileSync(f.path, "utf8");
      const re = /className=(?:"|`)([^"`]*modal-backdrop[^"`]*)(?:"|`)/g;
      let m;
      while ((m = re.exec(text))) {
        for (const c of m[1].split(/\s+/)) if (c && c !== "modal-backdrop" && !c.includes("{")) stacked.add(c);
      }
    }
    const lowStacked = [...stacked].filter((cls) => {
      const m = new RegExp(`\\.${cls.replace(/-/g, "\\-")}\\b[^{}]*\\{[^}]*?z-index:\\s*(\\d+)`).exec(cssAll227);
      return m && Number(m[1]) < 900;
    });
    (lowStacked.length === 0 ? ok : fail)(
      `【227】与 .modal-backdrop 叠用的弹窗遮罩必须 ≥ 900（同特异性按源顺序，后加载的类会把 400 压回去 ⇒ 弹窗被设置弹窗盖住）；实测 ${stacked.size} 个叠加弹窗${lowStacked.length ? "，偏低：" + lowStacked.join(" / ") : "全部达标"}`
    );
    (baseRule && Number(baseRule[1]) === 400 ? ok : fail)(
      "【227】.modal-backdrop 保持 400（全局模态基线，别被局部样式覆盖）"
    );
  }

  // ── 【236】两个市场的「翻页 / 拉取」接线（10-01 用户反馈双缺陷）──
  //    ① 技能页翻第二页自动回弹第一页：SkillHub 榜单接口不分页（恒回 page:1），渲染层本地切片
  //       翻页，但 refreshMarketSkills 用 result.page 覆写 marketPage + effect 监听 marketPage
  //       refetch ⇒ 用户刚点的页码被按回去。
  //    ② 插件市场整面 AbortError：codex-marketplace.com 国内访问间歇超时，市场清单单发 fetch
  //       无重试（同文件装插件路径早有 fetchWithRetry，唯独列表裸奔）。
  {
    // ⛔ 负向断言先过 codeOnly：part07 的修复注释里就写着「不许 setMarketPage(result.page)」，
    //    不剥注释会被自己的说明注释顶成假红。
    const seg07 = codeOnly(readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part07", "01-seg", "02-files-market-connectors.tsx"), "utf8"));
    (!seg07.includes("setMarketPage(result.page)") ? ok : fail)(
      "【236】技能市场刷新不许用 result.page 覆写 marketPage（榜单接口恒回 page:1，覆盖 = 翻页自动回弹第一页）"
    );
    const seg06 = codeOnly(readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part06", "01-seg", "01-ui-ready-mood-refs.tsx"), "utf8"));
    (!/, bag\.marketPage\]/.test(seg06) ? ok : fail)(
      "【236】技能市场刷新 effect 的 deps 不含 marketPage（翻页是本地切片，不碰远端；监听它 = 每次翻页拉一遍再按回 page 1）"
    );
    const cm = readFileSync(join(ROOT, "electron", "codex-market.ts"), "utf8");
    (/fetchWithRetry\(url, 15_000, 3\)/.test(cm) && !/SKILLHUB_API/.test(cm) ? ok : fail)(
      "【236】插件市场清单请求走 fetchWithRetry（10-01 二次换源 Gitee 后同步锚新源；单发 fetch 一抖整个市场 AbortError，列表不许裸奔）"
    );
    // ④ 界面上渲染出「: any」字样（10-01 用户截图，技能/插件两个市场都在分类 tab 尾部）：
    //    map(...) 收尾多打了 `: any`，JSX 文本节点合法 ⇒ tsc 不报、直接画到界面上。
    //    全仓扫「) }: any<」形态（先剥注释，防说明注释顶成假红）。
    const strayAny = walk(join(ROOT, "src"), [".tsx"])
      .map(({ path: p }) => ({ p, src: codeOnly(readFileSync(p, "utf8")) }))
      .filter(({ src }) => /[\)}]\s*:\s*any\s*</.test(src));
    (strayAny.length === 0 ? ok : fail)(
      `【236】JSX 里不许渲染出残留的类型标注「: any」（实测 ${strayAny.length} 处：${strayAny.map((x) => x.p).slice(0, 3).join("、")}）`
    );
    // ⑤ 新市场域接线（10-01 立项 expert-market / soul-market）：handler 挂载 + 人格生效链 +
    //    专家卡落地，缺一环 = 功能白配。
    /* ⛔ 10-03 P2 批次 8：两个市场拆成两个独立板块（一个文件恒等于一个域前缀）⇒ 断言跟着搬，
       读**两个**文件再拼起来判（拆开不是把断言删掉）。 */
    const mkts = ["expert-market-ipc.ts", "soul-market-ipc.ts"]
      .map((f) => readFileSync(join(ROOT, "electron", "features", f), "utf8"))
      .join("\n");
    (mkts.includes('"expert-market:list"') && mkts.includes('"expert-market:install"') && mkts.includes('"soul-market:apply"') && mkts.includes('"soul-market:current"') ? ok : fail)(
      "【236】expert-market / soul-market 两域 handler 全部挂载（缺 = 市场白配，桥接面有但主进程没人接）"
    );
    // ⑧ 数据目录跟随（10-01 用户令：「不要写死目录位置，目录我随时要改，要自动跟随数据目录」）：
    //    市场 handler 的技能落点必须从 codexHome 派生（codexHome ← userData ← data-dir.json），
    //    模块里**不许出现绝对盘符路径**（写死某个盘的目录 = 改数据目录后装到错地方）。
    ((() => {
      const code = codeOnly(mkts);
      const follows = /path\.join\(codexHome, "skills"\)/.test(code);
      const hardAbs = /["'`][A-Za-z]:[\\/]/.test(code);
      return follows && !hardAbs;
    })() ? ok : fail)(
      "【236】市场技能落点跟随数据目录（从 codexHome 派生、模块内零绝对盘符路径——写死目录 = 用户改数据目录就装错地方）"
    );
    const pers = readFileSync(join(ROOT, "electron", "personalization.ts"), "utf8");
    (/persona: pick\("persona"/.test(pers) && /- Persona \(installed from the persona market/.test(pers) ? ok : fail)(
      "【236】人格生效链完整：persona 字段落 personalization.json 且 buildAgentsMd 真渲染进 AGENTS.md（只存不渲染 = 装了不生效）"
    );
    const packs = readFileSync(join(ROOT, "electron", "skillhub-packages.ts"), "utf8");
    (packs.includes("writeExpertTeams(next)") && packs.includes("normalizeTeamConfig") ? ok : fail)(
      "【236】专家包装完必须落专家卡片（writeExpertTeams）——用户令「安装后在专家中心新增对应专家卡片」"
    );
    // ⑥ 专家专属技能分组（10-01 用户令：「# 面板里区分不出来哪些技能是专家专属技能」）：
    //    子技能落盘时必须打 kind=skillset-child 标记 → local-list 透出 skillsetSlug →
    //    mergedSkillCatalog 映射 source=expert → # 面板「专家专属」组。缺一环 = 分组永远为空。
    (packs.includes("markSkillsetChild") && packs.includes('raw.kind = "skillset-child"') ? ok : fail)(
      "【236】专家包子技能落盘时打 kind=skillset-child 标记（没标记 ⇒ # 面板分不出专家专属技能）"
    );
    const listSrc = readFileSync(join(ROOT, "electron", "features", "builtin-skills-ipc", "03-plugins-market.ts"), "utf8");
    (listSrc.includes('skillsetSlug: marketKind === "skillset-child"') ? ok : fail)(
      "【236】skills:local-list 透出 skillsetSlug（渲染层判专家专属的唯一依据）"
    );
    const part04 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part04", "01-seg.tsx"), "utf8");
    const composerSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "03-composer.tsx"), "utf8");
    (part04.includes('? "expert"') && /\["expert", "专家专属"\]/.test(composerSrc) ? ok : fail)(
      "【236】# 面板「专家专属」分组已接线（part04 映射 source=expert + composer 组标签）"
    );
  }
}
