/**
 * 12ax —— apply_patch（custom / freeform 工具）可用性守卫（11-05）
 *
 * 现场（用户另一台电脑）：微信驱动 22 天交易复盘，写 egg.py 反复中断，模型自述
 * 「命令通道对 shell 的选择不稳定」「之前失败是因为命令太长」。隔离引擎探针实测根因：
 *   · 0.166 的模型目录**不写 `apply_patch_tool_type` 时，工具面只有 exec_command / write_stdin /
 *     request_user_input / view_image / multi_agent_v1 / goal 三件 / web_search** —— 没有 apply_patch；
 *   · Windows 上模型只能拿 shell 命令写文件，命令行有长度上限 ⇒ 写稍大的脚本必然「命令太长」；
 *   · 探针补上 `apply_patch_tool_type: "freeform"` 后，工具面多出 apply_patch，且引擎在 Windows
 *     上真把 `*** Begin Patch / Add File` 落了盘（文件内容逐字一致）。
 * 另一半在桥：引擎的 apply_patch 是 **custom 工具**，chat / anthropic 上游只认 function 工具 ——
 * 桥必须降级成 `{input: string}` 的 function 并在回程还原成 custom_tool_call，否则工具被静默丢掉。
 *
 * 判据跑**构建产物**（dist-electron），静态 + 真跑各一半：光看源码正则证明不了引擎真能拿到工具。
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require_ = createRequire(import.meta.url);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const art = (name) => join(ROOT, "dist-electron", name);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/[^'"`]*$/, "")).join("\n");

let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };

console.log("【12ax】apply_patch 工具面 + 桥的双向翻译");

const need = ["responses-bridge.js", "responses-bridge/01-sse-items.js", "responses-bridge/02-chat-convert.js", "responses-bridge/03-anthropic-convert.js", "features/custom-model-probe.js"]
  .filter((f) => !existsSync(art(f)));
if (need.length) {
  ok(false, `构建产物齐备（缺 ${need.join("、")} —— 先 npm run build:electron）`);
} else {
  const probeSrc = stripComments(read("dist-electron/features/custom-model-probe.js"));
  // ① 模型目录必须声明 freeform apply_patch（不写 = 工具面没有这个工具，见文件头探针实测）
  ok(/apply_patch_tool_type:\s*"freeform"/.test(probeSrc),
    "模型目录声明 apply_patch_tool_type = freeform（缺了工具面只有 exec_command，写大文件必撞命令行上限）");
  ok(/catalogModels\.push\(\{[\s\S]{0,2000}?apply_patch_tool_type/.test(probeSrc),
    "声明落在 catalogModels 的每个模型条目里（写在函数外/注释里都不算）");

  const items = require_(art("responses-bridge/01-sse-items.js"));
  const chatConv = require_(art("responses-bridge/02-chat-convert.js"));
  const anthropic = require_(art("responses-bridge/03-anthropic-convert.js"));
  const { customToolNames, customInputFromArgs } = items;
  const { ChatStreamTranslator, toChatRequest, chatJsonToResponses } = chatConv;

  const body = {
    model: "m",
    tools: [{ type: "custom", name: "apply_patch", description: "edit", format: { type: "grammar", syntax: "lark", definition: "start: x" } }],
  };
  const names = customToolNames(body);
  ok(names.has("apply_patch") && names.size === 1, "customToolNames 从请求体认出 custom 工具（回程按它还原）");

  // ② chat 下发：custom → function，参数只有一个 input 字符串
  const chat = toChatRequest(body);
  const chatTool = (chat.tools ?? []).find((t) => t.function?.name === "apply_patch");
  ok(Boolean(chatTool) && chatTool.type === "function",
    "chat 上游收到的是 function 形态的 apply_patch（旧实现直接过滤掉 custom ⇒ 模型以为有、上游根本没有）");
  ok(chatTool?.function?.parameters?.properties?.input?.type === "string",
    "下发的参数是 { input: string }（整段 patch 原样放，不受命令行长度限制）");

  // ③ chat 回程：custom_tool_call + 原样 patch；不发参数增量
  const PATCH = "*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch\n";
  const tr = new ChatStreamTranslator("m", { customTools: names });
  let out = tr.begin();
  const argsJson = JSON.stringify({ input: PATCH });
  out += tr.push({ id: "c", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "apply_patch", arguments: "" } }] } }] });
  for (let i = 0; i < argsJson.length; i += 13) {
    out += tr.push({ id: "c", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argsJson.slice(i, i + 13) } }] } }] });
  }
  out += tr.finish();
  const events = out.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  const done = events.find((e) => e.type === "response.output_item.done" && e.item?.name === "apply_patch");
  ok(done?.item?.type === "custom_tool_call",
    "chat 回程 item 是 custom_tool_call（给成 function_call 引擎按名字找不到工具，这次调用被丢掉）");
  ok(done?.item?.input === PATCH, "回程 input 还原成原样 patch 文本（分片 JSON 已正确拼回并拆包）");
  ok(!events.some((e) => e.type === "response.function_call_arguments.delta"),
    "custom 工具不发 function_call_arguments.delta（JSON 片段会被引擎当 patch 正文）");
  ok(customInputFromArgs('{"input":"abc"}') === "abc" && customInputFromArgs("raw") === "raw" && customInputFromArgs("") === "",
    "customInputFromArgs：有 input 取 input、裸文本原样、空串不炸");

  // ④ 非流式 chat 同样还原
  const jsonOut = chatJsonToResponses({ choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "apply_patch", arguments: argsJson } }] } }] }, "m", names);
  ok(jsonOut.output?.[0]?.type === "custom_tool_call" && jsonOut.output?.[0]?.input === PATCH,
    "非流式 chat 回包还原成 custom_tool_call（漏这条只有流式能用）");

  // ⑤ anthropic 下发 + 回程
  const anth = anthropic.toAnthropicRequest(body);
  const anthTool = (anth.tools ?? []).find((t) => t.name === "apply_patch");
  ok(anthTool?.input_schema?.properties?.input?.type === "string",
    "anthropic 上游也收到 { input: string } 的 apply_patch（input_schema 不是 parameters）");
  const atr = new anthropic.AnthropicStreamTranslator("m", { customTools: names });
  let aout = atr.begin();
  aout += atr.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "apply_patch", input: {} } });
  for (let i = 0; i < argsJson.length; i += 11) {
    aout += atr.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: argsJson.slice(i, i + 11) } });
  }
  aout += atr.finish();
  const aevents = aout.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  const adone = aevents.find((e) => e.type === "response.output_item.done" && e.item?.name === "apply_patch");
  ok(adone?.item?.type === "custom_tool_call" && adone?.item?.input === PATCH,
    "anthropic 回程同样是 custom_tool_call + 原样 patch");
  const ajson = anthropic.anthropicJsonToResponses({ content: [{ type: "tool_use", id: "t1", name: "apply_patch", input: { input: PATCH } }] }, "m", names);
  ok(ajson.output?.[0]?.type === "custom_tool_call" && ajson.output?.[0]?.input === PATCH,
    "非流式 anthropic 回包也还原成 custom_tool_call");

  // ⑥ 负向：普通 function 工具不能被误判成 custom（否则引擎收到 custom_tool_call 找不到工具）
  const normalNames = customToolNames({ tools: [{ type: "function", name: "exec_command" }] });
  const normal = new ChatStreamTranslator("m", { customTools: normalNames });
  let nout = normal.begin();
  nout += normal.push({ id: "c", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "xc", function: { name: "exec_command", arguments: '{"cmd":"ls"}' } }] } }] });
  nout += normal.finish();
  const nevents = nout.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
  const ndone = nevents.find((e) => e.type === "response.output_item.done");
  ok(ndone?.item?.type === "function_call" && ndone?.item?.arguments === '{"cmd":"ls"}',
    "普通 function 工具仍是 function_call（参数增量照常下发）");
}

console.log(fails ? `\n【apply-patch】${fails} 项失败` : `\n【apply-patch】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
