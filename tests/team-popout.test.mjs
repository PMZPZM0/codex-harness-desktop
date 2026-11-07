import test from "node:test";
import assert from "node:assert/strict";

/* 工作伙伴独立窗口的 URL 判据（与 src/lib/team-popout.ts 同口径）。
   ⛔ 真值表在渲染层首帧同步判定，这里把「哪些 query 算独立窗口」钉死。 */
const isTeamPopout = (search) => {
  try { return new URLSearchParams(search).get("teamPopout") === "1"; }
  catch { return false; }
};

test("工作伙伴独立窗口：只认 teamPopout=1", () => {
  assert.equal(isTeamPopout("?teamPopout=1"), true);
  assert.equal(isTeamPopout("?popout=abc"), false);
  assert.equal(isTeamPopout(""), false);
  assert.equal(isTeamPopout("?teamPopout=0"), false);
  assert.equal(isTeamPopout("?foo=1&teamPopout=1"), true);
});
