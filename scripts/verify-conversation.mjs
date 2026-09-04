import assert from "node:assert/strict";
import fs from "node:fs/promises";

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

const previousWorkspace = await evaluate(`localStorage.getItem("workspace")`);
const previousPermissions = await evaluate(`({ approval: localStorage.getItem("default-approval"), sandbox: localStorage.getItem("default-sandbox") })`);
await evaluate(`localStorage.setItem("workspace", ${JSON.stringify(process.env.VERIFY_WORKSPACE || "D:\\2")})`);
await send("Page.reload");
await new Promise((resolve) => setTimeout(resolve, 1800));

const before = await evaluate(`window.codex.request("thread/list", { limit: 100, sortKey: "updated_at", sortDirection: "desc" }).then((result) => result.data.map((thread) => thread.id))`);
await evaluate(`(() => {
  document.querySelector(".new-thread")?.click();
  const textarea = document.querySelector(".composer textarea");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, "Reply with exactly OK.");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".composer").requestSubmit();
})()`);
await new Promise((resolve) => setTimeout(resolve, 100));
assert(await evaluate(`document.querySelector(".user-message")?.innerText.includes("Reply with exactly OK.") ?? false`), "User message was not rendered immediately");

let state;
for (let attempt = 0; attempt < 120; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  state = await evaluate(`({
    running: Boolean(document.querySelector(".stop-button")),
    userVisible: document.querySelector(".user-message")?.innerText.includes("Reply with exactly OK.") ?? false,
    assistant: document.querySelector(".assistant-message")?.innerText ?? "",
    taskCompletion: Boolean(document.querySelector(".turn-process.completed")),
    userLeft: document.querySelector(".user-message")?.getBoundingClientRect().left ?? 0,
    assistantLeft: document.querySelector(".assistant-message")?.getBoundingClientRect().left ?? 0,
  contextRing: Boolean(document.querySelector('.message-footer button[title="从此处分支"] + .context-ring')),
    error: document.querySelector(".notice")?.innerText ?? "",
  })`);
  if (!state.running && (state.assistant || state.error)) break;
}

const after = await evaluate(`window.codex.request("thread/list", { limit: 100, sortKey: "updated_at", sortDirection: "desc" }).then((result) => result.data.map((thread) => thread.id))`);
const created = after.find((id) => !before.includes(id));
if (created) await evaluate(`window.codex.request("thread/delete", { threadId: ${JSON.stringify(created)} })`);

let approvalResult;
if (process.env.VERIFY_APPROVAL === "1") {
  const approvalBefore = await evaluate(`window.codex.request("thread/list", { limit: 100, sortKey: "updated_at", sortDirection: "desc" }).then((result) => result.data.map((thread) => thread.id))`);
  await evaluate(`(() => {
    document.querySelector(".new-thread")?.click();
    const selects = document.querySelectorAll(".composer-setting select");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(selects[1], "read-only");
    selects[1].dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await evaluate(`(() => {
    const selects = document.querySelectorAll(".composer-setting select");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(selects[0], "on-request");
    selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    const textarea = document.querySelector(".composer textarea");
    const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    textSetter.call(textarea, "First send exactly PREPARING as an assistant update. Then run exactly one PowerShell command to create D:\\\\2\\\\codex-harness-approval-test.txt containing exactly OK without a trailing newline. Then reply exactly DONE. Do not inspect the file or run another command.");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".composer").requestSubmit();
  })()`);
  let cardVisible = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    cardVisible = await evaluate(`Boolean(document.querySelector(".approval-card"))`);
    if (cardVisible) break;
  }
  assert(cardVisible, "Official approval request did not appear");
  const approvalWaiting = await evaluate(`(() => { const turn = [...document.querySelectorAll(".codex-turn")].at(-1); const assistant = turn?.querySelector(".assistant-message"); const process = turn?.querySelector(".turn-process.live"); return { paused: document.querySelector(".working-indicator")?.classList.contains("paused") ?? false, spinner: Boolean(document.querySelector(".timeline .spinner")), label: document.querySelector(".working-indicator")?.innerText ?? "", liveGroup: Boolean(process), liveOpen: process?.open ?? false, assistant: assistant?.innerText ?? "", assistantBeforeProcess: Boolean(assistant && process && assistant.compareDocumentPosition(process) & Node.DOCUMENT_POSITION_FOLLOWING), processFooter: Boolean(assistant?.querySelector(".message-footer") || process?.querySelector(".message-footer")) }; })()`);
  assert(approvalWaiting.paused && !approvalWaiting.spinner && approvalWaiting.label.includes("等待你的确认"), "Approval wait should be static instead of spinning");
  assert(approvalWaiting.liveGroup && !approvalWaiting.liveOpen, "Running tools should be grouped and collapsed by default");
  assert(approvalWaiting.assistant.includes("PREPARING") && approvalWaiting.assistantBeforeProcess, "Assistant update must render before its command/tool process");
  assert(!approvalWaiting.processFooter, "Process updates must not render message actions");
  await evaluate(`document.querySelector(".approval-card button.primary")?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const cardDismissed = await evaluate(`!document.querySelector(".approval-card")`);
  let approvalState;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    approvalState = await evaluate(`({ running: Boolean(document.querySelector(".stop-button")), assistant: [...document.querySelectorAll(".assistant-message")].at(-1)?.innerText ?? "", taskCompletion: Boolean(document.querySelector(".turn-process.completed")), processRows: document.querySelectorAll(".process-row").length, summaryFooters: [...document.querySelectorAll(".codex-turn")].at(-1)?.querySelectorAll(":scope > .message-footer").length ?? 0, nestedFooters: [...document.querySelectorAll(".codex-turn")].at(-1)?.querySelectorAll(".turn-process .message-footer").length ?? 0, error: document.querySelector(".notice")?.innerText ?? "" })`);
    if (!approvalState.running && (approvalState.assistant || approvalState.error)) break;
  }
  for (let attempt = 0; !approvalState.running && !approvalState.taskCompletion && !approvalState.error && attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    approvalState = await evaluate(`({ running: Boolean(document.querySelector(".stop-button")), assistant: [...document.querySelectorAll(".assistant-message")].at(-1)?.innerText ?? "", taskCompletion: Boolean(document.querySelector(".turn-process.completed")), processRows: document.querySelectorAll(".process-row").length, summaryFooters: [...document.querySelectorAll(".codex-turn")].at(-1)?.querySelectorAll(":scope > .message-footer").length ?? 0, nestedFooters: [...document.querySelectorAll(".codex-turn")].at(-1)?.querySelectorAll(".turn-process .message-footer").length ?? 0, error: document.querySelector(".notice")?.innerText ?? "" })`);
  }
  const approvalAfter = await evaluate(`window.codex.request("thread/list", { limit: 100, sortKey: "updated_at", sortDirection: "desc" }).then((result) => result.data.map((thread) => thread.id))`);
  const approvalThread = approvalAfter.find((id) => !approvalBefore.includes(id));
  if (approvalThread && !approvalState.running) await evaluate(`window.codex.request("thread/delete", { threadId: ${JSON.stringify(approvalThread)} })`);
  await fs.rm(process.env.VERIFY_APPROVAL_FILE || "D:\\2\\codex-harness-approval-test.txt", { force: true });
  assert(cardDismissed, "Approval card did not close after response");
  assert(!approvalState.error, approvalState.error);
  assert(approvalState.assistant, "Turn did not continue after approval");
  assert(approvalState.taskCompletion, `Completed tool task did not render its completion summary: ${JSON.stringify(approvalState)}`);
  assert.equal(approvalState.summaryFooters, 1, "Only the final summary should render message actions");
  assert.equal(approvalState.nestedFooters, 0, "Process messages must not render message actions");
  await evaluate(`document.querySelector(".turn-process.completed")?.scrollIntoView({ block: "center" })`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const collapsedCapture = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile("harness-process-collapsed.png", Buffer.from(collapsedCapture.result.data, "base64"));
  const completedProcess = await evaluate(`(async () => { const details = document.querySelector(".turn-process.completed"); const summary = details.querySelector(".process-summary"); const final = [...document.querySelectorAll(".codex-turn > .assistant-message")].at(-1); const folded = !details.classList.contains("open"); const leadHiddenWhenFolded = !details.querySelector(".process-lead"); summary.click(); await new Promise((resolve) => setTimeout(resolve, 50)); const lead = details.querySelector(".process-lead"); const content = details.querySelector(".process-content"); return { folded, leadHiddenWhenFolded, open: details.classList.contains("open"), summary: summary.innerText, leadBeforeSummary: Boolean(lead && lead.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING), summaryBeforeFinal: Boolean(final && summary.compareDocumentPosition(final) & Node.DOCUMENT_POSITION_FOLLOWING), commands: content?.querySelectorAll(".process-row").length ?? 0, interimAssistant: Boolean(lead?.querySelector(".assistant-message")), animation: content ? getComputedStyle(content).animationName : "" }; })()`);
  await new Promise((resolve) => setTimeout(resolve, 220));
  const expandedCapture = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile("harness-process-expanded.png", Buffer.from(expandedCapture.result.data, "base64"));
  assert(completedProcess.folded && completedProcess.leadHiddenWhenFolded && completedProcess.open && completedProcess.summary.includes("已工作"), "Completed process should fold into the elapsed-time row");
  assert(completedProcess.leadBeforeSummary && completedProcess.summaryBeforeFinal && completedProcess.interimAssistant, "Completed process must preserve its lead text before the elapsed row and final summary");
  assert(completedProcess.commands > 0 && completedProcess.animation === "process-reveal", "Expanded process must show command details with a transition");
  approvalResult = { cardVisible, cardDismissed, completed: true, testThreadDeleted: Boolean(approvalThread && !approvalState.running) };
}

if (previousWorkspace == null) await evaluate(`localStorage.removeItem("workspace")`);
else await evaluate(`localStorage.setItem("workspace", ${JSON.stringify(previousWorkspace)})`);
await evaluate(`(() => {
  const previous = ${JSON.stringify(previousPermissions)};
  for (const [key, value] of [["default-approval", previous.approval], ["default-sandbox", previous.sandbox]]) {
    if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  }
})()`);

assert(!state.error, state.error);
assert(state.userVisible, "User message disappeared after turn completion");
assert(state.assistant, "Assistant response was not rendered");
assert.equal(state.taskCompletion, false, "Ordinary conversation should not render a task completion summary");
assert(state.userLeft > state.assistantLeft, "User messages should be on the right and Codex messages on the left");

assert(state.contextRing, "Context progress ring is not next to the branch action");
socket.close();
console.log(JSON.stringify({ immediateUserMessage: true, persistedUserMessage: state.userVisible, assistant: state.assistant.slice(0, 120), testThreadDeleted: Boolean(created), approval: approvalResult }));
