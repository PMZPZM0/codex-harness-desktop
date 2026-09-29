/**
 * 预检守卫组：13-drama-gen —— 画布「生成通道分流 + 配置引导 + 结果面板」。
 *
 * 立此组的原因（09-28 用户反馈三连）：
 *   · 「生图跟视频都没有区分开功能，流程都一样」→ 原来「生成视频」按钮**无条件**渲染在
 *     所有卡片上（笔记卡、剧本卡也有），用户分不清两条通道；
 *   · 「生图模型都没有配置的地方」→ 未配置时点了才 notice 报错，卡片上没有任何前置提示；
 *   · 「相册也没有」→ 生成结果只写在卡片 payload 里，没有一处能总览。
 * 三条都是**静态可查**的结构事实 ⇒ 用断言钉住，避免下次重构又退回原样。
 *
 * 共享面由 ./_ctx.mjs 注入。
 */
import { C, ROOT, join, ok, fail, readFileSync, readdirSync, codeOnly } from "./_ctx.mjs";

export async function run() {
  console.log(C.bold("\n【192】画布生成通道分流与结果面板"));

  const card = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8");
  const canvas = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8");
  const panel = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaResultsPanel.tsx"), "utf8");
  const story = readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8");

  /* ① 生成按钮必须按节点类型分流 —— 判据锚「有映射表 + 无映射就 return null」，
        而不是锚某个 kind 字符串（那样改一个类型就假绿）。 */
  (function checkChannelMap() {
    const sharedSrc = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaChannelButton.tsx"), "utf8");
    const hasMap = /export const GEN_CHANNELS: Record<string, DramaChannel\[\]> = \{/.test(sharedSrc);
    const cardUses = /import \{[^}]*GEN_CHANNELS[^}]*\} from "\.\/DramaChannelButton"/.test(card);
    (hasMap && cardUses ? ok : fail)(
      "【192】卡面用共享的「节点类型 → 可用生成通道」映射表（09-28 提到 DramaChannelButton.tsx，卡面与检查器同一份）"
    );
  })();
  (/if \(!GEN_CHANNELS\[kind\]\) return null;/.test(card) && /visibleChannels\(kind, payload\)/.test(card) ? ok : fail)(
    "【192】映射表外的节点类型**不渲染**生成按钮（策划卡不该有生成图/视频）"
  );
  // ⛔ 负向断言：视频按钮不得再无条件渲染（原病根）
  (!/className="drama-canvas-btn"[^>]*onClick=\{\(e\) => \{ e\.stopPropagation\(\); void actions\.story\.generate\(id, "video"\); \}\}/.test(card) ? ok : fail)(
    "【192】没有「无条件渲染的生成视频按钮」（09-28 前的病根）"
  );

  /* ② 未配置 → 「去配置」而不是点了才报错 */
  (function checkConfigShortcut() {
    const sharedSrc = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaChannelButton.tsx"), "utf8");
    (/if \(missing\) \{ actions\.openGenSettings\(what as "image" \| "video"\); return; \}/.test(sharedSrc) ? ok : fail)(
      "【192】未配置通道时按钮改为跳「设置 → 插件」（不再点了才弹错）"
    );
  })();
  (/channels: DramaChannelState;/.test(story) && /refreshChannels/.test(story) ? ok : fail)(
    "【192】story 层暴露两条通道的就绪状态（卡片据此显示「去配置生图模型 / 去配置视频接口」）"
  );
  (/onOpenPluginSettings/.test(canvas) && /setSettingsPage\("plugins"\)/.test(readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8")) ? ok : fail)(
    "【192】宿主把「设置 → 插件」页面接到了画布（onOpenPluginSettings → plugins 页）"
  );

  /* ③ 结果面板（相册）：状态 + 渲染 + 定位三处接线，光有组件不算数 */
  (/const \[resultsOpen, setResultsOpen\]/.test(canvas) ? ok : fail)(
    "【192】画布有结果面板开关状态"
  );
  (/resultsOpen \? \(/.test(canvas) && /<DramaResultsPanel/.test(canvas) ? ok : fail)(
    "【192】结果面板真的被渲染"
  );
  (/setResultsOpen\(true\)/.test(canvas) ? ok : fail)(
    "【192】顶栏有打开结果面板的入口"
  );
  (/payload\.image/.test(panel) && /payload\.video/.test(panel) ? ok : fail)(
    "【192】结果面板聚合卡片 payload 的 image/video（不扫盘 —— 扫盘判不准「谁生成的」）"
  );

  /* ④ 空画布引导（用户「新建了然后呢，有什么用」） */
  (/drama-canvas-blank-guide/.test(canvas) && /board\.nodes\.length === 0 \?/.test(canvas) ? ok : fail)(
    "【192】空画布有引导（说明画布/分镜表用途与两个起手按钮的区别）"
  );
  (/pointer-events: none/.test(readFileSync(join(ROOT, "src", "styles", "21-drama-canvas.css"), "utf8").split(".drama-canvas-blank-guide {")[1]?.slice(0, 700) ?? "") ? ok : fail)(
    "【192】引导层 pointer-events:none（不挡住画布的拖拽/框选）"
  );

  /* ⑤ 渲染层**不得** import 主进程逻辑模块（09-28 实测踩到，不只是预览问题）
        `src/lib/video-providers.mjs` 顶部 `import { createHmac } from "node:crypto"` ——
        渲染层没有 node 内置模块：vite dev 下解构导入直接抛 externalized 错误，
        生产构建只是侥幸不炸。视频配置卡需要的字段全部由 window.codex.videoProviders() 提供。 */
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const walk = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.tsx?$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const offenders = walk(join(ROOT, "src"))
      .filter((f) => /video-providers\.mjs/.test(fs.readFileSync(f, "utf8")) && !/^\s*[*\/]/.test(fs.readFileSync(f, "utf8").split(/\r?\n/).find((l) => l.includes("video-providers.mjs")) ?? ""))
      .map((f) => f.replace(ROOT, "").replace(/\\/g, "/"))
      .filter((f) => fs.readFileSync(join(ROOT, f.slice(1)), "utf8").split(/\r?\n/).some((l) => /^\s*import[\s\S]*video-providers\.mjs/.test(l)));
    (offenders.length === 0 ? ok : fail)(
      `【192】渲染层不 import 含 node:crypto 的 video-providers.mjs（厂商数据走 IPC）${offenders.length ? "：" + offenders.join(" / ") : ""}`
    );
    // 两份可选字段清单必须一致（渲染层副本 vs 适配层真相源）
    const adapter = /export const VIDEO_OPTIONAL_FIELDS = \[([^\]]*)\]/.exec(
      readFileSync(join(ROOT, "src", "lib", "video-providers.mjs"), "utf8"),
    )?.[1] ?? "";
    const adapterFields = [...adapter.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const localCopy = readFileSync(join(ROOT, "src", "components", "video-optional-fields.ts"), "utf8");
    const localFields = [...(/export const OPTIONAL_FIELDS = \[([^\]]*)\]/.exec(localCopy)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    (adapterFields.length > 0 && JSON.stringify(adapterFields) === JSON.stringify(localFields) ? ok : fail)(
      `【192】可选字段两份同源（适配层 [${adapterFields.join(",")}] vs 渲染层 [${localFields.join(",")}]）—— 不一致则用户填了保存不住`
    );
  }

  /* ── 生成按钮的布局 / 文案 / 唯一实现（09-28 三次返工，坑全记在这里） ────────────
     ① **重叠**：按钮缺 flex:none/nowrap ⇒ 中文（无空格）flex item 的 min-content 只有
        「一个字」宽 ⇒ flex-shrink 把两个按钮压到互相覆盖，而 flex-wrap 因总宽没超容器
        **永远不触发**（用户截图：出图卡的「生成首帧」被「去配置视频接口」盖住）。
     ② **分不清**：文案「生成首帧 / 文生视频」把类别藏在词中间 ⇒ 扫一眼分不出出图还是出片。
     ③ **两处实现漂移**（code review 抓到）：卡面与右侧检查器各写一份生成按钮 ⇒ 卡面改了
        文案，检查器里还叫「生成图片」、未配置不给引导、还不查节点类型（笔记卡上也能点）。
        现在按钮本体与通道映射表都只有一份（DramaChannelButton.tsx）。
     判据锚**接线与唯一性**（映射表份数 / generate 调用点份数），不锚某个字面量。 */
  {
    const css = readFileSync(join(ROOT, "src", "styles", "21-drama-canvas.css"), "utf8");
    const dir = join(ROOT, "src", "features", "drama-canvas");
    const shared = readFileSync(join(dir, "DramaChannelButton.tsx"), "utf8");
    const inspector = readFileSync(join(dir, "DramaInspector.tsx"), "utf8");
    const allTsx = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
    const codeOf = (f) => codeOnly(readFileSync(join(dir, f), "utf8"));

    const btnRule = /\.drama-canvas-card-actions > \.drama-canvas-btn,\s*\n\.drama-canvas-inspector-actions > \.drama-canvas-btn \{([^}]*)\}/.exec(css)?.[1] ?? "";
    (btnRule.includes("flex: none") && btnRule.includes("white-space: nowrap") ? ok : fail)(
      "【192】卡面与检查器的按钮都 flex:none + white-space:nowrap（缺任一条 = 按钮被压到重叠，wrap 永不触发）"
    );

    const genDefs = allTsx.filter((f) => /const GEN_CHANNELS\s*[:=]/.test(codeOf(f)));
    (genDefs.length === 1 && genDefs[0] === "DramaChannelButton.tsx" ? ok : fail)(
      `【192】通道映射表只有一份定义（实得：${genDefs.join(", ") || "无"}）—— 两处各一份必然漂移`
    );

    const genCallers = allTsx.filter((f) => /actions\.story\.generate\(/.test(codeOf(f)));
    (genCallers.length === 1 && genCallers[0] === "DramaChannelButton.tsx" ? ok : fail)(
      `【192】生成按钮只有一个实现（实得：${genCallers.join(", ") || "无"}）—— 检查器曾自写一份「生成图片」：文案漂移 + 无配置引导 + 不查节点类型`
    );

    (/import \{[^}]*GEN_CHANNELS[^}]*\} from "\.\/DramaChannelButton"/.test(inspector) && /visibleChannels\(kind, payload\)/.test(inspector) ? ok : fail)(
      "【192】检查器用共享按钮 + 同一张映射表（选中笔记卡不再冒出生成按钮）"
    );

    const channelColors = ["image", "video", "audio"].filter((ch) => css.includes(`.drama-canvas-btn.is-channel-${ch} > svg`));
    (channelColors.length === 3 ? ok : fail)(
      `【192】三条生成通道各有图标配色（生图/视频/配音，缺 ${3 - channelColors.length} 条）`
    );

    (shared.includes("const head = `${CHANNEL_LABEL[what]} · `;") ? ok : fail)(
      "【192】通道类别标签前置（生图 · X / 视频 · X / 配音 · X —— 类别藏在词中间就分不清）"
    );
    (/className=\{`drama-canvas-btn is-channel-\$\{what\}/.test(shared) ? ok : fail)(
      "【192】按钮挂 is-channel-<通道> 类（配色靠这条接线；删掉 = 配色静默失效）"
    );
    (/what === "audio" \|\| missing/.test(shared) ? ok : fail)(
      "【192】未配置态按钮变 ghost（一眼看出「这条通道还没通」）"
    );

    (canvas.includes("生图工作流已就绪") && canvas.includes("点「生图」") ? ok : fail)(
      "【192】工作流建立提示用真实按钮名（image 卡按钮是「生图」—— 提示里的名字必须与卡面逐字同源；09-29 按钮从「生图 · 首帧」改名后这里同步）"
    );
    (panel.includes("点「生图」") && panel.includes("「视频」") && panel.includes("「配音」") ? ok : fail)(
      "【192】结果面板空态同样用真实按钮名（提示与按钮名不一致 = 用户找不到入口）"
    );
  /* ══ 分镜表管理（09-29 用户：「分镜表也加一个在项目管理里面加一个管理功能」）══
     分镜表是**唯一真源**：画布卡片 payload.board、BoardMeta.board、工作区文件都按 name 引用
     ⇒ 删除必须级联清干净（缺一环就留悬垂引用），改名只允许改显示标题（改 name = 全引用失效）。 */
  {
    const storage = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "drama-storage.ts"), "utf8"));
    const storySrc = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8"));
    const boardSrc = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-board.ts"), "utf8"));
    const panelSrc = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaProjectsPanel.tsx"), "utf8"));
    const canvasSrc = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8"));
    const electronSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "drama-canvas.ts"), "utf8"));

    (storage.includes("export function removeStoryboard") ? ok : fail)(
      "【199】store 有 removeStoryboard（本机索引 + 本地快照两份都清）"
    );
    (storage.includes("window.localStorage.removeItem(storyKey(name))") ? ok : fail)(
      "【199】removeStoryboard 真删本地快照（只删索引 = 数据仍在 localStorage 里留尸）"
    );
    (electronSrc.includes('"drama-canvas:storyboard-file-remove"') && electronSrc.includes("stat.isFile()") ? ok : fail)(
      "【199】工作区表文件有域内删除通道（且只删文件 —— 目录一律拒绝）"
    );
    (electronSrc.includes("isInsideTrustedRoots(workspace)") ? ok : fail)(
      "【199】删除通道走可信根校验（同 asset-write 口径）"
    );
    // 级联四要素：本机两份 + 工作区文件 + 画布卡引用 + 画布 meta 引用
    (storySrc.includes("store.removeStoryboard(name)") ? ok : fail)("【199】deleteStory 清本机索引与快照");
    (storySrc.includes("dramaCanvasStoryboardFileRemove") ? ok : fail)("【199】deleteStory 删工作区文件");
    (storySrc.includes('board.updatePayload(node.id, { board: "", style: "" })') ? ok : fail)(
      "【199】deleteStory 解绑画布上的分镜表卡（否则卡片指向一张不存在的表）"
    );
    (storySrc.includes("board.unbindStoryboard(name)") ? ok : fail)(
      "【199】deleteStory 清画布 meta 的挂表记录（BoardMeta.board 悬垂引用）"
    );
    (boardSrc.includes("const unbindStoryboard") ? ok : fail)("【199】board API 提供 unbindStoryboard");
    (storySrc.includes("storyName === name") ? ok : fail)("【199】删的是当前表时切走（否则画布挂着一张已删的表）");
    (storySrc.includes("const renameStory") && storySrc.includes("upsertStoryboard({ ...meta, title: clean })") ? ok : fail)(
      "【199】renameStory 只改 meta.title（name 是引用键 —— 改了会断掉卡片/文件/meta 三处引用）"
    );
    (panelSrc.includes("onStoryDelete") && panelSrc.includes("onStoryRename") && panelSrc.includes("onStorySwitch") ? ok : fail)(
      "【199】项目管理面板有分镜表分区（切换/重命名/删除三动作）"
    );
    (panelSrc.includes("storyboardFilePath") && panelSrc.includes("revealInFolder") ? ok : fail)(
      "【199】分镜表条目可直达工作区文件（打开文件夹）"
    );
    (canvasSrc.includes("onStoryDelete={(name: string) => void story.deleteStory(name)}") ? ok : fail)(
      "【199】画布把 deleteStory 接到面板（不接线 = 按钮点了没反应）"
    );
    // 顶栏布局（09-29 用户：按键布局调整）：四个「新建」收成一个下拉菜单
    (canvasSrc.includes("drama-canvas-headmenu-wrap") && !canvasSrc.includes("新建短剧工作流</button>") ? ok : fail)(
      "【199】顶栏「新建」合并为下拉菜单（四个按钮并排会把顶栏挤成两行）"
    );
  }

  /* ══ 顶栏单行布局（09-29 用户：「右上角那么多空白，可以放按键了啊…布局整洁，整齐一点」）══
     三个已踩过的坑各钉一条：留白过大（按钮被挤到第二行）、下拉被压成「1」字宽、
     进度芯片 0 值仍占位把顶栏撑出去。 */
  {
    const css = readFileSync(join(ROOT, "src", "styles", "21-drama-canvas.css"), "utf8");
    const canvasSrc2 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8"));

    // ① 窗控避让：**已挪到浮层顶部留白**（窗控只占窗口最顶 ~33px）。
    //    顶栏右侧必须左右对称（≤20px）—— 之前右侧留 116px 是为了避让，用户三次点名「还有空白」。
    const headPad = /\.drama-canvas-head \{[\s\S]{0,400}?padding:\s*10px\s+(\d+)px/.exec(css);
    (headPad && Number(headPad[1]) <= 20 ? ok : fail)(
      `【201】顶栏右侧不留窗控避让（实得 ${headPad ? headPad[1] + "px" : "未找到"}，应 ≤20px —— 避让已挪到浮层顶部）`
    );
    const topPad = /\.drama-canvas-backdrop \{[\s\S]{0,500}?padding:\s*clamp\((\d+)px/.exec(css);
    (topPad && Number(topPad[1]) >= 36 ? ok : fail)(
      `【201】浮层顶部留白 ≥36px 承担窗控避让（实得 ${topPad ? topPad[1] + "px" : "未找到"} —— 窗控高约 33px，顶栏才不会与它重叠）`
    );
    // ② 画布 / 分镜表下拉有最小宽度（窄窗口被压成「1」字宽 = 用户截图）
    (/\.drama-canvas-head \.app-select-trigger \{[^}]*min-width:\s*\d+px/.test(css) ? ok : fail)(
      "【201】顶栏下拉有 min-width（不给就被 flex 压成一字宽，选中值读不出来）"
    );
    /* ③ ⛔⛔ 09-29 **反转**：上一版这条要求「标签**始终**隐藏」（当时为了换单行）。
       结果用户看到两个没有任何说明的裸值 —— 原话「上面两个下拉框也不知道是什么东西」。
       省空间省错了地方：标签回答「这个控件是什么」，值才回答「当前选的是哪个」。
       新判据：标签**必须可见**，且不许再用断点式隐藏（断点会让宽窗口翻车，这是上一轮的教训）。 */
    {
      const spanRule = /\.drama-canvas-head \.drama-canvas-select > span \{([^}]*)\}/.exec(css);
      const hiddenByRule = Boolean(spanRule && /display:\s*none/.test(spanRule[1]));
      const hiddenByMedia = /@media[^{]*\{[\s\S]{0,500}?drama-canvas-select\s*>\s*span\s*\{[^}]*display:\s*none/.test(css);
      (!hiddenByRule && !hiddenByMedia ? ok : fail)(
        "【201】下拉标签可见（上一版为单行把它藏了，用户看不懂裸值；也不许用断点式隐藏）"
      );
    }
    // ③.5 工作流类型必须显式可见（病根：画布没有"这是什么工作流"的概念，两种模板 UI 混在一起）
    /* ③.5 ⛔ 09-29 再改：上一版把类型做成"标题文字 + 15px 的 ▾"，用户**根本看不见**
       （原话「没有生图和视频两个工作流切换入口啊」）。现在是两个**并列 tab**。
       判据：两个类型名各出现一次 + 有 tab 容器 + 点另一个会真的切（switchFlow）。 */
    (canvasSrc2.includes('"生图工作流"') && canvasSrc2.includes('"短剧工作流"')
      && canvasSrc2.includes('className="drama-canvas-flowtabs"') ? ok : fail)(
      "【201】顶栏两个工作流并列成 tab（只标类型没有切换入口 = 等于没有入口）"
    );
    (/const switchFlow = useCallback/.test(canvasSrc2) && /onClick=\{\(\) => switchFlow\("image"\)\}/.test(canvasSrc2)
      && /onClick=\{\(\) => switchFlow\("drama"\)\}/.test(canvasSrc2) ? ok : fail)(
      "【201】两个 tab 都接了切换动作（只画不出 = 点了没反应）"
    );
    // ⛔ 切换必须**保留原画布**：用户说的是"切换/换一种"，不是"把当前画布换掉"
    (/switchFlow[\s\S]{0,1200}?原画布保留/.test(canvasSrc2) ? ok : fail)(
      "【201】切换时保留原画布并告知怎么切回（换掉它 = 用户以为白做了）"
    );
    // 按类型收敛无关 UI：生图工作流里挂分镜表下拉、镜头时间线 = 纯噪声（用户截图红框二）
    (/\{flow\.type === "drama" \? \([\s\S]{0,200}?<DramaTimeline/.test(canvasSrc2) ? ok : fail)(
      "【201】时间线只在短剧工作流渲染（生图流显示「未绑定分镜表 0 镜」是噪声）"
    );
    (canvasSrc2.includes("flow.type === \"drama\" ? (") && /\{flow\.type === "drama" \? \(\s*<label className="drama-canvas-select nodrag" title="分镜表/.test(canvasSrc2) ? ok : fail)(
      "【201】分镜表下拉只在短剧工作流渲染（生图流那个「（尚无）」没人看得懂）"
    );
    // 「待生成 N」= 入口而不是死数字：必须是 button（可点触发批量生成）且悬停列明细
    /* 「待生成 N」的判据移到【204】（09-29 反转：单击不再直接开跑，改为先看明细再确认） */
    // ⛔ 实测坑：不给 nowrap 时「画布」标签被 flex 压成「画/布」两行，比隐藏还难看
    (/\.drama-canvas-head \.drama-canvas-select > span \{[^}]*white-space:\s*nowrap/.test(css) ? ok : fail)(
      "【201】下拉标签不折行（实测压成「画/布」两行）"
    );
    // ④ 进度芯片 0 值不渲染（空画布只剩「待生成 N」，否则固定三项把顶栏撑出去）
    (/progress\.images > 0 \?/.test(canvasSrc2) && /progress\.videos > 0 \?/.test(canvasSrc2) ? ok : fail)(
      "【201】进度芯片 0 值不渲染（有内容才显示计数，宽度随内容自适应）"
    );
    // ⑤ 按钮组不折行（内部折行 = 一排按钮断成两截，最难看）
    (/\.drama-canvas-head-actions \{[^}]*flex-wrap: nowrap/.test(css) ? ok : fail)(
      "【201】按钮组内部不折行（整体换行由顶栏兜底）"
    );
    /* ⑥⛔ 用户 09-29 第二次反馈「右上角不还是空白这么多吗，往右靠啊」的根治：
       顶栏必须 nowrap（断点式的「窄屏才摘标签」在窗口比断点宽时失效 → 按钮又掉第二行），
       且超宽窗口要收回避让留白（浮层 max-width 1320px 居中后两侧自然留白够，再留 116px 就是白占）。 */
    (/\.drama-canvas-head \{[^}]*flex-wrap: nowrap/.test(css) ? ok : fail)(
      "【201】顶栏 flex-wrap: nowrap（永不换行 —— 靠断点摘标签的方案在宽窗口会失效）"
    );
    /* ⛔ 09-29：这里原来要求 head-left 有 `overflow: hidden`。实测那个 hidden 会把挂在顶栏里的
       明细浮层**整块裁掉**（只剩一条线、按钮 elementFromPoint 命中 #root）—— 裁切是**标题元素自己**
       的职责。新判据：head-left 可收缩（flex:1 1 auto + min-width:0）但**自己不许裁切**，
       同时标题元素必须仍然自己截断（两条一起才既单行又不裁弹层）。 */
    (/\.drama-canvas-head-left \{[^}]*flex: 1 1 auto[^}]*min-width: 0/.test(css) ? ok : fail)(
      "【201】左侧可收缩（nowrap 下靠标题截断让位，而不是把按钮挤下去）"
    );
    {
      const hlRule = /\.drama-canvas-head-left \{([^}]*)\}/.exec(css);
      const selfClips = Boolean(hlRule && /overflow:\s*hidden/.test(hlRule[1]));
      const titleClips = /\.drama-canvas-head-left > div:first-of-type[^{]*\{[^}]*overflow:\s*hidden/.test(css);
      (!selfClips && titleClips ? ok : fail)(
        "【201】head-left 自己不裁切、由标题元素负责截断（head-left 裁切会把顶栏里的明细条/弹层切掉）"
      );
    }
  }

  /* ══ 媒体生成三件套（09-29 用户：「让 Codex 能够直接调用生图与视频工作流」）══
     模型侧工具 = image_generate（同步）/ video_generate（提交即返回）/ video_status（查询）。
     判据盯三件事：① 与画布**共用同一套 core**（不许在 rpc 里另写一份 HTTP 调用）；
     ② 视频必须两段式（提交里不许有轮询循环 —— 会把整个回合卡死）；
     ③ 任务不丢（提交即落盘 + 画布卡片留 jobId 可续查）。 */
  {
    const coreSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "dispatch-core.ts"), "utf8"));
    const rpcSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "dispatch-rpc.ts"), "utf8"));
    const videoSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "video-gen.ts"), "utf8"));
    const imageSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "builtin-skills-ipc", "01-builtin-images.ts"), "utf8"));
    const storySrc = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8"));

    for (const tool of ["image_generate", "video_generate", "video_status"]) {
      (coreSrc.includes(`name: "${tool}"`) && rpcSrc.includes(`name === "${tool}"`) ? ok : fail)(
        `【202】媒体工具 ${tool} 的 schema 与执行端都在（只加 schema = 工具在清单里但调不动）`
      );
    }
    // ① 共用 core
    (rpcSrc.includes("generateImageResilient") && rpcSrc.includes("submitVideoCore") && rpcSrc.includes("pollVideoCore") ? ok : fail)(
      "【202】执行端调 core（生图/视频逻辑只有一份 —— 与画布卡片共用）"
    );
    (!/await fetch\(/.test(rpcSrc) ? ok : fail)(
      "【202】执行端不自己发 HTTP（发现 fetch 调用 = 有人另写了一份实现，两条路径必然漂移）"
    );
    // ② 视频两段式：video_generate 段不许有轮询循环
    const submitCase = rpcSrc.slice(rpcSrc.indexOf('name === "video_generate"'), rpcSrc.indexOf('name === "video_status"'));
    (!/for \(;;\)|while \(/.test(submitCase) ? ok : fail)(
      "【202】video_generate 里没有轮询循环（提交必须立刻返回 —— 循环会把整个模型回合卡死几分钟）"
    );
    (submitCase.includes("rememberVideoJob") ? ok : fail)(
      "【202】提交后立刻落盘任务记录（jobId 只在内存 = 关画布/重启就查不到，产物白跑）"
    );
    // ③ 任务持久化 + 画布置信
    (videoSrc.includes("export function rememberVideoJob") && videoSrc.includes("video-jobs.json") ? ok : fail)(
      "【202】任务记录持久化到 userData/video-jobs.json（含 30 天裁剪，防无限增长）"
    );
    (videoSrc.includes("listVideoJobs") && videoSrc.includes("updateVideoJob") ? ok : fail)(
      "【202】任务可续查可回写（查询后状态/产物路径要落盘）"
    );
    (storySrc.includes("video_job_provider") && storySrc.includes("继续等待上一次提交的任务") ? ok : fail)(
      "【202】画布卡片留 jobId 并优先续查（超时/重启后再点不重复提交、不多花钱）"
    );
    (!/setTimeout\(r, 5000\)/.test(storySrc) ? ok : fail)(
      "【202】画布轮询已改自适应（固定 5s 已废 —— 短任务白等、长任务查太频）"
    );
    // ④ 生图重试
    (imageSrc.includes("export async function generateImageResilient") && /HTTP 4\\d\\d/.test(imageSrc) ? ok : fail)(
      "【202】生图带重试且 4xx 不重试（参数错重试没意义；网络/5xx/429 才值得再试）"
    );
    (/builtin:generate-image[^\n]{0,400}generateImageResilient/.test(imageSrc) ? ok : fail)(
      "【202】IPC 生图也走重试版（稳定性口径只有一份）"
    );
    // ⑤ 下载重试（产物拉回本地）
    (/export async function downloadVideoCore[\s\S]{0,2000}attempt < 2/.test(videoSrc) ? ok : fail)(
      "【202】视频下载带 1 次自动重试（网络抖动不至于白跑几分钟的生成）"
    );
  }

  }
  /* ══ 批量生成 + 整片合并导出（09-29 用户：「批量一键生成和整片合并导出完善一下」）══
     这两件事的失败模式都是**静默**的，所以断言锚「调用与键名」而不只锚「函数存在」：
       · 产物存在性判据的键名与写回分支不一致 ⇒ 批量每次都认为「没生成过」，重复跑一遍（白花钱）；
       · 视频混进图片层 ⇒ 提交时首帧还没落盘，i2v 悄悄退化成 t2v（用户以为「我的图没被用上」）；
       · 合并顺序错 ⇒ 成片乱序，而画面上看不出哪一步错了。 */
  {
    const storySrc = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8"));
    const canvasSrc = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8"));
    const resultsSrc = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaResultsPanel.tsx"), "utf8"));
    const videoGenSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "video-gen.ts"), "utf8"));
    const rpcSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "dispatch-rpc.ts"), "utf8"));
    const coreSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "dispatch-core.ts"), "utf8"));
    const toolchainSrc = codeOnly(readFileSync(join(ROOT, "electron", "toolchain.ts"), "utf8"));

    /* ── 批量生成 ── */
    (storySrc.includes("const generateBatch = useCallback") ? ok : fail)("【203】画布有批量生成入口（generateBatch）");
    // 两阶段：图片/配音先真生成，视频最后提交 —— 顺序反了视频就没有首帧
    (/const firstStage: BatchTask\[\] = \[\];/.test(storySrc) && /const videoStage: BatchTask\[\] = \[\];/.test(storySrc)
      && /\(what === "video" \? videoStage : firstStage\)\.push/.test(storySrc) ? ok : fail)(
      "【203】批量分两阶段（图片/配音 → 视频）—— 视频混在图片层会拿不到刚生成的首帧"
    );
    (storySrc.includes("await runOne(task, true)") ? ok : fail)("【203】批量里视频走 submitOnly（只提交不等待）");
    (/if \(options\.submitOnly\) \{/.test(storySrc) && storySrc.includes("video_job: submitted.jobId") ? ok : fail)(
      "【203】submitOnly 在**记下 jobId 之后**才返回（先返回 = 任务丢了，没法续查）"
    );
    (/const pool = Math\.min\(3, firstStage\.length\)/.test(storySrc) ? ok : fail)("【203】图片/配音并发池（网络等待型动作串行跑纯属浪费）");
    (storySrc.includes("batchStopped.current") && storySrc.includes("const stopBatch = useCallback") ? ok : fail)(
      "【203】批量可中止（stopBatch 置标志，池里的 worker 检查后退出）"
    );
    // 失败不中断：收集器记账，不在第一个失败处整批返回
    (/const report = \(text: string, tone\?: "ok" \| "err"\) => \{/.test(storySrc) && storySrc.includes("reasons.push(text)") ? ok : fail)(
      "【203】单个动作失败不中断整批（失败进收集器，汇总报一次）"
    );
    // 产物存在性判据必须与写回键一一对应（不一致 = 静默重复生成）
    (/const batchHasOutput = useCallback/.test(storySrc)
      && /if \(what === "video"\) return filled\(p\.video\)/.test(storySrc)
      && /if \(kind === "shot"\) return filled\(p\.first_frame\)/.test(storySrc)
      && /if \(kind === "character" \|\| kind === "location"\) return filled\(p\.ref\)/.test(storySrc) ? ok : fail)(
      "【203】batchHasOutput 键口径与 generate 写回一一对应（video/first_frame/ref/path）"
    );
    // 批量读的是**最新**节点快照，不是启动那刻的闭包
    (/nodesRef\.current\.find\(\(n\) => n\.id === nodeId\)/.test(storySrc) ? ok : fail)(
      "【203】generate 读 nodesRef 最新快照（读闭包 ⇒ 第二阶段的视频看不到刚写回的首帧）"
    );
    (/story\.generateBatch\("pending"\)/.test(canvasSrc) && /story\.generateBatch\("selected"\)/.test(canvasSrc) ? ok : fail)(
      "【203】顶栏批量按钮接了两个范围（待生成 / 选中的）—— 不接线 = 按钮点了没反应"
    );
    (/story\.batch\.running \?/.test(canvasSrc) && /story\.stopBatch\(\)/.test(canvasSrc) ? ok : fail)(
      "【203】跑批中按钮就地变成进度 + 中止"
    );

    /* ── 整片合并导出 ── */
    (storySrc.includes("const exportMovie = useCallback") ? ok : fail)("【203】画布有整片导出入口（exportMovie）");
    // 顺序的唯一真源是分镜表；表外散卡按画布位置兜底（否则没建表的板导不出东西）
    (/for \(const scene of data\.scenes \|\| \[\]\)/.test(storySrc) && /for \(const shot of scene\.shots \|\| \[\]\)/.test(storySrc) ? ok : fail)(
      "【203】成片顺序读分镜表的 场次→镜头（唯一真源）"
    );
    (/position\?\.y \?\? 0\) - \(\(b as any\)\.position\?\.y/.test(storySrc) ? ok : fail)(
      "【203】表外散卡按画布位置补序（上→下、左→右）—— 只会按数组顺序 = 成片乱序"
    );
    (/output: \{ \.\.\.\(data\.output \|\| \{\}\), video: path/.test(storySrc) ? ok : fail)(
      "【203】导出后回写分镜表 output.video（这个落点从设计起就留着，不回写等于成片失联）"
    );
    (storySrc.includes("window.codex.videoConcat") ? ok : fail)("【203】导出走 video:concat 通道（不是渲染层自己拼）");
    (/void story\.exportMovie\(\)/.test(resultsSrc) ? ok : fail)("【203】结果面板接了「导出成片」按钮");

    /* ── 主进程：ffmpeg 合并 ── */
    (videoGenSrc.includes("export async function concatVideosCore") ? ok : fail)("【203】主进程有 concatVideosCore");
    (videoGenSrc.includes('"-f", "concat"') && videoGenSrc.includes('"-c", "copy"') ? ok : fail)(
      "【203】合并用 concat demuxer + 先试 -c copy（无损秒拼）"
    );
    (/libx264/.test(videoGenSrc) && /force_original_aspect_ratio=decrease/.test(videoGenSrc) ? ok : fail)(
      "【203】签名不一致时统一重编码（不同厂商片段分辨率/帧率不一致，直接重编码是唯一正确路径）"
    );
    (/if \(!stat\.isFile\(\)\) throw/.test(videoGenSrc) ? ok : fail)("【203】片段必须是文件（目录混进来会让 ffmpeg 报奇怪的错）");
    (/isInsideTrustedRoots\(workspace\)/.test(videoGenSrc) ? ok : fail)("【203】成片落盘前过可信根校验（与素材同口径）");
    // ffmpeg 路径解析只有一份（在 toolchain.ts）：video-gen 自己拼候选 = 两份实现必然漂移
    // ⛔ 锚「从 toolchain 取到解析函数」+ 负向「自己没拼 ffmpeg 候选路径」，**不锚精确 import 串**
    //    （09-29 加了 bundledFfprobe 就把精确串锚红了 —— 固定字符串锚一改就假红）。
    (/import \{[^}]*resolveFfmpegPath[^}]*\} from "\.\.\/toolchain"/.test(videoGenSrc)
      && !/path\.join\([^)]*"ffmpeg"/.test(videoGenSrc) ? ok : fail)(
      "【203】video-gen 复用 toolchain 的 ffmpeg 解析（不自己拼候选路径）"
    );
    (/export function bundledFfmpeg/.test(toolchainSrc) && /export function resolveFfmpegPath/.test(toolchainSrc) ? ok : fail)(
      "【203】toolchain 提供 bundledFfmpeg / resolveFfmpegPath"
    );
    (/ffmpegMissingMessage[\s\S]{0,220}开发工具/.test(toolchainSrc) ? ok : fail)(
      "【203】ffmpeg 缺失的报错是**可操作**的（指向开发工具页，而不是只说「不可用」）"
    );
    // 共用同一实现：IPC 薄壳与 MCP 执行端都调 core
    (videoGenSrc.includes('ipcMain.handle("video:concat"') && videoGenSrc.includes("concatVideosCore(input)") ? ok : fail)(
      "【203】video:concat 是薄壳（直接调 core，不在 handler 里重写一遍）"
    );
    (rpcSrc.includes('name === "video_concat"') && rpcSrc.includes("concatVideosCore({") ? ok : fail)(
      "【203】MCP 的 video_concat 复用同一 core（两套实现 = 行为不一致）"
    );
    (coreSrc.includes('name: "video_concat"') ? ok : fail)("【203】video_concat 在工具清单里（schema 与执行端成对）");
    // ⛔⛔ 实测抓到的真缺陷（09-29）：分辨率/帧率都不同的两段用 -c copy 拼接，ffmpeg **退出码 0**、
    //    产物却是花屏 + 时基错乱的坏片。所以判据必须是「**先**比签名」，不是「copy 失败再回退」。
    (/async function probeSignature/.test(videoGenSrc) && /bundledFfprobe/.test(videoGenSrc) ? ok : fail)(
      "【203】concat 先比编码签名（ffprobe 探测分辨率/帧率/编码）"
    );
    (videoGenSrc.includes("const copySafe = signatures.every") ? ok : fail)(
      "【203】全部签名一致才敢 copy（不一致时 copy 不报错但产出坏片）"
    );
    (/if \(copySafe\) \{[\s\S]{0,400}?"-c", "copy"/.test(videoGenSrc) ? ok : fail)(
      "【203】copy 被 copySafe 包住（漏掉判断 = 静默坏片又回来了）"
    );
  }
  /* ══ 批量生成的两个「静默」缺陷（09-29 用户：「我没有生成啊，怎么显示生成中」）══
     ① 顶栏那个数字被做成了**单击直接开跑**的按钮 —— 一个长成标签样子的元素触发会调 API、
        会花钱的动作，用户点它只是想看「这 3 是什么」。判据：那颗按钮的 onClick 里不许出现 generateBatch。
     ② 批量此前**静默开始**（只在结束汇总），用户不知道开始了、也不知道去哪停。判据：开始必须报一次。
     ⛔ 这类断言要锚**结构**（谁触发谁），不能只锚「按钮存在」—— 存在的东西照样能接错动作。 */
  {
    const canvasSrc204 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8"));
    const storySrc204 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8"));
    // ① 只取「待生成 N」那颗按钮自己的 JSX（到它自己的 </button> 为止），检查里面有没有开跑
    const start = canvasSrc204.indexOf('className="drama-canvas-pending"');
    const end = start >= 0 ? canvasSrc204.indexOf("</button>", start) : -1;
    const pendingBtnJsx = start >= 0 && end > start ? canvasSrc204.slice(start, end) : "";
    (pendingBtnJsx && !/generateBatch/.test(pendingBtnJsx) ? ok : fail)(
      "【204】「待生成 N」单击只开明细浮层（不许直接开跑 —— 用户点它是想看这 3 是什么）"
    );
    // ⛔ 用「明细列表之后紧跟生成按钮」这个**方向**判，不用固定字符窗口串两句
    //    （实测 1200 窗口不够 —— 中间插几行就假红；本仓踩过同款坑）
    // ⛔ 明细做成**展开条**而不是浮层：实测浮层被 .drama-canvas-shell 的 overflow:hidden
    //    （圆角裁切，必须保留）切成一条 12px 白线，生成按钮 elementFromPoint 命中 #root（点不到）。
    //    而画布祖先链有 backdrop-filter（创建 containing block）⇒ position:fixed 也逃不掉。
    (canvasSrc204.includes("drama-canvas-pendingbar") ? ok : fail)(
      "【204】待生成明细用展开条（浮层会被 shell 的圆角裁切切掉 —— 实测只剩一条线）"
    );
    (/<\/header>[\s\S]{0,700}?drama-canvas-pendingbar/.test(canvasSrc204) ? ok : fail)(
      "【204】展开条渲染在 header 之后（shell 直接子元素 —— 挂在顶栏里就会再次被裁）"
    );
    (canvasSrc204.includes("progress.pendingCards.slice") && canvasSrc204.includes("drama-canvas-pending-item") ? ok : fail)(
      "【204】展开条真的列出是哪几张卡（只报数字 = 用户还是不知道这 3 是什么）"
    );
    (canvasSrc204.includes("批量生成这") ? ok : fail)(
      "【204】展开条里有明确的「批量生成这 N 张」主按钮才开跑（先看明细，再动手）"
    );
    // ② 批量开始必须出声（含停止入口指引）
    (/开始批量生成/.test(storySrc204) ? ok : fail)(
      "【204】批量生成开始时报一次（此前静默开始 ⇒ 用户以为「我没生成」）"
    );
    (/点一下就停|可随时停止/.test(storySrc204) ? ok : fail)(
      "【204】开始提示里写明停止入口（让人知道怎么收手）"
    );
  }
  /* ══ 产物查看器（09-29 用户：「卡片里面的图片没有预览功能，不方便，预览图片里面的功能配套齐全一下」）══
     三条设计约束：① 缩略图**可点开**（只显示不给点 = 没有预览）；② **只有一套**预览
     （结果面板曾经自己有一套，配套动作必然漏一边）；③ 看得见的动作要齐全，
     且「清除」只清卡片记录、不动磁盘文件 —— 可逆，所以不需要二次确认。 */
  {
    const cardSrc205 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8"));
    const viewerSrc205 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaMediaViewer.tsx"), "utf8"));
    const resultsSrc205 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaResultsPanel.tsx"), "utf8"));
    const canvasSrc205 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8"));

    (canvasSrc205.includes("<DramaMediaViewer") && /openMedia: \(target: ViewerTarget\)/.test(canvasSrc205) ? ok : fail)(
      "【205】查看器已接进画布（openMedia 有落点 ⇒ 点缩略图真会打开）"
    );
    (/onClick=\{open\}/.test(cardSrc205) && /actions\.openMedia\(/.test(cardSrc205) ? ok : fail)(
      "【205】卡片缩略图可点开（只显示不给点 = 用户说的「没有预览功能」）"
    );
    // 分层：画布内遮罩（不 portal —— portal 会被画布层盖住；也不做顶栏浮层 —— 会被 shell 裁）
    (/className="drama-canvas-modal-mask"/.test(viewerSrc205) && !/createPortal/.test(viewerSrc205) ? ok : fail)(
      "【205】查看器走画布内遮罩且不 portal（portal 被画布盖住、浮层被 shell 的 overflow 裁）"
    );
    (!/drama-results-preview/.test(resultsSrc205) && /openMedia\(\{ path: asset\.path/.test(resultsSrc205) ? ok : fail)(
      "【205】结果面板复用同一个查看器（它自己那套已删 —— 两套预览必然行为不一致）"
    );
    (["revealInFolder", "clipboard.writeText", "uploadRef", "story.generate", "board.saveNow"].every((k) => viewerSrc205.includes(k)) ? ok : fail)(
      "【205】查看器配套动作齐全（打开文件夹 / 复制路径 / 替换为新图 / 重新生成 / 清除记录）"
    );
    (/Object\.fromEntries\(target\.fields!\.map/.test(viewerSrc205) && !/\bunlink\b|\brmSync\b/.test(viewerSrc205) ? ok : fail)(
      "【205】「清除」只清卡片记录的字段、不删磁盘文件（可逆 ⇒ 不需要二次确认）"
    );
  }
  /* ══ 画幅 / 尺寸 / 负面提示词（09-29 用户：「从专业设计师和自媒体重度需求者角度打磨生图和生视频」）══
     最硬的判据是**真跑适配层真值表**（不是读文本）：
     · 竖屏 9:16 必须真的进到各家请求体（此前**全部写死横屏** ⇒ 自媒体出不了竖屏）；
     · 不支持画幅的厂商必须**报错**（静默按默认出片 = 用户以为设成功了）；
     · 不指定画幅时**必须保持原默认**（不破坏现网调用）。 */
  {
    const { pathToFileURL } = await import("node:url");
    const vp = await import(pathToFileURL(join(ROOT, "src", "lib", "video-providers.mjs")).href);
    const videoGenSkill206 = readFileSync(join(ROOT, "electron", "builtin-skills", "15-skill-video-generation.ts"), "utf8");
    const cfg = { apiKey: "k", model: "" };
    const nowMs = 1700000000000;
    (Array.isArray(vp.VIDEO_ASPECTS) && vp.VIDEO_ASPECTS.includes("9:16") ? ok : fail)(
      "【206】画幅常量含 9:16 竖屏（短视频主流形态；此前适配层全部写死横屏）"
    );
    /* ① 四家支持画幅：9:16 必须真出现在它们的请求体里（按各家自己的格式） */
    const supports = ["wanx", "seedance", "runway", "veo"];
    const sent = supports.map((id) => {
      const mode = id === "runway" || id === "veo" ? "i2v" : "t2v";
      const req = vp.videoBuildSubmit(id, cfg, { mode, prompt: "p", image: "https://x/y.png", aspect: "9:16" }, nowMs);
      return { id, hit: /9:16|720\*1280|720:1280/.test(JSON.stringify(req.body)) };
    });
    const missed = sent.filter((r) => !r.hit).map((r) => r.id);
    (missed.length === 0 ? ok : fail)(
      `【206】支持画幅的 4 家真把 9:16 传进请求体${missed.length ? "：缺 " + missed.join(", ") : "（万相/即梦/Runway/Veo 各自格式）"}`
    );
    /* ② 不支持画幅的 4 家：指定画幅必须**报错**（不许静默按默认出片） */
    const rejects = ["kling", "cogvideo", "minimax", "luma"].map((id) => {
      try { vp.videoBuildSubmit(id, { accessKey: "a", secretKey: "b", apiKey: "k" }, { prompt: "p", aspect: "9:16" }, nowMs); return id; }
      catch { return null; }
    }).filter(Boolean);
    (rejects.length === 0 ? ok : fail)(
      `【206】不支持画幅的 4 家都当场报错${rejects.length ? "：漏拦 " + rejects.join(", ") : "（可灵/智谱/MiniMax/Luma）"}`
    );
    /* ③ 不指定画幅 = 保持原默认（不破坏现网） */
    (JSON.stringify(vp.videoBuildSubmit("wanx", cfg, { prompt: "p" }, nowMs).body).includes("1280*720") ? ok : fail)(
      "【206】不指定画幅时保持原默认（默认路径不能被改坏）"
    );
    /* ④ 生图：size / negative 只在显式给时才带上（不同网关接受度差异大，默认不带 = 旧行为） */
    const imgSrc = codeOnly(readFileSync(join(ROOT, "electron", "features", "builtin-skills-ipc", "01-builtin-images.ts"), "utf8"));
    (/\.\.\.\(input\.size \? \{ size: input\.size \} : \{\}\)/.test(imgSrc) && /negative_prompt: input\.negative/.test(imgSrc) ? ok : fail)(
      "【206】生图 size / negative 只在显式给时才传（默认不带 = 不把本来能用的网关弄挂）"
    );
    /* ⑤ 参数必须**看得见**：检查器字段表里有画幅 / 尺寸 / 负面提示词（藏在代码里等于没有） */
    const inspSrc = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaInspector.tsx"), "utf8"));
    (/\{ key: "aspect", label: "画幅"/.test(inspSrc) && /\{ key: "size", label: "尺寸 \/ 画幅"/.test(inspSrc) && /\{ key: "negative", label: "负面提示词"/.test(inspSrc) ? ok : fail)(
      "【206】检查器暴露画幅 / 尺寸 / 负面提示词（用户能看见才叫能用）"
    );
    (inspSrc.includes("IMAGE_SIZE_PRESETS") ? ok : fail)("【206】生图尺寸有平台预设（自媒体按平台选，不用手填像素）");
    /* ⛔ 09-29 用户实测：上一版只给 image 卡加了，用户选**角色卡**就看不到（角色/场景同样走生图）。
       判据：size / negative 字段必须覆盖**全部三种生图卡**（image / character / location）。 */
    ((inspSrc.match(/\{ key: "size", label: "尺寸 \/ 画幅"/g) || []).length >= 3 ? ok : fail)(
      "【206】尺寸/负面提示词覆盖全部三种生图卡（image/character/location —— 只加一种 = 其余看不到）"
    );
    ((inspSrc.match(/\{ key: "negative", label: "负面提示词"/g) || []).length >= 3 ? ok : fail)(
      "【206】负面提示词同样覆盖三种生图卡"
    );
    /* ⑥ 技能要说清「哪些厂商不支持画幅」—— 不说 = 模型会以为都能用 */
    (videoGenSkill206.includes("只有部分厂商支持指定画幅") && videoGenSkill206.includes("9:16") ? ok : fail)(
      "【206】视频技能写明画幅支持范围（含哪些厂商不支持）"
    );
  }
  /* ══ 白模视频 / 3D 建模工作流（09-29 用户立项）══
     两个模板必须**真跑有效**（节点/边结构完整）且带 payload.flow 身份标记（flowLabel 判定依据）；
     createStarter 必须分发 4 种 kind；新建菜单必须有两项入口。
     ⛔ 依据是查证过的官方事实：Seedance 2.5 官方支持白模参考输入；Aholo Lux3D = 图/文→3D（GLB/PBR）。
     ⛔ 3D 生成通道尚未接入 —— 模板里是**指引卡**（note），不许假装有 3D 生成按钮。 */
  {
    const { pathToFileURL } = await import("node:url");
    const canvasSrc208 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8"));
    const modelMod = await import(pathToFileURL(join(ROOT, "src", "lib", "drama-canvas-model.mjs")).href);
    const wb = modelMod.whiteboxStarterWorkflow();
    const m3 = modelMod.model3dStarterWorkflow();
    (wb.nodes.length >= 5 && wb.edges.length >= 4 && wb.nodes.some((nd) => nd.payload?.flow === "whitebox") && wb.nodes.some((nd) => nd.kind === "shot") ? ok : fail)(
      "【208】白模视频模板有效（节点/边完整、含 shot 视频卡、带 whitebox 身份标记）"
    );
    (m3.nodes.length >= 5 && m3.edges.length >= 4 && m3.nodes.some((nd) => nd.payload?.flow === "model3d") && !m3.nodes.some((nd) => nd.kind === "shot") ? ok : fail)(
      "【208】3D 建模模板有效（带 model3d 标记；⛔ 无 3D 生成通道就不许放生成类卡片 —— 只放指引）"
    );
    (/(kind: "drama" | "image" | "whitebox" | "model3d")/.test(canvasSrc208) && /kind === "whitebox" \? whiteboxStarterWorkflow/.test(canvasSrc208) ? ok : fail)(
      "【208】createStarter 分发 4 种工作流（只加模板不接线 = 入口不存在）"
    );
    (canvasSrc208.includes("白模视频工作流") && canvasSrc208.includes("3D 建模工作流") && canvasSrc208.includes('createStarter("model3d")') ? ok : fail)(
      "【208】新建菜单有两项模板入口（model3d 入口已接线）"
    );
    /* ⛔⛔ 09-29 事故：改 createStarter 时把 board.replaceAll 整行吞掉 —— 快照算了、notice 弹了、
       **画布永远空**（用户报「切换不过去 / 新建菜单点了没反应」）。这条断言盯的就是「算了要写」。 */
    (/const snapshot = kind === "image" \? imageStarterWorkflow\(\)[\s\S]{0,400}?board\.replaceAll\(snapshot/.test(canvasSrc208) ? ok : fail)(
      "【208】createStarter 算了快照必须写进画布（board.replaceAll 紧跟 snapshot）—— 被吞掉则切换/新建全失效"
    );
    (!/kind === "image" \? imageStarterWorkflow\(\)[\s\S]{0,600}?pushNotice[\s\S]{0,200}?board\.replaceAll/.test(canvasSrc208) ? ok : fail)(
      "【208】顺序必须「先写画布再弹提示」（顺序反了 = 提示说成功而画布没变）"
    );
    (/flowLabel/.test(canvasSrc208) && /payload\?\.flow/.test(canvasSrc208) ? ok : fail)(
      "【208】工作流具体名由 payload.flow 判定（tab 显示“白模视频工作流”而非误归“短剧”）"
    );
  }
  /* ══ 画布素材写入：可信根失效的回退（09-29 用户「参考图传不了」）══
     ⛔ 事故本质：可信根 = userData + **活着的会话 cwd** + 用户选过的路径 ⇒ 会话一关/应用一重启，
        画布 workspace 就掉出白名单，上传**必然**被拒（用户看到的原文：只允许把素材写进会话工作区或应用数据目录）。
     修法两条缺一不可：① 不通过时**回退应用数据目录**（错误文案本来就写着「或应用数据目录」）；
     ② 回退必须**带标记**让 UI 说清落点 —— 静默回退比报错更糟（用户以为进了工作区，事后找不到文件）。 */
  {
    const dc = codeOnly(readFileSync(join(ROOT, "electron", "features", "drama-canvas.ts"), "utf8"));
    (/const trusted = Boolean\(resolved\) && isInsideTrustedRoots\(resolved\)/.test(dc) && /path\.join\(app\.getPath\("userData"\), "drama-canvas-assets"\)/.test(dc) ? ok : fail)(
      "【210】素材写入：可信根不通过时回退应用数据目录（不许直接抛 —— 画布脱离活会话时上传必失败）"
    );
    (/fallback: !trusted/.test(dc) ? ok : fail)(
      "【210】回退必须带 fallback 标记（静默回退 = 用户以为写进了工作区）"
    );
    const story = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8"));
    (/written\?\.fallback/.test(story) && story.includes("已暂存到应用数据目录") ? ok : fail)(
      "【210】渲染层把回退说清楚（提示里写明落点与怎么改回工作区）"
    );
    const manifest = readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8");
    (/Promise<\{ path: string; fallback\?: boolean \}>/.test(manifest) ? ok : fail)(
      "【210】IPC 类型面同步 fallback（类型不同步 = 渲染层拿不到标记）"
    );
  }
  /* ══ 参考图 ≠ 生成产物（09-29 用户实测：「上传的参考图会直接把已生成的图顶替掉展示」）══
     ⛔ 事故：image 卡上传参考图时写进 path/url —— 那是**生成产物的显示字段** ⇒ 一上传就覆盖。
     现在：参考图走独立 ref 字段；卡片上产物在主位、参考图退到缩略条。
     ⛔ 负向断言是关键：光锚「ref: path 存在」挡不住有人再加回一条写 path 的分支。 */
  {
    const story211 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8"));
    const card211 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8"));
    const css211 = readFileSync(join(ROOT, "src", "styles", "21-drama-canvas.css"), "utf8");

    (/board\.updatePayload\(nodeId, \{ ref: path \}\)/.test(story211) ? ok : fail)(
      "【211】上传参考图落 ref 字段（与生成产物分开）"
    );
    (((() => { const i = story211.indexOf("const uploadRef"); const seg = i >= 0 ? story211.slice(i, i + 2400) : "";
      return seg.includes("ref: path") && !/updatePayload\(nodeId, \{ path, url: path/.test(seg); })()) ? ok : fail)(
      "【211】负向：不许再把上传的参考图写进 path/url（一写就把已生成的图顶掉）"
    );
    (/const refPath = String\(payload\.ref \|\| ""\)/.test(card211) && /drama-canvas-card-ref-tag/.test(card211) ? ok : fail)(
      "【211】image 卡把参考图与产物分开显示（产物主位 + 参考图缩略条）"
    );
    (/drama-canvas-card-ref-img/.test(css211) ? ok : fail)(
      "【211】参考图缩略条样式在位（只接线不写样式 = 图撑满整卡，与产物还是分不清）"
    );
  }
  /* ══ 生图流程可读性（09-29 用户：「生图流程我有点看不懂」）══
     用户在四个困惑里全选：按钮文案费解 / 卡片角色分不清 / 图落在哪张卡不明 / 流程顺序乱，
     改进方向选「卡片加角色标签 + 配色」。四条断言各对应一处：
     ⛔ 角色必须**按状态**判定（同一张 image 卡没出图=提示词、出图=出图结果）—— 按 kind 判就分不出。 */
  {
    const card212 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8"));
    const btn212 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaChannelButton.tsx"), "utf8"));
    const css212 = readFileSync(join(ROOT, "src", "styles", "21-drama-canvas.css"), "utf8");
    const staleName = !readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8").includes("「生图 · 首帧」")
      && !readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaResultsPanel.tsx"), "utf8").includes("「生图 · 首帧」");
    const model212 = readFileSync(join(ROOT, "src", "lib", "drama-canvas-model.mjs"), "utf8");

    (/payload\.path \|\| payload\.url \? \{ key: "output", label: "出图结果" \} : \{ key: "input", label: "提示词" \}/.test(card212) ? ok : fail)(
      "【212】卡片角色按状态判定（image 卡：有产物=出图结果、无产物=提示词）"
    );
    (/drama-canvas-card-role is-\$\{role\.key\}/.test(card212) && /drama-canvas-card-step/.test(card212) ? ok : fail)(
      "【212】卡头渲染角色徽章 + 步骤号（算了 role 不渲染 = 白算）"
    );
    (/\.drama-canvas-card-role\.is-output/.test(css212) && /\.drama-canvas-card\.is-role-output > \.drama-canvas-card-head/.test(css212) ? ok : fail)(
      "【212】产物卡配色在位（⛔ 卡头微染而非整卡 box-shadow —— 选中态已占用 box-shadow）"
    );
    (/hasImage \? "重出" : kind === "shot" \? "首帧" : ""/.test(btn212) ? ok : fail)(
      "【212】「首帧」只留给 shot 卡（视频术语长在出图卡上 = 用户不知道点下去干什么）"
    );
    (staleName ? ok : fail)(
      "【212】文案里的按钮名必须与卡面逐字一致（不许再出现裸「生图 · 首帧」—— 那是 shot 卡的叫法）"
    );
    (((() => { const cnt = (model212.match(/step: [1-9]/g) || []).length; return cnt >= 13; })()) ? ok : fail)(
      "【212】三个模板都标了流程步骤号（生图 ①写提示词→②出图→③备注 / 白模 ①-⑤ / 3D 建模 ①-⑤）"
    );
  }
  /* ══ 保存提示一条、准确（09-29 用户实测：点保存同时看到「已保存（分镜表同时写到工作区）」
     与「⚠ 写工作区文件失败」两条**互相矛盾**的提示，问「啥意思」）══
     ⛔ 病根两条：① 保存按钮盲目乐观（只要有 workspace 就说写进工作区，不管成没成）；
     ② writeStoryboardFile 把 catch 里的错误吞掉 ⇒ 调用方只能说「失败」，用户不知道怎么办。
     常见失败原因是**画布 workspace 掉出主进程可信根**（会话关掉/应用重启后就会掉）。 */
  {
    const storage213 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "drama-storage.ts"), "utf8"));
    const story213 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8"));
    const canvas213 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8");

    (/catch \(error\) \{\s*return \{ path: null, error: error instanceof Error/.test(storage213) ? ok : fail)(
      "【213】写工作区失败必须带回**真实原因**（catch 吞错误 = 用户只看到「失败」不知怎么办）"
    );
    (/const \{ path, meta, error \} = await store\.saveStoryboard/.test(story213) && /return \{ path, error \};/.test(story213) ? ok : fail)(
      "【213】persist 把结果交回调用方（提示归调用方 ⇒ 不会出现两条自相矛盾）"
    );
    (/lastSaveErrorRef/.test(story213) ? ok : fail)(
      "【213】自动保存的失败提示去重（同一原因只弹一次，别每敲一下字弹一遍）"
    );
    (!/已保存到本机" \+ \(workspace \? "（分镜表同时写到工作区）/.test(canvas213) ? ok : fail)(
      "【213】负向：保存按钮不许再盲目乐观（曾按 workspace 有无就宣布写进工作区，与失败提示打架）"
    );
    (/saved\.path/.test(canvas213) && /saved\.error/.test(canvas213) ? ok : fail)(
      "【213】保存按钮按真实结果三态提示（成功 / 未绑工作区 / 失败带原因）"
    );
  }
  /* ══ 生图工作流精简度（09-29 用户：「设计得更简单，节点数量要精简，减少不必要的复杂连接，
     方便新手快速理解使用」）══
     原版 5 卡 4 线 ⇒ 现在 **3 卡 2 线**（写提示词 → 出图 → 备注）。
     ⛔ 断言要防的是**复杂度回潮**：后来人觉得"加张需求说明卡更完整"、"加个 A/B 对比更专业"，
        一加就把新手向的默认路径又搞复杂了 —— 上限断言能拦住。 */
  {
    const { pathToFileURL } = await import("node:url");
    const modelMod = await import(pathToFileURL(join(ROOT, "src", "lib", "drama-canvas-model.mjs")).href);
    const img = modelMod.imageStarterWorkflow();
    (img.nodes.length <= 3 && img.edges.length <= 2 ? ok : fail)(
      `【214】生图入门模板 ≤3 节点 / ≤2 连线（实得 ${img.nodes.length} 节点 / ${img.edges.length} 连线）`
    );
    (img.nodes.some((nd) => nd.id === "n-prompt") && img.nodes.some((nd) => nd.id === "n-out") && img.edges.some((e) => e.relation === "generate") ? ok : fail)(
      "【214】精简不许把核心砍掉：写提示词 → 出图（含 generate 关系）必须在"
    );
    (!img.nodes.some((nd) => /n-brief|n-pick|n-out-a|n-out-b/.test(nd.id)) ? ok : fail)(
      "【214】负向：已删的入门卡（需求说明 / 出图A·B / 选图结论）不许回潮（要对比请用复制卡片）"
    );
    (img.nodes.every((nd) => !nd.payload.text && !nd.payload.prompt) ? ok : fail)(
      "【214】模板 payload 不预填引导文本（09-28 教训：引导词会被当真实提示词发给模型）"
    );
  }
  /* ══ 按钮按状态精简（09-29 用户：「卡片上的功能按键也要精简，不要每个卡片都有重复按键」）══
     ⛔ 病根：image/shot 卡不分状态一律给「生图 + 视频 + 上传参考图」—— 没出图时「视频」是
        文生视频（对生图流程纯噪音），三张卡按钮一模一样也看不出主次。
     现在：visibleChannels(kind, payload) 按状态过滤（没图/首帧不给视频），
     上传参考图只在**输入位**给（没图的出图卡 / 有定妆照的角色卡 / 有首帧的镜头卡都不再重复挂）。 */
  {
    const shared215 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaChannelButton.tsx"), "utf8"));
    const card215 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8"));
    const insp215 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaInspector.tsx"), "utf8"));

    (/export function visibleChannels/.test(shared215) && /kind === "imagegen"[\s\S]{0,80}return allowed\.filter\(\(ch\) => ch !== "video"\)/.test(shared215) ? ok : fail)(
      "【215】visibleChannels 按状态过滤（没图/首帧不给「视频」；生图族 image/imagegen/character/location 一律不透视频）"
    );
    (/visibleChannels\(kind, payload\)/.test(card215) && /visibleChannels\(kind, payload\)/.test(insp215) ? ok : fail)(
      "【215】卡面与检查器**共用同一份**状态过滤（各自 filter 必然漂移）"
    );
    (/kind === "image" \? !payload\.path && !payload\.url && payload\.hint !== "output"/.test(card215) ? ok : fail)(
      "【215】上传参考图只在输入位给（每张卡都挂全套按键 = 用户吐槽的「重复按键」）"
    );
    (!/canUpload = \["image", "character", "location", "shot"\]\.includes\(kind\)/.test(card215) ? ok : fail)(
      "【215】负向：不许回到「按 kind 数组无条件给上传按钮」"
    );
    /* 用户 09-29：「区分两类工作流…按键与工作流类型一一对应、互不冲突」。 */
    (/if \(kind === "shot"\) \{[\s\S]{0,260}?hasFrame \|\| hasVideo/.test(shared215) ? ok : fail)(
      "【215】视频工作流的卡才给「视频」（镜头卡：没首帧先出首帧，有首帧才给视频）"
    );
    /* ⛔ 注意：GEN_CHANNELS 表里 image 仍写着 ["image","video"]（那是"该卡理论上可用通道"），
       过滤在 visibleChannels 里做 —— 所以这里只查**旧实现特征**不许回潮，不查表内容。 */
    (!/const hasStill =/.test(shared215) ? ok : fail)(
      "【215】负向：不许回退到旧的 hasStill 过滤（那是「有图就给视频」的实现，与两类工作流分流冲突）"
    );
    (/payload\.hint === "output"/.test(card215) && /hint: "output"/.test(readFileSync(join(ROOT, "src", "lib", "drama-canvas-model.mjs"), "utf8")) ? ok : fail)(
      "【215】出图卡（产物位）空态说清「点左边卡的生图，图出在这里」（两张卡都教写提示词 = 分不清哪张出图）"
    );
  }
  /* ══ 工作流内按键唯一（09-29 用户：「检查并确保同一工作流中任意两张卡片的按键不存在同名冲突；
     如发现重复需指出具体位置并给出消除重复的处理方案」）══
     做法：模板卡声明角色 payload.act，按键按角色分发（generate=唯一生成入口 / upload=只有上传 /
     output=不出按钮）。**真跑模板**统计 act 分布，断言每个工作流生成入口与素材位各 ≤1 ——
     这就是「同名按键不冲突」的机器判据。
     ⚠️ 口径（已向用户说明）：同**角色**的卡按键不同；同**类型**多张卡（短剧流多个角色卡）保有同类
        按键是必要能力（否则第二个角色没法制图），不算重复 —— 所以断言按「每工作流 ≤1 个生成入口」而不是「全局唯一」。 */
  {
    const { pathToFileURL } = await import("node:url");
    const modelMod = await import(pathToFileURL(join(ROOT, "src", "lib", "drama-canvas-model.mjs")).href);
    const flows = {
      生图: modelMod.imageStarterWorkflow(),
      白模视频: modelMod.whiteboxStarterWorkflow(),
      "3D 建模": modelMod.model3dStarterWorkflow(),
    };
    for (const [label, snap] of Object.entries(flows)) {
      const gen = snap.nodes.filter((nd) => nd.payload?.act === "generate").length;
      const up = snap.nodes.filter((nd) => nd.payload?.act === "upload").length;
      (gen <= 1 && up <= 1 ? ok : fail)(
        `【216】${label}工作流按键唯一（生成入口 ${gen} 张 / 素材位 ${up} 张，各需 ≤1 —— >1 就是同名按键冲突）`
      );
    }
    const card216 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8"));
    (/act === "upload" \|\| act === "prompt" \? \[\] : visibleChannels/.test(card216) ? ok : fail)(
      "【216】卡面按 act 分发通道（模板只声明不接线 = 白声明；upload/prompt 位不生图，生图在产物位）"
    );
    (/act === "upload" \? true/.test(card216) ? ok : fail)(
      "【216】素材位（upload）只给「上传参考图」—— 素材是从外部拖/传进来的，不该有生成按钮"
    );
    (/act === "output" \? false/.test(card216) ? ok : fail)(
      "【216】产物位（output）不出按钮（图落在这里，重出请回唯一入口那张卡）"
    );
  }
  /* ══ AI 润色 + 卡片按键按角色（09-29 用户：「写提示词，就加一个 AI 润色文案功能，出图就生图按键…
     出图现在没有生图按键，怎么行」+「那你就加一个，不要新开会话」）══
     ⛔ 两处都容易做偏：① 润色若走 Agent 会话就是「为一句润色开一次对话」（用户明确否掉了）；
     ② 为了「按键不重复」把产物位按钮删空，用户要的是**每张卡有自己该有的专属按键**。 */
  {
    const region = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
    const dc = readFileSync(join(ROOT, "electron", "features", "drama-canvas.ts"), "utf8");
    const polish = readFileSync(join(ROOT, "electron", "prompt-polish.ts"), "utf8");
    const card217 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8"));
    const story217 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8"));
    const polishChainOk = /AI 润色/.test(card217) && /story\.polishPrompt\(id/.test(card217) && /dramaCanvasPolishPrompt/.test(story217);

    (/drama-canvas:polish-prompt/.test(region) && /"drama-canvas:polish-prompt"/.test(dc) ? ok : fail)(
      "【217】润色通道已登记（handler + ipc-registry 域表；漏域表 = 预检直接红）"
    );
    (/act === "upload" \|\| act === "prompt" \? \[\] : visibleChannels/.test(card217) ? ok : fail)(
      "【217】写提示词位（act=prompt）不挂生图通道（生图入口在出图卡）"
    );
    /* ⛔ 分工：卡面按钮调 story.polishPrompt（story 层负责 busy/提示），
       真正的 IPC 调用在 use-drama-story ⇒ 两处都要在（只写一处 = 断链）。 */
    (polishChainOk ? ok : fail)(
      "【217】「AI 润色」按钮 → story.polishPrompt → 润色通道（三段接线齐全，就地写回卡片）"
    );
    (!/askAgent\(id, "polish"\)/.test(card217) ? ok : fail)(
      "【217】负向：润色不许走 Agent 会话（用户明确「不要新开会话」——那是为一句润色开一次对话）"
    );
    (/只支持 chat 协议|responses 协议/.test(polish) && /官方订阅账号不支持/.test(polish) ? ok : fail)(
      "【217】润色通道写明能力边界（chat 协议 / 官方订阅报错）—— 不符合就明确报错，不猜、不静默"
    );
    (/AbortSignal\.timeout/.test(polish) ? ok : fail)(
      "【217】润色请求带超时（网关慢要报错，不能挂住 UI）"
    );
  }
  /* ══ 旧版模板自动升级（09-29 用户：「我这怎么又是旧的了」）══
     ⛔ 病根是**模板只影响新建**：存量画布在 localStorage 里，切 tab 时被原样读回
     ⇒ 模板改了也永远看到旧卡。所以这条断言必须钉在**读盘那一刻**（load），
     只钉 createStarter 是没用的（用户并没有点新建）。 */
  {
    const boardSrc218 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-board.ts"), "utf8");
    const canvasSrc218 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8");
    const { pathToFileURL } = await import("node:url");
    const model218 = await import(pathToFileURL(join(ROOT, "src", "lib", "drama-canvas-model.mjs")).href);
    const LEGACY218 = { version: 2, nodes: [
      { id: "n-brief", kind: "note", payload: { title: "需求说明", step: 1 } },
      { id: "n-prompt", kind: "image", payload: { title: "主提示词", step: 2 } },
      { id: "n-out-a", kind: "image", payload: { title: "出图 A", step: 3 } },
      { id: "n-out-b", kind: "image", payload: { title: "出图 B", step: 3 } },
      { id: "n-pick", kind: "note", payload: { title: "选图结论", step: 4 } },
    ], edges: [] };
    const up218 = model218.upgradeLegacyStarterSnapshot(LEGACY218);
    const withText218 = JSON.parse(JSON.stringify(LEGACY218)); withText218.nodes[0].payload.text = "我的需求";
    const withImage218 = JSON.parse(JSON.stringify(LEGACY218)); withImage218.nodes[2].payload.path = "C:/a.png";

    (/upgradeLegacyStarterSnapshot\(snapshot\)/.test(boardSrc218) && /store\.writeBoard\(name, upgraded\)/.test(boardSrc218) ? ok : fail)(
      "【218】画布**读盘时**自动升级空壳旧模板并立刻写回（只改 createStarter = 切 tab 永远看到旧卡）"
    );
    (up218 && up218.nodes.length === 3 && up218.edges.length === 2 ? ok : fail)(
      "【218】空壳旧模板（5 卡）升级为最新 3 步精简版（真跑，不是查关键字）"
    );
    (model218.upgradeLegacyStarterSnapshot(withText218) === null && model218.upgradeLegacyStarterSnapshot(withImage218) === null ? ok : fail)(
      "【218】负向：有用户内容（文字 / 生成图）的旧画布**绝不动**（不替用户做决定）"
    );
    (model218.upgradeLegacyStarterSnapshot(model218.imageStarterWorkflow()) === null ? ok : fail)(
      "【218】负向：已是最新模板不重复升级（幂等，免每次打开都写盘）"
    );
    (/写提示词 → 出图 → 备注/.test(canvasSrc218) && !/出图 A\/B/.test(canvasSrc218) ? ok : fail)(
      "【218】顶栏/菜单/说明里的流程描述同步为最新 3 步（模板改了文案没改 = 用户又看到「旧流程」）"
    );
    (/legacyStarterSignature/.test(canvasSrc218) ? ok : fail)(
      "【218】切到「有内容的旧模板」时说明原因（否则用户只看到「又是旧的」，不知道能怎么办）"
    );
  }
  /* ══ 独立生图节点 + 六类图 + 电商出图工作流（09-29 用户：「设计生图节点时，请将其独立出来，
     不要与视频节点共用同一套结构」+「生图节点需包含以下图片类型：主图、SKU图、详情图、场景图、
     白底图、买家秀」+「规划详情图如何生成，并提供图片尺寸等可选配置项」+
     「在每张提示词卡片中都要集成AI润色功能」）══
     ⛔ 三条容易做偏：① 把六类图做成同一个节点换皮肤（那就还是共用结构）；
     ② 生图节点留着视频通道（两类工作流又混在一张卡上）；③ 润色只在某一类卡上（用户要的是**每张**）。 */
  {
    const { pathToFileURL } = await import("node:url");
    const model219 = await import(pathToFileURL(join(ROOT, "src", "lib", "drama-canvas-model.mjs")).href);
    const channelSrc219 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaChannelButton.tsx"), "utf8");
    const inspectorSrc219 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaInspector.tsx"), "utf8");
    const cardSrc219 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8"));
    const storySrc219 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8"));
    const canvasSrc219 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8");
    const registrySrc219 = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");

    const kinds219 = model219.IMAGE_KINDS.map((item) => item.label).join(" / ");
    const wanted219 = ["主图", "SKU 图", "详情图", "场景图", "白底图", "买家秀"];
    const ecom219 = model219.ecomImageStarterWorkflow();
    const inIdx219 = inspectorSrc219.indexOf("imagegen: [");
    const imagegenBlock219 = inIdx219 >= 0 ? inspectorSrc219.slice(inIdx219, inspectorSrc219.indexOf("\n  ],", inIdx219)) : "";

    (wanted219.every((label) => kinds219.includes(label)) ? ok : fail)(
      `【219】六类图齐全（主图 / SKU图 / 详情图 / 场景图 / 白底图 / 买家秀）—— 实测：${kinds219}`
    );
    (model219.dramaIsKnownKind("imagegen") && !String(model219.DRAMA_NODE_DEFS.imagegen.subtitle).includes("视频") ? ok : fail)(
      "【219】imagegen 是**独立**节点类型（不复用 image / video），且定位里不含视频"
    );
    (/imagegen: \["image"\],/.test(channelSrc219) && /kind === "imagegen"/.test(channelSrc219) ? ok : fail)(
      "【219】生图节点只挂生图通道 —— 结构上不可能出现视频按钮（「不与视频节点共用同一套结构」）"
    );
    (["imageType", "size", "count", "panels", "subject", "negative"].every((k) => imagegenBlock219.includes(`key: "${k}"`)) ? ok : fail)(
      "【219】生图节点配置项齐全（图片类型 / 尺寸 / 张数 / 图块清单 / 锁定主体 / 负面提示词）"
    );
    (!/aspect:|duration:|ref_video/.test(imagegenBlock219) ? ok : fail)(
      "【219】负向：生图节点的配置项**不含**视频那套（画幅 / 时长 / 参考视频）"
    );
    (cardSrc219.includes('imagegen: "prompt"') && cardSrc219.includes('character: "look"') && cardSrc219.includes('shot: "prompt"')
      && /POLISH_FIELD\[kind\]/.test(cardSrc219) && /\[polishField\]: polished/.test(cardSrc219) ? ok : fail)(
      "【219】每张提示词卡都集成「AI 润色」：按 kind 找到**它自己的**提示词字段并就地写回"
    );
    (cardSrc219.includes("锁定主体") && /describeSubject\(id\)/.test(cardSrc219) ? ok : fail)(
      "【219】生图卡上有「锁定主体」按钮（接 story.describeSubject）"
    );
    (ecom219.nodes.length === 8 && ecom219.edges.length === 7 && ecom219.nodes.every((n) => n.payload.flow === "ecom") ? ok : fail)(
      "【219】电商出图工作流：8 卡 7 线（参考图 → 白底母版 → 主图/SKU/场景/买家秀/详情图 → 素材包清单）"
    );
    (ecom219.nodes.filter((n) => n.kind === "imagegen").length === 6 ? ok : fail)(
      "【219】电商工作流里六类图各占一张生图节点"
    );
    (model219.detailPanelsOf({}).length === 6 && model219.detailPanelsOf({ panels: "A\nB" }).length === 2 ? ok : fail)(
      "【219】详情图按「图块清单」规划：默认 6 块，且清单可被用户改写（真跑）"
    );
    (/const locked = String\(payload\.subject/.test(storySrc219) && /\$\{locked\}/.test(storySrc219) ? ok : fail)(
      "【219】锁定主体真正参与生成（拼成整套图共用前缀，不只是存在 payload 里）"
    );
    (/drama-canvas:describe-image/.test(registrySrc219) && /describeProductOnce/.test(readFileSync(join(ROOT, "electron", "prompt-polish.ts"), "utf8")) ? ok : fail)(
      "【219】锁主体通道已登记域表 + 主进程有实现（视觉反推落盘在 prompt-polish）"
    );
    (/createStarter\("ecom"\)/.test(canvasSrc219) && /mark === "ecom"/.test(canvasSrc219) ? ok : fail)(
      "【219】电商出图工作流有新建入口，且顶栏显示自己的名字"
    );
    (/act === "upload" \|\| payload\.hint === "ref" \? "" : \(POLISH_FIELD\[kind\] \|\| ""\)/.test(cardSrc219) ? ok : fail)(
      "【219】负向：素材位（上传参考图 / 参考图槽）不挂「AI 润色」—— 那里没有提示词可润色"
    );
    (/kind === "image" \|\| kind === "imagegen"[\s\S]{0,140}pendingCards\.push\(label\)/.test(canvasSrc219) ? ok : fail)(
      "【219】新节点计入「待生成」进度（漏登记 ⇒ 顶栏数字永远说少，比不显示更误导）"
    );
  }
  /* ══ 连线可删 / 可改接 / 亮起动画 + 卡片工作态点亮 + 产物目录（09-29 用户：
     「用那条线就，那条线亮起来，动画」+「工作流是死的，线没办法删，手动牵线」+
     「我传了参考图，不想经过其他流程图」+「卡片那个在工作，那个就亮起来，这样方便区分」+
     「产物路径，你就在 codexharness 目录下面新增一个存的目录，也可以选择和修改目录」）══
     ⛔ 病根记录：连线删除的底层（onEdgesChange 处理 remove）**一直都在**，但 deleteKeyCode=null
        且线上没有任何删除入口 ⇒ 用户永远删不掉。**"能力存在"不等于"用户够得着"**。 */
  {
    const boardSrc220 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-board.ts"), "utf8");
    const canvasSrc220 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8");
    const cardSrc220 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8");
    const inspSrc220 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaInspector.tsx"), "utf8");
    const storySrc220 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "use-drama-story.ts"), "utf8"));
    const cssSrc220 = readFileSync(join(ROOT, "src", "styles", "21-drama-canvas.css"), "utf8");
    const registrySrc220 = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
    const mainSrc220 = readFileSync(join(ROOT, "electron", "features", "drama-canvas.ts"), "utf8");

    (/const removeEdges = useCallback/.test(boardSrc220) && /removeEdges: \(ids: string\[\]\) => void;/.test(boardSrc220) ? ok : fail)(
      "【220】删连线：状态骨提供 removeEdges（含接口声明）"
    );
    (/actions\.board\.removeEdges\(\[id\]\)/.test(canvasSrc220) && /actions\.board\.removeEdges\(\[e\.id\]\)/.test(inspSrc220) ? ok : fail)(
      "【220】删连线有**两个看得见的入口**：线上中点的 ✕ + 检查器连线行的删除键（能力存在 ≠ 用户够得着）"
    );
    (/const onReconnect = useCallback/.test(boardSrc220) && /edgesReconnectable/.test(canvasSrc220) && /onReconnect=\{board\.onReconnect\}/.test(canvasSrc220) ? ok : fail)(
      "【220】改接线：拖线端点换卡片（onReconnect + edgesReconnectable + 三处接线齐全）"
    );
    (/\"drama-edge\"/.test(canvasSrc220) && /const EDGE_TYPES/.test(canvasSrc220) && /edgeTypes=\{EDGE_TYPES\}/.test(canvasSrc220)
      && (boardSrc220.match(/type: "drama-edge"/g) || []).length >= 2 ? ok : fail)(
      "【220】自定义边类型 drama-edge 挂到画布，且三条创建路径（读盘 / 手动连 / 默认）统一用它"
    );
    (/\.drama-canvas-edge-flow/.test(cssSrc220) && /@keyframes drama-edge-flow/.test(cssSrc220) ? ok : fail)(
      "【220】连线**亮起来 + 流动动画**（悬停 / 选中 / 两端卡片任一在忙或选中）"
    );
    (/is-working/.test(cardSrc220) && /\.drama-canvas-card\.is-working/.test(cssSrc220) && /@keyframes drama-card-working/.test(cssSrc220) ? ok : fail)(
      "【220】「哪张卡在工作，那张卡就点亮」（busy 前缀判定 + 脉动动画）"
    );
    (/deleteKeyCode=\{null\}/.test(canvasSrc220) ? ok : fail)(
      "【220】负向：**不**打开 Delete 键的全局删除（那会连卡片一起被键盘删掉，用户没要求且易误删）"
    );
    (/defaultOutputDir|outputs/.test(mainSrc220) && /drama-canvas:output-dir/.test(registrySrc220) && /drama-canvas:output-dir-set/.test(registrySrc220) ? ok : fail)(
      "【220】产物目录：默认 <userData>/outputs + 两个通道（读 / 选·改·恢复默认）已登记域表"
    );
    (/outputDir: String\(outDir\?\.dir \|\| ""\)\.trim\(\) \|\| undefined/.test(storySrc220) ? ok : fail)(
      "【220】生成时把产物目录传给主进程（只登记通道不传 = 白做）"
    );
    (/persistGeneratedImage\(url: string, dirOverride\?: string\)/.test(readFileSync(join(ROOT, "electron", "features", "builtin-skills-ipc", "01-builtin-images.ts"), "utf8")) ? ok : fail)(
      "【220】落盘真的落到指定目录（不传时仍走旧默认 —— 会话里的 MCP 工具行为不变）"
    );
    (/outputDir && !isInsideTrustedRoots/.test(readFileSync(join(ROOT, "electron", "features", "video-gen.ts"), "utf8"))
      && /outputDir: String\(outDirForVideo\?\.dir \|\| ""\)/.test(storySrc220) ? ok : fail)(
      "【220】视频工作流同理：视频也落产物目录，且**先过可信根**（选了目录就登记，否则写了也白写）"
    );
  }
  /* ══ 视频工作流：卡片关联性 + 按键按用途区分（09-29 用户：「视频工作流中各个卡片之间应具有较高的
     关联性，且每张卡片的功能按键应根据其用途有所区分」）══
     调研落成的四条：场次卡管本场一致性（首帧并排 + 按场选中）、剪辑卡接真实本机拼接、
     角色/场景卡显示「N 镜在用」、镜头卡显示上游摘要。 */
  {
    const cardSrc221 = codeOnly(readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaNodeCard.tsx"), "utf8"));
    const canvasSrc221 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8");
    const actionsSrc221 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "drama-actions.ts"), "utf8");
    const cssSrc221 = readFileSync(join(ROOT, "src", "styles", "21-drama-canvas.css"), "utf8");
    /* 按**分支切片**取各自卡片的渲染段（比固定字符窗口稳：插几行不会假红） */
    /* ⛔ 必须带花括号找：subtitleOf / roleOf 里也有同名的无花括号分支，先命中的是它们（本轮踩到）。 */
    const sceneAt221 = cardSrc221.indexOf('if (kind === "scene") {');
    const shotAt221 = cardSrc221.indexOf('if (kind === "shot") {', sceneAt221);
    const sceneBranch221 = sceneAt221 >= 0 && shotAt221 > sceneAt221 ? cardSrc221.slice(sceneAt221, shotAt221) : "";
    const tlAt221 = cardSrc221.indexOf('if (kind === "timeline") {');
    /* ⛔ 别拿注释当锚：codeOnly 会把注释剥掉（本轮实测踩到）⇒ 用「下一个分支起点」切尾。 */
    const tlEnd221 = cardSrc221.indexOf("if (kind ===", tlAt221 + 12);
    /* ⛔ 末尾这个分支后面**没有**下一个 if（character/location 是兜底），indexOf 回 -1 —— 要回落到串尾。 */
    const timelineBranch221 = tlAt221 >= 0 ? cardSrc221.slice(tlAt221, tlEnd221 > tlAt221 ? tlEnd221 : cardSrc221.length) : "";

    /* ① 每类卡按键按用途区分：四类「策划/结构」卡各有一颗**只属于自己**的按钮 */
    const own221 = ["让 Agent 生成分镜表", "展开场次与镜头", "选中本场", "拼接成片（本机）", "让 Agent 精修"];
    (own221.every((text) => cardSrc221.includes(text)) ? ok : fail)(
      "【221】按键按用途区分：剧本 / 分镜表 / 场次 / 剪辑各有专属按键（不再只有镜头卡有按钮）"
    );
    (sceneBranch221.includes("选中本场") && timelineBranch221.includes("拼接成片") ? ok : fail)(
      "【221】专属按键挂在**各自**分支里（不是随便找张卡挂上就算）"
    );

    /* ② 剪辑卡必须用真能力：本机 ffmpeg 拼接已存在，卡面不许再说「不内置合成器」 */
    (/actions\.story\.exportMovie\(\)/.test(cardSrc221) && /actions\.story\.exporting/.test(cardSrc221) ? ok : fail)(
      "【221】剪辑卡接**真实**本机拼接能力（exportMovie + 忙态），而不是只会把人推去开会话"
    );
    (!/不内置合成器/.test(cardSrc221) ? ok : fail)(
      "【221】负向：卡面不许再写「本项目不内置合成器」（09-29 已接 video:concat，这句是过期文案 —— 文案骗人比没文案更糟）"
    );

    /* ③ 关联性：场次卡并排本场首帧（continuity pass）、角色/场景显示被引用数、镜头显示上游 */
    (/drama-canvas-strip/.test(cardSrc221) && /\.drama-canvas-strip-img/.test(cssSrc221) ? ok : fail)(
      "【221】场次卡有「本场首帧并排」一致性检查条（发型/服装/光线一眼比对）"
    );
    (/镜在用/.test(cardSrc221) ? ok : fail)(
      "【221】角色 / 场景卡显示「N 镜在用」（一致性锚点用了多少镜必须看得见）"
    );
    (/drama-canvas-chips/.test(cardSrc221) && /\.drama-canvas-chip\b/.test(cssSrc221) ? ok : fail)(
      "【221】镜头卡显示上游摘要 chips（本场 / 角色 / 场景 —— 这张卡吃谁）"
    );
    (/linkedShotRefs/.test(actionsSrc221) && /linkedShotRefs: \(nodeId: string\)/.test(canvasSrc221) ? ok : fail)(
      "【221】按场操作要有节点 id（linkedShots 只回 payload ⇒ 补 linkedShotRefs；否则「选中本场」根本选不到）"
    );
  }
  /* ══ 节点与检查器按工作流分流（09-29 用户：「节点未按生图工作流和视频工作流独立区分」
     +「点击卡片弹出的侧边栏未按功能（最新逻辑）更新」）══
     ⛔ 两条都是"看起来改了其实没改"的高发区：面板照旧列全部节点、检查器照旧一套外样。 */
  {
    const { pathToFileURL } = await import("node:url");
    const model222 = await import(pathToFileURL(join(ROOT, "src", "lib", "drama-canvas-model.mjs")).href);
    const canvasSrc222 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaCanvas.tsx"), "utf8");
    const inspSrc222 = readFileSync(join(ROOT, "src", "features", "drama-canvas", "DramaInspector.tsx"), "utf8");
    const cssSrc222 = readFileSync(join(ROOT, "src", "styles", "21-drama-canvas.css"), "utf8");

    /* ① 分流真跑：生图节点不进视频流，视频节点不进生图流，通用卡两边都在 */
    (model222.dramaNodeFitsFlow("imagegen", "image") === true
      && model222.dramaNodeFitsFlow("imagegen", "drama") === false
      && model222.dramaNodeFitsFlow("shot", "drama") === true
      && model222.dramaNodeFitsFlow("shot", "image") === false
      && model222.dramaNodeFitsFlow("script", "image") === false
      && model222.dramaNodeFitsFlow("timeline", "image") === false ? ok : fail)(
      "【222】节点按工作流分流（真跑）：生图节点只在生图流，剧本/镜头/剪辑只在视频流"
    );
    (model222.dramaNodeFitsFlow("note", "image") === true && model222.dramaNodeFitsFlow("note", "drama") === true
      && model222.dramaNodeFitsFlow("image", "image") === true && model222.dramaNodeFitsFlow("image", "drama") === true ? ok : fail)(
      "【222】通用卡两边都给（笔记 / 参考图 —— 别为了「分流」把通用节点也砍掉）"
    );
    (/dramaGroupsFor\(flow\.type\)/.test(canvasSrc222) && /dramaNodeFitsFlow\(kind, flow\.type\)/.test(canvasSrc222) ? ok : fail)(
      "【222】添加节点面板按**当前**工作流过滤（且空分组不列）"
    );

    /* ② 检查器按功能更新：工作流 chip + 动作按 kind + 与卡面同源的润色 */
    (/drama-canvas-flow-chip/.test(inspSrc222) && /is-family-\$\{imageKindFamily\}/.test(inspSrc222) && /\.drama-canvas-flow-chip/.test(cssSrc222) ? ok : fail)(
      "【222】检查器头部标明「属于哪条工作流 + 这一步是什么」（生图族上蓝，一眼可辨）"
    );
    (/WRITEBACK_KINDS\.includes\(kind\)/.test(inspSrc222) ? ok : fail)(
      "【222】「写回分镜表」只在分镜相关卡出现（原来每张卡都挂 = 旧统一外样残留，点了空转）"
    );
    (/POLISH_FIELD, POLISH_LABEL/.test(inspSrc222) && /story\.polishPrompt\(id/.test(inspSrc222) ? ok : fail)(
      "【222】检查器也有「AI 润色」，且与卡面**同源**（同一张 POLISH_FIELD 表，不各写一份）"
    );
    (/imageKindMeta\(payload\.imageType\)\.purpose/.test(inspSrc222) ? ok : fail)(
      "【222】生图节点在检查器里先讲清「是什么图 / 多大 / 几个图块」再列字段"
    );
  }
}
