const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { once } = require("node:events");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const effortSource = fs.readFileSync(path.join(root, "src/lib/effort.ts"), "utf8");
const pickDefaultEffort = vm.runInNewContext(ts.transpile(effortSource) + "\npickDefaultEffort", { exports: {} });
assert.equal(pickDefaultEffort(["low"]), "low");
assert.equal(pickDefaultEffort(["low", "medium"]), "medium");
assert.equal(pickDefaultEffort(["low", "high"]), "high");
const source = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");
const start = source.indexOf("function buildModelCatalog(");
const end = source.indexOf("\n/**", start);
const buildModelCatalog = vm.runInNewContext(
  ts.transpile(source.slice(start, end)) + "\nbuildModelCatalog",
  { normalizeProvider: value => value },
);
const appSource = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const sendStart = appSource.indexOf("const startTurn = async (target: Thread)");
assert.ok(sendStart >= 0, "find the actual composer send path");
const sendEnd = appSource.indexOf("\n      });", sendStart) + "\n      });".length;
const sendCode = ts.transpile(appSource.slice(sendStart, sendEnd)) + "\nstartTurn";
const composerParams = async (model, effort, plan) => {
  let sent;
  const send = vm.runInNewContext(sendCode, {
    window: { codex: { request: async (_method, params) => { sent = params; } } },
    selectedModel: { model }, modelId: model, modelName: value => value,
    effort, personality: "none", approvalPolicy: "never", sendInput: [],
    planOnceRef: { current: plan },
  });
  await send({ id: "fixture" });
  return JSON.parse(JSON.stringify(sent));
};
const platform = `${process.platform}-${process.arch}`;
const target = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
}[platform];
const binary = path.join(path.dirname(require.resolve(`@openai/codex-${platform}/package.json`)),
  "vendor", target, "bin", process.platform === "win32" ? "codex.exe" : "codex");

async function probe(supportsSummaries) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-reasoning-"));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const item = { id: `msg-${requests.length}`, type: "message", role: "assistant",
      status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] };
    const response = { id: `resp-${requests.length}`, object: "response", status: "completed",
      output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    for (const event of [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
      { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "OK" },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response },
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  let child;
  const pending = new Map();
  const completed = new Set();
  let seq = 0;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const model = "deepseek-v4-flash";
    const catalog = buildModelCatalog({ name: "Probe", model, models: [
      { id: model, contextWindow: 1000000, efforts: ["low", "medium", "high", "ultra"] },
    ] });
    catalog.models[0].supports_reasoning_summaries = supportsSummaries;
    fs.writeFileSync(path.join(home, "catalog.json"), JSON.stringify(catalog));
    fs.writeFileSync(path.join(home, "config.toml"), [
      `model = "${model}"`, 'model_provider = "probe"',
      `model_catalog_json = ${JSON.stringify(path.join(home, "catalog.json"))}`,
      '[model_providers.probe]', 'name = "Probe"',
      `base_url = "http://127.0.0.1:${server.address().port}/v1"`,
      'wire_api = "responses"', 'env_key = "HARNESS_TEST_KEY"', 'requires_openai_auth = false',
    ].join("\n"));
    child = spawn(binary, ["app-server", "--listen", "stdio://"], {
      env: { ...process.env, CODEX_HOME: home, HARNESS_TEST_KEY: "local-test-only",
        HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", NO_PROXY: "127.0.0.1,localhost",
        CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" },
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.resume();
    const request = (method, params) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
    createInterface({ input: child.stdout }).on("line", line => {
      const message = JSON.parse(line);
      const entry = pending.get(message.id);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result);
      }
      if (message.method === "turn/completed") completed.add(message.params.turn.id);
    });
    await request("initialize", { clientInfo: { name: "reasoning_probe", version: "1.0.0" },
      capabilities: { experimentalApi: true } });
    const list = await request("model/list", { includeHidden: true });
    assert.equal(list.data?.find(entry => entry.model === model)?.description, "Probe \u00b7 custom model");
    const { thread } = await request("thread/start", { cwd: home, model,
      approvalPolicy: "never", sandbox: "read-only" });
    const runTurn = async params => {
      const before = requests.length;
      const { turn } = await request("turn/start", { ...params, threadId: thread.id,
        input: [{ type: "text", text: "Reply OK.", text_elements: [] }] });
      const deadline = Date.now() + 15000;
      while (!completed.has(turn.id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(completed.has(turn.id), "turn must finish");
      assert.equal(requests.length, before + 1, "exactly one upstream request per turn");
      return requests.at(-1);
    };
    for (const effort of ["minimal", "low", "medium", "high", "ultra", "xhigh"]) {
      const sent = await runTurn(await composerParams(model, effort, false));
      console.log(JSON.stringify({ supportsSummaries, selected: effort, sentReasoning: sent?.reasoning ?? null }));
      assert.equal(sent?.reasoning?.effort, effort === "ultra" ? "high" : effort);
    }
    await request("thread/settings/update", { threadId: thread.id, effort: "low" });
    const afterSettings = await runTurn({});
    console.log(JSON.stringify({ supportsSummaries, settingsEffort: "low", sentReasoning: afterSettings.reasoning }));
    assert.equal(afterSettings.reasoning?.effort, "low");
    for (const effort of ["low", "high", "ultra", "xhigh"]) {
      const params = await composerParams(model, effort, true);
      assert.equal(params.collaborationMode.settings.reasoning_effort, effort);
      const plan = await runTurn(params);
      console.log(JSON.stringify({ supportsSummaries, planEffort: effort, sentReasoning: plan.reasoning }));
      assert.equal(plan.reasoning?.effort, effort === "ultra" ? "high" : effort);
    }
    const ordinary = await runTurn(await composerParams(model, "low", false));
    assert.equal(ordinary.reasoning?.effort, "low", "normal turn after plan retains selected effort");
  } finally {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    // Only the directory created by this probe may be removed.
    assert.equal(path.dirname(home), path.resolve(os.tmpdir()));
    assert.ok(path.basename(home).startsWith("harness-reasoning-"));
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

(async () => {
  await probe(true);
  await probe(false);
  console.log("PASS: composer sends, settings changes, plan effort, and model-specific ultra mapping");
})().catch(error => { console.error(error); process.exitCode = 1; });
