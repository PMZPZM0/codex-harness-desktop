/**
 * 像素办公室 · Canvas 渲染器
 *
 * ⛔ 刻意用 **原生 canvas 2D** 而不是 Pixi：像素风要的是 imageSmoothingEnabled=false
 *   的最近邻放大，2D 足够；还躲开 Pixi v8 的空纹理/CSP 两个坑（上一版实测踩过）。
 * ⛔ 资产走 **Vite import**（可达闭包内，打包期裁剪不掉 —— 0.0.27 那条事故的教训）。
 */
import { useEffect, useRef } from "react";
import bgUrl from "./assets/bg.webp";
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
import { OfficeSim } from "./office-sim";
import { drawScreen, screenModeOf } from "./office-screen";

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

export type OfficeCanvasProps = {
  members: OfficeMemberState[];
  onOpenMember?: (memberId: string) => void;
  /** 10-04 事件驱动：取某成员的真实事件状态（null = 该成员当下无事件）。
   *  ⛔ 由上层从 `TeamMemberRunRecord` 派生（不订阅引擎，见 TeamOfficePreview 注释）。 */
  eventStateOf?: (memberId: string) => {
    activity: null | "book" | "water" | "toilet" | "run" | "gym";
    thinking: boolean;
    waiting: boolean;
    reporting: boolean;
  } | null;
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

export function OfficeCanvas({ members, onOpenMember, eventStateOf }: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const membersRef = useRef(members);
  const openRef = useRef(onOpenMember);
  const eventRef = useRef(eventStateOf);
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

    void (async () => {
      const [bg, ...chars] = await Promise.all([loadImage(bgUrl), ...CHAR_URLS.map(loadImage)]);
      if (disposed) return;
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

        // ── 数据同步（4Hz 足够：成员状态本来就是低频变化） ──
        if (now - lastSync > 250) {
          lastSync = now;
          sim.sync(membersRef.current, Date.now());
          /* ⛔⛔ 10-04 事件驱动：把**真实事件**灌进 sim。
             两件事分开：
               · setEventState ⇒ 只改显示器画什么（不驱动移动）
               · sendTo⇒ 真的派人去对应 POI（书架/饮水机/卫生间/跑步机/哑铃）
             ⚠️ 4Hz 派单会不会反复派？sendTo 内部有「已在途/已在做同一件事就拒」，
               所以同一条事件最多派一次；换任务（query 变了）才会派新的。 */
          const es = eventRef.current;
          if (es) {
            for (const a of sim.agents) {
              const st = es(a.id);
              sim.setEventState(a.id, {
                thinking: Boolean(st?.thinking),
                waiting: Boolean(st?.waiting),
                reporting: Boolean(st?.reporting),
              });
              if (st?.activity) sim.sendTo(a.id, st.activity, Date.now());
            }
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

        // ── 显示器内容（10-04 用户报「显示器像一张图、没有动画」）──
        // ⛔ 必须画在**背景之后、角色之前**：背景图把六个显示器烙死了，内容区是叠在
        //   屏面上的；而角色要能走到屏前面（路过后被挡住才对）。
        // ⛔ 屏幕坐标**锚在座位、不是角色**：角色起身去喝水时，屏幕必须留在原地亮着，
        //   不能跟着人飘到饮水机那儿去。
        // ⛔ 每个座位都画（没人也画 off=熄屏）—— 否则"有人来了屏幕才亮"这个状态变化
        //   体现不出来，显示器看上去仍是静态图。
        for (let i = 0; i < SEATS.length; i++) {
          const seat = SEATS[i];
          const sc = seat?.screen;
          if (!seat || !sc) continue;
          const a = sim.agents.find((x) => x.seatIndex === i);
          const mode = a
            ? screenModeOf({
                activity: a.activity,
                mode: a.mode,
                occupied: true,
                thinking: a.thinking,
                waiting: a.waiting,
                reporting: a.reporting,
              })
            : "off";
          drawScreen(
            ctx, now / 1000, mode, a ? hashId(a.id) : i + 1,
            Math.round(seat.x + sc.x), Math.round(seat.y + sc.y), sc.w, sc.h,
          );
        }

        // ── 角色（y 排序：越靠下越后画 = 遮挡正确）──
        // 名字牌 / 气泡留到第二遍画：坐姿成员画完后要重贴椅背（盖住下半身），
        // 牌子若在同一遍会被椅背盖掉。
        const sorted = [...sim.agents].sort((a, b) => a.y - b.y);
        for (const a of sorted) {
          const sheet = chars[a.charIndex] ?? chars[0];
          if (!sheet) continue;
          // 列：坐姿用两帧变体交替（打字微动画）；走路按步频循环；其余站立
          const col = a.action === "sit" ? SIT_FRAMES[Math.floor(a.frameClock * 1.6) % SIT_FRAMES.length] : a.action === "walk" ? WALK_CYCLE[Math.floor(a.frameClock * 3) % WALK_CYCLE.length] : COL_IDLE;
          const row = a.action === "sit" ? 1 /* 朝上坐（背对观众对着显示器） */ : a.facing;
          const dw = FRAME_W * SPRITE_SCALE;
          const dh = FRAME_H * SPRITE_SCALE;
          const dx = Math.round(a.x - dw / 2);
          /* ⛔ 坐姿锚点从**该座位椅背顶**推导（10-01 实测：两排椅子相对座位高度差 25px，
             统一公式必然弄错一排——上排人物整个被椅背重贴盖掉「头都没了」）：
             人物顶 = 椅背顶 - 31（露头肩 31px，与下排自然态一致）；走路/站立 = 脚底 y+26。 */
          const r = SEATS[a.seatIndex]?.backrest ?? { dx: -30, dy: -30, w: 60, h: 64 };
          const dy = a.action === "sit" ? Math.round(a.y + r.dy - 31) : Math.round(a.y - dh + 26);
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
            const work = a.mode === "work";
            const backTop = a.y + r.dy;
            if (a.activity === "tea") {
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
        // ── 第二遍：名字牌 + 气泡（UI 层，永远在最上）──
        for (const a of sorted) {
          ctx.font = "11px ui-sans-serif, system-ui";
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(28,30,36,0.72)";
          const tw = ctx.measureText(a.name).width;
          ctx.fillRect(a.x - tw / 2 - 5, a.y + 30, tw + 10, 15);
          ctx.fillStyle = "#f4f5f7";
          ctx.fillText(a.name, a.x, a.y + 41);

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

      // 点击 → 找最近的角色（打开会话）
      const onClick = (ev: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const sx = ((ev.clientX - rect.left) / rect.width) * CANVAS_W;
        const sy = ((ev.clientY - rect.top) / rect.height) * CANVAS_H;
        let best: { d: number; id: string } | null = null;
        for (const a of sim.agents) {
          const d = Math.hypot(a.x - sx, a.y - 26 - sy);
          if (d < 48 && (!best || d < best.d)) best = { d, id: a.id };
        }
        if (best) openRef.current?.(best.id);
      };
      canvas.addEventListener("click", onClick);
      return () => canvas.removeEventListener("click", onClick);
    })().catch(() => undefined);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="office-pixel-canvas" />;
}
