/**
 * 专家团资料卡身份回归（11-22 用户实测）：
 * 「点击团成员，出来都是上面主代理的个人信息」+「成员名字下面加专家身份」。
 *
 * 判据分两层：纯身份解析真跑，以及成员栏 / 资料卡确实接到同一份结果。
 * ⛔ 合成 id `team:<teamId>:<memberId>` 不能被当成团主理人。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTeamIdentityHelpers } from "../../src/features/harness-team/20-team-view-utils.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【team-profile-identity】${message}`);
  if (!condition) fails++;
};

const teamSlot = { id: "p-team", kind: "bot", name: "软件开发专家团", managerId: "", canDelegate: [], addedBy: "", muted: false, targetKind: "team", targetKey: "t1", targetProfession: "", avatar: "" };
const expertSlot = { ...teamSlot, id: "p-expert", name: "星象", targetKind: "expert", targetKey: "xingxiang", targetProfession: "视觉设计" };
const catalog = [
  { kind: "expert", key: "t1:lead", name: "承枢", profession: "交付总监", teamId: "t1" },
  { kind: "member", key: "m1", name: "洞明", profession: "逆向工程师", teamId: "t1" },
];
const helpers = createTeamIdentityHelpers([teamSlot, expertSlot], catalog, {
  "team:t1:lead": "preset:lead",
  "team:t1:m1": "preset:kid",
});
const kid = helpers.profileMemberOf("team:t1:m1");
ok(kid?.name === "洞明" && kid?.targetProfession === "逆向工程师" && kid?.avatar === "preset:kid",
  "合成团成员 id 还原成本人姓名 / 岗位 / 群内头像（⛔ 不落主理人）");
ok(helpers.professionOf(teamSlot) === "交付总监" && helpers.professionOf(expertSlot) === "视觉设计",
  "专家团显示主理人职业，普通专家回查目录职业");
ok(helpers.leadFaceOf(teamSlot).targetKey === "t1:lead" && helpers.kidsOf(teamSlot).length === 1,
  "团槽头像种子走主理人，团成员展开只取本团目录条目");
ok(helpers.leadFaceOf(teamSlot).avatar === "preset:lead",
  "主理人团槽头像为空时读取群级覆盖表（⛔ 换脸后消息与成员栏不能分叉）");
ok(helpers.leadFaceOf({ ...teamSlot, avatar: "preset:member-row" }).avatar === "preset:member-row",
  "主理人成员行头像优先于群级覆盖表（与 || 回落口径一致）");

const view = codeOnly(read("src/features/harness-team/04-team-group-view.tsx"));
ok(/createTeamIdentityHelpers\(group\.members, catalog, group\.avatars\)/.test(view)
  && /profileMemberOf\(profile\.memberId\)/.test(view),
  "成员栏与资料卡接线同一份身份解析");
ok(/const kidId = teamAuthorIdOf\(/.test(view)
  && /onClick=\{\(event\) => openProfile\(event, kidId\)\}/.test(view)
  && /team-group__member-tag is-profession[\s\S]{0,200}?kid\.profession/.test(view),
  "团成员行点击本人、名字下展示本人岗位");

const profile = codeOnly(read("src/features/harness-team/14-team-profile-card.tsx"));
ok(/const teamAuthor = parseTeamAuthorId\(member\.id\)/.test(profile)
  && /const kid = useMemo\([\s\S]{0,420}?teamAuthor\?\.memberId/.test(profile)
  && /kid\?\.profession \|\| lead\?\.profession \|\| expert\?\.profession/.test(profile)
  && /<dt>身份<\/dt>[\s\S]{0,100}?<dd>\{identity\}<\/dd>/.test(profile),
  "资料卡姓名 / 岗位 / 身份行都按本人显示");

console.log(`\n${fails ? "✗" : "✓"} team-profile-identity：${checks - fails}/${checks} 通过`);
process.exitCode = fails ? 1 : 0;
