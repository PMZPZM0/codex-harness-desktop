/**
 * 办公室动画导演（team-office 域，09-26 v4「马维斯式」）。
 *
 * 职责：把成员的**真实运行状态**翻译成「此刻谁在做什么」，供渲染层画成动画。
 *   · 预设动画（状态驱动）：工作中 → 敲键盘；空闲 → 喝咖啡 / 伸懒腰 / 看手机 / 打盹 / 翻资料
 *   · 随机动画：串门（走到同事工位旁）、去接水 / 翻资料架 / 看白板、姿势时长与变体随机
 *   · 交接（handoff）：任务派发（CEO → 成员）、成果汇报（成员 → CEO）、
 *     顺带递资料（成员 ↔ 成员）—— 渲染层据 this.handoffs 画飞行卡片 + 落点特效
 *
 * ⛔ 导演只产出**纯数据快照**（poses / handoffs），不碰 DOM、不认识名字、不 import React。
 * ⛔ 随机源可注入：断言与截图验收用固定种子 ⇒ 结果可复现（别让判据依赖 Math.random）。
 * ⛔ 导演不订阅任何通道：外部把它 observe(running, hasThread) 一遍即可。
 */

export type OfficePoseKind =
  | "work"      // 敲键盘（工作 / 待命都坐在这儿）
  | "coffee"    // 端咖啡
  | "stretch"   // 伸懒腰
  | "phone"     // 看手机
  | "doze"      // 打盹
  | "note"      // 翻资料 / 记笔记
  | "visit"     // 走到同事工位旁
  | "errand"    // 去接水 / 翻资料架 / 看白板
  | "absent";   // 没有会话 = 空工位

export type ErrandSpot = "water" | "shelf" | "printer";
export type HandoffKind = "task" | "report" | "doc" | "chat";

export type OfficePose = {
  kind: OfficePoseKind;
  /** visit：被访问的工位索引（渲染层据此算位移与朝向） */
  visitIndex?: number;
  /** errand：地面目标点 */
  spot?: ErrandSpot;
  /** 剩余 tick 数（<= 0 时重新抽） */
  hold: number;
  /** 右栏看板显示的动作文案（不含人名，人名由调用方拼） */
  label: string;
  /** 同种姿势的变体（渲染层据此换点细节，避免一眼看出循环） */
  variant: number;
};

export type OfficeHandoff = {
  id: string;
  /** -1 = CEO 工位 */
  from: number;
  to: number;
  kind: HandoffKind;
  label: string;
  /** 剩余 tick 数（飞完并停留一小会儿后卸载） */
  ttl: number;
};

export type DirectorSnapshot = {
  poses: OfficePose[];
  ceo: OfficePose;
  handoffs: OfficeHandoff[];
};

/** 导演一拍 = 1.2s。姿势切换与位置过渡都挂在这个节拍上（CSS transition 负责平滑）。 */
export const OFFICE_TICK_MS = 1200;

type ActionSpec = { kind: OfficePoseKind; label: string; min: number; max: number };

/** 工作中的短动作：绝大多数时间在敲键盘，偶尔抬头查点东西。 */
const BUSY_ACTIONS: ActionSpec[] = [
  { kind: "work", label: "编码中", min: 5, max: 9 },
  { kind: "note", label: "查资料", min: 2, max: 4 },
  { kind: "phone", label: "看消息", min: 2, max: 3 },
];

/** 空闲动作池（随机抽）。 */
const IDLE_ACTIONS: ActionSpec[] = [
  { kind: "coffee", label: "喝咖啡", min: 3, max: 5 },
  { kind: "stretch", label: "伸懒腰", min: 2, max: 4 },
  { kind: "phone", label: "看手机", min: 3, max: 5 },
  { kind: "doze", label: "打盹", min: 4, max: 7 },
  { kind: "note", label: "翻资料", min: 3, max: 5 },
];

const ERRAND_LABEL: Record<ErrandSpot, string> = {
  water: "去接水",
  shelf: "去翻资料架",
  printer: "去打印",
};
const ERRAND_SPOTS: ErrandSpot[] = ["water", "shelf", "printer"];

const HANDOFF_LABEL: Record<HandoffKind, string> = {
  task: "派任务",
  report: "交成果",
  doc: "递资料",
  chat: "对口径",
};

export class OfficeDirector {
  private poses: OfficePose[] = [];
  private ceo: OfficePose = { kind: "work", hold: 6, label: "统筹中", variant: 0 };
  private handoffs: OfficeHandoff[] = [];
  private seq = 0;
  private prevRunning: boolean[] = [];
  private prevHas: boolean[] = [];
  /** 串门 / 跑腿的公共冷却（tick）：防止一屋子人同时起身乱走 */
  private roamCooldown = 0;

  constructor(private rand: () => number = Math.random) {}

  /** 抖一个 [min,max] 的整数。 */
  private span(min: number, max: number): number {
    return min + Math.floor(this.rand() * (max - min + 1));
  }

  private pick<T>(list: T[]): T {
    return list[Math.min(list.length - 1, Math.floor(this.rand() * list.length))];
  }

  private pushHandoff(from: number, to: number, kind: HandoffKind, ttl = 2): void {
    this.seq += 1;
    this.handoffs.push({ id: `h${this.seq}`, from, to, kind, label: HANDOFF_LABEL[kind], ttl });
    // 同时最多三条飞行（多了像弹幕，反而看不出交接）
    if (this.handoffs.length > 3) this.handoffs.splice(0, this.handoffs.length - 3);
  }

  /** 抽下一个姿势。initial=true 时只产「落座」姿势（首次挂载不让人凭空乱走）。 */
  private next(index: number, running: boolean[], hasThread: boolean[], initial = false): OfficePose {
    const variant = this.span(0, 2);
    if (running[index]) {
      if (initial || this.rand() < 0.72) {
        const spec = BUSY_ACTIONS[0];
        return { kind: spec.kind, hold: this.span(spec.min, spec.max), label: spec.label, variant };
      }
      const spec = this.pick(BUSY_ACTIONS.slice(1));
      return { kind: spec.kind, hold: this.span(spec.min, spec.max), label: spec.label, variant };
    }
    const mates = hasThread.map((has, i) => (has && i !== index ? i : -1)).filter((i) => i >= 0);
    if (!initial && this.roamCooldown <= 0) {
      const roll = this.rand();
      if (roll < 0.1 && mates.length) {
        const to = this.pick(mates);
        this.roamCooldown = 4;
        // 串门顺带递一份资料 —— 「员工之间交接」最自然的形态
        this.pushHandoff(index, to, "doc");
        return { kind: "visit", visitIndex: to, hold: this.span(4, 6), label: "去同事工位", variant };
      }
      if (roll < 0.2) {
        const spot = this.pick(ERRAND_SPOTS);
        this.roamCooldown = 4;
        return { kind: "errand", spot, hold: this.span(4, 6), label: ERRAND_LABEL[spot], variant };
      }
    }
    if (initial || this.rand() < 0.5) {
      const spec = this.pick(IDLE_ACTIONS);
      return { kind: spec.kind, hold: this.span(spec.min, spec.max), label: spec.label, variant };
    }
    // 空闲但不表演：老实待在工位上（否则一屏都是喝咖啡的人，不像办公室）
    return { kind: "work", hold: this.span(3, 6), label: "待命", variant };
  }

  /**
   * 外部真实状态变化时调用（首次挂载也要调一次）：只做「迁移检测 → 派交接」。
   * idle/never → running：CEO → 该成员 派任务；running → idle：该成员 → CEO 交成果。
   */
  observe(running: boolean[], hasThread: boolean[]): void {
    const size = running.length;
    if (this.prevRunning.length !== size) {
      this.prevRunning = running.slice();
      this.prevHas = hasThread.slice();
      this.poses = Array.from({ length: size }, (_, i) =>
        hasThread[i] ? this.next(i, running, hasThread, true) : { kind: "absent" as const, hold: 9999, label: "未开工", variant: 0 },
      );
      return;
    }
    for (let i = 0; i < size; i++) {
      if (!hasThread[i]) continue;
      const wasRunning = this.prevRunning[i] === true;
      const nowRunning = running[i] === true;
      if (!wasRunning && nowRunning) {
        this.pushHandoff(-1, i, "task");
        this.poses[i] = { kind: "work", hold: this.span(5, 8), label: "接到任务", variant: 0 };
        this.ceo = { kind: "note", hold: 3, label: "派任务", variant: 1 };
      } else if (wasRunning && !nowRunning) {
        this.pushHandoff(i, -1, "report");
        this.poses[i] = { kind: "note", hold: 3, label: "整理成果", variant: 1 };
        this.ceo = { kind: "work", hold: 5, label: "看汇报", variant: 2 };
      }
    }
    this.prevRunning = running.slice();
    this.prevHas = hasThread.slice();
  }

  /** 推进一拍，返回快照（调用方拿去 setState）。 */
  step(running: boolean[], hasThread: boolean[]): DirectorSnapshot {
    if (this.roamCooldown > 0) this.roamCooldown -= 1;
    for (let i = 0; i < running.length; i++) {
      if (!hasThread[i]) {
        const pose = this.poses[i];
        if (!pose || pose.kind !== "absent") this.poses[i] = { kind: "absent", hold: 9999, label: "未开工", variant: 0 };
        continue;
      }
      const pose = this.poses[i];
      if (!pose || pose.kind === "absent") {
        this.poses[i] = this.next(i, running, hasThread, true);
        continue;
      }
      const hold = pose.hold - 1;
      this.poses[i] = hold > 0 ? { ...pose, hold } : this.next(i, running, hasThread);
    }
    // CEO：偶尔在工位间发指令（装饰性，不代表真实调度）
    const ceoHold = this.ceo.hold - 1;
    if (ceoHold > 0) this.ceo = { ...this.ceo, hold: ceoHold };
    else {
      const roll = this.rand();
      const idleCeo: OfficePose[] = [
        { kind: "work", hold: this.span(4, 7), label: "统筹中", variant: this.span(0, 2) },
        { kind: "note", hold: this.span(3, 5), label: "看汇报", variant: this.span(0, 2) },
        { kind: "coffee", hold: this.span(3, 4), label: "喝口茶", variant: this.span(0, 2) },
      ];
      this.ceo = roll < 0.06 && hasThread.some(Boolean)
        ? { kind: "stretch", hold: 3, label: "活动一下", variant: this.span(0, 2) }
        : this.pick(idleCeo);
    }
    this.handoffs = this.handoffs.map((h) => ({ ...h, ttl: h.ttl - 1 })).filter((h) => h.ttl > 0);
    return { poses: this.poses.map((p) => ({ ...p })), ceo: { ...this.ceo }, handoffs: this.handoffs.map((h) => ({ ...h })) };
  }
}

/** 空快照（首帧 / 无成员）。 */
export function emptySnapshot(size = 0): DirectorSnapshot {
  return {
    poses: Array.from({ length: size }, () => ({ kind: "absent" as const, hold: 9999, label: "未开工", variant: 0 })),
    ceo: { kind: "work", hold: 6, label: "统筹中", variant: 0 },
    handoffs: [],
  };
}

/** 交接卡片在两人之间飞行的弧线路径（供 SVG animateMotion 用）。 */
export function handoffArc(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const lift = Math.min(from.y, to.y) - 74;
  const cx = from.x + (to.x - from.x) * 0.5;
  return `M ${from.x} ${from.y} C ${cx} ${lift}, ${cx} ${lift}, ${to.x} ${to.y}`;
}
