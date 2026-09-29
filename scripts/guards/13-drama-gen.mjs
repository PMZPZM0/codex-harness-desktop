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
    // ③ 下拉标签**始终**隐藏（曾用 @media 断点摘 —— 窗口比断点宽时标签又回来把按钮挤下去）
    (/^\.drama-canvas-head \.drama-canvas-select > span \{ display: none; \}/m.test(css) ? ok : fail)(
      "【201】下拉标签始终隐藏（值本身可读；断点式隐藏会在宽窗口失效）"
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
    (/flex: 1 1 auto; flex-wrap: nowrap; min-width: 0; overflow: hidden/.test(css) ? ok : fail)(
      "【201】左侧可收缩（nowrap 下靠标题截断让位，而不是把按钮挤下去）"
    );
  }

  }
}
