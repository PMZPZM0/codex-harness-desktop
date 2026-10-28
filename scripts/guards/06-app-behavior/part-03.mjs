/** 06-app-behavior 第 3/5 段：原 06-app-behavior.mjs L1713–L2516（逐字搬运 + 各自成块）。
 *  ⛔ 每个顶层语句外面套一层块：拆段后同一文件里不再共享作用域，const 重名不会撞（也正好还原原文件的分块隔离）。 */
/**
 * 预检守卫组：06-app-behavior
 * 分节：【23】【24】【25】【28】（原 L2914–L4089）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, ROOT, codeOnly, createRequire, existsSync, fail, join, mainSrc, mkdirSync, ok, pathToFileURL, readAppUi, readBuiltinSkillsSource, readFileSync, readMainSource, readResponsesBridgeSource, readSettingsSurface, readStyles, readdirSync, relative, rmSync, sliceHandle, spawnSync, statSync, typesSrc,
} from "../_ctx.mjs";
import { FUNCTION_MENU_DEFAULT_ORDER, moveFunctionMenuItem, normalizeFunctionMenu, resetFunctionMenuLayout, setFunctionMenuItemOverflow } from "../../../src/features/function-menu/menu-model.mjs";



export async function run() {
{
if (existsSync(join(ROOT, "src", "features", "team-office"))) {
    console.log(C.bold("\n【154】专家团办公室预览（team-office 域）"));
    /* 不得再有独立侧栏入口 */
    const shellSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "01-sidebar-shell.tsx"), "utf8");
    (!shellSrc.includes("CompanyMode") && !shellSrc.includes("companyPreview") ? ok : fail)("【154】侧栏不得有独立「公司模式」入口（已收成专家团专属预览）");
    /* 入口 = 专家团会话右侧「成员流转轨」末位节点（用户 09-25 定稿：⛔ 不是设置页卡片） */
    const railSrc = readFileSync(join(ROOT, "src", "features", "experts-teams", "ExpertsTeams", "02-rails.tsx"), "utf8");
    (railSrc.includes("onOpenOffice") && railSrc.includes("team-rail-office") ? ok : fail)("【154】成员流转轨末位有「办公室」入口节点");
    const teamsSrc = readFileSync(join(ROOT, "src", "features", "settings-teams", "TeamsSettingsSection.tsx"), "utf8");
    (!teamsSrc.includes("openTeamOfficePreview") ? ok : fail)("【154】⛔ 不得在专家团设置页卡片加入口（用户已否）");
    const timelineSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "01-timeline.tsx"), "utf8");
    (timelineSrc.includes("onOpenOffice={() => setCompanyPreviewTeamId(railTeam.teamId)}") ? ok : fail)("【154】会话把 rail 入口接到预览状态（用当前会话的团队）");
    /* 组件与数据面 */
    const viewPath = join(ROOT, "src", "features", "team-office", "TeamOfficePreview.tsx");
    const viewSrc = existsSync(viewPath) ? readFileSync(viewPath, "utf8") : "";
    /* ⛔ 10-05 修订：原来两条断言的是"组件自己调 `teamThreadsMap()` / `runningThreadIds`"——
       而当前实现已改为**纯 props 驱动**（成员运行态由宿主从引擎事件流归约后传入，
       见该文件头「数据边界」注释）。⇒ 旧断言过时，且方向与新架构**相反**。
       ⛔ 新判据：**组件不许自己拉数据 / 订阅引擎**（这才是域组件的规矩）。 */
    (!/window\.codex|teamThreadsMap\(|runningThreadIds/.test(codeOnly(viewSrc)) ? ok : fail)(
      "【154】⛔⛔ 预览是**纯 props 驱动**：不自己拉 IPC（成员状态由宿主归约后传入）"
    );
    (viewSrc.includes("runningByMember") ? ok : fail)("【154】角色状态映射真实成员运行记录 runningByMember（唯一数据源）");
    (viewSrc.includes("openThread") ? ok : fail)("【154】预览的「进入对话」真实跳到该成员会话");
    /* ⭐ 10-07 用户要求：关闭钮**左侧**一组缩放按钮（放大 / 缩小 / 重置）+ 滚轮缩放。
       ⛔ 判据锚「控制组存在 + 它排在关闭钮**之前**」这个**结构**，不锚图标名
         （图标换了不算回归；缺按钮 / 顺序反了才算）。
       ⛔ 只断言"有个 tools 容器"是不够的 —— 事件必须被**收回来**：顶栏整条是
         `pointer-events: none`，托盘不写 `auto` 的话三个按钮全是死的。 */
    const toolsIdx154 = viewSrc.indexOf("office-overlay-tools");
    const closeIdx154 = viewSrc.indexOf("office-overlay-close");
    (toolsIdx154 >= 0 && closeIdx154 > toolsIdx154 ? ok : fail)(
      "【154】缩放控制组在关闭钮**左侧**（DOM 顺序：tools 先于 close）"
    );
    /* ⛔ 用带转义的锚点找 `zoomCtl.current?.zoomIn()` 这类调用，别用宽松的 includes */
    (["zoomIn", "zoomOut", "reset"].every((k) => new RegExp(`zoomCtl\\.current\\?\\.${k}\\(\\)`).test(viewSrc)) ? ok : fail)(
      "【154】放大 / 缩小 / 重置三个操作都接到画布的控制句柄"
    );
    (viewSrc.includes("onZoomChange") && viewSrc.includes("controlsRef") ? ok : fail)(
      "【154】画布回报缩放倍率 + 接收控制句柄（缺回报 ⇒ 到上下限按钮不停用 = 点了没反应）"
    );
    const officeCss154 = existsSync(join(ROOT, "src", "styles", "20-team-office.css"))
      ? readFileSync(join(ROOT, "src", "styles", "20-team-office.css"), "utf8") : "";
    (/\.office-overlay-tools\s*\{[\s\S]{0,400}?pointer-events:\s*auto/.test(officeCss154) ? ok : fail)(
      "【154】⛔⛔ 缩放托盘自己收回点击（顶栏是 pointer-events:none，不收回 ⇒ 三个按钮全点不动）"
    );
    // ⛔ 10-03：负向断言也要双形态 —— 渲染层一旦出现 `ipcHost.handle` 同样是"视图组件内注册 IPC"，
    //    只禁 ipcMain 的话，改个名字就能绕过（负向断言最怕这种"换个写法就绿"）。
    (!/ipcMain\.handle/.test(viewSrc) && !/ipcHost\.handle/.test(viewSrc) ? ok : fail)("【154】视图组件内不得直接注册 IPC");
    const appViewSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8");
    (appViewSrc.includes("<TeamOfficePreview") && appViewSrc.includes("teamId={app.companyPreviewTeamId}") ? ok : fail)("【154】预览浮层已挂载进 AppView（显式 props，域组件禁收 app）");
    const bagSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "bag-types.ts"), "utf8");
    (bagSrc.includes("companyPreviewTeamId: string | null;") ? ok : fail)("【154】companyPreviewTeamId 已登记 bag-types");
    const cssEntry = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
    (cssEntry.includes("./styles/20-team-office") ? ok : fail)("【154】办公室样式已接入 styles.css（20-team-office）");
    /* ⛔⛔ 10-05 加：**显示器内容区必须落在屏幕玻璃上，不是椅背上。**
       背景（用户两次报「显示器还是固定的 / 没对准 / 没显示」）：
         · 10-04 那版 screen 坐标是"扫 bg.webp"得到的，但判据同时命中了**椅背**
           （椅背 rgb(47,65,95) 与屏幕玻璃同属"暗且偏蓝"）⇒ 六个屏面全落在椅背上；
         · 而椅背随后会被**重贴**盖回人物身上（OfficeCanvas 的 backrest 重贴）
           ⇒ 画上去的动态内容被整块盖掉 ⇒ 用户看到的仍是背景图里烙死的静态屏幕。
       ⇒ 判据用**几何不可能性**：屏面底必须高于椅背顶（相对坐标 screen.y+h <= backrest.dy）。
         ⛔ 无阈值可调、无需读图；坐标一旦写回椅背范围立刻变红。 */
    const fmtSrc = existsSync(join(ROOT, "src", "features", "team-office", "office-format.ts"))
      ? readFileSync(join(ROOT, "src", "features", "team-office", "office-format.ts"), "utf8") : "";
    const seatRows = [...fmtSrc.matchAll(/y:\s*(-?\d+),\s*facing:\s*"up",\s*backrest:\s*\{\s*dx:\s*(-?\d+),\s*dy:\s*(-?\d+),\s*w:\s*\d+,\s*h:\s*\d+\s*\},\s*screen:\s*\{\s*x:\s*(-?\d+),\s*y:\s*(-?\d+),\s*w:\s*(\d+),\s*h:\s*(\d+)\s*\}/g)];
    (seatRows.length === 6 ? ok : fail)(`【154】SEATS 六个座位都带 screen 矩形（解析到 ${seatRows.length} 个 —— ⛔ 0 个说明正则失配、断言在空跑）`);
    const onChair = seatRows.filter((m) => Number(m[5]) + Number(m[7]) > Number(m[3]));
    (onChair.length === 0 ? ok : fail)(`【154】⛔⛔ 每个屏面都**完全在椅背上方**（压到椅背上会被椅背重贴整块盖掉）—— 违例 ${onChair.length} 个`);
    /* ⛔ 判据落在**注释里**（量法说明）⇒ ⛔ 不能先剥注释再找（那样必然恒红 —— 第一版就写错了）。 */
    (/(is_glass|sum\s*<\s*190)/.test(fmtSrc) ? ok : fail)(
      "【154】量法注释点名**亮度判据**（⛔ 旧的 `b>r+20` 类判据会把椅背一起收进来）");
    const officeCss = existsSync(join(ROOT, "src", "styles", "20-team-office.css")) ? readFileSync(join(ROOT, "src", "styles", "20-team-office.css"), "utf8") : "";
    /* 形态守卫（09-27 v8「PixiJS 渲染」）：v1 折线图 / v2 div 色块 / v3 单张 SVG 插画
       三版都被用户否过（「歪歪扭扭」「不好看」「手绘人物和素材家具违和」）⇒ 断言钉死：
       画布 = PixiJS Application + 逐帧 animateScene，⛔ 不许退回任何一种被否形态。 */
    /* ── 当前实现（原生 canvas 2D，v19 起）─────────────────────────────
       ⛔ 这里原先断言的是 PixiJS 形态（`new Application` / `animateScene` /
          `OfficeScene` / `pointertap`），那些文件已随 v19 换实现而删除
          ⇒ 断言早已失效，本轮**显式移除**（⛔ 不留死断言）。
       下面是**当下真实存在**的实现面。 */
    const canvasPath154 = join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx");
    const canvasSrc154 = existsSync(canvasPath154) ? readFileSync(canvasPath154, "utf8") : "";
    const screenPath154 = join(ROOT, "src", "features", "team-office", "office-screen.ts");
    const screenSrc154 = existsSync(screenPath154) ? readFileSync(screenPath154, "utf8") : "";
    const cssSrc154 = existsSync(join(ROOT, "src", "styles", "20-team-office.css"))
      ? readFileSync(join(ROOT, "src", "styles", "20-team-office.css"), "utf8") : "";
    (canvasSrc154.includes('getContext("2d")') && canvasSrc154.includes("drawScreen(") ? ok : fail)(
      "【154】场景是原生 canvas 2D 且逐帧画显示器内容（v19 形态）"
    );
    (cssSrc154.includes(".office-pixel-canvas") ? ok : fail)(
      "【154】画布宿主容器样式齐全（.office-pixel-canvas —— 类名是接口）"
    );
    (!/\.ofc-(desk|bubble|type-a|zzz|sip)/.test(cssSrc154) ? ok : fail)(
      "【154】⛔ 场景级 .ofc-* 旧样式已清干净（留着 = 死样式，CSS 覆盖告警会一直报）"
    );
    /* ⛔⛔ 显示器内容必须画在**背景之后**：画在背景前等于没画（会被背景盖掉）。 */
    const drawIdx154 = canvasSrc154.indexOf("drawScreen(");
    const bgIdx154 = canvasSrc154.indexOf("ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H)");
    (bgIdx154 >= 0 && drawIdx154 > bgIdx154 ? ok : fail)(
      "【154】⛔⛔ 显示器内容画在背景之后（画在背景前 = 被背景盖住 = 用户报的「没显示」）"
    );
    (!canvasSrc154.includes("ipcRenderer") && !/window as any\)\.codex/.test(canvasSrc154) ? ok : fail)(
      "【154】画布层零 IPC（事件驱动：成员状态由宿主 props 传入）"
    );
    /* ⛔⛔ 待机 ≠ 熄屏（10-05 用户报「显示器都还是固定的」的第二层原因）：
       `idle` 必须有**自己的**屏保分支，⛔ 不许再让它落到 `off`。 */
    (/if \(mode === "idle"\)/.test(screenSrc154) ? ok : fail)(
      "【154】⛔⛔ idle 有自己的屏保分支（⛔ 退回 off ⇒ 委托跑完全员待机、六屏全黑静止）"
    );
    (/return "code";[\s\S]{0,300}?return "idle";/.test(screenSrc154) ? ok : fail)(
      "【154】⛔⛔ 有人坐工位但没在跑 ⇒ 映射到 idle（屏保），⛔ 不是 off"
    );
    (/if \(!input\.occupied\) return "off";/.test(screenSrc154) ? ok : fail)(
      "【154】off 语义收窄为**空座**（⛔ 别再让「待机」共用它）"
    );
    /* ⛔ 10-26 办公室分间：单例改成「按办公室 key 的模块级 Map」（每间一个 sim，切回来人物还在原处）。
       意图不变：**模块级常驻**，⛔ 不是组件级（组件级 ⇒ 每次打开预览都重播进场）。 */
    (/const officeSims = new Map<string, OfficeSim>\(\)/.test(canvasSrc154) ? ok : fail)(
      "【154】sim 是模块级常驻（按办公室分间的 Map，⛔ 组件级 ⇒ 每次打开预览都重播进场）"
    );
  }
}

{
if (!existsSync(join(ROOT, "src", "features", "team-office", "office-render.ts"))) {
    /* ⛔⛔ 2026-10-05：本组断言的**对象**（PixiJS 程序化绘制 / office-director 导演 /
       office-render 绘制）随 v19「像素素材 + 原生 canvas 2D」全部删除
       ⇒ 本组**长期空跑**。⛔ 静默跳过 = 假绿（让人以为办公室有几十条断言在保护）
       —— 用户 10-05 报「显示器没对准、没显示」时没有任何守卫拦下，根因就在这里。
       ✅ 先改成**显式打印**；恢复方式 = 按当前实现重写断言（样板见【154】）。 */
    console.log("  ! 【办公室】断言对象 office-render.ts 已随 v19 删除 ⇒ 本组跳过（⛔ 空跑=假绿，待按当前实现重写）");
  } else
  {
    console.log(C.bold("\n【169】办公室渲染纵深（程序化绘制 / 桌-人-椅三层遮挡）"));
    const renderPath = join(ROOT, "src", "features", "team-office", "office-render.ts");
    const renderSrc = existsSync(renderPath) ? readFileSync(renderPath, "utf8") : "";
    const isoPath = join(ROOT, "src", "features", "team-office", "office-iso.ts");
    const isoSrc = existsSync(isoPath) ? readFileSync(isoPath, "utf8") : "";
    const furnSrc = existsSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"))
      ? readFileSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"), "utf8") : "";

    (["drawRoom", "drawBackWall", "drawSideProps", "drawDeskStation", "drawChair"].every((f) => renderSrc.includes("export function " + f)) ? ok : fail)(
      "【169】office-render 五件套齐全（房间 / 后墙 / 两侧 / 工位 / 椅子）"
    );
    (!/assets\/office\/|\.png/.test(renderSrc) ? ok : fail)(
      "【169】绘制模块零贴图依赖（程序化路线：不引任何 PNG）"
    );
    // ⛔ 等距块**不许画底面**：相机在上前方俯视，底面永远被自己的顶面遮住；而它的屏幕位置
    //    只比顶面低 (z1−z0)·k，画在最后会**盖住顶面上半** ⇒ 白桌面变成一大片灰
    //    （v10 打磨实测：把桌面渐变 alpha 从 0.019 调到 0.005 都不见效，根因是这块底面）。
    ((() => {
      const fn = (renderSrc.match(/function isoPrism\([\s\S]*?\n\}/) || [""])[0];
      const polys = (fn.match(/g\.poly\(/g) || []).length;
      const bottomQuad = /up\(a, lo\)[\s\S]{0,40}up\(b, lo\)/.test(fn);
      return polys === 4 && !bottomQuad;
    })() ? ok : fail)(
      "【169】等距块只画 4 个可见面（左右侧 + 前 + 顶），⛔ 不画底面（它会盖住顶面 ⇒ 白桌面变灰）"
    );
    ((["drawDeskStation(desk", "drawChair(chair"]).every((k) => furnSrc.includes(k)) ? ok : fail)(
      "【169】桌与椅分两个 Graphics（合成一件 ⇒ 要么人被桌挡、要么椅被人挡）"
    );
    // ⛔ 三层顺序靠**数值**判定：桌/椅各取自己的地面基线，人物取座位点 ⇒ 桌 < 人 < 椅。
    //    桌面基线取「占地中心」= v − DESK_DV/2，椅子基线取 v + CHAIR_DV（都写在 syncStatics 里）。
    ((() => {
      const desk = /deskBox\.zIndex = floorPoint\(slot\.u, slot\.v - DESK_DV \/ 2\)\.y/.test(furnSrc);
      const chair = /chairBox\.zIndex = floorPoint\(slot\.u, slot\.v \+ CHAIR_DV\)\.y/.test(furnSrc);
      const person = /view\.container\.zIndex = slot\.y;/.test(furnSrc);
      return desk && chair && person && /world\.sortableChildren = true/.test(furnSrc);
    })() ? ok : fail)(
      "【169】桌 / 人 / 椅各按自己的地面基线排 zIndex（桌最靠后、椅最靠观众）"
    );
    // ⛔ 行距 > 桌纵深 + 椅距：不够时后一排的**桌子会压住前一排的椅子、显示器会盖住前一排的人**
    //    （450px 地板深 + 0.31 行距实测过；改 FLOOR/ROW_V/DESK_DV 任一都要过这条）。
    const isoNum = (src, re) => { const m = src.match(re); return m ? Number(m[1]) : NaN; };
    ((() => {
      const deskDv = isoNum(renderSrc, /export const DESK_DV = ([\d.]+)/);
      const chairDv = isoNum(renderSrc, /export const CHAIR_DV = ([\d.]+)/);
      const rowsBlock = (isoSrc.match(/const ROW_V[\s\S]*?\n\};/) || [""])[0];
      const rows = (rowsBlock.match(/\[[\d.,\s]+\]/g) || []).map((s) =>
        s.replace(/[[\]]/g, "").split(",").map(Number).filter((n) => Number.isFinite(n)));
      const gaps = rows.map((xs) => xs.slice(1).reduce((g, x, i) => Math.min(g, x - xs[i]), Infinity));
      const minGap = Math.min(...gaps);
      return Number.isFinite(deskDv) && Number.isFinite(chairDv) && gaps.length > 0
        && minGap > deskDv + chairDv;
    })() ? ok : fail)(
      "【169】行距 > 桌纵深 + 椅距（不够时后排桌子会压住前排椅子 / 显示器会盖住前排的人）"
    );
    // 地板纵深与场景高度：工位是"深"的，地板太浅就塞不下多排（这里只钉两者同步缩放）
    ((() => {
      const floorY = (isoSrc.match(/export const FLOOR = \{[\s\S]*?\n\};/) || [""])[0].match(/-?\d+/g) || [];
      const depth = Number(floorY[1]) === Number(floorY[3]) ? Number(floorY[5]) - Number(floorY[1]) : NaN;
      const sceneH = isoNum(isoSrc, /export const SCENE_H = (\d+)/);
      return Number.isFinite(depth) && depth >= 500 && sceneH >= depth + 120;
    })() ? ok : fail)(
      "【169】地板纵深 ≥ 500 且画布高度留够（容纳 3 排工位 + 墙）"
    );
  }
}

{
if (!existsSync(join(ROOT, "src", "features", "team-office", "office-render.ts"))) {
    /* ⛔⛔ 2026-10-05：本组断言的**对象**（PixiJS 程序化绘制 / office-director 导演 /
       office-render 绘制）随 v19「像素素材 + 原生 canvas 2D」全部删除
       ⇒ 本组**长期空跑**。⛔ 静默跳过 = 假绿（让人以为办公室有几十条断言在保护）
       —— 用户 10-05 报「显示器没对准、没显示」时没有任何守卫拦下，根因就在这里。
       ✅ 先改成**显式打印**；恢复方式 = 按当前实现重写断言（样板见【154】）。 */
    console.log("  ! 【办公室】断言对象 office-render.ts 已随 v19 删除 ⇒ 本组跳过（⛔ 空跑=假绿，待按当前实现重写）");
  } else
  {
    console.log(C.bold("\n【176】办公室角色外形（物种 / 项圈 / 屏幕内容）"));
    const palPath = join(ROOT, "src", "features", "team-office", "office-palette.ts");
    const palSrc = existsSync(palPath) ? readFileSync(palPath, "utf8") : "";
    const canvas176 = readFileSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"), "utf8");
    const render176 = readFileSync(join(ROOT, "src", "features", "team-office", "office-render.ts"), "utf8");

    const animals = ((palSrc.match(/export const ANIMALS: AnimalKind\[\] = \[([\s\S]*?)\];/) || [])[1] || "");
    const list = (animals.match(/"([a-z]+)"/g) || []).map((s) => s.replace(/"/g, ""));
    (list.length >= 10 && new Set(list).size === list.length ? ok : fail)(
      "【176】物种池 ≥10 且无重复（每个成员一种动物；重复 = 两个人长得一样）"
    );
    const all = list.concat("lion");
    // 物种外形二选一：**单侧耳**（drawEarSide 的 case，可参与抽动）或**整圈对称特征**
    // （drawHeadBackdrop 的 animal === "x"，如绵羊的羊毛圈 / 刺猬的刺 —— 拆不成左右两支）。
    // ⛔ 只查单侧分支会把 sheep/hedgehog 误报成"缺耳朵"（它们的外形在 backdrop 里）。
    const missing = all.filter((a) => {
      const hasSize = new RegExp("\\b" + a + ": \\[\\d").test(canvas176);
      const hasSideEar = new RegExp('case "' + a + '":').test(canvas176);
      const hasBackdrop = new RegExp('animal === "' + a + '"').test(canvas176);
      return !hasSize || (!hasSideEar && !hasBackdrop);
    });
    (all.length >= 11 && missing.length === 0 ? ok : fail)(
      "【176】每个物种都有耳朵分支 + 头型尺寸（缺一个就退化成认不出的黑团）"
        + (missing.length ? "，缺：" + missing.join("/") : "")
    );
    (/export function animalOf\(index: number, isCeo = false\)/.test(palSrc)
      && /export function collarColor\(index: number, isCeo = false\)/.test(palSrc)
      && !/export function (animalOf|collarColor)[\s\S]{0,240}?(Math\.random|Date\.now)/.test(palSrc) ? ok : fail)(
      "【176】物种与项圈色都按序号稳定派生（⛔ 不许随机 —— 同一个人每次进来都该是同一种动物）"
    );
    (canvas176.includes("animalOf(") && canvas176.includes("collarColor(") && canvas176.includes("SILHOUETTE") ? ok : fail)(
      "【176】画布真的用上了物种 / 项圈色 / 剪影色（有常量没接线 = 恒真假绿）"
    );
    (/export function screenKindOf\(index: number, running: boolean, dozing: boolean, role = ""\)/.test(render176)
      && /if \(dozing\) return "sleep"/.test(render176)
      && /资金\|流向\|行情/.test(render176) && /return "risk"/.test(render176)
      && /screenKindOf\(slot\.idx, slot\.running, slot\.pose\?\.kind === "doze", slot\.profession\)/.test(canvas176)
      && /:\$\{s\.profession\}/.test(canvas176) ? ok : fail)(
      "【176】屏幕内容按成员稳定派生（09-30 加职业映射：资金看行情 / 风控看仪表盘）+ 打盹切熄屏 + key 含职业"
    );
    // ⛔ 跑腿目标与设施坐标必须**同源**：drawAmenities 画设施用的每个 floorPoint(u, v)
    //    都要出现在 OfficeCanvas 的 ERRAND_SPOT_UV 里 —— 两边漂移 ⇒「去接水」的人走到空气里。
    ((() => {
      const uvBlock = (canvas176.match(/const ERRAND_SPOT_UV[\s\S]*?\n\};/) || [""])[0];
      const want = [...uvBlock.matchAll(/u: ([\d.]+), v: ([\d.]+)/g)].map((m) => m[1] + "," + m[2]);
      const amenities = (render176.match(/export function drawAmenities[\s\S]*?\n\}/) || [""])[0];
      const got = [...amenities.matchAll(/floorPoint\(([\d.]+), ([\d.]+)\)/g)].map((m) => m[1] + "," + m[2]);
            /* 09-30 加了 3 个跑腿点（treadmill / vending / tea）+ 素材模式的新设施：
         ERRAND_SPOT_UV 的每个点都必须能在 drawAmenities 里找到（素材数组的 [id,u,v,k] 或程序化 floorPoint）。 */
      const amenSprites = (render176.match(/\["[a-z0-9]+", ([\d.]+), ([\d.]+), [\d]+\]/g) || [])
        .map((s) => { const m = s.match(/([\d.]+), ([\d.]+),/); return m ? m[1] + "," + m[2] : ""; });
      return want.length === 7 && want.every((p) => got.includes(p) || amenSprites.includes(p));
    })() ? ok : fail)(
      "【176】跑腿目标与办公设施坐标同源（两边漂移 ⇒「去接水」的人走到空气里）"
    );
    // ⛔ screens ticker **只挂不驱动**的假象（09-27 实测）：syncStatics 把每台显示器的
    //    动画 ticker 收进 scene.screens，animateScene 却只驱动 scene.props ⇒ 屏幕永远静止，
    //    而"代码在逐行敲"的静态首帧看起来像在动（截图验收发现不了，必须锚驱动点）。
    (/if \(screenAnim\) scene\.screens\.push\(screenAnim\);/.test(canvas176)
      && /scene\.screens\.forEach\(\(p\) => p\.update\(scene\.clock\)\);/.test(canvas176) ? ok : fail)(
      "【176】屏幕动画 ticker 被逐帧驱动（只 push 不 update = 永远静止的首帧）"
    );
    // 耳朵必须是**可动部件**：左右各一支、pivot 在耳根，坐姿/走姿的动画循环里都要碰它
    // （物种识别全靠耳朵，耳朵焊死 = 退回"一坨黑"）。
    // ⛔ 09-30 素材路线：部件类型变成可空（生图精灵没有独立耳朵），所以断言改成**判空后的驱动**
    //    —— 既保住"接入两个动画循环"，又钉死"素材模式下不许崩"。
    ((canvas176.match(/ears: Graphics\[\] \| null;/g) || []).length >= 2
      && /if \(p\.ears\) p\.ears\.forEach\(\(ear, i\) =>/.test(canvas176)
      && /if \(w\.ears\) w\.ears\.forEach\(\(ear, i\) =>/.test(canvas176) ? ok : fail)(
      "【176】耳朵接入坐姿 + 走姿两个动画循环（且素材模式下判空驱动，不崩）"
    );
    // ⛔ 键盘**不许居中**：人坐在工位正中，居中键盘会被躯干整个挡住（09-27 放大实测只剩两条白边），
    //    必须偏向人的左手侧 —— 锚定「u 减偏移」的写法，改回居中即红。
    //    （09-30：桌深从 0.235 收到 0.17，键盘跟着往左前挪到 0.056/0.052 —— 只放宽数值区间，
    //      「必须减 offset」这条不变；居中写法 `floorPoint(u, v ...)` 仍然判红。）
    (/floorPoint\(u - 0\.0[3-9]\d*, v - 0\.0[3-9]\d*\)/.test(render176) ? ok : fail)(
      "【176】键盘偏向人的左手侧（居中 = 被躯干挡住，放大才看得见的假 blanks）"
    );
    // ⛔ 走动小人的头部 wrap 偏移**必须补偿 HEAD_CY**：buildAnimalHead 把头画在 wrap 内部
    //    (0, HEAD_CY) 处，walker 的 headwrap 若还写死 (0,-76)（buildHead 时代的旧补偿），
    //    头就被双重抬高 36+ 单位 —— 脖子上出现"白色空洞"，背后的墙 / 饮水机从洞里透出来
    //    （09-27 用户截图点名"人物出来都是穿模的"）。
    (/headwrap\.position\.set\(0, -76 - HEAD_CY\)/.test(canvas176) ? ok : fail)(
      "【176】走动小人头部 wrap 偏移补偿 HEAD_CY（写死旧偏移 = 头双重抬高、脖子断成两截）"
    );
    // 圆头下缘往中间收，头两侧与项圈上缘之间必然露楔形白缝 —— 必须有**脖子填充**兜底
    // （09-27 用户截图点名"脖子中间空了那么多"；小 ry 物种中心也空 3~7 单位）。
    (/const NECK_FILL = \{/.test(canvas176) && /neck\.roundRect\(NECK_FILL\.x/.test(canvas176) ? ok : fail)(
      "【176】坐姿有脖子填充（头底扎进项圈 + 黑块兜住楔形白缝，缺一个就露缝）"
    );
  }
}

{
{
    console.log(C.bold("\n【177】手机控制 phone-harness（平台边界 / 遥测默认关）"));
    const phPath = join(ROOT, "electron", "features", "phone-harness.ts");
    const phSrc = existsSync(phPath) ? readFileSync(phPath, "utf8") : "";
    const phUi = existsSync(join(ROOT, "src", "features", "settings-devtools", "PhoneHarnessCard.tsx"))
      ? readFileSync(join(ROOT, "src", "features", "settings-devtools", "PhoneHarnessCard.tsx"), "utf8") : "";

    (existsSync(phPath) && /iphoneEligible: process\.platform === "darwin"/.test(phSrc) ? ok : fail)(
      "【177】iPhone 通道严格绑定 darwin（Windows/Linux 上不存在的通道不许宣传）"
    );
    (phUi.includes("iphoneEligible") && /status\?\.platform === "darwin"/.test(phUi) ? ok : fail)(
      "【177】卡片按平台显示不同能力清单（非 Mac 要明说 iPhone 通道不支持）"
    );
    ((() => {
      // ⛔ 顺序也是判据：必须先关遥测、再注册技能（技能一生效就会被调用）。
      const off = phSrc.indexOf('harness(["config", "set", "telemetry", "false"]');
      const skill = phSrc.indexOf('harness(["skill"]');
      return off > 0 && skill > off;
    })() ? ok : fail)(
      "【177】装机后先关上游遥测再注册技能（上游默认开且会上报任务文本与调用参数）"
    );
    // ⛔ 10-02：单源口径已废 —— 清华源的索引页 200 但 wheel 直链 403，单源必挂
    //    （用户实测：文档转换 / 手机控制 / Laya 三处同时报同一个 403）。现在走共享源表逐源重试；
    //    环境变量仍可覆盖**首选源**（自测/代理场景）。
    (phSrc.includes("PHONE_PIP_SOURCES") && phSrc.includes("PIP_INDEXES") && phSrc.includes("pip-sources") ? ok : fail)(
      "【177】pip 安装走**多源兜底**（共享源表 pip-sources.ts；单源必被镜像抖动打死 —— 10-02 三处报障的根因）"
    );
    // ⛔ 必须带 `-U`：不带升级参数时 pip 对已装的包只回 "Requirement already satisfied" 就结束，
    //    用户点「检查更新」什么也没发生（上游 alpha 周更，拿不到修复 = 假动作）。
    (/pip", "install", "-U"/.test(phSrc) ? ok : fail)(
      "【177】装机/更新走 pip install -U（不带 -U 时已装包不会被升级，点更新 = 静默空转）"
    );
    // adb（Android 通道必需）：① 两平台安装表都要有它（预检【34】同源要求对称）；
    // ② 装进 tools/platform-tools；③ CLI 侧要能拿到路径（写 android.adb，⛔ 不动系统 PATH）。
    const rtSrc = existsSync(join(ROOT, "scripts", "install-runtimes.cjs"))
      ? readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8") : "";
    ((rtSrc.match(/want\("platform-tools"\)/g) ?? []).length >= 2
      && /path\.join\(TOOLS, "platform-tools"\)/.test(rtSrc)
      && /PLATFORM_TOOLS_URL/.test(rtSrc) ? ok : fail)(
      "【177】adb 在 Windows 与 macOS 两条安装路径上对称存在且落 tools/platform-tools（预检【34】比对两平台安装表）"
    );
    (/harness\(\["config", "set", "android\.adb"/.test(phSrc) ? ok : fail)(
      "【177】adb 路径写进 phone-harness 的 android.adb（⛔ 不改系统 PATH，与项目一贯做法一致）"
    );
    (phUi.includes('installDevRuntime') && phUi.includes('"platform-tools"') ? ok : fail)(
      "【177】卡片里有 adb 下载安装入口（复用开发工具页的运行时安装链路：进度与下载源都一致）"
    );
  }
}

{
{
    console.log(C.bold("\n【170】DESIGN.md 视觉规范（存在 / 章节 / 变量真值对账）"));
    const md170 = existsSync(join(ROOT, "DESIGN.md")) ? readFileSync(join(ROOT, "DESIGN.md"), "utf8") : "";
    const css170 = readFileSync(join(ROOT, "src", "styles", "01-base-and-chrome.css"), "utf8");

    (md170.length > 1200 ? ok : fail)(
      "【170】根目录存在 DESIGN.md（与 AGENTS.md 并列：一个管怎么建、一个管长什么样）"
    );

    (["## Overview", "## Colors", "## Typography", "## Components", "## Theming"].every((h) => md170.includes(h)) ? ok : fail)(
      "【170】DESIGN.md 章节齐备（总览 / 颜色 / 字体 / 组件 / 主题）"
    );

    // ⛔ 核心：变量表的亮/暗两栏必须与 CSS 里的**真值一致**
    const lightBlock = css170.slice(css170.indexOf(":root {"), css170.indexOf(':root[data-theme="dark"]'));
    const darkBlock = css170.slice(css170.indexOf(':root[data-theme="dark"] {'));
    const cssVal = (blk, name) => {
      const m = blk.match(new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{3,8})"));
      return m ? m[1].toLowerCase() : null;
    };
    const drift = [];
    for (const name of ["bg", "panel", "panel-2", "line", "text", "muted", "accent"]) {
      const row = md170.split("\n").find((l) => l.startsWith("| `--" + name + "`"));
      if (!row) { drift.push(name + "(文档缺行)"); continue; }
      const cells = row.split("|").map((c) => c.trim().replace(/`/g, ""));
      const mdLight = (cells[2] || "").toLowerCase();
      const mdDark = (cells[3] || "").toLowerCase();
      const cLight = (cssVal(lightBlock, name) || "").toLowerCase();
      const cDark = (cssVal(darkBlock, name) || "").toLowerCase();
      if (!mdLight || mdLight !== cLight) drift.push(name + " 亮 " + mdLight + "≠" + cLight);
      if (!mdDark || mdDark !== cDark) drift.push(name + " 暗 " + mdDark + "≠" + cDark);
    }
    (drift.length === 0 ? ok : fail)(
      "【170】DESIGN.md 变量表与 CSS 真值一致（改了变量必须同步文档，否则文档会骗人）"
        + (drift.length ? "，漂移：" + drift.slice(0, 4).join("；") : "")
    );

    // 引导链：引擎只会自动读 AGENTS.md ⇒ DESIGN.md 必须在那里登记，
    // 否则改 UI 的 agent 根本不知道有这份规范（写得再好也没人读）。
    const agents170 = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    (agents170.includes("DESIGN.md") && agents170.includes("改 UI 前先读") ? ok : fail)(
      "【170】AGENTS.md 已登记 DESIGN.md（引擎只保证读 AGENTS.md，引导链断了规范就没人看）"
    );
  }
}

{
{
    console.log(C.bold("\n【171】项目级 AGENTS.md 自动创建 + DESIGN.md 引导链"));
    const pcSrc = readFileSync(join(ROOT, "electron", "project-conventions.ts"), "utf8");

    // ① 模板与追加段都必须引导读 DESIGN.md —— 这是 DESIGN.md 在用户项目里生效的唯一通道
    //    ⛔ 锚「模板正文本体」（两处模板里各出现一次的短语），不能数全文 DESIGN.md —— 头注释里就有 3 处，数全文恒真
    const guideHits = (pcSrc.match(/先完整读它/g) || []).length;
    const sectionHits = (pcSrc.match(/## 视觉规范/g) || []).length;
    (guideHits >= 2 && sectionHits >= 2 ? ok : fail)(
      "【171】模板与追加段都引导读 DESIGN.md（DESIGN.md 生效的唯一通道，不能断）"
        + `（模板正文命中：先完整读它×${guideHits}/视觉规范标题×${sectionHits}）`
    );
    // ② 追加幂等：带标记判重，thread/start 反复触发也不重复追加
    (pcSrc.includes("HARNESS_APPEND_MARK") && /includes\(HARNESS_APPEND_MARK\)/.test(pcSrc) ? ok : fail)(
      "【171】追加幂等（带标记判重，thread/start 反复触发不重复追加）"
    );
    // ③ 静默降级：启动链旁路，任何失败（只读盘/权限）都不许影响会话启动
    (pcSrc.includes("export function ensureProjectAgentsMd") && /catch \{/.test(pcSrc) ? ok : fail)(
      "【171】全函数 try/catch 静默降级（启动链旁路，失败不许影响会话启动）"
    );
    // ④ 接线完整性（结构性）：每一个 server.request("thread/start") 的文件都必须已接线 ——
    //    将来新增调用点漏接，这里打红（这就是用户看到的「没自动创建」）。
    const engineTs = [];
    (function walk171(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const fp = join(dir, e.name);
        if (e.isDirectory()) walk171(fp);
        else if (/\.ts$/.test(e.name)) engineTs.push(fp);
      }
    })(join(ROOT, "electron"));
    const unwired = engineTs.filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.includes('server.request("thread/start"') && !src.includes("ensureProjectAgentsMd");
    });
    (unwired.length === 0 ? ok : fail)(
      "【171】全部 thread/start 调用点都已接线 ensureProjectAgentsMd"
        + (unwired.length ? "，未接线：" + unwired.slice(0, 3).map((f) => f.replace(ROOT, "")).join("；") : "")
    );
    // ⑤ 主路径必须在**转发前**调用（响应侧建会让本会话错过）
    const bridge171 = readFileSync(join(ROOT, "electron", "features", "codex-ipc.ts"), "utf8");
    ((() => {
      const call = bridge171.indexOf("ensureProjectAgentsMd(startCwd)");
      const req = bridge171.indexOf("server.request(method, params)");
      return call >= 0 && req >= 0 && call < req;
    })() ? ok : fail)(
      "【171】主路径（codex:request）在转发前调用（引擎处理 thread/start 时就读 AGENTS.md）"
    );
  }
}

{
{
    console.log(C.bold("\n【172】AGENTS.md 注入上限（默认 32KB 会静默截断）"));
    const csSrc = readFileSync(join(ROOT, "electron", "codex-server.ts"), "utf8");
    // ① 启动参数显式设置上限（接线锚：spawn 的 argv 数组里带 -c project_doc_max_bytes=…）
    const m = csSrc.match(/-c",\s*"project_doc_max_bytes=(\d+)"/);
    (m ? ok : fail)(
      "【172】启动参数显式抬高 project_doc_max_bytes（引擎默认 32768 会静默截断 AGENTS.md）"
        + (m ? `（当前 ${m[1]}）` : "，未找到 -c project_doc_max_bytes=… ⇒ 用的是默认 32768")
    );
    // ② 值必须留有余量：> 当前 AGENTS.md 实际字节数（引擎会向上拼接多级，故要求 ≥2×）
    if (m) {
      const limit = Number(m[1]);
      let agentsBytes = 0;
      try { agentsBytes = statSync(join(ROOT, "AGENTS.md")).size; } catch { agentsBytes = 0; }
      (limit > agentsBytes ? ok : fail)(
        `【172】上限(${limit}) 必须大于 AGENTS.md 实际大小(${agentsBytes} 字节，否则等于没修)`
      );
      (limit >= agentsBytes * 2 ? ok : fail)(
        `【172】上限留 2× 余量（引擎向上遍历会拼接多级 AGENTS.md，卡的是总量；余量=${(agentsBytes ? (limit / agentsBytes).toFixed(2) : "?")}×）`
      );
    }
  }
}

{
{
    const diagSrc = readFileSync(join(ROOT, "electron", "features", "app-diagnostics.ts"), "utf8");
    const winSrc = readFileSync(join(ROOT, "electron", "features", "window-factory.ts"), "utf8");
    // ① relaunch 前必须摘掉 dev URL（新实例才不会去连已死的 vite）
    (/delete process\.env\.VITE_DEV_SERVER_URL/.test(diagSrc) ? ok : fail)(
      "【174】app:relaunch 在 dev 下摘掉 VITE_DEV_SERVER_URL（否则新实例连已死的 vite ⇒ 白屏）"
    );
    // ② relaunch 必须优雅退（app.quit 而非 app.exit）——保证 before-quit 清理与图标不被打断
    // ⛔ 10-03：双形态锚点（域改插件形态后写 ipcHost.handle）
    // ⛔ 10-14：窗口 2000 → 4000。handler 里新增了「为什么不用 app.relaunch」的实证注释，
    //    长度超过 2000 ⇒ quit() / spawn / unref 被切出窗口，**四条断言一起假红**
    //    （实测：注释一变长就红，与代码对错无关）。窗口必须留得住 handler 全文 + 合理注释余量；
    //    下一个 handler 若有则优先切到那里（真正的边界），故放大不会串到隔壁域。
    const relaunchBlock = sliceHandle(diagSrc, "app:relaunch", 4000);
    // ⛔ 10-03：域接缝化后写的是 `host.app.relaunch()` / `host.app.quit()`。
    //    判据必须**认接缝形态** —— 只写 /app\.relaunch\(\)/ 的话，此刻仍能过是因为它恰好是
    //    `host.app.relaunch()` 的子串（**碰巧匹配**，不是设计）。将来若改成别的接缝名
    //    （如 `caps.app`）就会静默假红/假绿。判据要显式列出两种形态。
    // ⛔ 10-14：重启改为**显式分离 spawn**（见下方⑤），`.relaunch()` 不再是必须品；
    //    这里只钉"优雅退"，spawn 的判据在⑤。
    const relaunchGraceful = /(?:\bhost\.app|app)\.quit\(\)/.test(relaunchBlock)
      && !/(?:\bhost\.app|app)\.exit\(0\)/.test(relaunchBlock);
    (relaunchGraceful ? ok : fail)(
      "【174】app:relaunch 用 app.quit() 优雅退出（app.exit 会跳过 before-quit 清理并打断任务栏图标）"
    );
    // ③ 窗口加载失败要能回落本地 dist（宁可看构建版也不能白屏）
    (/loadURL\(devUrl\)\.catch\(/.test(winSrc) && /loadFile\(distIndex\)/.test(winSrc) ? ok : fail)(
      "【174】dev URL 加载失败回落本地 dist（白屏第二道保险）"
    );
    // ④ 图标路径必须多源兜底（只认 app.getAppPath() 一条会在 relaunch 后丢图标）
    // ⛔ 10-12 云助手抽出真相源 electron/app-icon.ts（findBuildAsset / resolveWindowIcon），
    //    主窗 / 助手窗 / 托盘三处共用；桌面版仍内联在 window-factory.ts。
    //    判据**认两种形态**（抽出前 / 抽出后），否则同步守卫时必有一仓假红。
    const iconPath = join(ROOT, "electron", "app-icon.ts");
    if (existsSync(iconPath)) {
      const iconSrc = readFileSync(iconPath, "utf8");
      (/findBuildAsset/.test(iconSrc) && /process\.execPath/.test(iconSrc) && /candidates\.find\(/.test(iconSrc) ? ok : fail)(
        "【174】图标多源兜底在 app-icon.ts 唯一真相源（appPath / __dirname 上溯 / execPath 上溯 / cwd）"
      );
      (/resolveWindowIcon\(\)/.test(winSrc) ? ok : fail)(
        "【174】主窗经 resolveWindowIcon() 取图标（不许各自拼路径）"
      );
    } else {
      (/iconCandidates/.test(winSrc) && /process\.execPath/.test(winSrc) && /iconCandidates\.find\(/.test(winSrc) ? ok : fail)(
        "【174】窗口图标多源兜底（appPath / execPath 上溯 / cwd，取首个存在的）"
      );
    }
    /* ⑤ 重启的两条合法形态（10-14 用户实测「保存重启，怎么就关掉了应用，没有自动重启呢」）：
         启动形态决定用哪条路 —— **两条都要认，按形态判**：
           · `electron .`（桌面版，package.json main + 可见窗口）：`host.app.relaunch()` 即可。
           · `electron dist-electron/headless.js`（云助手无头 + 自起静态服务）：同一行
             `app.relaunch()` **spawn 不出新进程**（对照实验：relaunch() 返回 200 不抛错，
             进程表 1 秒内从 3 归零，20 秒无新进程、8917 一直 ECONNREFUSED）⇒ 只关不开。
             必须改用 `spawn(execPath, argv.slice(1), {detached:true}).unref()`（实测 t+2s 起恢复）。
         ⛔ 判据：出现 spawn 形态 ⇒ 必须 detached+unref 且前缀 releaseSingleInstanceLock；
                  否则必须出现 `host.app.relaunch()`（朴素形态也要有优雅退，②已钉）。 */
    {
      const isSpawnForm = /spawn\(\s*process\.execPath\s*,\s*process\.argv\.slice\(1\)/.test(relaunchBlock);
      if (isSpawnForm) {
        const detached = /detached:\s*true/.test(relaunchBlock) && /\.unref\(\)/.test(relaunchBlock);
        const releaseFirst = (() => {
          const r = relaunchBlock.indexOf("releaseSingleInstanceLock");
          const s = relaunchBlock.indexOf("spawn(");
          return r >= 0 && s > r;
        })();
        ok("【174】app:relaunch 用 spawn(execPath, argv.slice(1)) 显式重启（无头形态：app.relaunch 起不来）");
        (detached ? ok : fail)("【174】重启子进程必须 detached:true + unref()（否则旧进程退出会带走它）");
        (releaseFirst ? ok : fail)("【174】app:relaunch 先释放单实例锁再起新实例（否则新实例抢不到锁会自杀）");
      } else {
        (/(?:\bhost\.app|app)\.relaunch\(/.test(relaunchBlock) ? ok : fail)(
          "【174】app:relaunch 走朴素 host.app.relaunch()（窗口形态；无头形态须改 spawn —— 见⑤注释）"
        );
      }
    }
  }
}

{
{
    console.log(C.bold("\n【173】共享技能池（按项目生效）"));
    const poolSrc = readFileSync(join(ROOT, "electron", "skill-pool.ts"), "utf8");

    // ① 三件套齐全（sync 投影 / describe UI 数据 / set 动作）
    ((["syncSkillPool", "describeSkillPool", "setSkillPoolState"].every((fn) => poolSrc.includes("export function " + fn))) ? ok : fail)(
      "【173】skill-pool.ts 三件套齐全（sync 投影 / describe / set）"
    );
    // ①b 项目独立性（09-27 用户拍板「A 项目启用禁用跟 B 项目没有毛关系」）：describe 的
    //    active 必须按 cwd 自己的配置算（!globalDisabled && !projectDisabled），
    //    ⛔ 禁止读磁盘改名态（磁盘是「最近一次 sync 项目」的投影，读它会把 A 的状态泄漏进 B 的
    //    视图，且在 B 点开还会反向写坏 B 的配置——双向污染，实测复现过）。
    (/active:\s*!globalDisabled\s*&&\s*!projectDisabled/.test(poolSrc) && !/active:\s*enabled\b/.test(poolSrc) ? ok : fail)(
      "【173】describe 的 active 按项目配置算（禁读磁盘投影态，保证项目间独立）"
    );
    // ② 接线：ensureProjectAgentsMd 里必须调用 syncSkillPool（thread/start 前生效的唯一通道）
    const pcPool = readFileSync(join(ROOT, "electron", "project-conventions.ts"), "utf8");
    (pcPool.includes("syncSkillPool(dir)") ? ok : fail)(
      "【173】syncSkillPool 挂在 ensureProjectAgentsMd（thread/start 前投影，12 处调用点继承）"
    );
    // ③ 迁移保底：磁盘停用态而配置无记录 ⇒ 记入全局停用集（防误恢复）
    (poolSrc.includes("记入全局停用集") && poolSrc.includes("writeGlobalDisabled(codexHome, global)") ? ok : fail)(
      "【173】迁移保底：遗留 .disabled 先记入全局停用集（防已停用技能被误恢复）"
    );
    // ④ IPC 三件套：handler 注册 + manifest 通道 + registry 域表
    const handlerPool = readFileSync(join(ROOT, "electron", "features", "skills-ipc.ts"), "utf8");
    const manifestPool = readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8");
    const registryPool = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
    (/(?:ipcMain|ipcHost)\.handle\("skills:pool-describe"/.test(handlerPool) && /(?:ipcMain|ipcHost)\.handle\("skills:pool-set"/.test(handlerPool) ? ok : fail)(
      "【173】skills:pool-describe / skills:pool-set handler 已注册"
    );
    (manifestPool.includes("skills:pool-describe") && manifestPool.includes("skills:pool-set") ? ok : fail)(
      "【173】manifest 已登记 skills:pool-* 两通道"
    );
    (registryPool.includes('"skills:pool-describe", "skills:pool-set"') ? ok : fail)(
      "【173】ipc-registry 的 skills 域已登记 pool 通道"
    );
    // ⑤ UI：技能中心挂池管理区块
    const uiPool = readFileSync(join(ROOT, "src", "features", "settings-skills", "SkillPoolSection.tsx"), "utf8");
    const centerPool = readFileSync(join(ROOT, "src", "features", "settings-skills", "SkillsCenterSection.tsx"), "utf8");
    (uiPool.includes("describeSkillPool") && uiPool.includes("setSkillPoolState") ? ok : fail)(
      "【173】SkillPoolSection 自取池数据与动作（不经 bag，避开【92】顺序契约）"
    );
    (/<SkillPoolSection\s+projects=\{props\.projects\}[^>]*\/>/.test(centerPool) ? ok : fail)(
      "【173】技能中心「我的技能」视图已挂共享技能池区块（穿 projects 供项目切换器；⛔ 判据锚 props 接线，别锚整串字面量——10-06 加 onNotice 回执时旧字面量断言假红）"
    );
  }
}

{
{
    console.log(C.bold("\n【155】团队调度的团队标识恢复"));
    const teamSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part07", "02-seg", "02-team-sessions-skills.tsx"), "utf8");
    (teamSrc.includes("window.codex.teamOfThread?.(leadThreadId)") ? ok : fail)("【155】runTeamMember 有主进程持久映射兜底（teamOfThread）");
    (/bag\.teamThreadMapRef\.current\.set\(leadThreadId, teamId\)/.test(teamSrc) ? ok : fail)("【155】兜底拿到的 teamId 回填 ref（避免重复查询）");
    (/if \(!teamId\) \{[\s\S]{0,320}?无法确定该会话所属的专家团/.test(teamSrc) ? ok : fail)("【155】拿不到团队标识 ⇒ 明确报错（⛔ 不得把空 teamId 发下去）");
    const rolesSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part02", "01-mcp-teams-plan", "02-team-roles-import.tsx"), "utf8");
    (/teamOfThread[\s\S]{0,400}?teamThreadMapRef\.current\.set\(id, String\(teamId\)\)/.test(rolesSrc) ? ok : fail)("【155】打开会话时把团队映射回填 ref（重启后调度/UI 都能恢复）");
    /* 启动时从主进程灌满映射（否则重启后未打开过的会话：调度拿不到 teamId、
       工具卡的成员头像注册表也为空 —— 同一事故的第二个受害面） */
    (/teamThreadsMap\?\.\(\)[\s\S]{0,500}?teamThreadMapRef\.current\.set\(threadId/.test(rolesSrc) ? ok : fail)("【155】启动时从主进程全量灌 ref（工具卡成员解析 + 调度共用）");
    (teamSrc.includes("bag.thread?.id === leadThreadId ? bag.thread?.cwd") ? ok : fail)("【155】cwd 兜底用「本会话 cwd」且限定同会话（后台调度不串配置）");
  }
}

{
{
    console.log(C.bold("\n【157】上下文用量口径：按会话归属 + 只用本轮 last"));
    const statusSrc157 = readFileSync(join(ROOT, "src", "features", "status", "Status.tsx"), "utf8");
    (!/usageBucket\(tokenUsage, "last"\) \?\? usageBucket\(tokenUsage, "total"\)/.test(statusSrc157) ? ok : fail)(
      "【157】⛔ 上下文环不得拿会话累计 total 当分子（长会话必然超窗口 ⇒ 环顶到 100%）"
    );
    (statusSrc157.includes('const currentUsage = usageBucket(tokenUsage, "last");') ? ok : fail)(
      "【157】环的分子只用本轮 last（= 当前上下文规模）"
    );
    (statusSrc157.includes("const currentUsage = lastUsage;") && statusSrc157.includes("const breakdownUsage = lastUsage ?? totalUsage;") ? ok : fail)(
      "【157】容量弹层：百分比只认 last，明细网格仍可 total 兜底"
    );
    const part05Src157 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "01-seg.tsx"), "utf8");
    const part01Src157 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part01", "04-optimistic-turn-approval-e2e.tsx"), "utf8");
    (/persistTokenUsageSnapshot[\s\S]{0,600}?map\.set\(threadId/.test(part01Src157) ? ok : fail)(
      "【157】用量按会话归属存储（后台会话/被委派子会话不污染当前的环）"
    );
    (/usageThreadId === String\(bag\.threadRef\.current\?\.id/.test(part05Src157) ? ok : fail)(
      "【157】只有当前会话的用量才进环"
    );
    (/useEffect\(\(\) => \{[\s\S]{0,240}?tokenUsageByThreadRef\.current\.get\(activeId\)/.test(part05Src157) ? ok : fail)(
      "【157】切会话时换成该会话自己的快照（否则环里粘着上一个会话的数字）"
    );
    /* 落盘 + 接力继承（09-25 用户补充：「一切换供应商，显示从初始值开始统计，原来的不消耗识别出来，
       聊一会就爆了」）—— 切供应商会**重启应用**，内存快照全丢 ⇒ 必须落盘才谈得上"真实进度"。 */
    (/localStorage\.setItem\(TOKEN_SNAPSHOT_KEY/.test(part01Src157) && /JSON\.parse\(localStorage\.getItem\(TOKEN_SNAPSHOT_KEY\)/.test(part01Src157) ? ok : fail)(
      "【157】用量快照落盘 + 启动读回（⛔ 不落盘 ⇒ 切供应商重启后进度归零）"
    );
    (/TOKEN_SNAPSHOT_MAX/.test(part01Src157) && /slice\(-TOKEN_SNAPSHOT_MAX\)/.test(part01Src157) ? ok : fail)(
      "【157】快照按上限截断（防撑爆 localStorage）"
    );
    /* ⛔ 必须**真 LRU**（09-25 代码审查）：Map 的 set 不会把已存在的键挪到末尾 ⇒ 只写 slice(-N)
       实际是 FIFO，长期活跃的老会话会被新会话挤掉、重启后进度照样归零。 */
    (/map\.delete\(threadId\);[\s\S]{0,600}?map\.set\(threadId, usage\)/.test(part01Src157) ? ok : fail)(
      "【157】快照截断是**真 LRU**（先 delete 再 set 挪到末尾；否则长期活跃会话会被挤掉、进度照样归零）"
    );
    (/const TOKEN_SNAPSHOT_KEY/.test(part01Src157.split("export function")[0]) ? ok : fail)(
      "【157】存储键在**模块级**（放 hook 体里会被【93】当 Bag 名字）"
    );
    (/persistTokenUsageSnapshot\(usageThreadId, normalizedUsage\)/.test(part05Src157) ? ok : fail)(
      "【157】每次用量事件都落盘"
    );
    const settingsSrc157 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part06", "02-seg", "02-model-thread-settings.tsx"), "utf8");
    (/inheritTokenUsageSnapshot\(threadId, next\.id\)/.test(settingsSrc157) ? ok : fail)(
      "【157】接力（fork）时把用量快照继承给新会话（⛔ 否则新会话环从 0 开始）"
    );
  }
}

{
{
  const part08Src = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part08", "01-seg.tsx"), "utf8").replace(/\r/g, "");
  // ① archiveThread 整体 try/catch：引擎 thread/archive 报错不许再落进 unhandled rejection（void 调用 = 无声消失）
  (/async function archiveThread\(id: string\) \{\n    \/\/ ⛔ 09-26[\s\S]*?try \{[\s\S]*?await window\.codex\.request\("thread\/archive", \{ threadId: id \}\);/.test(part08Src) ? ok : fail)(
    "【162】归档链路整体 try/catch（void 调用的报错不许静默消失——「点归档没反应」本身）"
  );
  // ② 失败必须弹可见 toast（带引擎原话），行保持原位（本地清理在引擎成功之后才执行）。
  (/bag\.showToast\("归档失败", msg\.slice\(0, 160\)\)/.test(part08Src) ? ok : fail)(
    "【162】归档失败弹可见 toast（引擎原话截 160 字；用户不再面对无声失败）"
  );
  // ③ unarchive 同病同修：历史归档区点恢复也不许静默。
  (/async function unarchiveThread\(id: string\) \{[\s\S]*?try \{[\s\S]*?await window\.codex\.request\("thread\/unarchive", \{ threadId: id \}\);[\s\S]*?bag\.showToast\("取消归档失败"/.test(part08Src) ? ok : fail)(
    "【162】取消归档同修（历史归档区恢复失败也要可见）"
  );
  // ④ 反向绊线：本地清理（setThreads 过滤行）必须仍在引擎请求**之后**——失败时不许误删本地行。
  (/await window\.codex\.request\("thread\/archive", \{ threadId: id \}\);\n      bag\.setThreads\(\(current\) => current\.filter/.test(part08Src) ? ok : fail)(
    "【162】本地行的移除必须在引擎归档成功之后（失败时行保持原位）"
  );
  // ⑤ 幽灵会话分流（09-26「点归档没反应」真根因）：no rollout found / not found 类错误 = 引擎已
  //    不认这条线程（rollout 双份残留、兜底扫描捞回的幽灵行）；按「失败」提示只会让用户反复点，
  //    按幽灵处理（本地移除 + 「已从列表清理」提示）才达成用户意图 = 让它从侧栏消失。
  (/no rollout found/i.test(part08Src) && /\.test\(msg\)/.test(part08Src) ? ok : fail)(
    "【162】幽灵会话（引擎已不认）按本地清理分流，不按失败提示"
  );
  // ⑥ 反向绊线：幽灵分流必须真的移除本地行（只提示不清理 = 幽灵行还在，没解决任何事）。
  (/bag\.setThreads\(\(current\) => current\.filter\(\(entry\) => entry\.id !== id\)\);[\s\S]{0,160}bag\.showToast\("已从列表清理"/.test(part08Src) ? ok : fail)(
    "【162】幽灵分流必须带本地行移除（setThreads filter + 「已从列表清理」提示成对）"
  );
}
}

{
{
  const undo178 = readAppUi();
  // ⛔ 用**调用形态**锚（`request("thread/rollback"`）——注释里会写旧方法名解释原因，
  //   用「全文禁词」会被自己的注释误伤（09-27 在【46】上真踩过）。
  (!/request\("thread\/rollback"/.test(undo178) ? ok : fail)(
    "【178】不许再调 thread/rollback（引擎 0.157 已移除该 RPC ⇒ 直接 method not found）"
  );
  // 撤销分支先整块锚定再查内容（⛔ 别用固定字符窗口串两句：插几行就假红）
  const undoBlock178 = /name === "undo"\)([\s\S]*?)\} else if/.exec(undo178)?.[1] ?? "";
  (/request\("thread\/revert", \{ threadId[^}]*beforeTurnId/.test(undoBlock178) ? ok : fail)(
    "【178】撤销走 thread/revert 且传 beforeTurnId（替代 numTurns：beforeTurnId 之前的前缀才是保留部分）"
  );
  (/request\("thread\/turns\/list"/.test(undoBlock178) ? ok : fail)(
    "【178】revert 后必须 thread/turns/list 重载回合（返回的 thread.turns 恒为空，直接塞回会清空界面）"
  );
}
}

{
{
  const upSrc = readFileSync(join(ROOT, "src", "components", "UsagePanel.tsx"), "utf8");
  (/request\("account\/usage\/read"/.test(upSrc) ? ok : fail)(
    "【179】使用统计页接入引擎账号用量（account/usage/read）"
  );
  // ⛔ 必须静默降级：未登录 / 用第三方 provider（引擎侧没有账号态）/ 网络失败 ⇒ **整块不渲染**。
  //   本机实测 auth.json 是 4 字节的 `null` ⇒ 用户当前走的就是这条降级路（SSR 已实证不留空区块）。
  (/\.catch\(\(\) => undefined\)/.test(upSrc) && /if \(!summary\) return null/.test(upSrc) ? ok : fail)(
    "【179】拿不到账号数据时静默降级（catch 兜住 + !summary 直接 return null，不留空占位）"
  );
  // ⛔ 两套来源不许混算：本机累计（本地 stats）与服务端账号 summary 必须分开展示。
  //   锚 `stats` 的**数据引用形态**（stats. / stats, / stats)）—— 裸词会被自己的 CSS 类名
  //   `usage-stats-row` 误伤（09-27 实测踩到；同型教训：断言别锚裸词，要锚代码形态）。
  const accountFn = /function AccountUsageBlock\(\)[^]*?\n}/.exec(upSrc)?.[0] ?? "";
  (accountFn.length > 0 && !/stats\s*[.,)]/.test(accountFn) ? ok : fail)(
    "【179】账号区块不引用本机 stats（本机累计与服务端记账是两套来源，不许混算）"
  );
}
}
}
