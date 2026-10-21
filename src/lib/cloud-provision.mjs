/**
 * 云账号「登录即用」编排（10-22）—— 登录页与设置页**共用同一套顺序**。
 *
 * 用户令：「设置云账号界面功能流程太复杂，用户登录起步自动配置好，新手登录即用，保留手动流程」。
 * 这里只做**编排**，每一步仍走既有主进程通道（单一真相源）：
 *   ① 模型：cloud-models:sync（落盘云供应商 + 代理令牌）
 *   ② 知识库：cloud-kb:sync → kb:backend-set(cloud)（连接器 + 后端一起切，缺一不可）
 *   ③ 记忆：cloud-memory:sync → memory:backend:set(cloud)（未开通/未生效时只报告、不硬切）
 *   ④ 生效位：cloud-models:activate（**只在没有别的供应商 / 已是云端**时；会重启引擎，放最后）
 *
 * ⛔ 不抢生效位：`onlyIfEmpty` 默认 true —— 已有别家供应商就保持原样，只回报「云端已就绪、未生效」。
 * ⛔ 不强制重签：force 重签会把另外两台设备的令牌挤出 3 枚令牌环（服务端硬约束），
 *    令牌失效的 401 自愈由 `cloud-models:sync` 内部处理。
 * ⛔ 网络抖动 ≠ 未开通：知识库/记忆同步失败只记 failed，不改已有落盘配置（主进程同口径）。
 */

const STEP_TIMEOUT_MS = 15_000;

/** 单步超时：服务端不可达时别把登录/设置页卡死（CloudFetch 本身无超时）。 */
function withTimeout(promise, ms = STEP_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/** @typedef {"ok"|"skipped"|"failed"|"needs-action"} ProvisionState */
/** @typedef {{ id: string, state: ProvisionState, detail: string }} ProvisionStep */

export function emptyProvisionReport() {
  return {
    ok: false,
    code: "",
    steps: /** @type {ProvisionStep[]} */ ([]),
    models: null,
    kb: null,
    memory: null,
    activated: false,
    activeModel: "",
  };
}

/**
 * @param {any} api window.codex（老构建缺通道时按缺省跳过，不崩）
 * @param {{ activate?: boolean, onlyIfEmpty?: boolean, restartIfActive?: boolean }} [options]
 */
export async function provisionCloud(api, options = {}) {
  const report = emptyProvisionReport();
  const activate = options.activate !== false;
  const onlyIfEmpty = options.onlyIfEmpty !== false;
  const restartIfActive = options.restartIfActive === true;
  const push = (id, state, detail) => report.steps.push({ id, state, detail });

  const status = await api.cloudAuthStatus?.().catch(() => null);
  if (!status?.loggedIn) {
    report.code = "not-logged-in";
    push("auth", "failed", "未登录云账号");
    return report;
  }
  push("auth", "ok", status.active?.username || "已登录");

  /* ── ① 模型目录 + 代理令牌 ── */
  let sync = null;
  try {
    sync = await withTimeout(api.cloudModelsSync?.({ force: false }) ?? Promise.resolve(null));
  } catch (error) {
    sync = { ok: false, models: 0, error: String(error?.message ?? error) };
  }
  report.models = { ok: Boolean(sync?.ok), count: Number(sync?.models || 0), error: sync?.error || "" };
  if (!report.models.ok) {
    push("models", "failed", report.models.error || "模型同步失败");
    report.code = report.models.error || "models-failed";
    return report;
  }
  if (report.models.count <= 0) {
    push("models", "needs-action", "云端还没有勾选任何模型（去用户中心勾选后点一键同步）");
    report.code = "no-models";
    return report;
  }
  push("models", "ok", `${report.models.count} 个模型已同步`);

  /* ── ② 云端知识库：连接器 + 后端同时切（只切一个 = 工具面到不了） ── */
  let kbReply = null;
  try {
    kbReply = await withTimeout(api.cloudKbSync?.() ?? Promise.resolve(null));
  } catch (error) {
    kbReply = { ok: false, error: String(error?.message ?? error) };
  }
  if (kbReply?.ok) {
    let backend = null;
    try {
      backend = await api.kbBackendSet?.("cloud");
    } catch { /* 设置失败按“未接通”回报，不挡登录 */ }
    report.kb = { ok: true, state: "ok", detail: "云端知识库已接通" };
    push("kb", "ok", backend?.connector?.applied === false ? "连接器已连通（工具面待重启）" : "云端知识库已接通");
  } else {
    const reason = String(kbReply?.error || "");
    const notActivated = reason === "not-activated";
    report.kb = {
      ok: false,
      state: notActivated ? "skipped" : "failed",
      detail: notActivated ? "未开通云端知识库（用户中心开通后自动生效）" : reason || "知识库接通失败",
    };
    push("kb", notActivated ? "skipped" : "failed", report.kb.detail);
  }

  /* ── ③ 云端记忆：未开通/未生效时只报告，不硬切（memory:backend:set 也会二次拒绝） ── */
  let memReply = null;
  try {
    memReply = await withTimeout(api.cloudMemorySync?.() ?? Promise.resolve(null));
  } catch (error) {
    memReply = { ok: false, error: String(error?.message ?? error) };
  }
  const activation = memReply?.activation;
  if (activation?.entitled && activation?.applied) {
    let backend = null;
    try {
      backend = await api.setMemoryBackend?.("cloud");
    } catch { /* 同上 */ }
    if (backend?.refused) {
      report.memory = { ok: false, state: "failed", detail: `记忆未接通（${backend.refused}）` };
      push("memory", "failed", report.memory.detail);
    } else {
      report.memory = { ok: true, state: "ok", detail: "云端记忆已接通" };
      push("memory", "ok", "云端记忆已接通");
    }
  } else {
    report.memory = {
      ok: false,
      state: activation?.reason === "unreachable" ? "failed" : "skipped",
      detail: activation?.reasonText || (activation?.reason === "unreachable" ? "记忆服务暂时不可达" : "未开通云端记忆（用户中心开通后自动生效）"),
    };
    push("memory", report.memory.state, report.memory.detail);
  }

  /* ── ④ 生效位：只在「没有别家供应商 / 已是云端」时切；重启引擎放最后一步 ── */
  if (activate) {
    let modelStatus = null;
    try {
      modelStatus = await api.cloudModelsStatus?.();
    } catch { /* 读不到按未生效处理 */ }
    const current = await api.getCustomModel?.().catch(() => null);
    const cloudActive = Boolean(modelStatus?.active) || current?.provider === "cloud";
    if (cloudActive && !restartIfActive) {
      report.activated = true;
      report.activeModel = current?.model || "";
      push("model-active", "ok", "云端模型当前生效");
    } else if (!cloudActive && onlyIfEmpty && current && current.provider !== "cloud") {
      push("model-active", "skipped", "本机已有其他供应商，保持原样（需要时可一键切换）");
      report.code = report.code || "other-provider";
    } else {
      try {
        const act = await api.cloudModelsActivate?.();
        if (act?.ok) {
          report.activated = true;
          report.activeModel = String(act.model || "");
          push("model-active", "ok", `云端模型已生效${act.model ? `（${act.model}）` : ""}`);
        } else {
          push("model-active", "failed", String(act?.error || "切换云端模型失败"));
          report.code = report.code || "activate-failed";
        }
      } catch (error) {
        push("model-active", "failed", String(error?.message ?? error));
        report.code = report.code || "activate-failed";
      }
    }
  }

  report.ok = Boolean(report.models?.ok && report.models.count > 0);
  return report;
}

/** 一步中文摘要（设置页「一键同步」回执 / 登录页提示共用）。 */
export function provisionSummary(report) {
  if (!report) return "";
  if (report.code === "not-logged-in") return "未登录云账号";
  const ok = report.steps.filter((s) => s.state === "ok").map((s) => s.detail);
  const skipped = report.steps.filter((s) => s.state === "skipped").map((s) => s.detail);
  const failed = report.steps.filter((s) => s.state === "failed" || s.state === "needs-action").map((s) => s.detail);
  const parts = [];
  if (ok.length) parts.push(`已就绪：${ok.join(" · ")}`);
  if (skipped.length) parts.push(`跳过：${skipped.join(" · ")}`);
  if (failed.length) parts.push(`需处理：${failed.join(" · ")}`);
  return parts.join("；");
}
