import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { ChannelBotService, larkSignature, verifyLarkSignature } = require("../dist-electron/channel-bot.js");
const port = 30_000 + process.pid % 10_000;
const config = {
  enabled: true,
  host: "127.0.0.1",
  port,
  workspace: process.cwd(),
  sandbox: "read-only",
  appId: "test-app",
  appSecret: "test-secret",
  verificationToken: "test-token",
  encryptKey: "test-encrypt-key",
};
const bindingsFile = join(tmpdir(), `codex-harness-channel-${process.pid}.json`);
const calls = [];
const service = new ChannelBotService({
  request: async (method, params) => {
    calls.push([method, params]);
    if (method === "thread/start") return { thread: { id: "thread-test", turns: [] } };
    if (method === "turn/start") return { turn: { id: "turn-test" } };
    throw new Error(`unexpected Codex method: ${method}`);
  },
}, bindingsFile, async () => ({ provider: "test", name: "Test", model: "test-model", baseUrl: "http://127.0.0.1/v1" }), () => undefined);

try {
  await service.configure(config);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "nonce";
  const body = JSON.stringify({ type: "url_verification", token: config.verificationToken, challenge: "verified" });
  const signature = larkSignature(timestamp, nonce, config.verificationToken, body);
  assert.equal(verifyLarkSignature(timestamp, nonce, config.verificationToken, body, signature), true);
  assert.equal(verifyLarkSignature(timestamp, nonce, config.verificationToken, body, "bad"), false);

  const response = await fetch(`http://127.0.0.1:${port}/bot/feishu`, { method: "POST", headers: { "x-lark-request-timestamp": timestamp, "x-lark-request-nonce": nonce, "x-lark-signature": signature }, body });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { challenge: "verified" });

  const iv = Buffer.alloc(16, 7);
  const cipher = createCipheriv("aes-256-cbc", createHash("sha256").update(config.encryptKey).digest(), iv);
  const encrypted = Buffer.concat([iv, cipher.update(body), cipher.final()]).toString("base64");
  const encryptedResponse = await fetch(`http://127.0.0.1:${port}/bot/feishu`, { method: "POST", body: JSON.stringify({ encrypt: encrypted }) });
  assert.equal(encryptedResponse.status, 200);
  assert.deepEqual(await encryptedResponse.json(), { challenge: "verified" });

  const eventBody = JSON.stringify({ schema: "2.0", header: { token: config.verificationToken, event_type: "im.message.receive_v1" }, event: { sender: { sender_type: "user", sender_id: { open_id: "ou_test" } }, message: { message_id: "om_test", chat_id: "oc_test", message_type: "text", content: JSON.stringify({ text: "检查项目状态" }), mentions: [] } } });
  const eventResponse = await fetch(`http://127.0.0.1:${port}/bot/feishu`, { method: "POST", body: eventBody });
  assert.equal(eventResponse.status, 200);
  for (let index = 0; index < 20 && calls.length < 2; index++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls.map(([method]) => method), ["thread/start", "turn/start"]);
  assert.equal(calls[1][1].input[0].text, "[飞书用户 ou_test]\n检查项目状态");

  const rejected = await fetch(`http://127.0.0.1:${port}/bot/feishu`, { method: "POST", headers: { "x-lark-request-timestamp": timestamp, "x-lark-request-nonce": nonce, "x-lark-signature": "bad" }, body });
  assert.equal(rejected.status, 401);
  console.log("channel bot verification passed");
} finally {
  await service.stop();
  await fs.rm(bindingsFile, { force: true });
}
