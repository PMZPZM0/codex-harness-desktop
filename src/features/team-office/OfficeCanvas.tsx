/**
 * 像素办公室 · Canvas 渲染器
 *
 * ⛔ 刻意用 **原生 canvas 2D** 而不是 Pixi：像素风要的是 imageSmoothingEnabled=false
 *   的最近邻放大，2D 足够；还躲开 Pixi v8 的空纹理/CSP 两个坑（上一版实测踩过）。
 * ⛔ 资产走 **Vite import**（可达闭包内，打包期裁剪不掉 —— 0.0.27 那条事故的教训）。
 */
import { useEffect, useRef } from "react";
// ⛔ bg 必须 ?inline（强制 data: URI）：bg.webp 80KB 超过全局 assetsInlineLimit(64KB) 会被拆成
//   独立文件 /assets/bg-*.webp，构建版 file:// 下绝对路径解析到盘根 ⇒ 404 ⇒ 画布白底
//   （10-05 用户报「办公室白了」；09-30 v19 埋雷，办公室调试都在 dev 模式所以一直没暴露）。
//   人物 PNG 小于阈值本来就内联成 data:，所以人物一直正常 —— 这也是它拖到今天才被发现的原因。
import bgUrl from "./assets/bg.webp?inline";
import char0 from "./assets/chars/char_0.png";
import char1 from "./assets/chars/char_1.png";
import char2 from "./assets/chars/char_2.png";
import char3 from "./assets/chars/char_3.png";
import char4 from "./assets/chars/char_4.png";
import char5 from "./assets/chars/char_5.png";
import {
  CANVAS_H, CANVAS_W, COL_IDLE, FRAME_H, FRAME_W, SEATS, SIT_FRAMES, SPRITE_SCALE, WALK_CYCLE,
  type OfficeMemberState,
} from "./office-format";
import { OfficeSim, phaseElapsedMs, type Agent } from "./office-sim";
import type { OfficeActivityKind } from "./office-activity";
import {
  drawScreen, effectivePhase, eventWordZhOf, screenModeOf, screensaverAt, TOOL_SCREEN_MODES,
  type RunPhase, type SaScene, type ScreenMode,
} from "./office-screen";

const CHAR_URLS = [char0, char1, char2, char3, char4, char5];

/* ⭐ 全局常驻 sim（2026-10-04）。
 * ⛔ 为什么必须是模块级而不是组件级：`OfficeCanvas` 每次打开预览都会重新挂载
 *   ⇒ 组件内的 sim（含 agents 数组）会一起销毁 ⇒ 每人退回门口初始位置、重播进场。
 *   sim 属于「整个应用的一份世界状态」，不属于「这块画布」。
 * ⛔ 不加「新 sim 继承旧 sim」那类接口：单例已解决重建问题，那类方法就是**没有调用方的死代码**。 */
let officeSimSingletonRef: OfficeSim | null = null;
function officeSimSingleton(): OfficeSim {
  if (!officeSimSingletonRef) officeSimSingletonRef = new OfficeSim();
  return officeSimSingletonRef;
}

/** 成员 id → 稳定整数（屏幕内容种子）。⛔ 同一个成员每次刷新必须同一套"代码"，不能乱跳。 */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 走路/站立时的**渲染层微错位**（±5px，纵向）。
 *
 * ⛔⛔ 10-06 用户要求删掉人物之间的体积碰撞（"太容易卡位"）⇒ 逻辑上两个人**可以站在
 *   同一格**上。为了不让他们在画面上叠成"一个人"，按 id 给一个**固定**的纵向微偏移：
 *   · 只影响**画在哪儿**，不影响 `x/y`/寻路/点击命中以外的任何东西（所以不会卡位）；
 *   · 按 id 取 -5/0/+5 ⇒ 同一屏里三个人以内都能错开，且**每次渲染都相同**（不抖）。
 * ⛔ 坐姿**不给偏移**：坐姿锚点是从椅背实测推出来的（精确到像素），偏了就会"人不在椅子上"。
 *   而坐姿不会重叠（座位是按人分的，且 sync 会把坐姿钉回精确座位像素）。
 */
function renderOffsetY(id: string): number {
  return ((hashId(id) % 3) - 1) * 5;
}

/**
 * 宿主喂进来的**真实事件状态**（只影响显示器内容 + 是否派人离席）。
 * ⛔⛔ 10-05 晚改：原来是 `{ activity, thinking, waiting, reporting }` 三个布尔 ——
 *   宿主**编不出**真实值（`reporting` 被写成"关键词没命中" ⇒ 敲代码屏永远不出现），
 *   用户报「事件状态反馈未接通，操作后没有任何响应」根因就在这里。
 *   ⇒ 换成"真实阶段 + 真实产出量 + 阶段起始时刻"，全部可从 run 记录如实推出。
 */
export type OfficeEventState = {
  /** 真实运行阶段（none = 无运行信息 ⇒ 屏保） */
  phase: RunPhase;
  /** 阶段起始的**绝对**时刻（epoch ms；0 = 未知，由 sim 按首次观测计时） */
  sinceMs: number;
  /** 完成/失败时的总用时（跑动中给 0 ⇒ 屏面实时算） */
  durationMs: number;
  /** 本轮**真实产出字数**（report 屏的进度条按它增长） */
  chars: number;
  /** ⭐ 本次委派的身份（**变化 = 有新任务派下来** ⇒ 播"任务派发"动画）。
   *  专家团取主进程给的 `runId`；被调度会话没有 runId ⇒ 用 `起始时刻` 代替
   *  （同一个会话再次被派单 ⇒ startedAt 必变）。 */
  runId: string;
  /** ⭐ 该成员**最近一条真实事件**（打开浏览器 / 写文件 / 搜文件 / 跑命令…）。
   *  来自 `office-activity` 事件面（引擎 item 事件，与对话框同一套判据）。
   *  ⛔ 这是"显示器演什么"的**主输入**：阶段只回答"这条命跑到哪了"，
   *    回答不了"他此刻在打开浏览器还是改文件"。 */
  event: { kind: OfficeActivityKind; detail: string; elapsedMs: number } | null;
};

export type OfficeCanvasProps = {
  members: OfficeMemberState[];
  onOpenMember?: (memberId: string) => void;
  /** 取某成员的真实事件状态（null = 该成员当下无运行信息）。
   *  ⛔ 由上层从 run 记录派生（不订阅引擎，见 TeamOfficePreview 注释）。 */
  eventStateOf?: (memberId: string) => OfficeEventState | null;
};

/** 加载一张图（resolve 后才用；失败 resolve null 绝不 reject —— 一张图挂了别拖死整层）。 */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 角色名牌下的状态词（⭐ 10-05 晚新增：把"这人什么状态"从**屏面里**也搬到**名牌上**）。
 *  ⛔ 为什么两处都要：屏面只有 50×34（缩放到窗口里也就几十像素），远看只能看出颜色；
 *    名牌是画布上字号最大的元素，状态放这儿才"看得见"（这正是用户说的"没有任何响应"）。 */
function statusOf(a: Agent, nowMs: number): { text: string; color: string } {
  /* ⛔ 顺序 = 屏幕的优先级（见 screenModeOf）：终态 > 事件 > 阶段 > 离席 > 待机。
     两处口径必须一致 —— 否则会出现"名牌说已完成、屏幕上还在滚命令"。 */
  const phase = effectivePhase(a.phase, a.phaseSince, nowMs);
  if (phase === "failed") return { text: "失败", color: "#e0705f" };
  if (phase === "done") return { text: "已完成", color: "#6ed49a" };
  if (a.event) {
    const s = Math.floor(a.eventElapsedMs / 1000);
    const word = eventWordZhOf(a.event);
    return { text: s >= 1 ? `${word} ${s}s` : word, color: "#7fd6a8" };
  }
  if (phase === "thinking" || phase === "waiting" || phase === "writing" || phase === "reporting") {
    const s = Math.floor(phaseElapsedMs(a, nowMs) / 1000);
    return { text: s >= 1 ? `运行中 ${s}s` : "运行中", color: "#7fd6a8" };
  }
  if (a.activity) return { text: "离席", color: "#e8c76a" };
  if (a.mode === "work") return { text: "开工中", color: "#7fd6a8" };
  return { text: "待机", color: "#8ea3b8" };
}

export function OfficeCanvas({ members, onOpenMember, eventStateOf }: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const membersRef = useRef(members);
  const openRef = useRef(onOpenMember);
  const eventRef = useRef(eventStateOf);
  /* 悬停的成员 id（⭐ 10-05 晚新增）：画布上"能点"这件事原来**没有任何视觉提示**，
     用户点空处/点没会话的人 ⇒ 静默无反应，正是"操作后没有任何响应"的一半原因。 */
  const hoverRef = useRef<string | null>(null);
  membersRef.current = members;
  openRef.current = onOpenMember;
  eventRef.current = eventStateOf;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let disposed = false;
    let ro: ResizeObserver | null = null;

    /* ── 全屏铺满（⭐ 10-05 晚）───────────────────────────────────────────
     * ⛔ 用户报「画面未铺满全屏，只显示在中间区域」。根因：CSS 只给了
     *   `max-width/max-height:100%` —— 那**只能缩小、不能放大**，而画布固有尺寸
     *   就是 960×640 ⇒ 窗口一大就只是居中留黑边。
     * ✅ 改成 cover：按 max(sw/960, sh/640) 算缩放，**显式写死画布 CSS 尺寸**，
     *   溢出部分由舞台容器（overflow:hidden）裁掉 ⇒ 永远铺满、且保持 3:2 比例
     *   （⛔ 不能拉伸：像素风一旦非等比缩放，像素就不是方块了）。
     * ⛔⛔ 为什么不用 CSS `object-fit: cover`：那会让元素盒子与实际渲染区不一致，
     *   而点击命中算的是 `getBoundingClientRect()` ⇒ 命中点会整体偏移（人物点不中）。
     *   显式设置尺寸则 rect 就是渲染区，命中天然正确。 */
    const fitCover = () => {
      const stage = canvas.parentElement;
      if (!stage) return;
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      if (sw <= 0 || sh <= 0) return;
      const scale = Math.max(sw / CANVAS_W, sh / CANVAS_H);
      const w = Math.round(CANVAS_W * scale);
      const h = Math.round(CANVAS_H * scale);
      if (canvas.style.width !== `${w}px`) canvas.style.width = `${w}px`;
      if (canvas.style.height !== `${h}px`) canvas.style.height = `${h}px`;
    };

    void (async () => {
      const [bg, ...chars] = await Promise.all([loadImage(bgUrl), ...CHAR_URLS.map(loadImage)]);
      if (disposed) return;

      fitCover();
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(fitCover);
        if (canvas.parentElement) ro.observe(canvas.parentElement);
      }

      /* ⛔⛔ 2026-10-04 用户报「每次打开办公室预览，人物就重新进办公室」——
         这里原本是 `new OfficeSim()`，而**每次打开预览 = 本组件重新挂载**
         ⇒ 新 sim ⇒ 成员回到门口初始位置 (`x:64,y:596`) ⇒ 每次都重播进场。
         ⇒ 改为**模块级常驻单例**：整个应用生命周期内只建一次；
            关掉预览只是画布卸载，sim（成员位置/座位/ID）原样留着，下次打开直接接着。 */
      const sim = officeSimSingleton();
      /* 调试/e2e 句柄：探针据此断言 agents 状态（⛔ 只读使用，别在业务里碰它） */
      (window as unknown as Record<string, unknown>).__officeSim = sim;
      let lastSync = 0;
      let last = performance.now();

      const draw = (now: number) => {
        const dt = Math.min(64, now - last);
        last = now;
        const nowMs = Date.now();

        // ── 数据同步（4Hz 足够：成员状态本来就是低频变化） ──
        if (now - lastSync > 250) {
          lastSync = now;
          sim.sync(membersRef.current, nowMs);
          /* ⛔⛔ 10-04 事件驱动：把**真实事件**灌进 sim。
             两件事分开：
               · setEventState ⇒ 只改显示器画什么（不驱动移动）
               · sendTo ⇒ 真的派人去对应 POI（书架/饮水机/卫生间/跑步机/哑铃）
             ⚠️ 4Hz 派单会不会反复派？sendTo 内部有「已在途/已在做同一件事就拒」，
               所以同一条事件最多派一次；换任务（query 变了）才会派新的。 */
          const es = eventRef.current;
          if (es) {
            for (const a of sim.agents) {
              const st = es(a.id);
              sim.setEventState(a.id, {
                phase: st?.phase ?? "none",
                since: st?.sinceMs ?? 0,
                chars: st?.chars ?? 0,
                durationMs: st?.durationMs ?? 0,
                event: st?.event?.kind ?? null,
                eventDetail: st?.event?.detail ?? "",
                eventElapsedMs: st?.event?.elapsedMs ?? 0,
                runId: st?.runId ?? "",
              });
            }
            /* ⛔ 这里**刻意不再**按事件派人出门（用户 10-05：「有工作就不要闲逛」）——
               曾经按任务里的关键词把在跑的人派去书架/饮水机表演，现在一律不出门：
               在跑的人坐工位，屏幕照实演他手上的事（浏览器/写文件/跑命令…）。
               出门只剩一条路径：sim 内部空闲成员的随机休息（`step` → `sendTo`）。 */
          }
        }
        sim.tick(dt);

        // ── 背景 ──
        ctx.imageSmoothingEnabled = false;
        if (bg) ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H);
        else {
          ctx.fillStyle = "#dfe5ec";
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }

        // ── 悬停落点（画在场景最底层：地面光圈，不遮人物）──
        const hoverId = hoverRef.current;
        if (hoverId) {
          const ha = sim.agents.find((x) => x.id === hoverId);
          if (ha) {
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = "#ffe9a8";
            ctx.beginPath();
            ctx.ellipse(ha.x, ha.y + 24, 26, 9, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }

        // ── 显示器内容（10-04 用户报「显示器像一张图、没有动画」）──
        // ⛔ 必须画在**背景之后、角色之前**：背景图把六个显示器烙死了，内容区是叠在
        //   屏面上的；而角色要能走到屏前面（路过后被挡住才对）。
        // ⛔ 屏幕坐标**锚在座位、不是角色**：角色起身去喝水时，屏幕必须留在原地亮着，
        //   不能跟着人飘到饮水机那儿去。
        // ⛔ 每个座位都画（没人也画 off=熄屏）—— 否则"有人来了屏幕才亮"这个状态变化
        //   体现不出来，显示器看上去仍是静态图。
        /* 每个工位这一帧画的是哪种画面 —— 第二遍画人物时要拿它推**姿态**
           （姿态与屏幕必须同源，见下面那段的注释）。 */
        const seatMode: ScreenMode[] = [];
        /* ⭐ 屏保**当前那一档**（与屏面同源：都用同一个 `screensaverAt`）——
           只给"摸鱼姿态"用（tv/game ⇒ 人后仰看屏幕）。⛔ 别另判一套条件。 */
        const seatScene: (SaScene | null)[] = [];
        for (let i = 0; i < SEATS.length; i++) {
          const seat = SEATS[i];
          const sc = seat?.screen;
          if (!seat || !sc) continue;
          const a = sim.agents.find((x) => x.seatIndex === i);
          /* ⛔ 完成/失败反馈有**时效**（DONE_HOLD_MS 后回到屏保）——
             这个裁剪必须在绘制侧按绝对时刻判：宿主只在 React 重渲染时才重算阶段，
             而用户可能一直开着办公室不动。 */
          const phase = a ? effectivePhase(a.phase, a.phaseSince, nowMs) : "none";
          const seed = a ? hashId(a.id) : i + 1;
          const mode: ScreenMode = a
            ? screenModeOf({ activity: a.activity, mode: a.mode, phase, event: a.event, occupied: true })
            : "off";
          /* ⭐ 屏保（10-06 重做）：`idle` 表示"这块屏该放屏保了"，**具体放哪一档、
             以及在两档之间怎么交叉溶解，全在 drawScreen 内部完成**（见 screensaverAt）。
             ⛔ 这里**不再**把 mode 换成 video/game —— 那会让 `seatMode` 与屏面实际
               内容不一致（屏面已经换成别的档了，姿态却还按旧档演）。 */
          if (mode === "idle") seatScene[i] = screensaverAt(now / 1000, seed).from;
          /* 计时口径：**由事件驱动的模式**显示"这件事跑了多久"，
             其余显示"这条命跑了多久"。⛔ 别混用（会把"写了 12 秒"显示成"开工 12 秒"）。 */
          const eventDriven = TOOL_SCREEN_MODES.has(mode) && a?.event != null;
          seatMode[i] = mode;
          /* ⛔⛔ **屏面裁剪**（10-06）：屏保里有"云从屏外飘进来""代码雨从顶上落下"
             这类元素 —— 它们**故意**画到框外，不裁就会盖住显示器外框和桌子
             （用户 10-04 报过"黑块盖在桌子上"，是同一类溢出）。
             ⛔ 裁剪放在**调用侧**而不是 drawScreen 内部：drawScreen 有十来个
               `return` 分支（每个模式一个），在里面 save/clip 必然漏掉某条 return
               的 restore ⇒ clip 泄漏到后面的人物绘制上（人整个被裁掉）。
               包一层在这里 ⇒ 只有一处、且不会漏。 */
          ctx.save();
          ctx.beginPath();
          ctx.rect(Math.round(seat.x + sc.x), Math.round(seat.y + sc.y), sc.w, sc.h);
          ctx.clip();
          drawScreen(
            ctx, now / 1000, mode, seed,
            Math.round(seat.x + sc.x), Math.round(seat.y + sc.y), sc.w, sc.h,
            a
              ? {
                elapsedMs: eventDriven ? a.eventElapsedMs : phaseElapsedMs(a, nowMs),
                chars: a.chars,
                detail: a.eventDetail,
              }
              : undefined,
          );
          ctx.restore();
        }

        // ── 角色（y 排序：越靠下越后画 = 遮挡正确）──
        // 名字牌 / 气泡留到第二遍画：坐姿成员画完后要重贴椅背（盖住下半身），
        // 牌子若在同一遍会被椅背盖掉。
        /* ⛔ y 相同时按 id 定序：10-06 删掉体积碰撞后**两个人可能站在同一格**
           （y 完全相等）⇒ 没有 tie-break 的话绘制顺序会随数组内部状态抖动 = 闪烁。 */
        const sorted = [...sim.agents].sort((a, b) => (a.y - b.y) || (a.id < b.id ? -1 : 1));
        /* 每个人的**人物绘制底边**（第一遍算出来，第二遍名牌按它贴脚画）——
           ⛔ 必须同源：两处各算一遍必然漂（名牌和人物对不上）。 */
        const spriteBottom = new Map<string, number>();
        for (const a of sorted) {
          const sheet = chars[a.charIndex] ?? chars[0];
          if (!sheet) continue;
          // 列：坐姿用两帧变体交替（打字微动画）；走路按步频循环；其余站立
          const col = a.action === "sit" ? SIT_FRAMES[Math.floor(a.frameClock * 1.6) % SIT_FRAMES.length] : a.action === "walk" ? WALK_CYCLE[Math.floor(a.frameClock * 3) % WALK_CYCLE.length] : COL_IDLE;
          const row = a.action === "sit" ? 1 /* 朝上坐（背对观众对着显示器） */ : a.facing;
          const dw = FRAME_W * SPRITE_SCALE;
          const dh = FRAME_H * SPRITE_SCALE;
          /* ⛔⛔ 姿态与屏幕**同源**（用户 10-05：「确保办公室预览中各事件对应的卡通人物
             动画与显示器内容严格一一联动对应」）：姿态由**同一个 `mode` / 同一个屏保档**推出来，
             ⛔ 不另判一套条件 —— 两套条件必然漂（屏幕上放着剧、人却在猛敲键盘）。
             · 屏保当前档是 tv/game（摸鱼）⇒ `slack`：人**后仰看屏幕**（微微左右晃 + 举着手机）
             · 否则按 sim 的 action/mode 走原来的敲键盘 / 静坐 / 举杯。 */
          const scene = seatScene[a.seatIndex] ?? null;
          const slack = a.action === "sit" && (scene === "tv" || scene === "game");
          const swing = slack ? Math.round(Math.sin(a.frameClock * 1.3)) : 0;
          const dx = Math.round(a.x - dw / 2) + swing;
          /* ⛔ 坐姿锚点从**该座位椅背顶**推导（10-01 实测：两排椅子相对座位高度差 25px，
             统一公式必然弄错一排——上排人物整个被椅背重贴盖掉「头都没了」）：
             人物顶 = 椅背顶 - 31（露头肩 31px，与下排自然态一致）；走路/站立 = 脚底 y+26。 */
          const r = SEATS[a.seatIndex]?.backrest ?? { dx: -30, dy: -30, w: 60, h: 64 };
          /* ⛔ 走路/站立加**渲染层微错位**（见 renderOffsetY）：逻辑上没有体积碰撞了，
             靠这 ±5px 避免两人叠成"一个人"。⛔ 坐姿不加（锚点是实测像素）。 */
          const off = a.action === "sit" ? 0 : renderOffsetY(a.id);
          const dy = a.action === "sit"
            ? Math.round(a.y + r.dy - 31)
            : Math.round(a.y - dh + 26) + off;
          spriteBottom.set(a.id, dy + dh);
          ctx.save();
          if (a.flip) {
            ctx.translate(dx + dw, dy);
            ctx.scale(-1, 1);
            ctx.drawImage(sheet, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H, 0, 0, dw, dh);
          } else {
            ctx.drawImage(sheet, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H, dx, dy, dw, dh);
          }
          ctx.restore();

          /* ⛔ 坐进椅子：人画完立刻把椅背矩形从背景图**重贴**上来盖住下半身 ——
             背景是烙死的整图，人物永远画在它上面，不重贴就是"人物挡住椅子"（09-30 实测）。
             ⛔ 矩形用**该座位自己的 backrest**（实测值，见 SEATS 注释）。 */
          if (a.action === "sit" && bg) {
            ctx.drawImage(bg, a.x + r.dx, a.y + r.dy, r.w, r.h, a.x + r.dx, a.y + r.dy, r.w, r.h);
          }

          /* ⛔ 手部动画（10-01 用户：「干坐着挺尴尬」→「加一点喝茶倒水查资料」「没有点鼠标
             跟键盘」）：素材坐姿帧差异 1-2px 不可感知 ⇒ canvas 叠手。
             · work：左手快速敲键盘 + 右手慢节奏点鼠标（桌上有鼠标块，下压有行程）
             · idle：双手静放键盘
             · activity==="tea"：右手举杯到嘴边（杯子 + 握持手），左手放键盘
             手 y = 椅背顶 - 28（键盘面，从 backrest 推导）；⛔ 画在椅背重贴之后（桌面最上层）。 */
          if (a.action === "sit") {
            const work = a.mode === "work" && !slack;
            const backTop = a.y + r.dy;
            if (slack) {
              /* 摸鱼姿态（10-05 晚，与 video/game 屏**成对**出现）：
                 一只手举着"手机/遥控器"贴在脸前、另一只手撂在桌上不敲键盘、
                 身体随 swing 轻晃、头顶偶尔飘一个音符（每 ~3.4s 一个，飘 1.2s）。 */
              ctx.fillStyle = "#2b323c"; // 举着的屏幕（放在肩侧偏下 ⇒ 一眼是"举着手机看"，不是"头上顶着东西"）
              ctx.fillRect(a.x + 11 + swing, dy + 22, 8, 12);
              ctx.fillStyle = "#7fd6a8"; // 屏幕里的画面（绿光，与"看剧"呼应）
              ctx.fillRect(a.x + 12 + swing, dy + 23, 6, 8);
              ctx.fillStyle = "#e8b08a"; // 托着它的手
              ctx.fillRect(a.x + 10 + swing, dy + 33, 5, 5);
              ctx.fillStyle = "#e8b08a"; // 另一只手撂在桌上（⛔ 没有敲键盘动作）
              ctx.fillRect(a.x - 16 + swing, backTop - 27, 4, 5);
              const note = (a.frameClock * 0.29 + (hashId(a.id) % 7) / 7) % 1;
              if (note < 0.35) {
                const lift = Math.round((note / 0.35) * 14);
                ctx.fillStyle = `rgba(232,199,106,${(1 - note / 0.35).toFixed(2)})`;
                ctx.fillRect(a.x + 14 + swing, dy - 6 - lift, 3, 3);
                ctx.fillRect(a.x + 16 + swing, dy - 11 - lift, 2, 6);
              }
            } else if (a.activity === "tea") {
              // 举杯喝水：杯举到头侧（人物顶+20 处），右手托杯，左手仍在键盘上
              const cupY = dy + 18;
              ctx.fillStyle = "#dfe8f2"; ctx.fillRect(a.x + 11, cupY, 6, 8); // 杯身
              ctx.fillStyle = "#7fb5d6"; ctx.fillRect(a.x + 11, cupY + 1, 6, 3); // 水面
              ctx.fillStyle = "#c98d63"; ctx.fillRect(a.x + 11, cupY + 8, 6, 2); // 杯底影
              ctx.fillStyle = "#e8b08a"; ctx.fillRect(a.x + 10, cupY + 10, 5, 5); // 托杯的手
              ctx.fillStyle = "#e8b08a"; ctx.fillRect(a.x - 17, backTop - 28, 4, 5); // 左手放键盘
            } else {
              const t = a.frameClock * (work ? 9 : 0);
              const lb = work ? (Math.sin(t) > 0 ? -2 : 0) : 0;
              // 右手点鼠标：低频（约 0.35Hz）且短促下压，与左手错开
              const rb = work ? (Math.sin(t * 0.24) > 0.82 ? -2 : 0) : 0;
              const handY = backTop - 28;
              ctx.fillStyle = "#3a3f47"; // 鼠标（右手边桌面上）
              ctx.fillRect(a.x + 23, handY + 1, 4, 6);
              ctx.fillStyle = "#c98d63"; // 手腕/袖口阴影层
              ctx.fillRect(a.x - 18, handY + lb - 1, 5, 6);
              ctx.fillRect(a.x + 14, handY + rb - 1, 5, 6);
              ctx.fillStyle = "#e8b08a"; // 手
              ctx.fillRect(a.x - 17, handY + lb, 4, 5);
              ctx.fillRect(a.x + 15, handY + rb, 4, 5);
            }
          }
        }
        /* ── 任务派发动画（⭐ 10-05 晚 用户要求「为任务派发增加对应的动画表现」）──
           ⛔ 画在**人物之后、名牌之前**：任务卡是从桌面飞过去的，必须能盖住桌椅；
             但⛔ 不能盖住名牌/气泡（那两样是"谁是谁、说了什么"的唯一出口）。
           ⛔ 起点固定取座位 0：两条成员来源都把**派发方**放在第 0 位
             （专家团 = 主理人；普通会话 = 「我」，见 TeamOfficePreview 的 members 构造）。 */
        for (const fx of sim.dispatchFx) {
          const from = SEATS[fx.from];
          const to = sim.agents.find((x) => x.seatIndex === fx.to);
          if (!from || !to) continue;
          const p = Math.min(1, Math.max(0, (nowMs - fx.at) / 1600));
          const sx = from.x;
          const sy = from.y - 44;
          const tx = to.x;
          const ty = to.y - 44;
          const ctrlX = (sx + tx) / 2;
          const ctrlY = Math.min(sy, ty) - 64;                 // 抛物线控制点在上方 ⇒ 卡片"抛"过去
          const mx = (1 - p) * (1 - p) * sx + 2 * (1 - p) * p * ctrlX + p * p * tx;
          const my = (1 - p) * (1 - p) * sy + 2 * (1 - p) * p * ctrlY + p * p * ty;
          // 拖尾（同一条二次曲线取前半段，越靠近卡片越亮）
          ctx.strokeStyle = `rgba(232,199,106,${(0.5 * (1 - p)).toFixed(2)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let s = 0; s <= 10; s += 1) {
            const q = p * (s / 10);
            const qx = (1 - q) * (1 - q) * sx + 2 * (1 - q) * q * ctrlX + q * q * tx;
            const qy = (1 - q) * (1 - q) * sy + 2 * (1 - q) * q * ctrlY + q * q * ty;
            if (s === 0) ctx.moveTo(qx, qy);
            else ctx.lineTo(qx, qy);
          }
          ctx.stroke();
          // 任务卡（一张小纸片：黄底 + 两行"字"）
          ctx.save();
          ctx.translate(mx, my);
          ctx.rotate(Math.sin(p * Math.PI) * 0.5);
          ctx.fillStyle = "#fdf3c8";
          ctx.fillRect(-8, -6, 16, 12);
          ctx.fillStyle = "#8a6b1f";
          ctx.fillRect(-6, -4, 12, 2);
          ctx.fillRect(-6, -1, 8, 2);
          ctx.fillRect(-6, 2, 10, 2);
          ctx.restore();
          // 落点高亮环（卡片到达时闪一下 ⇒ 明确"交给谁了"）
          if (p > 0.86) {
            ctx.strokeStyle = `rgba(232,199,106,${(1 - (p - 0.86) / 0.14).toFixed(2)})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(tx, ty + 68, 26, 10, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        // ── 第二遍：名字牌（含**真实状态**）+ 气泡（UI 层，永远在最上）──
        for (const a of sorted) {
          const st = statusOf(a, nowMs);
          ctx.textAlign = "center";
          ctx.font = "11px ui-sans-serif, system-ui";
          const nameW = ctx.measureText(a.name).width;
          ctx.font = "10px ui-sans-serif, system-ui";
          const stW = ctx.measureText(st.text).width;
          const pw = Math.max(nameW, stW) + 12;
          const plx = a.x - pw / 2;
          /* ⛔⛔ 名牌**贴脚**画（10-06 用户：「顶部一排名字与其对应角色的距离过远」）。
             根因：原来写死 `a.y + 30` —— 而"人物底边"在**坐姿**时是 `a.y + r.dy + 65`
             （上排 r.dy = −62 ⇒ 人物底 ≈ a.y + 3），比 `a.y + 30` **高 27px**
             ⇒ 上排名牌浮在人物脚下老远（下排 r.dy = −37 ⇒ 人物底 a.y + 28，看着正常）。
             ⇒ 改成从第一遍算出的 `spriteBottom`（人物**真实绘制底边**）推 ⇒ 两排一致。
             ⚠️ 上排名牌会压住椅子下沿 ~5px 属正常（名牌是 UI 层，永远画在最上）。 */
          const ply = (spriteBottom.get(a.id) ?? a.y + 26) + 4;
          ctx.fillStyle = "rgba(28,30,36,0.78)";
          ctx.beginPath();
          ctx.roundRect(plx, ply, pw, 26, 4);
          ctx.fill();
          /* 悬停：名牌描一圈暖色边 —— 与地面光圈一起构成"这个能点"的提示 */
          if (hoverId === a.id) {
            ctx.strokeStyle = "rgba(255,233,168,0.85)";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.font = "11px ui-sans-serif, system-ui";
          ctx.fillStyle = "#f4f5f7";
          ctx.fillText(a.name, a.x, ply + 11);
          ctx.font = "10px ui-sans-serif, system-ui";
          ctx.fillStyle = st.color;
          ctx.fillText(st.text, a.x, ply + 23);

          if (a.bubble) {
            ctx.font = "12px ui-sans-serif, system-ui";
            const btxt = a.bubble.text;
            const bw = ctx.measureText(btxt).width + 16;
            const bx = Math.min(CANVAS_W - bw - 4, Math.max(4, a.x - bw / 2));
            const by = a.y - 84;
            ctx.fillStyle = "rgba(255,255,255,0.96)";
            ctx.strokeStyle = "rgba(40,44,52,0.5)";
            ctx.beginPath();
            ctx.roundRect(bx, by, bw, 20, 6);
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(a.x - 4, by + 20);
            ctx.lineTo(a.x + 4, by + 20);
            ctx.lineTo(a.x, by + 26);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = "#22252c";
            ctx.fillText(btxt, bx + bw / 2, by + 14);
          }
        }

        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);

      /* 命中判定：取离点击点最近的角色。
       * ⛔ 悬停与点击**共用同一个判定**（`hitTest`）—— 各写一份必然漂：
       *   看着有光圈却点不中（或反过来），是最难查的那种"操作没反应"。 */
      const hitTest = (clientX: number, clientY: number): Agent | null => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const sx = ((clientX - rect.left) / rect.width) * CANVAS_W;
        const sy = ((clientY - rect.top) / rect.height) * CANVAS_H;
        let best: { d: number; a: Agent } | null = null;
        for (const a of sim.agents) {
          const d = Math.hypot(a.x - sx, a.y - 26 - sy);
          if (d < 48 && (!best || d < best.d)) best = { d, a };
        }
        return best?.a ?? null;
      };
      const onClick = (ev: MouseEvent) => {
        const a = hitTest(ev.clientX, ev.clientY);
        if (a) openRef.current?.(a.id);
      };
      const onMove = (ev: MouseEvent) => {
        const a = hitTest(ev.clientX, ev.clientY);
        const id = a?.id ?? null;
        if (hoverRef.current !== id) {
          hoverRef.current = id;
          canvas.style.cursor = id ? "pointer" : "default";
        }
      };
      const onLeave = () => {
        if (hoverRef.current !== null) {
          hoverRef.current = null;
          canvas.style.cursor = "default";
        }
      };
      canvas.addEventListener("click", onClick);
      canvas.addEventListener("mousemove", onMove);
      canvas.addEventListener("mouseleave", onLeave);
    })().catch(() => undefined);

    return () => {
      disposed = true;
      if (ro) ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="office-pixel-canvas" />;
}
