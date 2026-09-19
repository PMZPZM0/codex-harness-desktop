/**
 * **Anthropic Messages** 适配的端到端实证：mock 一个「只提供 Claude 原生 /v1/messages」的网关，
 * 接真实 Codex 引擎，验证四件事（chat 版探针的姊妹篇，见 scripts/probe-bridge.cjs）：
 *   ① 引擎经桥 → `/v1/messages`；认证头从 `Authorization: Bearer` 正确转成 `x-api-key`
 *      （引擎只发 Bearer，Anthropic 要 x-api-key —— 转错就是 401，必须实测）；
 *   ② 文本流（content_block_delta.text_delta）能穿到引擎；
 *   ③ **工具往返闭环**：mock 下发 tool_use → 引擎执行 → 下一轮请求里带 tool_result，
 *      且 tool_use_id 与 tool_use.id 配对（这是 Anthropic 协议最容易做错的地方）；
 *   ④ thinking 块转成 reasoning summary 后引擎不报解析错。
 *
 * 用法：node scripts/probe-anthropic.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { once } = require('node:events');

const { ResponsesBridge } = require('../dist-electron/responses-bridge.js');

const MODEL = 'anthropic-probe-model';
const TEXT_ONE = 'ANTHROPIC_TEXT_ONE';
const TEXT_TWO = 'ANTHROPIC_TOOL_DONE';
const THINKING = '让我先看一眼这个问题。';
const TOOL_ID = 'toolu_probe_1';

const platform = `${process.platform}-${process.arch}`;
const target = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
}[platform];
const binary = path.join(
  path.dirname(require.resolve(`@openai/codex-${platform}/package.json`)),
  'vendor', target, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex',
);

/** 一行 Anthropic SSE（负载就是事件对象本身，带 type 字段）。 */
const ev = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const messageStart = () => ev('message_start', { message: { id: 'msg_probe', model: MODEL, usage: { input_tokens: 3, output_tokens: 1 } } });
const blockStart = (index, block) => ev('content_block_start', { index, content_block: block });
const blockDelta = (index, delta) => ev('content_block_delta', { index, delta });
const blockStop = (index) => ev('content_block_stop', { index });
const messageDelta = (stopReason, outputTokens) => ev('message_delta', { delta: { stop_reason: stopReason }, usage: { output_tokens: outputTokens } });
const messageStop = () => ev('message_stop', {});

const upstreamCalls = [];   // { path, body, headers }
const upstream = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = null;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 非 JSON */ }
  upstreamCalls.push({ path: req.url, body, headers: req.headers });

  // 这个网关「只支持 Anthropic Messages」：其它端点不存在
  if (!String(req.url).endsWith('/v1/messages')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `unknown endpoint ${req.url}` } }));
  }

  const messages = body?.messages ?? [];
  const blocksOf = (m) => (Array.isArray(m?.content) ? m.content : []);
  const hasToolResult = messages.some((m) => blocksOf(m).some((b) => b?.type === 'tool_result'));
  const toolCallsSeen = upstreamCalls.filter((c) => String(c.path).endsWith('/v1/messages')
    && !(c.body?.messages ?? []).some((m) => blocksOf(m).some((b) => b?.type === 'tool_result'))).length;

  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (hasToolResult) {
    return res.end(messageStart() + blockStart(0, { type: 'text', text: '' })
      + blockDelta(0, { type: 'text_delta', text: TEXT_TWO }) + blockStop(0)
      + messageDelta('end_turn', 3) + messageStop());
  }
  if (toolCallsSeen >= 2) {
    // 第二次对话轮：下发 tool_use（引擎应执行并把结果带回来）
    return res.end(
      messageStart()
      + blockStart(0, { type: 'tool_use', id: TOOL_ID, name: 'exec_command', input: {} })
      + blockDelta(0, { type: 'input_json_delta', partial_json: '{"cmd":' })
      + blockDelta(0, { type: 'input_json_delta', partial_json: '"echo anthropic-ok"}' })
      + blockStop(0)
      + messageDelta('tool_use', 9) + messageStop(),
    );
  }
  // 第一次对话轮：thinking 块 + 文本块
  return res.end(
    messageStart()
    + blockStart(0, { type: 'thinking', thinking: '' })
    + blockDelta(0, { type: 'thinking_delta', thinking: THINKING })
    + blockStop(0)
    + blockStart(1, { type: 'text', text: '' })
    + blockDelta(1, { type: 'text_delta', text: TEXT_ONE.slice(0, 11) })
    + blockDelta(1, { type: 'text_delta', text: TEXT_ONE.slice(11) })
    + blockStop(1)
    + messageDelta('end_turn', 12) + messageStop(),
  );
});
upstream.on('clientError', (_error, socket) => socket.destroy());

let child;
let bridge;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anthropic-probe-'));
const pending = new Map();
const completed = new Set();
const agentText = [];
let stderrText = '';
let seq = 0;

async function main() {
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;

  bridge = new ResponsesBridge({ preferredPort: 0, log: (line) => console.log('  ' + line) });
  const bridgePort = await bridge.start();
  // ⛔ 手动指定 anthropic 档（这是本轮新增的第三档协议）
  bridge.register('probe', { baseUrl: `http://127.0.0.1:${upstreamPort}`, mode: 'anthropic', label: 'mock-anthropic-gateway' });

  fs.writeFileSync(path.join(home, 'config.toml'), [
    `model = "${MODEL}"`, 'model_provider = "probe"',
    '[model_providers.probe]', 'name = "Mock Anthropic Gateway"',
    `base_url = "http://127.0.0.1:${bridgePort}/p/probe"`,
    'wire_api = "responses"', 'env_key = "HARNESS_TEST_KEY"', 'requires_openai_auth = false',
  ].join('\n'));

  child = spawn(binary, ['app-server', '--listen', 'stdio://'], {
    env: { ...process.env, CODEX_HOME: home, HARNESS_TEST_KEY: 'anthropic-probe-key',
      HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1,localhost',
      CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1' },
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => { stderrText += d.toString(); });
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const entry = pending.get(message.id);
    if (entry) {
      clearTimeout(entry.timer); pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    }
    if (message.method === 'turn/completed') completed.add(message.params.turn.id);
    if (message.method === 'item/agentMessage/delta') agentText.push(message.params.delta);
  });

  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  const runTurn = async (text) => {
    completed.clear();
    agentText.length = 0;
    const { turn } = await request('turn/start', { threadId, model: MODEL, input: [{ type: 'text', text, text_elements: [] }] });
    const deadline = Date.now() + 30000;
    while (!completed.has(turn.id) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.ok(completed.has(turn.id), `turn 必须完成（${text}）`);
    return agentText.join('');
  };

  await request('initialize', { clientInfo: { name: 'anthropic_probe', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  const { thread } = await request('thread/start', { cwd: home, model: MODEL, approvalPolicy: 'never', sandbox: 'read-only' });
  const threadId = thread.id;

  console.log('\n=== Anthropic Messages 适配端到端实证 ===');
  console.log(`  桥端口 ${bridgePort} → 上游 mock Claude 网关 :${upstreamPort}`);

  // ── 第一轮：thinking + 文本 ──
  const first = await runTurn('第一问');
  console.log(`  第一轮引擎收到的助手文本: ${JSON.stringify(first)}`);
  assert.ok(first.includes(TEXT_ONE), '文本增量必须穿过桥到达引擎');
  const firstCall = upstreamCalls.find((c) => String(c.path).endsWith('/v1/messages'));
  assert.ok(firstCall, '桥必须把 responses 请求转成 /v1/messages 发出');

  // ① 端点与认证头（引擎只发 Bearer，Anthropic 要 x-api-key）
  console.log(`  上游收到的路径: ${firstCall.path}`);
  console.log(`  x-api-key: ${firstCall.headers['x-api-key']} · anthropic-version: ${firstCall.headers['anthropic-version']}`);
  assert.equal(firstCall.headers['x-api-key'], 'anthropic-probe-key', '必须把 Bearer 转成 x-api-key（否则上游 401）');
  assert.ok(firstCall.headers['anthropic-version'], '必须带 anthropic-version（缺它官方直接 400）');

  // ② 请求体形状
  console.log(`  上游请求体顶层键: ${JSON.stringify(Object.keys(firstCall.body))}`);
  assert.ok(typeof firstCall.body.system === 'string' && firstCall.body.system.length > 0, 'instructions 必须落到顶层 system');
  assert.ok(firstCall.body.max_tokens > 0, 'max_tokens 必填');
  assert.ok(Array.isArray(firstCall.body.tools) && firstCall.body.tools[0]?.input_schema, '工具必须用 input_schema 形状');
  assert.ok(!(firstCall.body.tools ?? []).some((t) => t.function), '不得残留 chat 形状（function 嵌套）');
  const roles = (firstCall.body.messages ?? []).map((m) => m.role);
  console.log(`  上游收到的 messages 角色序列: ${JSON.stringify(roles)}`);
  assert.ok(roles.every((r) => r === 'user' || r === 'assistant'), 'roles 只能是 user/assistant（system 在顶层）');
  for (let i = 1; i < roles.length; i++) {
    assert.notEqual(roles[i], roles[i - 1], `messages 必须严格交替，实际序列 ${JSON.stringify(roles)}`);
  }

  // ── 第二轮：工具往返 ──
  const second = await runTurn('第二问');
  console.log(`  第二轮引擎收到的助手文本: ${JSON.stringify(second)}`);
  const toolCarry = upstreamCalls.filter((c) => String(c.path).endsWith('/v1/messages')
    && (c.body?.messages ?? []).some((m) => (Array.isArray(m.content) ? m.content : []).some((b) => b?.type === 'tool_result')));
  assert.ok(toolCarry.length >= 1, '引擎必须执行工具并把结果回传（tool_result 块）');
  const carryMessages = toolCarry[0].body.messages;
  const resultBlock = carryMessages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b?.type === 'tool_result');
  const useBlock = carryMessages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b?.type === 'tool_use');
  assert.equal(resultBlock.tool_use_id, TOOL_ID, 'tool_result.tool_use_id 必须对回上游给的 tool_use.id');
  assert.ok(useBlock, '助手回合必须以 tool_use 块回传历史');
  assert.equal(useBlock.name, 'exec_command');
  assert.ok(String(resultBlock.content ?? '').length > 0, 'tool_result 必须有内容');
  const resultOwner = carryMessages.find((m) => (Array.isArray(m.content) ? m.content : []).some((b) => b?.type === 'tool_result'));
  assert.equal(resultOwner.role, 'user', 'tool_result 必须挂在 user 消息上（Anthropic 硬要求）');
  console.log(`  工具回传: tool_use_id=${resultBlock.tool_use_id} · 工具名=${useBlock.name} · 归属角色=${resultOwner.role}`);

  // ③ thinking 宽容度
  const parseErrors = stderrText.split('\n').filter((l) => /unknown variant|failed to parse|serde|invalid type/i.test(l));
  console.log(`  引擎解析错误行（应为空）: ${JSON.stringify(parseErrors.slice(0, 3))}`);
  assert.equal(parseErrors.length, 0, 'reasoning summary 事件不得让引擎解析失败');

  // ④ rollout 落地
  let rollout = '';
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl')) rollout += fs.readFileSync(full, 'utf8');
    }
  };
  try { walk(path.join(home, 'sessions')); } catch { /* 忽略 */ }
  assert.ok(rollout.length > 0, '引擎必须写下 rollout（否则本项检查无效）');
  console.log(`  rollout reasoning 出现次数: ${(rollout.match(/"reasoning"/g) ?? []).length} · 思考原文落地: ${rollout.includes(THINKING)}`);

  const status = bridge.status();
  console.log(`  桥统计: ${JSON.stringify(status)}`);
  assert.ok(status.converted >= 2, '转换计数必须增长（证明确实走了 anthropic 转换路径）');
  console.log('PASS: Anthropic Messages 适配端到端（端点/认证头/文本/工具往返/思考）全部通过');
}

main().catch((error) => { console.error('FAIL: ' + (error?.stack ?? error)); process.exitCode = 1; })
  .finally(async () => {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    try { await bridge?.stop(); } catch { /* 忽略 */ }
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    upstream.closeAllConnections();
    await new Promise((r) => upstream.close(r));
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
