/**
 * 团队模式 · 群定时任务（纯函数，11-06）
 *
 * 两份逆向报告里的对应物：
 *   · 豆包 §③「自动化定时任务」：定时把一句话交给某个伙伴，**prompt 里写死收件人**；
 *   · 飞书 §3 机器人菜单的 `TriggerMenuEvent`：人点了才触发（那是**有人值守**）。
 *   我们的做法把两者合起来：菜单是有人值守的模板；定时任务是无人值守的模板。
 *
 * 落点：到点 ⇒ 走与 `@伙伴` 完全相同的派活链路（真实子会话 + 群消息 + 账本 `source=automation`）。
 * ⛔ 这里**不算下次运行时刻**：RRULE 构造/相位守恒/补跑窗口的唯一真相源是
 *   `electron/scheduler.ts`（`computeNextRunAt` / `buildRRuleFromInput`）——
 *   主进程算完把 `nextRunAt` 写回条目，渲染层只负责显示。⛔ 别在渲染层再写一套调度算术。
 * ⛔ 纯函数：不读盘、不碰 React、不看时钟（`now` 一律由调用方传入）。
 */

/** 一个群最多挂几个定时任务（再多就不是"群里的闹钟"而是调度平台了）。 */
export const MAX_GROUP_SCHEDULES = 8;

/** 定时任务那句话的长度上限（与菜单 prompt 同量级）。 */
export const MAX_SCHEDULE_PROMPT_CHARS = 800;

/** 任务名长度上限（列表里一行要看得下）。 */
export const MAX_SCHEDULE_NAME_CHARS = 20;

/** 一个任务最多派给几个伙伴。 */
export const MAX_SCHEDULE_TARGETS = 4;

/**
 * 频率类型：⛔ 与 `electron/scheduler.ts` 的 `ScheduleKind` 同名同义（interval/daily/weekly/once）。
 * 只开放这四种：月/年在这个场景里没人用，多一个选项就多一组算错的概率。
 */
export const SCHEDULE_KINDS = Object.freeze(["interval", "daily", "weekly", "once"]);

export const SCHEDULE_KIND_LABELS = Object.freeze({
  interval: "每小时",
  daily: "每天",
  weekly: "每周",
  once: "一次性",
});

/** 星期标签（0 = 周日，与 `Date#getDay()` / `buildRRuleFromInput` 的 weekdays 一致）。 */
export const WEEKDAY_LABELS = Object.freeze(["周日", "周一", "周二", "周三", "周四", "周五", "周六"]);

/** `HH:mm` 归一化：非法一律回 09:00（⛔ 不抛：坏数据不该让整页设置打不开）。 */
export function normalizeTimeOfDay(value) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(value ?? "").trim());
  if (!m) return "09:00";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return "09:00";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const unique = (list) => list.filter((x, i, arr) => arr.indexOf(x) === i);

/**
 * 一条定时任务归一化。
 * ⛔ `id` 与 `prompt` 缺一即无效（⛔ 不替调用方生成 id：纯函数里没有可靠时钟/随机源）。
 * ⛔ `nextRunAt` 只接受主进程写回的值；渲染层提交上来的值**原样保留**只是为了编辑时不被抹掉，
 *   真正的重算发生在主进程 `set-schedule`。
 */
export function normalizeScheduleEntry(entry) {
  const id = String(entry?.id ?? "").trim();
  /* ⛔ 清掉开发标记（`⛔` 是代码里的记号，落到用户的定时指令里就是乱入的红圈） */
  const prompt = String(entry?.prompt ?? "").replace(/⛔\s*/g, "").trim().slice(0, MAX_SCHEDULE_PROMPT_CHARS);
  if (!id || !prompt) return null;
  const kind = SCHEDULE_KINDS.includes(String(entry?.kind ?? "")) ? String(entry.kind) : "daily";
  const weekdays = unique(
    (Array.isArray(entry?.weekdays) ? entry.weekdays : [1])
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
  ).sort((a, b) => a - b).slice(0, 7);
  const memberIds = unique(
    (Array.isArray(entry?.memberIds) ? entry.memberIds : []).map((x) => String(x ?? "").trim()).filter(Boolean),
  ).slice(0, MAX_SCHEDULE_TARGETS);
  const name = String(entry?.name ?? "").trim().slice(0, MAX_SCHEDULE_NAME_CHARS) || prompt.slice(0, MAX_SCHEDULE_NAME_CHARS);
  const next = Number(entry?.nextRunAt);
  const last = Number(entry?.lastRunAt);
  return {
    id,
    name,
    prompt,
    memberIds,
    kind,
    timeOfDay: normalizeTimeOfDay(entry?.timeOfDay),
    weekdays: kind === "weekly" ? (weekdays.length ? weekdays : [1]) : [],
    scheduleType: kind === "once" ? "once" : "recurring",
    /* 一次性任务的时刻（ISO 本地字符串 `YYYY-MM-DDTHH:mm`，与 scheduler 的 scheduledAt 同口径） */
    scheduledAt: kind === "once" ? String(entry?.scheduledAt ?? "").trim() : "",
    enabled: entry?.enabled !== false,
    nextRunAt: Number.isFinite(next) && next > 0 ? Math.round(next) : null,
    lastRunAt: Number.isFinite(last) && last > 0 ? last : undefined,
    lastError: String(entry?.lastError ?? "").trim().slice(0, 300) || undefined,
    createdAt: Number(entry?.createdAt ?? 0) || 0,
  };
}

/** 整份列表归一化：下拉里坏条目丢掉、id 去重、超上限截断。 */
export function normalizeSchedules(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const entry = normalizeScheduleEntry(raw);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
    if (out.length >= MAX_GROUP_SCHEDULES) break;
  }
  return out;
}

/**
 * 新增或更新一条（按 id）。
 * ⛔ 同一 id 的 `createdAt/lastRunAt` 沿用旧值：编辑频率不该让"上次跑过"这件事失忆
 *   （否则补跑窗口/熔断都从零开始，会重复补跑）。
 */
export function upsertSchedule(list, entry, now = 0) {
  const base = normalizeSchedules(list);
  const next = normalizeScheduleEntry(entry);
  if (!next) return base;
  const idx = base.findIndex((x) => x.id === next.id);
  if (idx < 0) {
    if (base.length >= MAX_GROUP_SCHEDULES) return base; // 上限由 UI 提示，这里不静默替换别人
    return [...base, { ...next, createdAt: next.createdAt || Number(now) || 0 }];
  }
  const old = base[idx];
  const merged = {
    ...next,
    createdAt: old.createdAt || next.createdAt,
    lastRunAt: next.lastRunAt ?? old.lastRunAt,
    lastError: next.lastError ?? old.lastError,
    /* 调度口径没变就沿用旧的下次时刻（⛔ 每次保存都重算 = 用户改个名字就把这一轮推掉）；
       口径变了 ⇒ 清成 null 交给主进程重算（⛔ 别把渲染层带上来的旧时刻当成新口径的答案）。 */
    nextRunAt: sameCadence(old, next) ? (next.nextRunAt ?? old.nextRunAt) : null,
  };
  const copy = [...base];
  copy[idx] = merged;
  return copy;
}

/** 两条任务的"调度口径"是否一致（频率/时间/星期/一次性时刻）。 */
export function sameCadence(a, b) {
  return String(a?.kind ?? "") === String(b?.kind ?? "")
    && String(a?.timeOfDay ?? "") === String(b?.timeOfDay ?? "")
    && String(a?.scheduledAt ?? "") === String(b?.scheduledAt ?? "")
    && JSON.stringify(a?.weekdays ?? []) === JSON.stringify(b?.weekdays ?? []);
}

export function removeSchedule(list, id) {
  const k = String(id ?? "");
  return normalizeSchedules(list).filter((x) => x.id !== k);
}

export function toggleSchedule(list, id, enabled) {
  const k = String(id ?? "");
  return normalizeSchedules(list).map((x) => (x.id === k ? { ...x, enabled: Boolean(enabled) } : x));
}

/**
 * 这条任务派不出去的原因（⛔ 返回文案数组，不是布尔 —— 界面要能直接显示）。
 * ⛔ 与手动派活的闸同口径：静音 / 未绑定 / 需要团队许可（member|team）。
 */
export function scheduleBlockers(group, entry) {
  const members = Array.isArray(group?.members) ? group.members : [];
  const ids = Array.isArray(entry?.memberIds) ? entry.memberIds : [];
  const picked = members.filter((m) => m.kind === "bot" && ids.includes(m.id));
  if (!picked.length) return ["还没选派给谁"];
  const out = [];
  const muted = picked.filter((m) => m.muted);
  if (muted.length === picked.length) out.push(`「${muted.map((m) => m.name).join("、")}」已静音，到点也不会跑`);
  const unbound = picked.filter((m) => !m.targetKind || !m.targetKey);
  if (unbound.length) out.push(`「${unbound.map((m) => m.name).join("、")}」没绑定智能体，到点派不出去`);
  const gated = picked.filter((m) => m.targetKind === "member" || m.targetKind === "team");
  if (gated.length) out.push(`「${gated.map((m) => m.name).join("、")}」需要「专家团」许可，应用目前没有这个开关`);
  if (entry?.kind === "once" && !String(entry?.scheduledAt ?? "").trim()) out.push("一次性任务还没设时间");
  return out;
}

/** 人话描述（列表与群头都用这一份，⛔ 别两处各写一套）。 */
export function describeSchedule(entry) {
  const kind = String(entry?.kind ?? "daily");
  const time = normalizeTimeOfDay(entry?.timeOfDay);
  if (kind === "interval") return "每小时";
  if (kind === "weekly") {
    const days = (Array.isArray(entry?.weekdays) && entry.weekdays.length ? entry.weekdays : [1])
      .map((d) => WEEKDAY_LABELS[Number(d) % 7] ?? "")
      .filter(Boolean);
    return `每${days.join("、")} ${time}`;
  }
  if (kind === "once") {
    const at = String(entry?.scheduledAt ?? "");
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
    return m ? `一次性 · ${m[2]}-${m[3]} ${m[4]}:${m[5]}` : "一次性 · 时间未设";
  }
  return `每天 ${time}`;
}

/**
 * 下次运行的人话时刻（"今天 09:00 / 明天 09:00 / 11-08 09:00 / 已停用"）。
 * ⛔ `ts` 必须来自主进程（`nextRunAt`），这里不做任何推算。
 */
export function formatNextRun(ts, now = 0) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const d = new Date(n);
  const cur = new Date(Number(now) || Date.now());
  const hh = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(d) - startOf(cur)) / 86_400_000);
  if (dayDiff === 0) return `今天 ${hh}`;
  if (dayDiff === 1) return `明天 ${hh}`;
  if (dayDiff === -1) return `昨天 ${hh}`;
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${hh}`;
}
