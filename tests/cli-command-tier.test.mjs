/** CLI 派活权限档（11-07）：safe / standard / full 的模板追加规则（纯函数真值表）。 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCliPermissionTier,
  cliPermissionTierOf,
  cliPromptCommandFor,
  cliSupportsPermissionTier,
} from "../src/lib/cli-command.mjs";

test("权限档：缺省与脏值一律回落 standard", () => {
  assert.equal(cliPermissionTierOf(undefined), "standard");
  assert.equal(cliPermissionTierOf(""), "standard");
  assert.equal(cliPermissionTierOf("乱写"), "standard");
  assert.equal(cliPermissionTierOf("FULL"), "full");
});

test("权限档：六个核实过的 CLI 各自追加正确参数", () => {
  assert.equal(cliPromptCommandFor("claude", "standard"), 'claude -p "{prompt}" --permission-mode acceptEdits');
  assert.equal(cliPromptCommandFor("claude", "full"), 'claude -p "{prompt}" --permission-mode bypassPermissions');
  assert.equal(cliPromptCommandFor("codex", "standard"), 'codex exec "{prompt}" --sandbox workspace-write');
  assert.equal(cliPromptCommandFor("codex", "safe"), 'codex exec "{prompt}" --sandbox read-only');
  assert.equal(cliPromptCommandFor("gemini", "full"), 'gemini -p "{prompt}" --approval-mode yolo');
  assert.equal(cliPromptCommandFor("qwen", "standard"), 'qwen --prompt "{prompt}" --approval-mode auto-edit');
  assert.equal(cliPromptCommandFor("qoder", "standard"), 'qoder -p "{prompt}" --permission-mode accept_edits');
  assert.equal(cliPromptCommandFor("codebuddy", "full"), 'codebuddy -p "{prompt}" --permission-mode bypassPermissions');
});

test("权限档：Kimi 2.5.2 的 --auto/--yolo 与 -p 互斥 ⇒ 不加参数", () => {
  assert.equal(cliPromptCommandFor("kimi", "standard"), 'kimi -p "{prompt}"');
  assert.equal(cliPromptCommandFor("kimi", "full"), 'kimi -p "{prompt}"');
  assert.equal(cliSupportsPermissionTier("kimi"), false);
});

test("权限档：没有核实过参数的 CLI 原样返回", () => {
  for (const bin of ["aider", "openclaw", "comatecli", "traecli", "iflow", "harness", "qwenpaw", "kimi"]) {
    assert.equal(cliPromptCommandFor(bin, "full"), cliPromptCommandFor(bin, "safe"), bin);
    assert.equal(cliSupportsPermissionTier(bin), false, bin);
  }
  assert.equal(cliSupportsPermissionTier("claude"), true);
});

test("权限档：幂等（重复应用不叠加）", () => {
  const once = applyCliPermissionTier('claude -p "{prompt}"', "standard");
  assert.equal(applyCliPermissionTier(once, "standard"), once);
  assert.equal(once, cliPromptCommandFor("claude", "standard"));
});

test("权限档：自定义 / 未知命令与无占位符文本不动", () => {
  assert.equal(applyCliPermissionTier('zcode -p "{prompt}"', "full"), 'zcode -p "{prompt}"');
  assert.equal(applyCliPermissionTier("echo hi", "full"), "echo hi");
  assert.equal(applyCliPermissionTier("", "full"), "");
});
