// src/lib/thread-runtime.mjs —— 「会话运行时配置」的单一存放处（纯函数，零依赖）
//
// 为什么写它（09-14，参考 ZCode 逆向报告后的收敛）：
//   ZCode 里模型/思考等级/权限是**会话状态对象的字段**——切换会话 = 切到另一个状态对象，
//   只有一个存放处，所以不存在「切换后要对账」「两个存放处分叉」这类问题。我们这边是
//   `thread-model-<id>` / `thread-effort-<id>` / `thread-permissions-<id>` 三套键族分开读写，
//   约 20 处写、15 处读，散在 chooseModel / openThread / applyGlobalModelChoice / 权限切换 /
//   fork / 迁移 / 兜底 effect 等十来个函数里——正是「档案与会话记录分叉」「兜底 effect
//   冲掉用户刚选的模型」这类坑的温床。
//
// 收敛后的形态：
//   `thread-runtime-<id> = { model, effort, sandbox, approval, rev }` —— **一个对象，一次读、
//   一次写、一个校验点**。新增会话级字段（子代理默认模型等）不必再加第四个键族。
//
// 兼容策略（重要）：
//   · 读：新键优先；没有新键时**从旧三键族迁移**并回写一次，之后旧键不再参与判定。
//   · 写：写新键 + 派生镜像到旧键（给已发布的旧版本/降级场景读），镜像是**派生值，
//     永远不具权威性**——只要新键在，旧键一律忽略。
//   · 旧键的镜像写只是向下兼容，不是「三处存放」的复活：任何读取路径都不再从旧键取值。
//
// ⛔ 写入时机的规矩（比键的数量更重要，09-14 立，**新写代码一律遵守**）：只有**明确的用户动作**
//    才落盘；effect / 对账逻辑一律只改内存。合并成一个对象但后台 effect 仍然落盘，照样会踩
//    （历史教训：`allModels` 兜底 effect 曾把用户刚选的模型冲掉）。
//    既有的「旧会话种子烙印 / 打开会话时补记录」是 09-13 的历史决策（防止全局默认把老会话
//    冲掉），本轮不动它们的时机，但它们的落点也已经统一到这个对象。

/** 新单一存放处的键前缀 */
export const RUNTIME_PREFIX = "thread-runtime-";
/** 被取代的三套旧键族（只作镜像，不再参与读取判定） */
export const LEGACY_PREFIX = { model: "thread-model-", effort: "thread-effort-", permissions: "thread-permissions-" };

/** @param {string} threadId @returns {string} */
export function runtimeKey(threadId) {
  return `${RUNTIME_PREFIX}${String(threadId ?? "")}`;
}

/** 空运行时（字段恒在，避免各处 `?? ""`） */
export function emptyRuntime() {
  return { model: "", effort: "", sandbox: "", approval: "", rev: 0 };
}

const str = (v) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

/** 归一化任意输入（坏 JSON / 缺字段 / 字段类型不对）→ 完整对象
 *  @param {unknown} raw @returns {{model:string, effort:string, sandbox:string, approval:string, rev:number}} */
export function normalizeRuntime(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const rev = Number(src.rev);
  return {
    model: str(src.model),
    effort: str(src.effort),
    sandbox: str(src.sandbox),
    approval: str(src.approval),
    rev: Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 0,
  };
}

/**
 * 迁移：新对象优先，缺失字段由旧三键族补齐。
 * @param {{ runtime?: unknown, model?: unknown, effort?: unknown, permissions?: unknown }} input
 *   - `runtime`：新键里已存的对象（可能不存在/坏 JSON）
 *   - `model` / `effort`：旧键里裸字符串
 *   - `permissions`：旧键里的 `{sandbox, approval}` 对象（也可能已经是 JSON 字符串）
 * @returns 完整运行时对象
 */
export function migrateRuntime(input) {
  const base = normalizeRuntime(input?.runtime);
  const perms = (() => {
    const p = input?.permissions;
    const obj = typeof p === "string" ? (() => { try { return JSON.parse(p); } catch { return {}; } })() : p;
    return obj && typeof obj === "object" ? obj : {};
  })();
  return {
    // 新键已有的值永远优先；新键没有的才从旧键补（旧键只在这个时候说话）
    model: base.model || str(input?.model),
    effort: base.effort || str(input?.effort),
    sandbox: base.sandbox || str(perms.sandbox),
    approval: base.approval || str(perms.approval),
    rev: base.rev,
  };
}

/**
 * 打补丁：只覆盖**非空**的传入字段（空串/undefined 不抹掉已有值——等价旧 helper 的
 * 「空值直接 return」，防止对账逻辑把用户的选择清成空）。
 * @returns {{ runtime: object, changed: boolean }} changed=false 时调用方可以不落盘
 */
export function patchRuntime(current, patch) {
  const base = normalizeRuntime(current);
  const src = patch && typeof patch === "object" ? patch : {};
  const next = { ...base };
  for (const key of ["model", "effort", "sandbox", "approval"]) {
    const value = str(src[key]);
    if (value) next[key] = value;
  }
  const changed = ["model", "effort", "sandbox", "approval"].some((k) => next[k] !== base[k]);
  if (!changed) return { runtime: base, changed: false };
  return { runtime: { ...next, rev: base.rev + 1 }, changed: true };
}

/** 签名：用于「这次改了没有 / 要不要重新下发给引擎」的去重判据 */
export function runtimeSignature(runtime) {
  const r = normalizeRuntime(runtime);
  return [r.model, r.effort, r.sandbox, r.approval].join("|");
}

/** 回声表的 TTL：主进程广播几毫秒内就到，5 秒足够宽松，又不会把「几秒后另一个窗口恰好
 *  改成同样值」这种真事件误判成回声（真事件本来就是同值，不提示也无害）。 */
export const OWN_WRITE_TTL_MS = 5000;

/** 记下「本窗口刚写出去的这份运行时」——用于认领主进程广播回来的自己的回声。
 *  ⛔ 每个会话**只保留最近一次**写入：一次用户动作可能连写多次（切模型会先写档位、再写模型），
 *  中间态不算「自己的回声」——否则另一个窗口恰好把值改回那个中间态时，会被误判成回声而
 *  静默吞掉（实测：② 断言就是这么假红的）。也不吃内存：每会话一条，另外顺手清理过期项。
 *  @param {Map<string, { signature: string, at: number }>} store 调用方持有的回声表
 *  @param {number} now 当前时间戳（显式传入，便于纯函数测试） */
export function rememberOwnWrite(store, threadId, runtime, now = Date.now()) {
  if (!store || !threadId) return store;
  store.set(String(threadId), { signature: runtimeSignature(runtime), at: now });
  if (store.size > 256) {
    for (const [key, entry] of store) if (now - entry.at > OWN_WRITE_TTL_MS) store.delete(key);
  }
  return store;
}

/** 这份运行时是不是「本窗口刚写出去、又被主进程原样广播回来」的那一份？
 *  ⛔ 为什么必须有这一层：主进程把变更广播给**所有**窗口（含写入者自己），而广播可能在
 *  React 提交 state 之前到达——那一刻界面的取值还是旧的，会被误判成「另一个窗口改了」，
 *  于是用户自己切个模型就弹「另一个窗口更新了…」（09-14 用户实测的误报）。
 *  判据只用四项取值的签名：rev 是主进程的计数器，不参与判定。
 *  @param {Map<string, number>} store 回声表
 *  @param {number} now 当前时间戳 */
export function isOwnEcho(store, threadId, runtime, now = Date.now()) {
  if (!store || !threadId) return false;
  const entry = store.get(String(threadId));
  if (!entry || typeof entry.at !== "number") return false;
  return now - entry.at < OWN_WRITE_TTL_MS && entry.signature === runtimeSignature(runtime);
}

/** 派生旧三键族的镜像值（只用于向下兼容写入；**读取路径禁止用它**）
 *  @returns {{ model: string, effort: string, permissions: string }} permissions 是 JSON 字符串 */
export function legacyMirror(runtime) {
  const r = normalizeRuntime(runtime);
  return {
    model: r.model,
    effort: r.effort,
    permissions: JSON.stringify({ sandbox: r.sandbox, approval: r.approval }),
  };
}
