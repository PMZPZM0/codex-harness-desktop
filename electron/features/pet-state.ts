/**
 * 桌面宠物 · 引擎事件 → 官方九态归约（主进程侧，纯映射）。
 *
 * 为什么单独成模块：宠物状态是**引擎事件流的派生物**，渲染层（浮窗）不该自己去订阅引擎事件
 * —— 浮窗是独立 BrowserWindow，拿不到主窗口那套 app 状态；让主进程做唯一归约点，
 * 浮窗只收「一个状态名 + 一句气泡」。这样：
 *   · 归约逻辑可以脱离 UI 单测（喂事件序列 → 断言状态）；
 *   · 浮窗关着时不产生任何渲染开销，主进程只维护一个对象。
 *
 * 九态来自官方 Codex 宠物规范（实测自引擎二进制 + petdex 公开文档，两者逐字吻合）：
 *   idle / running-right / running-left / waving / jumping / failed / waiting / running / review
 * ⛔ 语义映射是**我们定的**（官方只规定行名与行序，没规定什么事件对应哪一行），
 *    所以下面每条都写清依据；改映射要同步守卫【232】。
 */
import { engineActiveTurnIds } from "../runtime-refs";

export type PetStateName =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

/** 推给浮窗的载荷（⛔ 只传状态与文案，不传引擎原始事件 —— 免得浮窗拿到会话内容）。 */
export interface PetSignal {
  state: PetStateName;
  /** 气泡文案（空串 = 不显示气泡） */
  bubble: string;
  /** 当前在跑的回合数（渲染层可用于显示"并行 N 个任务"） */
  busy: number;
  /** 最近一次工具名（仅用于气泡文案派生，不外泄正文） */
  tool: string | null;
  /** 状态变更时间戳 */
  ts: number;
}

type Sink = (signal: PetSignal) => void;
let sink: Sink | null = null;

/** 浮窗创建时登记，销毁时清空 —— 归约模块不反向依赖窗口模块（避免循环依赖）。 */
export function setPetSignalSink(fn: Sink | null) {
  sink = fn;
  if (fn) {
    ensureClock();
    fn(store.signal);
  }
}

let current: PetStateName = "idle";
let bubble = "";
let tool: string | null = null;
/** 一次性状态（庆祝 / 失败）的保持截止时间；到点自动回落 idle。 */
let holdUntil = 0;
let holdFallback: PetStateName = "idle";
let clock: NodeJS.Timeout | null = null;

const store = {
  signal: { state: current, bubble, busy: 0, tool: null, ts: 0 } as PetSignal,
};

function publish(force = false) {
  const next: PetSignal = {
    state: current,
    bubble,
    busy: engineActiveTurnIds.size,
    tool,
    ts: Date.now(),
  };
  const changed =
    force ||
    next.state !== store.signal.state ||
    next.bubble !== store.signal.bubble ||
    next.busy !== store.signal.busy;
  store.signal = next;
  if (changed) sink?.(next);
}

/** 当前状态快照（浮窗首帧补水用：推送可能发生在窗口创建之前）。 */
export function petSignal(): PetSignal {
  return store.signal;
}

export function petStateName(): PetStateName {
  return current;
}

function setState(state: PetStateName, text = "") {
  current = state;
  bubble = text;
  holdUntil = 0;
  publish();
}

/** 一次性状态：保持 `holdMs` 后回落（庆祝/失败都是"闪一下"，不能永久停在那）。 */
function pulse(state: PetStateName, text: string, holdMs: number, fallback: PetStateName = "idle") {
  current = state;
  bubble = text;
  holdUntil = Date.now() + holdMs;
  holdFallback = fallback;
  publish();
}

/** 工具名 → 中文短句（气泡文案；⛔ 只出现工具/动作名，不出现文件内容或命令正文）。 */
function toolBubble(itemType: string, item: Record<string, unknown>): string {
  switch (itemType) {
    case "commandExecution": return "正在执行命令…";
    case "fileChange": return "正在改文件…";
    case "webSearch": return "正在联网找资料…";
    case "mcpToolCall":
    case "dynamicToolCall": return `正在用 ${String(item.tool ?? item.server ?? "工具").slice(0, 24)}`;
    default: return "干活中…";
  }
}

/** 工具类 item（都在"忙"这一层；官方九态里没有更细的粒度，统一映射 running）。 */
const TOOL_ITEM_TYPES = new Set(["commandExecution", "fileChange", "webSearch", "mcpToolCall", "dynamicToolCall"]);

/**
 * 喂一个引擎事件。返回是否改变了状态（便于测试断言）。
 *
 * 优先级（高 → 低）：需要用户操作(request) > 失败 > 庆祝/保持中 > 工具运行 > 正文输出 > 思考 > 空闲
 */
export function feedPetEvent(event: unknown): boolean {
  const before = `${current}|${bubble}`;
  const e = event as { kind?: string; method?: string; status?: string; params?: Record<string, any> } | null;
  if (!e || typeof e !== "object") return false;

  ensureClock();

  /* 引擎向宿主发起的**请求**（审批 / 提问等）：宠物是"举手等你" —— 这是唯一会打断当前状态的信号，
     因为它真的在等人，比其他一切都要紧。 */
  if (e.kind === "request") {
    setState("waving", "等你确认一下");
    return `${current}|${bubble}` !== before;
  }
  if (e.kind === "status") {
    if (e.status === "ready" && engineActiveTurnIds.size === 0 && Date.now() >= holdUntil && current !== "idle") {
      setState("idle");
    }
    return `${current}|${bubble}` !== before;
  }
  if (e.kind !== "notification") return false;

  const p = e.params ?? {};
  switch (e.method) {
    case "turn/started":
      setState("waiting", "正在想…");
      break;
    case "turn/completed":
      pulse("jumping", "搞定！", 1600);
      break;
    case "turn/failed":
      pulse("failed", "这轮出错了", 3200);
      break;
    case "turn/aborted":
    case "turn/interrupted":
      pulse("failed", "已中断", 2200);
      break;
    case "item/started": {
      const item = (p.item ?? {}) as Record<string, unknown>;
      const type = String(item.type ?? "");
      if (TOOL_ITEM_TYPES.has(type)) {
        tool = type === "mcpToolCall" || type === "dynamicToolCall" ? String(item.tool ?? "") || null : type;
        setState("running", toolBubble(type, item));
      } else if (type === "reasoning") {
        setState("waiting", "正在推演…");
      }
      break;
    }
    case "item/agentMessage/delta":
      // 正文在往外吐 = 模型在作答（用户在读）。保持"审查"态，但**不覆盖**等待用户确认。
      if (current !== "waving") setState("review", "");
      break;
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta":
      if (current !== "waving") setState("waiting", "正在推演…");
      break;
    default:
      return `${current}|${bubble}` !== before;
  }
  return `${current}|${bubble}` !== before;
}

/**
 * 低频时钟：只做两件事 —— ① 一次性状态到点回落；② 回合都结束了但状态还停在"忙"时兜回 idle。
 * 200ms 一跳，成本可忽略；⛔ 不做"空闲随机溜达"（那是渲染层的活，浮窗关着时不该有任何动画开销）。
 */
function ensureClock() {
  if (clock) return;
  clock = setInterval(() => {
    /* 没人听、也没有待回落的一次性状态 ⇒ 停表（宠物关着时不该有常驻定时器） */
    if (!sink && !holdUntil) {
      clearInterval(clock!);
      clock = null;
      return;
    }
    const now = Date.now();
    if (holdUntil && now >= holdUntil) {
      holdUntil = 0;
      const next = engineActiveTurnIds.size > 0 ? "running" : holdFallback;
      setState(next, engineActiveTurnIds.size > 0 ? "继续干活…" : "");
      return;
    }
    if (engineActiveTurnIds.size === 0 && (current === "running" || current === "review" || current === "waiting")) {
      setState("idle");
    }
  }, 200);
  // 时钟不该拖住进程退出
  clock.unref?.();
}

/** 仅供测试/诊断：重置到空闲（不对外暴露给 IPC）。 */
export function resetPetState() {
  current = "idle";
  bubble = "";
  tool = null;
  holdUntil = 0;
  publish(true);
}
