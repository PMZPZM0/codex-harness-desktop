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
    const cardUses = /import \{ DramaChannelButton, GEN_CHANNELS \} from "\.\/DramaChannelButton"/.test(card);
    (hasMap && cardUses ? ok : fail)(
      "【192】卡面用共享的「节点类型 → 可用生成通道」映射表（09-28 提到 DramaChannelButton.tsx，卡面与检查器同一份）"
    );
  })();
  (/const allowed = GEN_CHANNELS\[kind\];\s*\n\s*if \(!allowed\) return null;/.test(card) ? ok : fail)(
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

    (/import \{ DramaChannelButton, GEN_CHANNELS \} from "\.\/DramaChannelButton"/.test(inspector) && /GEN_CHANNELS\[kind\]/.test(inspector) ? ok : fail)(
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

    (canvas.includes("生图工作流已就绪") && canvas.includes("生图 · 首帧") ? ok : fail)(
      "【192】工作流建立提示用真实按钮名（原来写「点『生成』」，卡片上根本没这个按钮，用户照着找不到）"
    );
    (panel.includes("生图 · 首帧") && panel.includes("视频 · 生成") ? ok : fail)(
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
    (canvasSrc2.includes('{flow.type === "drama" ? "短剧工作流" : "生图工作流"}') ? ok : fail)(
      "【201】顶栏标题显示当前工作流类型（按卡片推断，用户才不会问「我这是哪个工作流」）"
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
    (/builtin:generate-image[\s\S]{0,120}generateImageResilient/.test(imageSrc) ? ok : fail)(
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
}
