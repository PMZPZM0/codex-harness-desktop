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
  CANVAS_H, CANVAS_W, CHAIR_BACKREST, COL_IDLE, FRAME_H, FRAME_W, SIT_FRAMES, SPRITE_SCALE, WALK_CYCLE,
  type OfficeMemberState,
} from "./office-format";
import { OfficeSim } from "./office-sim";

const CHAR_URLS = [char0, char1, char2, char3, char4, char5];

export type OfficeCanvasProps = {
  members: OfficeMemberState[];
  onOpenMember?: (memberId: string) => void;
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

export function OfficeCanvas({ members, onOpenMember }: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const membersRef = useRef(members);
  const openRef = useRef(onOpenMember);
  membersRef.current = members;
  openRef.current = onOpenMember;

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
      const sim = new OfficeSim();
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
        }
        sim.tick(dt);

        // ── 背景 ──
        ctx.imageSmoothingEnabled = false;
        if (bg) ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H);
        else {
          ctx.fillStyle = "#dfe5ec";
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
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
          // 锚点分动作（dh=96）：走路/站立 = 脚底 y+26；坐姿 = 坐姿图形底(y-68 处)落进椅面，
          // 头+肩露在椅背上方（用户 09-30：不露头认不出谁坐在哪）
          const dy = Math.round(a.y - dh + (a.action === "sit" ? 28 : 26));
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
             背景是烙死的整图，人物永远画在它上面，不重贴就是"人物挡住椅子"（09-30 实测）。 */
          if (a.action === "sit" && bg) {
            const r = CHAIR_BACKREST;
            ctx.drawImage(bg, a.x + r.dx, a.y + r.dy, r.w, r.h, a.x + r.dx, a.y + r.dy, r.w, r.h);
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
