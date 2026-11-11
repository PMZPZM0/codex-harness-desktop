/**
 * 群记忆注入块（把「群类型 + 座位」翻译成一段真正能塞进提示词的文本）。
 *
 * 分工：
 *   · `group-memory-policy.ts` 定规矩（纯函数：读什么域、写不写得了、怎么渲染）
 *   · 本文件负责取数（读 atoms → 按策略筛域 → 打分召回 → 渲染）
 *   · 调用方（群聊投递 / 委派）只拿到一段字符串，⛔ 不自己再判一次群类型
 *
 * ⛔ 所有失败都降级成 `null`（调用方当作"这个群没有记忆"），绝不许因为记忆读挂而让群聊发不出话。
 */

import {
  budgetOf, groupKindOf, policyOf, renderPlainForCli,
  type GroupKind, type GroupMemoryPolicy, type GroupSeat,
} from "./group-memory-policy";
import { isInjectable, type AtomScope } from "./atoms-format";
import { readAtoms, readUsage } from "./atoms-store";
import { selectAtoms } from "./atoms-select";

/** 只要求最小的形状，⛔ 不 import 群聊域的类型（跨域耦合）。 */
export type GroupLike = {
  /** 群 id —— 会话级记忆按它隔离（⛔ 没有它就会把别的群的记忆注入进来）。 */
  id?: string;
  name?: string;
  members?: Array<{ id?: string; kind?: string; name?: string; targetKind?: string; targetKey?: string; muted?: boolean }>;
};

export type GroupMemoryInput = {
  workspace?: string;
  group: GroupLike;
  /** 当前说话的人在群里的座位（由调用方按群档案判定）。 */
  seat: GroupSeat;
  /** 本轮任务文本（用于召回）。 */
  query?: string;
  /** 注入时刻（测试可传）。 */
  now?: number;
};

export type GroupMemoryBlock = {
  text: string;
  policy: GroupMemoryPolicy;
  kind: GroupKind;
  /** 实际召回的条目 id（调试 / 审计用）。 */
  recalled: string[];
  /** 命的域与条数（界面能显示"这次注入了什么"）。 */
  used: Array<{ scope: AtomScope; count: number }>;
};

/** 群类型判定：团槽 > 纯 CLI > 多专家 > 普通。⛔ 与 policy 侧同一实现，不另写。 */
export function groupKindFor(group: GroupLike): GroupKind {
  const members = Array.isArray(group?.members) ? group.members : [];
  const hasTeam = members.some((m) => m?.targetKind === "team");
  const hasCli = members.some((m) => m?.targetKind === "cli");
  const expertCount = members.filter((m) => m?.targetKind === "expert").length;
  return groupKindOf({ hasTeam, hasCli, expertCount });
}

/**
 * 生成注入块。没有工作区 / 没有条目 ⇒ 返回 null（调用方不追加任何东西）。
 */
export async function buildGroupMemoryBlock(input: GroupMemoryInput): Promise<GroupMemoryBlock | null> {
  try {
    const workspace = String(input?.workspace ?? "").trim();
    if (!workspace) return null;
    const kind = groupKindFor(input.group);
    const policy = policyOf(kind, input.seat);
    const { total, index, perBody } = budgetOf(policy);

    const { docs } = await readAtoms(workspace);
    const scopes = new Set(policy.inject.map((row) => row.scope));
    const groupId = String(input.group?.id ?? "");
    /* ⛔⛔ 11-10 用户令「记忆按群和会话每个独立一套」：
       · project / rule 域 = 工作区级，所有群共享（代码事实跨群有效）；
       · session 域 = **群级隔离**：带 group 的条目只在本群注入，别的群一条都看不到；
         不带 group 的当工作区级（迁移来的老条目走这条，不至于消失）。
       ⛔ 少了这层过滤，A 群的客户口径会被注入到 B 群 —— 比没有记忆更危险。 */
    const live = docs.filter((d) => {
      if (!isInjectable(d.meta, input.now)) return false;
      if (!scopes.has(d.meta.scope)) return false;
      if (d.meta.scope !== "session") return true;
      if (!d.meta.group) return true;
      return Boolean(groupId) && d.meta.group === groupId;
    });
    if (!live.length) return null;

    const usage = await readUsage(workspace);
    const picked = selectAtoms(live, {
      query: input.query ?? "",
      workspace,
      now: input.now,
      lastUsedAt: usage,
    }, {
      indexMaxChars: index,
      recallLimit: input.query && input.query.trim() ? policy.recallLimit : 0,
      bodyMaxChars: perBody,
    });

    const used: Array<{ scope: AtomScope; count: number }> = [];
    for (const row of policy.inject) {
      const count = live.filter((d) => d.meta.scope === row.scope).length;
      if (count) used.push({ scope: row.scope, count });
    }

    /* CLI 只吃纯文本：⛔ 不给 frontmatter、双链、文件路径（它会把那些当正文抄进回复）。 */
    if (policy.render === "plain") {
      const rows = picked.recalled.map((r) => ({ summary: r.meta.summary, body: r.body, flag: r.meta.confidence === "tentative" ? "待验证" : "" }));
      const head = `【本机项目记忆 · ${policy.label}】${policy.preamble}`;
      const body = rows.length ? renderPlainForCli(rows) : picked.indexText.replace(/^[-#].*$/gm, (m) => m);
      const text = `${head}\n${body}\n${policy.rules.map((r) => `· ${r}`).join("\n")}`;
      return {
        text: text.length > total ? `${text.slice(0, total).trimEnd()}\n（已按 ${policy.label} 预算截断）` : text,
        policy, kind, recalled: picked.recalled.map((r) => r.meta.id), used,
      };
    }

    const parts = [
      `【群记忆 · ${policy.label}】${policy.preamble}`,
      picked.indexText,
    ];
    if (picked.recalled.length) {
      const rows = picked.recalled.map((r) => {
        const flag = r.meta.confidence === "tentative" ? " · ⚠ 待验证，不当事实用" : "";
        return `### ${r.meta.id}（${r.meta.type}${flag}）\n${r.body}`;
      });
      parts.push(`#### 与本轮相关（${rows.length} 条）\n${rows.join("\n\n")}`);
    }
    if (picked.conflicts.length) {
      parts.push(`⚠ 下面几条互相矛盾，**先确认再采信**：\n${picked.conflicts.map(([a, b]) => `- ${a} ↔ ${b}`).join("\n")}`);
    }
    parts.push(`规则：\n${policy.rules.map((r) => `- ${r}`).join("\n")}`);
    const text = parts.join("\n\n");
    return {
      text: text.length > total ? `${text.slice(0, total).trimEnd()}\n（已按 ${policy.label} 预算截断）` : text,
      policy, kind, recalled: picked.recalled.map((r) => r.meta.id), used,
    };
  } catch {
    /* 记忆是旁路：读挂了当作没有，⛔ 不许把群聊带崩。 */
    return null;
  }
}
