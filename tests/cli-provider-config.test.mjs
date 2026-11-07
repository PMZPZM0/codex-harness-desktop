/** CLI 智能体「跟随主会话供应商」的配置生成（11-07）：纯函数真值表。 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  codexConfigToml,
  isLocalBaseUrl,
  kimiConfigToml,
  mergeGeminiSettings,
  stripV1Suffix,
} from "../src/lib/cli-provider-config.mjs";

test("isLocalBaseUrl：只认本机/内网", () => {
  assert.equal(isLocalBaseUrl("http://127.0.0.1:3425/v1"), true);
  assert.equal(isLocalBaseUrl("http://localhost:8080"), true);
  assert.equal(isLocalBaseUrl("http://[::1]:3425/v1"), true);
  assert.equal(isLocalBaseUrl("http://192.168.1.9/v1"), true);
  assert.equal(isLocalBaseUrl("https://api.openai.com/v1"), false);
  assert.equal(isLocalBaseUrl(""), false);
});

test("stripV1Suffix：Anthropic/Gemini SDK 自己拼 /v1", () => {
  assert.equal(stripV1Suffix("http://127.0.0.1:3425/v1"), "http://127.0.0.1:3425");
  assert.equal(stripV1Suffix("http://127.0.0.1:3425/v1/"), "http://127.0.0.1:3425");
  assert.equal(stripV1Suffix("http://127.0.0.1:3425"), "http://127.0.0.1:3425");
});

test("kimiConfigToml：provider + model 段与 default_model 对齐", () => {
  const toml = kimiConfigToml({ baseUrl: "http://127.0.0.1:3425/v1", model: "workbuddy-ai/deepseek-v4.1-flash-sg", apiKey: "harness-local" });
  assert.match(toml, /^default_model = "harness\/workbuddy-ai\/deepseek-v4\.1-flash-sg"$/m);
  assert.match(toml, /\[providers\.harness\]/);
  assert.match(toml, /type = "openai"/);
  assert.match(toml, /base_url = "http:\/\/127\.0\.0\.1:3425\/v1"/);
  assert.match(toml, /\[models\."harness\/workbuddy-ai\/deepseek-v4\.1-flash-sg"\]/);
  assert.match(toml, /provider = "harness"/);
  assert.equal(kimiConfigToml({ baseUrl: "", model: "x" }), "");
});

test("codexConfigToml：provider 指向当前供应商，Key 只写环境变量名", () => {
  const toml = codexConfigToml({ baseUrl: "http://127.0.0.1:3425/v1", model: "workbuddy-ai/deepseek-v4.1-flash-sg" });
  assert.match(toml, /^model_provider = "harness"$/m);
  assert.match(toml, /\[model_providers\.harness\]/);
  assert.match(toml, /wire_api = "responses"/);
  assert.match(toml, /env_key = "OPENAI_API_KEY"/);
  assert.doesNotMatch(toml, /harness-local/);
});

test("mergeGeminiSettings：只补认证方式与模型，其它设置原样保留", () => {
  const merged = mergeGeminiSettings({ theme: "dark", security: { auth: { keep: 1 } }, model: { maxSessionTurns: 3 } }, { model: "workbuddy-ai/deepseek-v4.1-flash-sg" });
  assert.equal(merged.theme, "dark");
  assert.equal(merged.security.auth.keep, 1);
  assert.equal(merged.security.auth.selectedType, "gemini-api-key");
  assert.equal(merged.model.maxSessionTurns, 3);
  assert.equal(merged.model.name, "workbuddy-ai/deepseek-v4.1-flash-sg");
  const empty = mergeGeminiSettings(null, {});
  assert.equal(empty.security.auth.selectedType, "gemini-api-key");
});
