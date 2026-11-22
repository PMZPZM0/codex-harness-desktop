/**
 * 群视图的纯工具（11-07 从 `04-team-group-view` 拆出，守住 >1000 行棘轮）。
 * ⛔ 这里只放**无 React 依赖**的纯函数：时间格式、短 id、@ 候选表。
 *   ⛔ 与渲染无关的东西别往这儿堆（视图组件仍在 04）。
 */
import { parseTeamAuthorId, teamAuthorIdOf, teamMemberIdOf } from "../../lib/team-models.mjs";
import type { TeamMember } from "./01-team-types";

export type TeamCatalogEntry = {
  kind: string;
  key: string;
  memberId?: string;
  name: string;
  profession?: string;
  teamId?: string;
};

/**
 * 专家团身份解析：成员栏、消息头像和资料卡共用同一份主理人 / 团成员口径。
 * ⛔ 合成 id 只在这里还原，别让各渲染分支各拼一套。
 */
export function createTeamIdentityHelpers(
  members: readonly TeamMember[],
  catalog: readonly TeamCatalogEntry[],
  avatars: Record<string, string> | undefined,
) {
  const leadOf = (member: TeamMember) => {
    if (member?.targetKind !== "team") return null;
    return catalog.find((entry) => entry.kind === "expert" && entry.teamId === member.targetKey) ?? null;
  };

  const kidsOf = (member: TeamMember) => {
    if (member?.targetKind !== "team") return [];
    const teamId = String(member.targetKey ?? "");
    if (!teamId) return [];
    const seen = new Set<string>();
    return catalog
      .filter((entry) => entry.kind === "member" && entry.teamId === teamId)
      .filter((entry) => (seen.has(entry.key) ? false : (seen.add(entry.key), true)));
  };

  const professionOf = (member: TeamMember) => {
    if (member.targetKind === "team") return String(leadOf(member)?.profession || member.targetProfession || "").trim();
    const targetKey = String(member.targetKey ?? "");
    const bound = member.targetKind === "expert"
      ? catalog.find((entry) => entry.kind === "expert"
        && (entry.key === targetKey || entry.teamId === targetKey || teamMemberIdOf(entry) === targetKey))
      : member.targetKind === "member"
        ? catalog.find((entry) => entry.kind === "member"
          && (entry.key === targetKey || teamMemberIdOf(entry) === targetKey))
        : null;
    return String(bound?.profession || member.targetProfession || "").trim();
  };

  const leadFaceOf = (member: TeamMember): TeamMember => {
    const lead = leadOf(member);
    if (!lead) return member;
    const override = String(avatars?.[teamAuthorIdOf(String(member.targetKey ?? ""), teamMemberIdOf(lead))] ?? "").trim();
    return { ...member, targetKind: "expert" as const, targetKey: lead.key, avatar: String(member.avatar ?? "").trim() || override };
  };

  const profileMemberOf = (id: string): TeamMember | null => {
    const direct = members.find((member) => member.id === id);
    if (direct) return direct;
    const teamAuthor = parseTeamAuthorId(id);
    if (!teamAuthor) return null;
    const slot = members.find((member) => member.targetKind === "team" && String(member.targetKey ?? "") === teamAuthor.teamId);
    if (!slot) return null;
    const entry = catalog.find((candidate) => (candidate.kind === "member" || candidate.kind === "expert")
      && candidate.teamId === teamAuthor.teamId
      && (teamMemberIdOf(candidate) === teamAuthor.memberId || candidate.key === teamAuthor.memberId));
    if (!entry) return null;
    const memberKind = entry.kind === "member" ? "member" : "expert";
    return {
      ...slot,
      id,
      name: entry.name,
      targetKind: memberKind,
      targetKey: memberKind === "member" ? teamMemberIdOf(entry) : entry.key,
      targetProfession: String(entry.profession ?? (memberKind === "member" ? "团成员" : "")),
      avatar: avatars?.[id] ?? "",
    };
  };

  return { leadOf, kidsOf, professionOf, leadFaceOf, profileMemberOf };
}

/** 时间 HH:mm（群消息 meta 那一行用）。 */
export function fmtTime(at: number): string {
  if (!at) return "";
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 会话 id 短显示（点击仍用完整 id：来源标记只负责"看得出是哪条"）。 */
export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…` : id;
}

/**
 * 正文 @ 解析用的候选表：群成员（含群主）+ 每个团的成员（合成 id `team:<teamId>:<memberId>`）。
 * ⛔ 名字一律走调用方的 `nameOf`：群主是**用户中心的真名**，团成员取自调度目录 ——
 *   这里再写一套取名就会与消息署名对不上（用户明说"头像和用户名没跟用户中心同步"）。
 */
type MemberLike = { id: string; kind?: string; name?: string; targetKind?: string; targetKey?: string };

/** 生成 @ 候选表：先列群成员本人，再按团展开其成员（id 走 `authorIdOf` 合成）；名字一律由调用方的 `nameOf` 给。 */
export function buildMentionCandidates<M extends MemberLike>(
  members: ReadonlyArray<M>,
  nameOf: (member: M) => string,
  kidsOf: (member: M) => Array<{ name: string; key?: string; memberId?: string } & Record<string, unknown>>,
  authorIdOf: (teamId: string, memberId: string) => string,
  memberIdOf: (kid: Record<string, unknown>) => string,
): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (const m of members) out.push({ id: m.id, name: nameOf(m) });
  for (const m of members) {
    const teamId = String(m.targetKey ?? "");
    if (!teamId || m.targetKind !== "team") continue;
    for (const kid of kidsOf(m)) out.push({ id: authorIdOf(teamId, memberIdOf(kid as Record<string, unknown>)), name: kid.name });
  }
  return out;
}
