/** 06-app-behavior 第 5/5 段：原 06-app-behavior.mjs L3234–L3878（逐字搬运 + 各自成块）。
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
{
    const fmtSrc = readFileSync(join(ROOT, "src", "features", "pet", "pet-format.ts"), "utf8");
    const ipcSrc = readFileSync(join(ROOT, "electron", "features", "pet-ipc.ts"), "utf8");
    const winSrc = readFileSync(join(ROOT, "electron", "features", "pet-window.ts"), "utf8");
    const stateSrc = readFileSync(join(ROOT, "electron", "features", "pet-state.ts"), "utf8");
    const genSrc = readFileSync(join(ROOT, "scripts", "gen-pet-spritesheets.mjs"), "utf8");
    const bootSrc = readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8");
    const mainEntrySrc = readFileSync(join(ROOT, "src", "main.tsx"), "utf8");
    const htmlSrc = readFileSync(join(ROOT, "index.html"), "utf8");
    const harnessSrc = readFileSync(join(ROOT, "scripts", "e2e", "lib", "harness.mjs"), "utf8");

    /** 官方九态行名（顺序即行序）—— 引擎二进制与 petdex 文档逐字一致的规范。 */
    const OFFICIAL_STATES = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"];
    const arrayLiteral = (src, name) => {
      const m = src.match(new RegExp(name + "[\\s\\S]{0,40}?=\\s*\\[([\\s\\S]*?)\\]"));
      return m ? (m[1].match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, "")) : [];
    };

    /* ① 九态行名与顺序：渲染层 / 主进程 / 生成器 **三处同源**，且都等于官方规范。
       ⛔ 行序就是行号，错一位 = 所有动作错乱（官方按行号取图）。 */
    const renderRows = arrayLiteral(fmtSrc, "PET_STATES");
    const mainRows = arrayLiteral(ipcSrc, "PET_STATE_ROWS");
    const genRows = arrayLiteral(genSrc, "STATE_ROWS");
    (JSON.stringify(renderRows) === JSON.stringify(OFFICIAL_STATES) ? ok : fail)(
      `【232】渲染层九态行名与顺序 = 官方规范（实得 ${renderRows.join("/")}）`
    );
    (JSON.stringify(mainRows) === JSON.stringify(OFFICIAL_STATES) ? ok : fail)(
      `【232】主进程九态行名与顺序 = 官方规范（与渲染层同源；实得 ${mainRows.join("/")}）`
    );
    (JSON.stringify(genRows) === JSON.stringify(OFFICIAL_STATES) ? ok : fail)(
      `【232】生成器九态行名与顺序 = 官方规范（实得 ${genRows.join("/")}）`
    );
    /* ② 生成器必须「缺一行就抛」，否则新格式少一行会静默出一张残图 */
    (genSrc.includes("官方九态缺一不可") && genSrc.includes("ROW_ANIMATION") ? ok : fail)(
      "【232】生成器缺行即抛（不静默出残图）"
    );
    /* ③ 内置宠物：几何自描述 + 素材齐全。
       ⛔ 图集现在可能是 WebP（AI 美术管线产出，比 PNG 小 60%）：PNG 读 IHDR、WebP 读 VP8X。
       10-21 美术替代新增动画包格式（animationSet + 16 向 lookFrameSet）：无图集，按九态文件校验。 */
    const petSlugs = ["harness-fox", "harness-mochi", "harness-tuantuan", "harness-chai", "harness-lizi", "harness-qingtuan"];
    const spriteSize = (file) => {
      try {
        const head = readFileSync(file).subarray(0, 33);
        if (head.length < 30) return null;
        if (head[0] === 0x89 && head.subarray(1, 4).toString() === "PNG") {
          return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
        }
        if (head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP" && head.subarray(12, 16).toString() === "VP8X") {
          return { width: head.readUIntLE(24, 3) + 1, height: head.readUIntLE(27, 3) + 1 };
        }
        return null;
      } catch { return null; }
    };
    let builtinOk = 0;
    const builtinProblems = [];
    for (const slug of petSlugs) {
      const dir = join(ROOT, "public", "pets", slug);
      try {
        const meta = JSON.parse(readFileSync(join(dir, "pet.json"), "utf8"));
        const statesOk = JSON.stringify(meta.states) === JSON.stringify(OFFICIAL_STATES);
        const animated = meta.animationSet && typeof meta.animationSet === "object" && !Array.isArray(meta.animationSet);
        /* 图集包几何必须是 192×208（官方格式）；动画包允许更高分辨率（288×312），
           但九态行名、8×9 声明与 at least 192×208 的清晰度底线仍成立。 */
        const geomOk = meta.columns === 8 && meta.rows === 9
          && (animated
            ? Number(meta.frameSize?.width) >= 192 && Number(meta.frameSize?.height) >= 208
            : meta.frameSize?.width === 192 && meta.frameSize?.height === 208);
        let assetOk = false;
        let detail = "";
        if (animated) {
          const missing = [];
          for (const state of OFFICIAL_STATES) {
            for (const key of ["animatedSrc", "stillSrc"]) {
              const rel = meta.animationSet?.[state]?.[key];
              if (!rel || !existsSync(join(dir, String(rel)))) missing.push(`${state}.${key}`);
            }
          }
          const lookFrames = Array.isArray(meta.lookFrameSet) ? meta.lookFrameSet : [];
          const lookOk = lookFrames.length === 0
            || (lookFrames.length === 16 && lookFrames.every((rel) => rel && existsSync(join(dir, String(rel)))));
          const fpsOk = Number(meta.fps) === 30;
          const lookFlagOk = lookFrames.length === 16 ? meta.supportsLookTracking === true : meta.supportsLookTracking !== true;
          assetOk = missing.length === 0 && lookOk && fpsOk && lookFlagOk;
          detail = `anim=${assetOk} missing=${missing.slice(0, 3).join(",") || "无"} look=${lookFrames.length} fps=${meta.fps}`;
        } else {
          const sheet = join(dir, String(meta.spritesheetPath || ""));
          const size = spriteSize(sheet);
          assetOk = Boolean(size && size.width === 8 * 192 && size.height === 9 * 208);
          detail = `sheet=${size ? `${size.width}x${size.height}` : "缺失/非PNG非WebP"}`;
        }
        if (statesOk && geomOk && assetOk) builtinOk += 1;
        else builtinProblems.push(`${slug}: states=${statesOk} geom=${geomOk} ${detail}`);
      } catch (error) {
        builtinProblems.push(`${slug}: ${error.message}`);
      }
    }
    (builtinOk === petSlugs.length ? ok : fail)(
      `【232】内置宠物包几何全部合规（图集 8×9 / 192×208 或动画包九态 + 可选 16 看帧；问题：${builtinProblems.join(" | ") || "无"}）`
    );
    /* ④ ⛔ 内置宠物必须落在 public/pets（→ dist/pets），**不能**放 src/：
       before-pack 的可达闭包只认 js/css 与 CSS 里的 url()，JS import 的位图会被判成陈旧死块删掉
       （v0.0.27 事故同型）。dist/pets 不在裁剪面（裁剪只走 dist/assets）。 */
    (genSrc.includes('path.join(ROOT, "public", "pets")') ? ok : fail)(
      "【232】生成物落 public/pets（→ dist/pets，不在 dist/assets 裁剪面内）"
    );
    /* ⑤ ⛔ CSP 必须放行 pet://（09-30 实测踩到：`*` 只覆盖网络协议，自定义协议要显式列，
       不放行 ⇒ 图集被拦、浮窗全透明 0% 不透明像素；与当年 connect-src data: 事故同型） */
    (/img-src[^;]*\bpet:/.test(htmlSrc) ? ok : fail)(
      "【232】CSP 的 img-src 显式放行 pet:（否则图集被拦成空白）"
    );
    /* ⑥ 浮窗必须在**首帧前**摘掉启动页：启动页是不透明白底，晚一步就在桌面上闪一块白 */
    (/html\[data-pet-window\][\s\S]{0,120}\.boot-splash[\s\S]{0,80}?display:\s*none/.test(htmlSrc) ? ok : fail)(
      "【232】宠物/活动浮窗首帧前隐藏启动页（防透明窗上的白底闪烁）"
    );
    (htmlSrc.includes('petSurface === "1" || petSurface === "activity"') && htmlSrc.includes("data-pet-window") ? ok : fail)(
      "【232】index.html 内联脚本在首帧前判定 ?pet=1 / ?pet=activity"
    );
    /* ⑦ 入口分流必须在 main.tsx（App() 里条件调用 useHarnessApp 会破坏 hook 调用序） */
    /* ⛔ 10-26：应用锁给主界面包了一层 AppLockGate（未开启锁时直接透传）⇒ 断言跟着改；
       意图不变：**宠物窗/活动窗不经过 App()**（在入口分流，不在 App 里条件调用 hook）。 */
    (mainEntrySrc.includes('petSurface === "activity"') && mainEntrySrc.includes("isPetActivityWindow ? <PetActivity />")
      && mainEntrySrc.includes("isPetWindow ? <PetFloat /> : <AppLockGate><App /></AppLockGate>") ? ok : fail)(
      "【232】渲染入口按 ?pet=1 / ?pet=activity 分流（不在 App() 里条件调用 hook）"
    );
    /* ⑧ 浮窗**不登记 window-bus**：登记进去会白收 codex:event 广播，还会被卷进弹窗语义 */
    (!winSrc.includes("registerBusWindow") ? ok : fail)(
      "【232】宠物浮窗不登记 window-bus（它是独立浮层，不是独立会话弹窗）"
    );
    /* ⑨ 对外「open」必须是**可见性**而非「窗口存在」：hide() 不销毁窗口，
       用 isPetWindowOpen 会让设置页在隐藏后仍显示"已显示"（09-30 实测） */
    (winSrc.includes("export function isPetVisible") && ipcSrc.includes("open: isPetVisible()") ? ok : fail)(
      "【232】IPC 的 open 用可见性语义（hide() 后不能仍报已显示）"
    );
    /* ⑩ 图集协议白名单必须**复用 petRoots**（不许另写一份目录 = 真相源分裂） */
    (ipcSrc.includes("export function petAssetRoots") && ipcSrc.includes("petRoots().map") && bootSrc.includes("petAssetRoots()") ? ok : fail)(
      "【232】pet:// 协议白名单来自 petRoots（单一真相源，不另写目录）"
    );
    /* ⑪ 启动恢复 + 事件归约接线（都断了功能就是"开了没反应/宠物不动"） */
    (bootSrc.includes("if (petSettings.enabled) applyPetSettings(petSettings)") ? ok : fail)(
      "【232】启动时按设置恢复宠物窗口"
    );
    (bootSrc.includes("feedPetEvent(event)") ? ok : fail)(
      "【232】引擎事件流喂给宠物归约（不改事件流向、只旁听）"
    );
    /* ⑫ 归约侧：九态全在类型里 + Qoder 式活动（completed 活动/气泡持久到已看；
     * 宠物姿态 jumping→review 6s→idle 自动回落，failed 仍持久 —— 用户 10-21 实测要求） */
    const stateNames = (stateSrc.match(/export type PetStateName =([\s\S]*?);/) || [, ""])[1];
    (OFFICIAL_STATES.every((s) => stateNames.includes(`"${s}"`)) ? ok : fail)(
      "【232】归约侧九态类型齐全"
    );
    (stateSrc.includes("petPhaseOfActivities") && stateSrc.includes("activities") && stateSrc.includes('status: "completed"')
      && stateSrc.includes("motion") && stateSrc.includes("markPetActivitySeen") ? ok : fail)(
      "【232】活动归约：completed→review 活动持久（姿态 6s 后回 idle）、failed 持久、打开后 markSeen 才清"
    );
    /* ⑬ ⛔ e2e 必须排除宠物浮窗 target：它也是 page target，
       取 list[0] 会随机连到宠物窗 ⇒ 之后所有 eval/click 全打空（实测设置导航读到 0 项） */
    (harnessSrc.includes('!(t.url || "").includes("pet=")') ? ok : fail)(
      "【232】e2e 连接排除宠物/活动浮窗整族（否则会随机连错窗口）"
    );
    /* ⑭ 设置页三处注册齐全（类型 / 导航 / 渲染注册表）—— 少一处就是"导航里有、点开空白" */
    const settingsTypesSrc = readFileSync(join(ROOT, "src", "features", "app-view", "types.ts"), "utf8");
    const catalogsSrc = readFileSync(join(ROOT, "src", "features", "app-view", "helpers", "catalogs.ts"), "utf8");
    const registrySrc = readSettingsSurface();
    (settingsTypesSrc.includes('| "pet"') ? ok : fail)("【232】SettingsPage 类型含 pet");
    (catalogsSrc.includes('["pet", "桌面宠物"') ? ok : fail)("【232】设置导航含「桌面宠物」入口");
    (registrySrc.includes("PetSettingsSection") && /pet:\s*\{\s*render/.test(registrySrc) ? ok : fail)(
      "【232】设置注册表登记 pet 页"
    );
    /* ⑮ 样式接入（浮窗 + 设置页同一文件，前缀 pet-） */
    (readFileSync(join(ROOT, "src", "styles.css"), "utf8").includes("./styles/22-pet") ? ok : fail)(
      "【232】宠物样式接入 styles.css（22-pet.css）"
    );
    /* ⑯ ⛔ 透明区域鼠标穿透（10-09 用户报「软件外面无法点」；同一天第一版被打回「宠物拖不动」）：
       宠物窗是透明矩形，`.pet-float` 整块又是 drag 区 ⇒ 默认整块矩形都吃鼠标，压在底下的
       桌面图标/其它窗口点不到。⛔⛔ **翻转判据不许依赖页面鼠标事件**：drag 区属非客户区，
       Chromium 不往里派发 DOM mousemove —— 第一版挂在渲染层 mousemove + elementFromPoint 上，
       实测事件永远不来 ⇒ 窗口永远停在穿透态 ⇒ 宠物既拖不动也点不着。
       现方案 = 渲染层只**上报矩形**，主进程按光标轮询决定整块穿透/可交互。 */
    const petFloatSrc = readFileSync(join(ROOT, "src", "features", "pet", "PetFloat.tsx"), "utf8");
    (winSrc.includes("screen.getCursorScreenPoint()") && winSrc.includes("setInterval(applyPetMouseState")
      && winSrc.includes("setIgnoreMouseEvents(ignore") ? ok : fail)(
      "【232】穿透翻转在主进程按光标轮询判定（screen.getCursorScreenPoint + 100ms interval）"
    );
    (ipcSrc.includes('"pet:interactive-rect"') && ipcSrc.includes("setPetInteractiveRect(rect ?")
      && petFloatSrc.includes("window.codex.petInteractiveRect(") && petFloatSrc.includes("getBoundingClientRect()") ? ok : fail)(
      "【232】渲染层只上报「宠物本体矩形」（pet:interactive-rect + getBoundingClientRect），不参与命中判定"
    );
    /* ⛔ 负向断言必须先**剥注释**：上面那条注释里就写着「第一版挂在 mousemove + elementFromPoint 上」
       —— 裸匹配会被自己的注释顶成假红（本仓已多次同型：09-25 三次 + 11r 的 localStorage）。 */
    const petFloatCode = String(petFloatSrc).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    (!petFloatCode.includes("elementFromPoint") && !petFloatCode.includes("petIgnoreMouse") ? ok : fail)(
      "【232】渲染层不许再用 mousemove/elementFromPoint 翻转（第一版就是这么坏的：drag 区不派发 DOM 鼠标事件）"
    );
    /* ⛔ 锚**位置**而不是"字符串存在"：`petMouseAppliedIgnore = null` 在 closePetWindow 里也有一处，
       只判 includes 的话把 closed 处理器里那处删掉仍绿（变异测试当场抓到这个假绿）。
       ⇒ 按 `win.on("closed"` 切片，只认**该处理器体内**的重置。 */
    const petClosedIdx = winSrc.lastIndexOf('win.on("closed"');
    const petClosedBody = petClosedIdx >= 0 ? winSrc.slice(petClosedIdx, petClosedIdx + 800) : "";
    (winSrc.includes("petInteractiveRect: PetInteractiveRect | null = null")
      && petClosedBody.includes("petMouseAppliedIgnore = null") ? ok : fail)(
      "【232】默认 fail-safe 穿透（矩形未上报 = 整块穿透）+ 窗口 closed 时重置「已应用状态」（不重置则重建后首帧不推状态、默认仍挡桌面）"
    );
  }
}

{
if (!existsSync(join(ROOT, "src", "features", "team-office", "office-format.ts"))) {
    /* v19 实现不在（再次下线）⇒ 跳过 */
  } else {
    const fmtSrc = readFileSync(join(ROOT, "src", "features", "team-office", "office-format.ts"), "utf8");
    const simSrc = readFileSync(join(ROOT, "src", "features", "team-office", "office-sim.ts"), "utf8");
    const canvasSrc = readFileSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"), "utf8");

    /* ① 精灵格式常量与 MetroCity 图集一致（16×32，7 列；列 6 = 坐姿） */
    (fmtSrc.includes("FRAME_W = 16") && fmtSrc.includes("FRAME_H = 32") ? ok : fail)(
      "【233】精灵帧 16×32（MetroCity CC0 图集网格）"
    );
    (fmtSrc.includes("COL_SIT = 6") ? ok : fail)("【233】坐姿列号 = 6（图集第 7 列）");

    /* ② ⛔ 座位格必须在碰撞图的可走行：桌矩形 y1 只到 8/13（椅行 9/14 留空）。
       座位被挡 ⇒ findPath 返回 null ⇒ 成员永远走不到工位（实测全员困在门口） */
    (/\{ x0: 6, y0: 6, x1: 10, y1: 8 \}/.test(simSrc) && /\{ x0: 19, y0: 11, x1: 23, y1: 13 \}/.test(simSrc) ? ok : fail)(
      "【233】桌碰撞矩形不含椅子行（椅行 9/14 可走）"
    );

    /* ③ ⛔ 门凹龛必须连通房间（col 5 也要开）—— 只开 2-4 会被左墙封死 */
    (simSrc.includes("for (const x of [2, 3, 4, 5]) g[at(x, y)] = 0;") ? ok : fail)(
      "【233】门凹龛连通房间（cols 2-5 × rows 15-18）"
    );

    /* ③b ⛔ 行为模型 = 人人有工位、坐班是常态（09-30 用户纠错：别把没任务的人映射成永久闲逛） */
    (simSrc.includes("坐班是常态") && simSrc.includes("onBreak") ? ok : fail)(
      "【233】坐班常态模型（非 running 也坐工位，闲逛只是短暂休息）"
    );

    /* ③c ⛔ 回工位必须**当场 BFS 重规划**并精确落到座位像素；⛔ 不许回放"来时路线的反向"
     * （10-06 晚逐帧实测：陈旧 homePath 的头是**出发地** ⇒ 人朝饮水机走直线、撞进「桌子行 +
     *  座位格」的夹角 ⇒ 每帧动 0.68px 却从不靠近路点、`path` 一格不减，僵持 1692 秒）。 */
    (simSrc.includes("private headHome") && simSrc.includes("back.push({ x: seat.x, y: seat.y })") && !/\.homePath\s*=/.test(simSrc) ? ok : fail)(
      "【233】回工位当场重规划 + 精确落座（⛔ homePath 已整体删除，不许回放陈旧路线）"
    );
    (simSrc.includes('activity: null | "tea" | "water" | "book"') && simSrc.includes("agent.activity = null") && simSrc.includes("agent.path = []") ? ok : fail)(
      "【233】休息活动（tea/water/book）在 mode 沿清空 + 清在途路径"
    );

    /* ══ 【237】Laya 智能判断（10-01 用户立项）═══════════════════════════
       GitHub NandhaKishorM/laya（Apache-2.0，33ms 非自回归决策引擎）。数据端
       electron/features/laya-service.ts（laya-serve HTTP，Python laya[serve]）。
       首个消费方 = 思考等级「自动」档。⛔ 判断失败必须降级手选档（增强不是依赖）。 */
    const layaSrc = existsSync(join(ROOT, "electron", "features", "laya-service.ts"))
      ? readFileSync(join(ROOT, "electron", "features", "laya-service.ts"), "utf8") : "";
    (layaSrc.includes("127.0.0.1") && layaSrc.includes("LAYA_API_KEY") && layaSrc.includes("hf-mirror.com") && layaSrc.includes("IDLE_EXIT_MS") ? ok : fail)(
      "【237】服务安全与经济性（只绑 127.0.0.1 + API key 鉴权 + 权重走 hf-mirror + 闲置自动退出）"
    );
    (layaSrc.includes('["low", "medium", "high", "xhigh"].includes(choice)') && layaSrc.includes("confidence >= 0.45") ? ok : fail)(
      "【237】effort 判定收口（档位白名单 + 校准置信 <0.45 弃权——低置信硬判不如不判）"
    );
    const sendSrc237 = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part08", "02-seg", "send.tsx"), "utf8");
    (sendSrc237.includes("bag.effortAuto") && sendSrc237.includes("resolveAutoEffort") && sendSrc237.includes("effectiveEffort") ? ok : fail)(
      "【237】发送链接入（effortAuto → resolveAutoEffort → effectiveEffort，手选档不被覆盖）"
    );
    const pickerSrc237 = readFileSync(join(ROOT, "src", "components", "EffortPicker.tsx"), "utf8");
    (pickerSrc237.includes("onAutoToggle") && pickerSrc237.includes("自动（Laya 智能判断）") ? ok : fail)(
      "【237】EffortPicker 自动档开关在位（⛔ auto 不进滑块 levels——不污染 effort 值域）"
    );
    const capabilitySrc237 = readFileSync(join(ROOT, "scripts", "gen-capability-skill.mjs"), "utf8");
    (capabilitySrc237.includes('"laya":') ? ok : fail)(
      "【237】能力清单含 laya 域描述（漏了模型就不知道这个能力存在——【153】教训）"
    );
    // 10-01 二补：手动档立即生效 + 升档锚点（模型对「中以上」系统性压缩的实测对策）
    (sendSrc237.includes("manualEffortOverride") && layaSrc.includes("ruleEscalate") ? ok : fail)(
      "【237】手动档一次性覆盖 + 升档锚点（自动模式下手选立即生效；规则命中 0ms 跳过模型）"
    );

    /* ── 【239】插件市场源 = Gitee 官方镜像（10-01 用户定稿：SkillHub 源几乎全为 DSH 生态装不上）──
       三条硬不变量：源指向 Gitee 镜像仓库、旧 SkillHub 插件 API 清零、镜像源插件全兼容
       （清单条目必须有 pluginPath——DSH 探测分支已随换源删除，不许回来）。 */
    {
      const marketSrc = readFileSync(join(ROOT, "electron", "codex-market.ts"), "utf8");
      const plugIpcSrc = readFileSync(join(ROOT, "electron", "features", "plugins-ipc.ts"), "utf8");
      (marketSrc.includes("claude-plugins-official-gitee") && marketSrc.includes("gitee.com/api/v5") ? ok : fail)(
        "【239】插件市场源 = Gitee 官方镜像（claude-plugins-official-gitee，48 个 .claude-plugin 兼容插件）"
      );
      (marketSrc.includes("GITEE_RAW") && marketSrc.includes("CDN_FILES_API") && marketSrc.includes("jsdelivr")
        && /sources = \[[\s\S]{0,200}GITEE_RAW[\s\S]{0,200}CDN_GH/.test(marketSrc) ? ok : fail)(
        "【239】清单/安装有备用源：Gitee raw 优先 + jsDelivr CDN 回落（Gitee API 403 限流时不再整页失败）"
      );
      (!/api\.skillhub\.cn\/api\/v1\/plugins/.test(marketSrc) && !/listSkillHubPlugins/.test(plugIpcSrc) ? ok : fail)(
        "【239】SkillHub 插件源清零（API 调用与旧函数名不许回来）"
      );
      (/Gitee 镜像源的插件全部自带 \.claude-plugin\/plugin\.json/.test(plugIpcSrc) ? ok : fail)(
        "【239】DSH 探测分支已删（镜像源 100% 兼容，无需逐仓库探测）"
      );
      /* 10-01 用户：「能不能翻译成中文，英文看不懂」——名称/简介走静态翻译表，
         ⛔ 必须同时锚「表存在」与「映射时真的套用」，只锚表存在会变成恒真。 */
      (/(?:^|\n)\s+"?[\w.-]+"?: \{ name:/.test(marketSrc) && /PLUGIN_ZH\[slug\]/.test(marketSrc) && /zh\?\.name \|\| slug/.test(marketSrc) ? ok : fail)(
        "【239】插件名称/简介中文翻译表在位且映射时套用（PLUGIN_ZH → displayName/description）"
      );
    }

    /* ── 【245】插件市场「已安装」状态必须来自**本地 manifest**（10-03 用户报障：
       装完卡片仍是「+」，「已安装」里也看不到）───────────────────────────────
       根因：判定只依赖引擎 `plugin/list` 的「id@market 前段 === slug」，而引擎可能未认领
       （安装流程自己的提示语就写着「当前列表未返回该插件」）⇒ 永远显示未安装。
       真相源 = 安装时写入市场目录的 `.codex-market.json`（主进程扫目录回传 installed）。 */
    const appUiCode245 = codeOnly(readAppUi());
    const marketSrc245 = codeOnly(readFileSync(join(ROOT, "electron", "codex-market.ts"), "utf8"));
    const marketIpcSrc245 = codeOnly(readFileSync(join(ROOT, "electron", "features", "plugins-ipc.ts"), "utf8"));
    // ⛔ 自读源文件：marketSrc 是【239】块内的局部 const，在块外引用会 ReferenceError
    //   ⇒ 「预检自身异常」会把后面所有断言一起废掉（10-03 实测踩过）。
    (marketSrc245.includes("export function codexMarketDir(") && /const marketDir = codexMarketDir\(codexHome\)/.test(marketSrc245) ? ok : fail)(
      "【245】本地市场目录单一真相源 codexMarketDir()（安装落点与「已装」扫描不许各拼一份路径）"
    );
    (marketSrc245.includes("listInstalledMarketPlugins") && /installed: installedMap\.has\(entry\.slug\)/.test(marketSrc245) ? ok : fail)(
      "【245】市场列表逐项合并本地已装标记（真相源 = .codex-market.json，不靠引擎 plugin/list 的命名巧合）"
    );
    (marketIpcSrc245.includes("installedDir: codexMarketDir(codexHome)") ? ok : fail)(
      "【245】plugins:market-list 必须传 installedDir（不传就退化成只看引擎列表 ⇒ 装完仍显示「+」）"
    );
    (appUiCode245.includes("plugin.installed === true") ? ok : fail)(
      "【245】市场卡片的「已安装」判定读主进程回传的 plugin.installed（引擎 id 比对只作回落）"
    );
    (/installMarketPlugin\(plugin\)[\s\S]{0,400}refreshPluginsPage\(\)/.test(appUiCode245) ? ok : fail)(
      "【245】装完插件必须重拉市场列表（只刷页面资源 ⇒ 卡片停留在旧状态）"
    );

    /* ── 【246】本地已装插件必须能进「已安装」列表并能真卸载（10-03 用户追问后补做）─────
       引擎 plugin/list 有时不认领本地市场插件（安装流程自己会提示「当前列表未返回该插件」），
       于是「装完了但已安装列表里没有、也卸不掉」。两条不变量：
         ① 补齐口径 = 引擎列表 ∪（本地已装 − 引擎已认领），且通道必须**零网络**；
         ② 卸载走本地删除时，目标必须过 safeFolder 归一 + 市场目录内校验（删除是唯一不可逆动作）。 */
    (/(?:ipcMain|ipcHost)\.handle\("plugins:market-installed"/.test(marketIpcSrc245) && marketIpcSrc245.includes("listInstalledMarketPlugins(codexMarketDir(codexHome))") && !/market-installed[\s\S]{0,200}listMarketPlugins\(/.test(marketIpcSrc245) ? ok : fail)(
      "【246】已装清单通道只扫本地目录（走 listInstalledMarketPlugins；误接 listMarketPlugins 会去拉远端 48 个插件）"
    );
    (appUiCode245.includes("localOnly: true") && appUiCode245.includes("engineSlugs.has(row.slug)") ? ok : fail)(
      "【246】「已安装」列表补齐本地已装且不与引擎重复（localOnly 标记 + 引擎 slug 差集）"
    );
    (/if \(plugin\.localOnly && plugin\.marketSlug\)[\s\S]{0,300}uninstallMarketPlugin\(/.test(appUiCode245) ? ok : fail)(
      "【246】localOnly 插件卸载走本地 IPC（引擎 plugin/uninstall 认不出它，绕过去会报 unknown plugin）"
    );
    (marketSrc245.includes("export async function removeCodexMarketPluginFiles(")
      && /target === root \|\| !target\.startsWith\(root \+ path\.sep\)/.test(marketSrc245)
      && marketSrc245.includes("safeFolder(slug)") ? ok : fail)(
      "【246】卸载删除有三重防御（safeFolder 归一 + 必须落在市场目录内 + 不等于根本身）"
    );

    /* ── 【254】Codex 官方插件市场（GitHub openai/plugins，国内镜像）—— 10-03 用户立项 ──────
       「帮我内置国内镜像源到插件列表里面，分好类，加官方插件安装入口，和安装状态反馈和已安装反馈」
       这是**第二个数据源**、独立板块（codex-official-market 前缀），不改 Gitee 源（【239】）一根毛。
       ⛔ 块内一律自读源文件（引用别的块内局部 const = ReferenceError，会把后面所有断言一起废掉）。 */
    {
      const officialSrc = codeOnly(readFileSync(join(ROOT, "electron", "codex-official-market.ts"), "utf8"));
      const officialIpc = codeOnly(readFileSync(join(ROOT, "electron", "features", "codex-official-market-ipc.ts"), "utf8"));
      const officialCatalog = readFileSync(join(ROOT, "electron", "codex-official-catalog.gen.ts"), "utf8");
      (officialSrc.includes('const GH_OWNER = "openai"') && officialSrc.includes('const GH_REPO = "plugins"')
        && officialSrc.includes('".agents/plugins/marketplace.json"') && officialSrc.includes('".agents/plugins/api_marketplace.json"') ? ok : fail)(
        "【254】官方源锚定 GitHub openai/plugins 的 .agents/plugins/{marketplace,api_marketplace}.json（清单形态与上游一致）"
      );
      // 镜像顺序 = 实测可用性（gh-proxy 通、直连兜底）；顺序反了国内首屏就要等三轮超时
      //（10-11 表收敛进 ./gh-mirror 单一真相源 —— 这里锚「别名引用 + 源头顺序」两处）
      (/const MIRROR_PREFIXES = GH_MIRROR_PREFIXES/.test(officialSrc) && /export const GH_MIRROR_PREFIXES = \["https:\/\/gh-proxy\.com\/", "https:\/\/ghfast\.top\/", ""\] as const/.test(codeOnly(readFileSync(join(ROOT, "electron", "gh-mirror.ts"), "utf8"))) ? ok : fail)(
        "【254】镜像优先级 gh-proxy → ghfast → 直连（表在 gh-mirror.ts 单一真相源；⛔ api.github.com 也走代理：未登录直连限 60 次/小时）"
      );
      (officialSrc.includes("const MAX_FILES = 1_200") && officialSrc.includes("MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024") ? ok : fail)(
        "【254】文件数上限按实测放宽到 1200（上游 zoom 单插件 795 个文件；沿用 Gitee 源的 300 会拒装 4 个合法插件）"
      );
      (officialSrc.includes("export function codexOfficialMarketDir(") && /installedDir: codexOfficialMarketDir\(codexHome\)/.test(officialIpc) ? ok : fail)(
        "【254】官方市场目录单一真相源 + list 必须传 installedDir（同【245】口径，不传就只看引擎列表）"
      );
      // 已装真相源 = 安装时写的 marker；两处（写 / 读）都要在，缺一处就是「装完仍是 +」
      (/\.codex-official\.json/.test(officialSrc) && officialSrc.includes("listInstalledOfficialPlugins")
        && /installed: installedMap\.has\(item\.slug\)/.test(officialSrc) ? ok : fail)(
        "【254】官方插件「已安装」判定读本地 marker .codex-official.json（引擎 plugin/list 不认领时它返空）"
      );
      (/(?:ipcHost|ipcMain)\.handle\("codex-official-market:installed"/.test(officialIpc)
        && officialIpc.includes("listInstalledOfficialPlugins(codexOfficialMarketDir(codexHome))")
        && !/codex-official-market:installed[\s\S]{0,200}listOfficialMarketPlugins\(/.test(officialIpc) ? ok : fail)(
        "【254】官方已装清单通道零网络（走本地扫描；误接 list 会去拉上游 65 条拖慢刷新）"
      );
      // pluginPath 来自渲染层字符串且参与临时目录取值拼接 ⇒ 必须白名单校验（不能靠"大概传不到"）
      (/if \(!\/\^\[\\w\.-\]\+\(\\\/\[\\w\.-\]\+\)\+\$\/\.test\(plugin\.pluginPath\)/.test(officialSrc)
        && officialSrc.includes('plugin.pluginPath.split("/").includes("..")') ? ok : fail)(
        "【254】安装入参 pluginPath 走形态白名单（只允许 plugins/<slug>，含 .. 或以 / 开头一律拒绝）"
      );
      (officialSrc.includes("export async function removeOfficialMarketPluginFiles(")
        && officialSrc.includes("path.resolve(pluginsRootOf(marketDir))")
        && /target === root \|\| !target\.startsWith\(root \+ path\.sep\)/.test(officialSrc)
        && officialSrc.includes("safeFolder(slug)") ? ok : fail)(
        "【254】官方插件卸载同样有三重删除防御（归一 + 必须落在 <市场>/plugins 内 + 点开头目录不碰）"
      );
      (officialIpc.includes("ensureOfficialMarketplaceSection(codexHome)")
        && /marketplacePath: installed\.manifestPath/.test(officialIpc)
        && officialIpc.includes('server.request("plugin/install"') && officialIpc.includes("server.restart()") ? ok : fail)(
        "【254】装完必须注册本地市场段 + plugin/install 传清单**文件**（传目录报 os error 5）+ 重启引擎（照【245】三条实证）"
      );
      (/自动生成，请勿手改/.test(officialCatalog) && /node scripts\/gen-codex-official-catalog\.mjs/.test(officialCatalog) ? ok : fail)(
        "【254】官方文案快照是生成物（头部标记 + 生成器命令都在，别手改 electron/codex-official-catalog.gen.ts）"
      );
      // 上游拉不通时回落内置快照，但**必须带 live=false 让 UI 说明白**（静默冒充实时数据 = 骗人）
      (/manifestCache = \{ at: Date.now\(\), entries, live: false \}/.test(officialSrc) && /live,\n?\s*catalogGeneratedAt/.test(officialSrc) ? ok : fail)(
        "【254】网络失败回落内置快照时回传 live=false + 快照日期（UI 要如实标注，不许冒充实时清单）"
      );
    }

    /* ── 【255】两个市场源在插件页各自成块 + 安装/已装反馈（10-03）──────────────────
       用户拍板：新独立板块（不塞进 plugins 域）· 按源给各自的分类 tab · 同时放出引擎自带的
       openai-api-curated 官方卡片。三条都各有断言，防止下一轮"顺手合并成一个列表"。 */
    {
      const officialUiSrc = readFileSync(join(ROOT, "src", "features", "codex-official-market", "CodexOfficialMarketSection.tsx"), "utf8");
      const officialUiCode = codeOnly(officialUiSrc);
      const officialIpc255 = codeOnly(readFileSync(join(ROOT, "electron", "features", "codex-official-market-ipc.ts"), "utf8"));
      const pluginsPageCode = codeOnly(readFileSync(join(ROOT, "src", "features", "settings-plugins", "PluginsMarketSection.tsx"), "utf8"));
      const appUiCode255 = codeOnly(readAppUi());
      (officialUiCode.includes("export function CodexOfficialMarketSection(") && officialUiCode.includes("useState(")
        && !/\bbag\./.test(officialUiCode) ? ok : fail)(
        "【255】官方市场板块自包含（本地 state，不进 bag —— 装进度/分页/搜索只有本页消费）"
      );
      (pluginsPageCode.includes("<CodexOfficialMarketSection") && /marketSource === "official"/.test(pluginsPageCode)
        && /label: "Claude 插件镜像"/.test(pluginsPageCode) && /label: "Codex 官方插件"/.test(pluginsPageCode) ? ok : fail)(
        "【255】插件页有源切换，两个源各渲染各的块（分类表 8 类 / 10 类不混排 —— 用户拍板按源给 tab）"
      );
      (/window\.codex\.listOfficialMarketCategories\(\)/.test(officialUiCode) ? ok : fail)(
        "【255】官方分类 tab 读上游清单（主进程现算 10 类含数量），不许在 catalogs.ts 里再硬编码一份"
      );
      (officialIpc255.includes('type: "official-plugin-install"') && /event\?\.type !== "official-plugin-install"/.test(officialUiCode) ? ok : fail)(
        "【255】安装进度事件独立 type（⛔ 不许与 Gitee 源共用 plugin-install：两源 slug 有重名 linear/github，会认错插件）"
      );
      (officialUiCode.includes("<PluginInstallModal") && officialUiCode.includes("STAGE_POSITIONS") ? ok : fail)(
        "【255】安装中有六步弹层（复用 PluginInstallModal，同一套 DOM/CSS，装了看不到进度=没有反馈）"
      );
      /* ⛔ 10-08 收口（行为已按 10-06 用户定案变更）：本页不再显示已安装项，
         页内两段式确认条（confirmSlug / uninstallPlugin）随之删除 —— 卸载统一在「已安装」屏
         走 openAppConfirm 确认框（全局模态层级另有【227】钉）。本条改为**负向**：
         旧的页内两段式确认条不许复活，且本页必须真的隐藏已装项。 */
      (!officialUiCode.includes("confirmSlug") && officialUiCode.includes("if (installed) return null") ? ok : fail)(
        "【255】官方市场页不显示已安装项（10-06 定案）；页内两段式确认条（confirmSlug）不许复活 —— 卸载统一在「已安装」屏走确认框"
      );
      /* ⛔ 10-08 收口：官方市场来源的插件卸载**必须走专用通道**。半成品把卸载统一收进 changePlugin 后，
         官方插件只调了引擎 plugin/uninstall —— 落盘目录与 `.agents/plugins/marketplace.json` 条目没清；
         而官方市场页按「扫本地目录」判已装、又隐藏已装项 ⇒ 两处都没入口、磁盘却还在（幽灵残留）。
         判据锚**调用接线**（剥注释后仍出现该 API 调用），不是"常量存在"。 */
      ((() => {
        const seg05 = codeOnly(readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "01-seg.tsx"), "utf8"));
        return seg05.includes("window.codex.uninstallOfficialMarketPlugin(") && /marketplaceName/.test(seg05) && /codex-official/i.test(seg05);
      })() ? ok : fail)(
        "【255】官方市场插件卸载走专用通道（changePlugin /codex-official/i 分支调 uninstallOfficialMarketPlugin —— 只调 plugin/uninstall 会漏删落盘目录 + marketplace 清单条目）"
      );
      (officialUiCode.includes("!live &&") && officialUiCode.includes("codex-official-market-error") ? ok : fail)(
        "【255】快照模式与加载失败都在 UI 上明说（⛔ 静默空列表会被当成「官方源没有插件」）"
      );
      // 每张卡片必须写清「还要配什么」：官方 65 条全部要鉴权（ON_INSTALL 58 / ON_USE 7），15 条还要 ChatGPT 连接器
      (officialUiCode.includes("{plugin.authNote}") && /authNote: /.test(codeOnly(readFileSync(join(ROOT, "electron", "codex-official-market.ts"), "utf8"))) ? ok : fail)(
        "【255】卡片带鉴权提示 authNote（装了不等于能用；「已安装」不能骗人）"
      );
      (!/\.filter\(\(marketplace: any\) => marketplace\.name !== "openai-api-curated"\)/.test(appUiCode255)
        && /\.flatMap\(\(marketplace: any\) => \(marketplace\.plugins \?\? \[\]\)/.test(appUiCode255) ? ok : fail)(
        "【255】openai-api-curated 整源过滤已按用户改判删除（引擎自带的官方市场卡片要放出来）"
      );
      (/if \(!plugin\.installable \|\| installing\) return;/.test(officialUiCode) ? ok : fail)(
        "【255】外部仓库源（3 条）不许触发安装（只给查看来源，不给人点了才发现报错）"
      );
      /* ⛔⛔ 10-08 事故（用户实测「装技能/插件报安装失败，其实已经装好了」）：四条安装链
       * （技能市场 / 插件市场 / 官方市场 / 专家市场）最后一步都是 `await server.restart()`，
       * 引擎的**瞬时**启动失败会原样抛出 ⇒ 把已经落盘的安装报成失败（SkillHub「编程专家.Skill」
       * 与 Gitee「Agent SDK 开发套件」两次实测；codex-home/skills 与 plugins/codex-market 里文件都在）。
       * 引擎侧已有自动重试兜底，但重试用尽时**不许**再把「装好了」说成「装失败」——
       * 四条必须降级成 pending 如实告知。判据锚**接线取值**（剥注释后仍出现
       * try{...restart()}catch 的降级写法），不是"文件里出现过 restart"。
       * ⛔ 本段续行一律带 ` * ` 前缀：本文件在【265】棘轮名单里，判据是**净代码行**。 */
      ((() => {
        const chain = ["skills-ipc.ts", "plugins-ipc.ts", "codex-official-market-ipc.ts", "expert-market-ipc.ts"]
          .map((name) => [name, join(ROOT, "electron", "features", name)]);
        const missing = chain
          .filter(([, file]) => !/try \{ await server\.restart\(\); \} catch/.test(codeOnly(readFileSync(file, "utf8"))))
          .map(([name]) => name);
        if (missing.length) console.log(`      未降级的安装链：${missing.join(" / ")}`);
        return missing.length === 0;
      })() ? ok : fail)(
        "【255】四条安装链都不让「引擎重启失败」变成「安装失败」（文件已落盘 ⇒ 必须降级为 pending 如实告知）"
      );
      // 板块三前缀同源：目录名 = IPC 前缀 = CSS 类前缀，且 CSS 独立成文件（不许塞进别人的分节尾部）
      (/\.codex-official-market/.test(readFileSync(join(ROOT, "src", "styles", "25-codex-official-market.css"), "utf8"))
        && readFileSync(join(ROOT, "src", "styles.css"), "utf8").includes('./styles/25-codex-official-market') ? ok : fail)(
        "【255】官方市场样式独立分节 25-codex-official-market.css 且已进 barrel（类前缀 = 域 id）"
      );
    }

    /* ③c 坐姿打字微动画 = 图集两个坐姿变体交替（cols 5/6） */
    (fmtSrc.includes("SIT_FRAMES = [5, 6]") && canvasSrc.includes("SIT_FRAMES[") ? ok : fail)(
      "【233】坐姿用双帧变体交替（打字微动画）"
    );

    /* ③d ⛔ 坐姿锚点从椅背顶推导 + 椅背重贴：人不抬高看不清谁坐在哪、不重贴就是人物挡住椅子。
       ⛔ 锚**per-seat backrest**（10-01 实测：两排椅子相对座位高度差 25px，统一公式/常量
       必然弄错一排——上排人物整个被盖掉「头都没了」）。 */
    /* ⛔ 锚「坐姿分支取 per-seat 偏移 − 31」，不锚换行（10-06 拆行后旧字面量匹配假红）。 */
    (/const dy = a\.action === "sit"\s*\?\s*Math\.round\(a\.y \+ r\.dy - 31\)/.test(canvasSrc) ? ok : fail)(
      "【233】坐姿锚点从椅背顶推导（人物顶 = 椅背顶 - 31，两排自适应）"
    );
    (canvasSrc.includes("SEATS[a.seatIndex]?.backrest") && canvasSrc.includes("ctx.drawImage(bg, a.x + r.dx") ? ok : fail)(
      "【233】坐姿画完重贴椅背矩形（人坐进椅子，不是挡住椅子；矩形按座位实测值）"
    );

    /* ⑤ 渲染必须关平滑（像素风最近邻放大）+ 资产走 Vite import（可达闭包，别回 public/） */
    (canvasSrc.includes("imageSmoothingEnabled = false") ? ok : fail)(
      "【233】canvas 关像素平滑（否则像素被拉糊）"
    );
    (canvasSrc.includes('from "./assets/bg.webp?inline"') && canvasSrc.includes("assets/chars/char_0.png") ? ok : fail)(
      "【233】办公室资产走 Vite import（打包可达闭包内；bg 必须 ?inline —— 80KB 超内联阈值，拆文件 = 构建版白底）"
    );

    /* ⑥ 事件驱动边界：域不订阅引擎、不开 IPC —— 状态只从 props 进（架构规则 §2.2） */
    (!/ipcRenderer|window\.codex\./.test(simSrc) ? ok : fail)(
      "【233】sim 不碰 IPC（状态一律由宿主 props 传入）"
    );
    (canvasSrc.includes("membersRef") ? ok : fail)(
      "【233】成员状态经 ref 进渲染循环（props 变化即画面变化 = 事件驱动落点）"
    );

    /* ⑦ 入口三件套：按钮回调接通 / bag 状态在 / AppView 挂载 */
    const timelineSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "01-timeline.tsx"), "utf8");
    (timelineSrc.includes("onOpenOffice={() => setCompanyPreviewTeamId(railTeam.teamId)}") ? ok : fail)(
      "【233】办公室按钮接通（不再留 TODO 空实现）"
    );
    const appViewSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8");
    (appViewSrc.includes("from \"../team-office\"") && appViewSrc.includes("<TeamOfficePreview") ? ok : fail)(
      "【233】AppView 挂载办公室浮层"
    );
  }
}

{
{
    const skinGone = ["src/features/ui-skin", "src/features/settings-ui-skin", "src/lib/ui-skin/store.ts", "src/lib/ui-skin/packs.gen.ts", "src/hooks/use-skin-binding.ts"];
    const leftovers = skinGone.filter((rel) => existsSync(join(ROOT, rel)));
    (leftovers.length === 0 ? ok : fail)(`【234】皮肤文件已删净（残留：${leftovers.join(", ") || "无"}）`);

    const widgetsSrc234 = readFileSync(join(ROOT, "src", "components", "SettingsWidgets.tsx"), "utf8");
    const cardShellSrc = readFileSync(join(ROOT, "src", "components", "CardShell.tsx"), "utf8");
    (!widgetsSrc234.includes("useSkinBinding") && !cardShellSrc.includes("useSkinBinding") && !widgetsSrc234.includes("SkinHost") && !cardShellSrc.includes("SkinHost") ? ok : fail)(
      "【234】开关 / 加载器恢复默认渲染（无换肤分支残留）"
    );

    /* ⑧ 开关全仓统一渲染路径（从皮肤块继承，与皮肤无关、独立成立）：
       胶囊开关只许走共享 ToggleSwitch——出现散装实现（label+checkbox 胶囊）= 同类控件两套长相。 */
    const switchScatter = [];
    const scanDirs238 = [join(ROOT, "src", "features"), join(ROOT, "src", "components")];
    const walk238 = (dir) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) { walk238(p); continue; }
        if (!ent.name.endsWith(".tsx") && !ent.name.endsWith(".ts")) continue;
        const t = readFileSync(p, "utf8");
        if (t.includes('className="bot-switch') || t.includes('className="auto-switch') || t.includes('className="switch"')) {
          switchScatter.push(relative(ROOT, p));
        }
      }
    };
    for (const d of scanDirs238) walk238(d);
    (switchScatter.length === 0 ? ok : fail)(
      `【234】胶囊开关统一走 ToggleSwitch（散装实现清零；命中：${switchScatter.join(", ") || "无"}）`
    );
  }
}

{
{
    const libSrc = existsSync(join(ROOT, "electron", "features", "uiverse-library.ts"))
      ? readFileSync(join(ROOT, "electron", "features", "uiverse-library.ts"), "utf8") : "";
    (libSrc.includes('path.join(appPath, "dist", "assets")') && libSrc.includes('path.join(appPath, "src", "lib", "ui-skin", "data"') ? ok : fail)(
      "【235】数据端双路定位（构建产物 dist/assets 前缀匹配 + dev 源文件回落；单一真相源不复制第二份）"
    );

    /* ① MCP 工具定义 + 执行端接线（⛔ 各自锚定，不串固定窗口） */
    const dispatchCoreSrc = readFileSync(join(ROOT, "electron", "features", "dispatch-core.ts"), "utf8");
    (dispatchCoreSrc.includes('"ui_component_search"') && dispatchCoreSrc.includes('"ui_component_get"') ? ok : fail)(
      "【235】MCP 工具定义在位（dispatchMcpTools 含 search + get 两件）"
    );
    const dispatchRpcSrc = readFileSync(join(ROOT, "electron", "features", "dispatch-rpc.ts"), "utf8");
    (dispatchRpcSrc.includes('from "./uiverse-library"') && dispatchRpcSrc.includes('name === "ui_component_search"') && dispatchRpcSrc.includes('name === "ui_component_get"') ? ok : fail)(
      "【235】执行端接线（dispatch-rpc 两分支真调 uiverseSearch/uiverseGet）"
    );

    /* ② 指令常驻（⛔ 锚 text += 接线；模型不知道工具存在 = 白配） */
    const devInstrSrc = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
    (devInstrSrc.includes("UI_COMPONENT_INSTRUCTIONS") && /text \+= UI_COMPONENT_INSTRUCTIONS;/.test(devInstrSrc) ? ok : fail)(
      "【235】developer_instructions 常驻第 12 条（写前端先查库；接线在 buildDevInstructions）"
    );
    /* ②b 直播弹幕代回 + 身份基线（10-22 用户：客户接了抖音自动化让它回弹幕，「连自我介绍都不会」）。
       两件事都不是措辞问题：① 弹幕是公共场合，长文/Markdown/反问/自称 AI 都会当场翻车；
       ② 引擎默认自称是「OpenAI 的编码代理」，本应用从没注入过「你跑在哪个应用里」。 */
    ((devInstrSrc.includes("LIVE_REPLY_INSTRUCTIONS") && /text \+= LIVE_REPLY_INSTRUCTIONS;/.test(devInstrSrc)
      && devInstrSrc.includes("不要现编") && devInstrSrc.includes("我是 AI / 语言模型")) ? ok : fail)(
      "【235】弹幕代回有默认口径（一句一句 / 不反问 / 没人设不现编 / 不说自己是 AI），且真接线"
    );
    const persSrc235 = readFileSync(join(ROOT, "electron", "personalization.ts"), "utf8");
    ((persSrc235.includes("IDENTITY_GUIDELINES") && persSrc235.includes("lines.push(IDENTITY_GUIDELINES)")
      && persSrc235.includes("向观众介绍你是 Codex")) ? ok : fail)(
      "【235】AGENTS.md 注入身份基线（被问「你是谁」按本应用回答；弹幕场景改用人设，不向观众自我介绍 Codex）"
    );
    /* ⛔ 10-25 品牌不进同步面：主仓身份恒为 Codex Harness Desktop。
       反向防线——从 PPcode 同步 UI 时若把 `BRAND_NAME = "PPcode"` / PP 品牌带回来，这里打红。 */
    const mainSidebarBrandSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "01-sidebar-shell.tsx"), "utf8");
    (mainSidebarBrandSrc.includes('<strong className="brand-name">Codex Harness</strong>')
      && !mainSidebarBrandSrc.includes('BRAND_NAME = "PPcode"')
      && !mainSidebarBrandSrc.includes('<strong className="brand-name">PPcode</strong>') ? ok : fail)(
      "【235】主仓侧栏品牌 = Codex Harness（⛔ 不许被 PPcode 的品牌名覆盖）"
    );
    const mainWinFactorySrc = readFileSync(join(ROOT, "electron", "features", "window-factory.ts"), "utf8");
    (mainWinFactorySrc.includes('title: "Codex Harness Desktop"')
      && !mainWinFactorySrc.includes('title: "PPcode"') ? ok : fail)(
      "【235】主仓窗口标题 = Codex Harness Desktop（⛔ 不许被 PPcode 标题覆盖）"
    );

    /* ③ 独立设置页三件套（注册表 / 类型 / 导航）+ 帮助总览 + 域页面在位 */
    const registrySrc235 = readSettingsSurface();
    const typesSrc235 = readFileSync(join(ROOT, "src", "features", "app-view", "types.ts"), "utf8");
    const catalogsSrc235 = readFileSync(join(ROOT, "src", "features", "app-view", "helpers", "catalogs.ts"), "utf8");
    const helpSrc235 = readFileSync(join(ROOT, "src", "components", "HelpDialog.tsx"), "utf8");
    (registrySrc235.includes('"component-library"') && typesSrc235.includes('"component-library"') ? ok : fail)(
      "【235】设置注册表 + 类型含 component-library"
    );
    (catalogsSrc235.includes('"component-library", "组件库"') && helpSrc235.includes("组件库") ? ok : fail)(
      "【235】设置导航含「组件库」+ 帮助总览有该页（守卫【32】同款义务）"
    );
    const compLibSrc = readFileSync(join(ROOT, "src", "features", "component-library", "ComponentLibrary.tsx"), "utf8");
    (compLibSrc.includes("writeClipboard") && compLibSrc.includes("comp-lib-error") && compLibSrc.includes("loadCategory") ? ok : fail)(
      "【235】组件库页：复制走 writeClipboard、加载失败可见（⛔ 不许静默空白）、数据走基座 loadCategory"
    );
    /* 10-30 用户截图：「这个界面，我想优化里面的展示内容，现在透明底不好看」——
       棋盘格只用来提示透明，满屏噪点；预览台改成与主题同源的纯色面。 */
    const skinCss235 = readFileSync(join(ROOT, "src", "styles", "23-ui-skin.css"), "utf8");
    const previewRule235 = (skinCss235.match(/\.ui-skin-preview\s*\{[^}]*\}/) ?? [""])[0];
    const detailRule235 = (skinCss235.match(/\.comp-lib-preview-row\s*\{[^}]*\}/) ?? [""])[0];
    (previewRule235.includes("color-mix(in srgb, var(--text)") && !previewRule235.includes("repeating-conic-gradient")
      && detailRule235.includes("color-mix(in srgb, var(--text)") && !detailRule235.includes("repeating-conic-gradient") ? ok : fail)(
      "【235】组件库预览台用主题纯色面（网格 + 详情），⛔ 不许退回透明棋盘格"
    );
    /* 10-30 截图里「Contact Us / heavy-dragon-56」被预览框切掉一半：超大组件要按可用框等比缩小。 */
    const skinHostSrc235 = readFileSync(join(ROOT, "src", "components", "SkinHost.tsx"), "utf8");
    (skinHostSrc235.includes("function fitToBox") && skinHostSrc235.includes("fitToBox(host, mount)") ? ok : fail)(
      "【235】预览宿主必须做等比缩放适配（超大社区组件不许被裁掉）"
    );
    (skinHostSrc235.includes("stageContrast(") && skinCss235.includes("var(--skin-stage") ? ok : fail)(
      "【235】透明底 + 浅色文字的组件给深色预览台（浅色主题下不许看不见）"
    );
  }
}

{
{
    const ucCss = readFileSync(join(ROOT, "src", "styles", "16-settings-ssh.css"), "utf8");
    (/\.uc-presets\s*\{[\s\S]{0,100}?grid-template-columns:\s*repeat\(5/.test(ucCss)
      && /\.codex-id-preset-grid\s*\{[\s\S]{0,120}?grid-template-columns:\s*repeat\(5/.test(ucCss) ? ok : fail)(
      "用户 / Codex 头像选择区放大到 5 列（缩略图变大，看得清）"
    );
  }
}
}
