import assert from "node:assert/strict";

const targets = await fetch(`http://127.0.0.1:${process.env.CODEX_HARNESS_DEBUG_PORT || 9223}/json`).then((response) => response.json());
const page = targets.find((target) => target.type === "page" && target.title === "Codex Harness Desktop");
assert(page, "Codex Harness Desktop debug page was not found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
};
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const message = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  assert(!message.result.exceptionDetails, JSON.stringify(message.result.exceptionDetails));
  return message.result.result.value;
};

const result = await evaluate(`(async () => {
  const cwd = localStorage.getItem("workspace");
  const calls = [
    ["threads", "thread/list", { limit: 10, sortKey: "updated_at", sortDirection: "desc" }],
    ["skills", "skills/list", { cwds: cwd ? [cwd] : [], forceReload: false }],
    ["mcp", "mcpServerStatus/list", { detail: "toolsAndAuthOnly", limit: 20 }],
    ["plugins", "plugin/list", { cwds: cwd ? [cwd] : [], forceRefetch: false }],
    ["apps", "app/list", { limit: 20, forceRefetch: false }],
  ];
  const checks = {};
  for (const [name, method, params] of calls) {
    try {
      const response = await window.codex.request(method, params);
      checks[name] = { ok: true, count: response.data?.length ?? response.marketplaces?.length ?? 0 };
    } catch (error) {
      checks[name] = { ok: false, error: error.message };
    }
  }
  const custom = await window.codex.getCustomModel();
  if (custom) {
    try {
      const probe = await window.codex.probeCustomModel(custom);
      checks.provider = { ok: probe.status === 200, count: probe.models.length, latencyMs: probe.latencyMs, configuredModelFound: probe.models.includes(custom.model) };
    } catch (error) {
      checks.provider = { ok: false, error: error.message };
    }
  }
  return checks;
})()`);

for (const [name, check] of Object.entries(result)) assert(check.ok, `${name}: ${check.error ?? "failed"}`);

if (process.env.VERIFY_TURN === "1") {
  const turn = await evaluate(`(async () => {
    const custom = await window.codex.getCustomModel();
    if (!custom) throw new Error("Custom model is not configured");
    const methods = [];
    const seenItemTypes = [];
    let threadId = "";
    let completed = null;
    const off = window.codex.onEvent((event) => {
      if (event.kind !== "notification" || (threadId && event.params?.threadId !== threadId)) return;
      methods.push(event.method);
      if ((event.method === "item/started" || event.method === "item/completed") && event.params?.item?.type) seenItemTypes.push(event.params.item.type);
      if (event.method === "turn/completed") completed = event.params.turn;
    });
    const started = await window.codex.request("thread/start", {
      model: custom.model,
      modelProvider: custom.provider,
      cwd: localStorage.getItem("workspace") || "D:\\\\",
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
    });
    threadId = started.thread.id;
    const response = await window.codex.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Reply with exactly OK.", text_elements: [] }],
      model: custom.model,
      effort: "low",
    });
    for (let attempt = 0; attempt < 120 && !completed; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    off();
    return { turnId: response.turn.id, status: completed?.status, itemTypes: [...new Set([...seenItemTypes, ...(completed?.items.map((item) => item.type) ?? [])])], methods };
  })()`);
  assert.equal(turn.status, "completed", `Turn did not complete: ${JSON.stringify(turn)}`);
  assert(turn.itemTypes.includes("userMessage"), "Official turn is missing userMessage");
  assert(turn.itemTypes.includes("agentMessage"), "Official turn is missing agentMessage");
  for (const method of ["turn/started", "item/started", "item/agentMessage/delta", "item/completed", "turn/completed"]) {
    assert(turn.methods.includes(method), `Official stream is missing ${method}`);
  }
  result.turn = turn;
}

socket.close();
console.log(JSON.stringify(result));
