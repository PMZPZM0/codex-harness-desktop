import test from "node:test";
import assert from "node:assert/strict";
import { extractVoiceScript, stripVoiceScript, isVoiceFence, VOICE_FENCE_LANG } from "../src/lib/voice-script.mjs";

/* 覆盖点在「契约边界」：围栏识别 / 摘取 / 去围栏 / 上限，都是纯函数。 */

test("voice 围栏：只认 ```voice（含大小写与短围栏）", () => {
  assert.equal(isVoiceFence("```voice"), true);
  assert.equal(isVoiceFence("```VOICE"), true);
  assert.equal(isVoiceFence("```js"), false);
  assert.equal(VOICE_FENCE_LANG, "voice");
});

test("voice 摘取：拿到播报稿，正文原样保留", () => {
  const raw = "正文第一段。\n\n```voice\n这是一句播报。\n```\n";
  const script = extractVoiceScript(raw);
  assert.equal(script.present, true);
  assert.match(script.text, /这是一句播报/);
  const body = stripVoiceScript(raw);
  assert.match(body, /正文第一段/);
  assert.ok(!String(body).includes("```voice"));
});

test("voice：没有围栏时摘取为空、去围栏不改变原文", () => {
  const raw = "只有正文。";
  const none = extractVoiceScript(raw);
  assert.equal(none.present, false);
  assert.equal(none.text, "");
  assert.equal(stripVoiceScript(raw), raw);
});
