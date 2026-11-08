/**
 * 群视图的纯工具（11-07 从 `04-team-group-view` 拆出，守住 >1000 行棘轮）。
 * ⛔ 这里只放**无 React 依赖**的纯函数：时间格式、短 id、@ 候选表。
 *   ⛔ 与渲染无关的东西别往这儿堆（视图组件仍在 04）。
 */

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
