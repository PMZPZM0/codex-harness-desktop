#!/usr/bin/env node
// 能力总闸联动层单测：主开关状态派生、动作计划 diff、IPC 批量下发与失败聚合、总闸托管判定。
// 跑法：node --experimental-strip-types scripts/verify-capability-groups.mjs（已注册为 npm run verify:capability-groups）

import assert from "node:assert/strict";

const mod = await import("../src/lib/capability-groups.ts");

const {
  groupState: gs,
  collectItems: ci,
  ponytailSkillsAllOn: psao,
  isPonytailSkill: ips,
  ponytailSubSkills: pss,
  planAction: pa,
  isEmptyAction: iea,
  applyAction: aa,
  describePartial: dp,
  guardOffOwner: goo,
  findCapabilitySkill: fcs,
  syncedSnapshot: ss,
  PONYTAIL_PLUGIN_ID: PID,
  NUPHUS_MCP_ID: NMCP,
  DESKTOP_SKILL_ID: DSID,
  BROWSER_SKILL_ID: BSID,
} = mod;

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); console.log(`ok  ${name}`); pass++; }
  catch (error) { console.log(`not ok  ${name}`); console.log(error?.stack ?? String(error)); fail++; }
}

const baseSnap = {
  ponytailOn: false,
  ponytailPluginOn: false,
  ponytailSkills: [],
  desktopAuto: false,
  browserAuto: false,
  nuphusMcpOn: false,
  desktopSkill: null,
  browserSkill: null,
};

// —— 1. 主开关派生 ——
test("writing-code 全关 → off", () => assert.equal(gs(baseSnap, "writing-code"), "off"));
test("desktop-automation 全关（含空技能）→ off", () => assert.equal(gs(baseSnap, "desktop-automation"), "off"));
test("browser-automation 全关 → off", () => assert.equal(gs(baseSnap, "browser-automation"), "off"));

test("writing-code 全开 → on", () => {
  const snap = { ...baseSnap, ponytailOn: true, ponytailPluginOn: true, ponytailSkills: [{ folder: "ponytail-audit", enabled: true }, { folder: "ponytail-debt", enabled: true }] };
  assert.equal(gs(snap, "writing-code"), "on");
});
test("desktop-automation 全开 → on", () => {
  const snap = { ...baseSnap, desktopAuto: true, nuphusMcpOn: true, desktopSkill: { folder: DSID, enabled: true } };
  assert.equal(gs(snap, "desktop-automation"), "on");
});
test("browser-automation 全开 → on", () => {
  const snap = { ...baseSnap, browserAuto: true, browserSkill: { folder: BSID, enabled: true } };
  assert.equal(gs(snap, "browser-automation"), "on");
});

test("writing-code 仅注入开 → partial", () => {
  assert.equal(gs({ ...baseSnap, ponytailOn: true }, "writing-code"), "partial");
});
test("desktop-automation 总闸开但 nuphus MCP 关 → partial", () => {
  assert.equal(gs({ ...baseSnap, desktopAuto: true, nuphusMcpOn: false, desktopSkill: { folder: DSID, enabled: true } }, "desktop-automation"), "partial");
});
test("desktop-automation 总闸开但技能停用 → partial", () => {
  assert.equal(gs({ ...baseSnap, desktopAuto: true, nuphusMcpOn: true, desktopSkill: { folder: DSID, enabled: false } }, "desktop-automation"), "partial");
});
test("browser-automation 总闸开但技能停用 → partial", () => {
  assert.equal(gs({ ...baseSnap, browserAuto: true, browserSkill: { folder: BSID, enabled: false } }, "browser-automation"), "partial");
});
// 技能未安装（null）不参与判定：总闸开 + MCP 开 + 技能未装 = on（缺装由自愈补）
test("desktop-automation 技能未安装不计入 → on", () => {
  assert.equal(gs({ ...baseSnap, desktopAuto: true, nuphusMcpOn: true, desktopSkill: null }, "desktop-automation"), "on");
});

// —— 2. collectItems ——
test("collectItems writing-code = 3 项", () => assert.equal(ci(baseSnap, "writing-code").length, 3));
test("collectItems desktop-automation = 2 项（技能未装）", () => assert.equal(ci(baseSnap, "desktop-automation").length, 2));
test("collectItems desktop-automation = 3 项（技能已装）", () => {
  const snap = { ...baseSnap, desktopSkill: { folder: DSID, enabled: true } };
  assert.equal(ci(snap, "desktop-automation").length, 3);
});
test("collectItems browser-automation = 1 项（技能未装）", () => assert.equal(ci(baseSnap, "browser-automation").length, 1));

// —— 3. ponytailSkillsAllOn ——
test("ponytailSkillsAllOn 空数组 → false", () => assert.equal(psao([]), false));
test("ponytailSkillsAllOn 全部启用 → true", () => assert.equal(psao([{ enabled: true }, { enabled: true }]), true));
test("ponytailSkillsAllOn 一个未启用 → false", () => assert.equal(psao([{ enabled: true }, { enabled: false }]), false));

// —— 4. isPonytailSkill ——
test("isPonytailSkill 命中 pluginId / folder 前缀 / 斜杠", () => {
  assert.equal(ips({ pluginId: PID }), true);
  assert.equal(ips({ folder: "ponytail-audit" }), true);
  assert.equal(ips({ folder: "ponytail/debt" }), true);
  assert.equal(ips({ name: "ponytail-preview" }), true);
  assert.equal(ips({ name: "ponytail/gain" }), true);
});
test("isPonytailSkill 排除其他", () => {
  assert.equal(ips({ folder: "other-skill" }), false);
  assert.equal(ips({ pluginId: "other" }), false);
  assert.equal(ips({ folder: "ponytailish" }), false);
  assert.equal(ips({ folder: "my-ponytail" }), false);
});

// —— 5. ponytailSubSkills ——
test("ponytailSubSkills 过滤并归一（缺 folder 回退 name）", () => {
  const skills = [
    { folder: "ponytail-audit", enabled: true, pluginId: PID },
    { folder: "ponytail-debt", enabled: false, pluginId: PID },
    { folder: "other-tool", enabled: true },
    { name: "ponytail-orphan", pluginId: PID },
  ];
  const result = pss(skills);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((r) => r.folder).sort(), ["ponytail-audit", "ponytail-debt", "ponytail-orphan"]);
});

// —— 6. findCapabilitySkill ——
test("findCapabilitySkill 命中 folder / name，缺失 → null", () => {
  const skills = [{ folder: DSID, name: DSID, enabled: true }];
  assert.deepEqual(fcs(skills, DSID), { folder: DSID, enabled: true });
  assert.deepEqual(fcs([{ name: BSID, enabled: false }], BSID), { folder: BSID, enabled: false });
  assert.equal(fcs([], DSID), null);
});

// —— 7. planAction diff ——
test("planAction writing-code 已就位 → 仅 ponytailMode", () => {
  const snap = { ...baseSnap, ponytailOn: true, ponytailPluginOn: true, ponytailSkills: [{ folder: "ponytail-audit", enabled: true }] };
  const action = pa(snap, "writing-code", true);
  assert.equal(action.ponytailMode, "full");
  assert.equal(action.ponytailLinked, undefined);
});
test("planAction writing-code 目标关、插件+技能已关 → 不发 linked", () => {
  const snap = { ...baseSnap, ponytailOn: true, ponytailPluginOn: false, ponytailSkills: [{ folder: "ponytail-audit", enabled: false }] };
  const action = pa(snap, "writing-code", false);
  assert.equal(action.ponytailMode, "off");
  assert.equal(action.ponytailLinked, undefined);
});
test("planAction writing-code 插件+技能开、目标关 → linked=false", () => {
  const snap = { ...baseSnap, ponytailOn: true, ponytailPluginOn: true, ponytailSkills: [{ folder: "ponytail-audit", enabled: true }] };
  const action = pa(snap, "writing-code", false);
  assert.equal(action.ponytailMode, "off");
  assert.equal(action.ponytailLinked, false);
});
test("planAction desktop 全关 → 目标开：发总闸+nuphus+技能", () => {
  const snap = { ...baseSnap, desktopSkill: { folder: DSID, enabled: false } };
  const action = pa(snap, "desktop-automation", true);
  assert.equal(action.desktopAutomation, true);
  assert.equal(action.nuphusMcp, true);
  assert.deepEqual(action.desktopSkill, { folder: DSID, enabled: true });
});
test("planAction desktop 已就位 → 空动作", () => {
  const snap = { ...baseSnap, desktopAuto: true, nuphusMcpOn: true, desktopSkill: { folder: DSID, enabled: true } };
  assert.deepEqual(pa(snap, "desktop-automation", true), {});
});
test("planAction desktop 技能未装 → 不发 desktopSkill", () => {
  const snap = { ...baseSnap, desktopAuto: true, nuphusMcpOn: false, desktopSkill: null };
  const action = pa(snap, "desktop-automation", true);
  assert.equal(action.nuphusMcp, true);
  assert.equal(action.desktopSkill, undefined);
});
test("planAction browser 全关 → 目标开：发总闸+技能", () => {
  const snap = { ...baseSnap, browserSkill: { folder: BSID, enabled: false } };
  const action = pa(snap, "browser-automation", true);
  assert.equal(action.browserAutomation, true);
  assert.deepEqual(action.browserSkill, { folder: BSID, enabled: true });
});
test("planAction browser 已就位 → 空动作", () => {
  const snap = { ...baseSnap, browserAuto: true, browserSkill: { folder: BSID, enabled: true } };
  assert.deepEqual(pa(snap, "browser-automation", true), {});
});

// —— 8. isEmptyAction ——
test("isEmptyAction 空对象 → true，有子项 → false", () => {
  assert.equal(iea({}), true);
  assert.equal(iea({ nuphusMcp: true }), false);
});

// —— 9. applyAction ——
test("applyAction 全成功路径（含 desktop/browser 子项）", async () => {
  const calls = [];
  const ipc = {
    ponytailModeSet: async (m) => { calls.push(["ponytail", m]); },
    setPluginLinkedEnabled: async (id, enabled) => { calls.push(["linked", id, enabled]); return { failures: [] }; },
    saveAppSettings: async (p) => { calls.push(["settings", p]); },
    setMcpServersEnabled: async (ids, enabled) => { calls.push(["mcp", ids, enabled]); },
    setSkillEnabled: async (input) => { calls.push(["skill", input]); },
  };
  const action = { ponytailMode: "full", ponytailLinked: true, desktopAutomation: true, browserAutomation: true, nuphusMcp: true, desktopSkill: { folder: DSID, enabled: true }, browserSkill: { folder: BSID, enabled: true } };
  const result = await aa(action, ipc);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.applied, { ponytailMode: true, ponytailLinked: true, desktop: true, browser: true, nuphus: true, desktopSkill: true, browserSkill: true });
  assert.deepEqual(calls, [
    ["ponytail", "full"],
    ["linked", "ponytail", true],
    ["settings", { desktopAutomation: true, browserAutomation: true }],
    ["mcp", ["nuphus"], true],
    ["skill", { folder: DSID, enabled: true }],
    ["skill", { folder: BSID, enabled: true }],
  ]);
});
test("applyAction nuphus/技能 失败 → failures 聚合", async () => {
  const ipc = {
    ponytailModeSet: async () => ({}),
    setPluginLinkedEnabled: async () => ({ failures: [] }),
    saveAppSettings: async () => ({}),
    setMcpServersEnabled: async () => { throw new Error("覆盖表写失败"); },
    setSkillEnabled: async () => { throw new Error("重命名失败"); },
  };
  const action = { nuphusMcp: true, desktopSkill: { folder: DSID, enabled: true } };
  const result = await aa(action, ipc);
  assert.equal(result.failures.length, 2);
  assert.match(result.failures.join("；"), /nuphus MCP/);
  assert.match(result.failures.join("；"), /覆盖表写失败/);
  assert.match(result.failures.join("；"), /重命名失败/);
});
test("applyAction 空动作 → 全 0 不发任何 IPC", async () => {
  let calls = 0;
  const ipc = {
    ponytailModeSet: async () => { calls++; },
    setPluginLinkedEnabled: async () => { calls++; return { failures: [] }; },
    saveAppSettings: async () => { calls++; },
    setMcpServersEnabled: async () => { calls++; },
    setSkillEnabled: async () => { calls++; },
  };
  const result = await aa({}, ipc);
  assert.equal(calls, 0);
  assert.deepEqual(result.failures, []);
});

// —— 10. describePartial（新标签表）——
const LABELS = { desktop: "桌面自动化总闸", nuphusMcp: "nuphus MCP", desktopSkill: `${DSID} 技能`, browser: "浏览器自动化总闸", browserSkill: `${BSID} 技能`, ponytail: "写代码注入", ponytailPlugin: "ponytail 插件", ponytailSkills: "ponytail 子技能" };
test("describePartial desktop partial → 列出未就位项", () => {
  const snap = { ...baseSnap, desktopAuto: true, nuphusMcpOn: false, desktopSkill: { folder: DSID, enabled: true } };
  const hint = dp(snap, "desktop-automation", LABELS);
  assert.ok(hint);
  assert.equal(hint.onCount, 2);
  assert.equal(hint.totalCount, 3);
  assert.deepEqual(hint.pendingLabels, ["nuphus MCP"]);
});
test("describePartial on/off → null", () => {
  assert.equal(dp(baseSnap, "desktop-automation", LABELS), null);
  const snap = { ...baseSnap, desktopAuto: true, nuphusMcpOn: true, desktopSkill: { folder: DSID, enabled: true } };
  assert.equal(dp(snap, "desktop-automation", LABELS), null);
});

// —— 11. guardOffOwner：总闸托管判定 ——
test("guardOffOwner nuphus MCP + 桌面总闸开 → desktop-automation", () => {
  assert.equal(goo({ ...baseSnap, desktopAuto: true }, { kind: "mcp", name: NMCP }), "desktop-automation");
});
test("guardOffOwner nuphus MCP + 桌面总闸关 → null", () => {
  assert.equal(goo(baseSnap, { kind: "mcp", name: NMCP }), null);
});
test("guardOffOwner 其他 MCP → null", () => {
  assert.equal(goo({ ...baseSnap, desktopAuto: true }, { kind: "mcp", name: "github" }), null);
});
test("guardOffOwner desktop-automation 技能 + 总闸开 → desktop-automation", () => {
  assert.equal(goo({ ...baseSnap, desktopAuto: true }, { kind: "skill", folder: DSID }), "desktop-automation");
});
test("guardOffOwner browser-automation 技能 + 总闸开 → browser-automation", () => {
  assert.equal(goo({ ...baseSnap, browserAuto: true }, { kind: "skill", folder: BSID }), "browser-automation");
});
test("guardOffOwner ponytail 插件 + 主开关开 → writing-code", () => {
  assert.equal(goo({ ...baseSnap, ponytailOn: true }, { kind: "plugin", id: PID }), "writing-code");
});
test("guardOffOwner ponytail 子技能 + 主开关开 → writing-code", () => {
  assert.equal(goo({ ...baseSnap, ponytailOn: true }, { kind: "skill", folder: "ponytail-audit" }), "writing-code");
});
test("guardOffOwner 无关技能 → null", () => {
  assert.equal(goo({ ...baseSnap, desktopAuto: true }, { kind: "skill", folder: "other-tool" }), null);
});

// —— 12. syncedSnapshot ——
test("syncedSnapshot desktop 目标开 → 全部对齐", () => {
  const snap = { ...baseSnap, desktopSkill: { folder: DSID, enabled: false } };
  const out = ss(snap, "desktop-automation", true);
  assert.equal(out.desktopAuto, true);
  assert.equal(out.nuphusMcpOn, true);
  assert.equal(out.desktopSkill.enabled, true);
});
test("syncedSnapshot writing-code 目标关 → 全部对齐", () => {
  const snap = { ...baseSnap, ponytailOn: true, ponytailPluginOn: true, ponytailSkills: [{ folder: "ponytail-audit", enabled: true }] };
  const out = ss(snap, "writing-code", false);
  assert.equal(out.ponytailOn, false);
  assert.equal(out.ponytailPluginOn, false);
  assert.equal(out.ponytailSkills[0].enabled, false);
});

console.log(`\n# tests ${pass + fail}\n# pass ${pass}\n# fail ${fail}`);
if (fail > 0) process.exit(1);
