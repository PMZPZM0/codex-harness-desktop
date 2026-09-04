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

await new Promise((resolve) => setTimeout(resolve, 1500));
const previousTheme = await evaluate(`localStorage.getItem("theme")`);
const previousDefaults = await evaluate(`({ model: localStorage.getItem("default-model"), effort: localStorage.getItem("default-effort"), approval: localStorage.getItem("default-approval"), sandbox: localStorage.getItem("default-sandbox"), personality: localStorage.getItem("default-personality") })`);
const state = await evaluate(`(() => {
  const selects = document.querySelectorAll(".model-controls select");
  const effort = selects[1];
  return {
    text: document.body.innerText,
    threadCount: document.querySelectorAll(".thread-row").length,
    configured: !selects[0]?.disabled,
    modelCount: selects[0]?.options.length ?? 0,
    selectedModelPresent: Boolean(selects[0]?.value && [...selects[0].options].some((option) => option.value === selects[0].value)),
    effortCount: effort?.options.length ?? 0,
    effort: effort?.value,
    savedEffort: localStorage.getItem("default-effort"),
    highestEffort: effort?.options[effort.options.length - 1]?.value,
    reasoningVisible: Boolean(document.querySelector(".reasoning")),
    composerSettings: document.querySelectorAll(".composer-setting select").length,
    rightPanelText: document.querySelector(".context-panel")?.innerText ?? "",
  };
})()`);
assert(state.text.includes("Codex Harness"));
assert(!state.reasoningVisible, "Reasoning content should not be rendered");
assert.equal(state.composerSettings, 2, "Composer permission controls are missing");
assert(!state.rightPanelText.includes("运行权限"), "Runtime permissions must not occupy the right panel");
assert(!state.rightPanelText.includes("本任务 Token"), "Token summary must not occupy the right panel");
assert(!state.rightPanelText.includes("功能清单"), "Feature checklist should not occupy the right panel");
assert.equal(await evaluate(`document.querySelectorAll(".timeline .spinner").length`), 0, "Timeline must not create a spinner while idle");
if (state.configured) {
  assert(state.modelCount >= 1 && state.selectedModelPresent, "Configured or discovered models are not selectable");
  assert(state.effortCount >= 5, "Custom reasoning options did not load");
  assert.equal(state.effort, state.savedEffort || state.highestEffort, "Saved reasoning effort was not restored");
} else {
  assert.equal(state.effortCount, 0, "Reasoning should remain disabled until a custom model is configured");
}

const settingsResult = await evaluate(`(() => {
  document.querySelector('.settings-modal button[title="关闭"]')?.click();
  const button = document.querySelector(".sidebar-settings");
  button?.click();
  return { clicked: Boolean(button), topbarSettings: Boolean(document.querySelector('.topbar button[title="设置"]')), settingsButtons: document.querySelectorAll('.sidebar-settings').length };
})()`);
await new Promise((resolve) => setTimeout(resolve, 50));
assert(settingsResult.clicked && await evaluate(`Boolean(document.querySelector(".settings-modal"))`), "Settings modal did not open from the sidebar");
assert.equal(settingsResult.topbarSettings, false, "Topbar settings entry should be removed");
assert.equal(settingsResult.settingsButtons, 1, "Settings entry should appear once in the sidebar");
const navCount = await evaluate(`document.querySelectorAll('.settings-nav button').length`);
assert.equal(navCount, 15, "Settings category navigation is incomplete");
const openSettingsPage = async (name) => {
  await evaluate(`[...document.querySelectorAll('.settings-nav button')].find((button) => button.innerText.includes(${JSON.stringify(name)}))?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const page = await evaluate(`({ text: document.querySelector('.settings-content').innerText, sections: document.querySelectorAll('.settings-content > .settings-section').length })`);
  assert.equal(page.sections, 1, `${name} should render exactly one settings page`);
  return page.text;
};
let settingsText = await openSettingsPage("模型");
assert(settingsText.includes("测试连通"), "Provider connectivity test is missing");
assert(settingsText.includes("获取模型"), "Provider model discovery is missing");

settingsText = await openSettingsPage("记忆");
assert(settingsText.includes("TencentDB Gateway 地址"), "TencentDB memory gateway settings are missing");
settingsText = await openSettingsPage("定时任务");
assert(settingsText.includes("添加任务"), "Scheduled task settings are missing");
settingsText = await openSettingsPage("插件");
assert(settingsText.includes("Plugins"), "Plugin resource panel is missing");
settingsText = await openSettingsPage("技能");
assert(settingsText.includes("Skills"), "Skills resource panel is missing");
settingsText = await openSettingsPage("电脑控制");
assert(settingsText.includes("审批"), "Computer control settings are missing");
const settingsLayout = await evaluate(`(() => { const modal = document.querySelector('.settings-modal'); const content = document.querySelector('.settings-content'); const rect = modal.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: document.documentElement.clientWidth, contentWidth: content.clientWidth, contentScrollWidth: content.scrollWidth }; })()`);
assert(settingsLayout.left >= 0 && settingsLayout.right <= settingsLayout.width, "Settings modal is outside the viewport");
assert.equal(settingsLayout.contentScrollWidth, settingsLayout.contentWidth, "Settings content has horizontal overflow");
const settingsCapture = await send("Page.captureScreenshot", { format: "png" });
await fs.writeFile("harness-settings.png", Buffer.from(settingsCapture.result.data, "base64"));
await openSettingsPage("外观");
await evaluate(`document.querySelector('.theme-switch button:first-child')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
const lightTheme = await evaluate(`document.documentElement.dataset.theme`);
assert.equal(lightTheme, "light", "Light theme did not apply");
await evaluate(`document.querySelector('.theme-switch button:last-child')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
const darkTheme = await evaluate(`document.documentElement.dataset.theme`);
assert.equal(darkTheme, "dark", "Dark theme did not apply");
await evaluate(`document.querySelector('.settings-modal .icon-button')?.click()`);

await evaluate(`localStorage.removeItem("theme"); location.reload()`);
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(await evaluate(`document.documentElement.dataset.theme`), "light", "First launch theme should default to light");
await evaluate(`document.querySelector('.sidebar-settings')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 50));
await openSettingsPage("外观");
await evaluate(`document.querySelector('.theme-switch button:last-child')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
await send("Page.reload");
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(await evaluate(`document.documentElement.dataset.theme`), "dark", "Saved theme should survive reload");
await evaluate(`document.querySelector('.settings-modal .icon-button')?.click()`);

const commandResult = await evaluate(`(() => {
  const textarea = document.querySelector('.composer textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, '/status');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
assert(commandResult);
await new Promise((resolve) => setTimeout(resolve, 50));
const paletteCount = await evaluate(`document.querySelectorAll('.command-palette button').length`);
assert.equal(paletteCount, 1, "Slash command palette did not filter commands");
await evaluate(`document.querySelector('.command-palette button')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 50));
const commandExecuted = await evaluate(`document.body.innerText.includes('任务状态')`);
assert(commandExecuted, "Slash command did not execute");

if (state.configured) {
  await evaluate(`(() => {
    const selects = document.querySelectorAll('.model-controls select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    const model = selects[0];
    setter.call(model, model.options[model.options.length - 1].value);
    model.dispatchEvent(new Event('change', { bubbles: true }));
    setter.call(selects[1], 'high');
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}
await evaluate(`(() => {
  const selects = document.querySelectorAll('.composer-setting select');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(selects[1], 'danger-full-access');
  selects[1].dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 50));
const fullAccess = await evaluate(`(() => { const selects = document.querySelectorAll('.composer-setting select'); return { approval: selects[0].value, disabled: selects[0].disabled, sandbox: selects[1].value }; })()`);
assert.deepEqual(fullAccess, { approval: "never", disabled: true, sandbox: "danger-full-access" }, "Full access did not disable approvals");
await new Promise((resolve) => setTimeout(resolve, 100));
const savedPreferences = await evaluate(`(() => { const model = document.querySelectorAll('.model-controls select'); return { model: model[0].value, effort: model[1].value, approval: localStorage.getItem('default-approval'), sandbox: localStorage.getItem('default-sandbox') }; })()`);
await send("Page.reload");
await new Promise((resolve) => setTimeout(resolve, 1800));
const restoredPreferences = await evaluate(`(() => { const model = document.querySelectorAll('.model-controls select'); const permissions = document.querySelectorAll('.composer-setting select'); return { model: model[0].value, effort: model[1].value, approval: permissions[0].value, sandbox: permissions[1].value }; })()`);
assert.deepEqual(restoredPreferences, { model: savedPreferences.model, effort: savedPreferences.effort, approval: savedPreferences.approval, sandbox: savedPreferences.sandbox }, "Model, effort, and permissions did not survive reload");
const defaultsBeforeThreadOpen = await evaluate(`({ model: localStorage.getItem("default-model"), effort: localStorage.getItem("default-effort"), approval: localStorage.getItem("default-approval"), sandbox: localStorage.getItem("default-sandbox") })`);
if (await evaluate(`Boolean(document.querySelector(".thread-row button"))`)) {
  await evaluate(`document.querySelector(".thread-row button")?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const defaultsAfterThreadOpen = await evaluate(`({ model: localStorage.getItem("default-model"), effort: localStorage.getItem("default-effort"), approval: localStorage.getItem("default-approval"), sandbox: localStorage.getItem("default-sandbox") })`);
  assert.deepEqual(defaultsAfterThreadOpen, defaultsBeforeThreadOpen, "Opening an old task must not overwrite saved defaults");
  await evaluate(`document.querySelector(".new-thread")?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const freshDefaults = await evaluate(`(() => { const model = document.querySelectorAll('.model-controls select'); const permissions = document.querySelectorAll('.composer-setting select'); return { model: model[0].value, effort: model[1].value, approval: permissions[0].value, sandbox: permissions[1].value }; })()`);
  assert.deepEqual(freshDefaults, defaultsBeforeThreadOpen, "A new task must restore saved defaults after opening an old task");
}

let disposableThreadId;
try {
  disposableThreadId = await evaluate(`(async () => {
    const started = await window.codex.request("thread/start", { model: "gpt-5.2-codex", cwd: localStorage.getItem("workspace") || "D:\\\\", approvalPolicy: "never", sandbox: "read-only" });
    return started.thread.id;
  })()`);
  await evaluate(`window.codex.request("thread/delete", { threadId: ${JSON.stringify(disposableThreadId)} })`);
  disposableThreadId = undefined;
  await evaluate(`document.querySelector('.archive-toggle')?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const archivedActions = await evaluate(`(() => {
    const row = document.querySelector('.thread-row');
    if (!row) return null;
    window.__deleteConfirmCount = 0;
    window.confirm = () => { window.__deleteConfirmCount += 1; return false; };
    row.querySelector('button[title="永久删除"]')?.click();
    return { titles: [...row.querySelectorAll('button[title]')].map((button) => button.title), confirms: window.__deleteConfirmCount };
  })()`);
  if (archivedActions) {
    assert.deepEqual(archivedActions.titles, ["恢复", "永久删除"], "Archived task actions are incomplete");
    assert.equal(archivedActions.confirms, 1, "Permanent delete action is not wired to confirmation");
  }
  await evaluate(`document.querySelector('.archive-toggle')?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 100));
} finally {
  if (disposableThreadId) await evaluate(`window.codex.request("thread/delete", { threadId: ${JSON.stringify(disposableThreadId)} }).catch(() => undefined)`);
}

if (!state.configured) {
  await evaluate(`(() => {
    const textarea = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, 'test');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.composer').requestSubmit();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const settingsOpened = await evaluate(`Boolean(document.querySelector('.settings-modal'))`);
  assert(settingsOpened, "Sending without a custom model did not open settings");
  await evaluate(`document.querySelector('.settings-modal .icon-button')?.click()`);
}

for (const [name, width, height] of [["desktop", 1440, 900], ["narrow", 900, 700]]) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const layout = await evaluate(`(() => {
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
    return { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, sidebarRight: sidebar.right };
  })()`);
  assert.equal(layout.scrollWidth, layout.width, `${name} layout has horizontal overflow`);
  if (name === "narrow") assert(layout.sidebarRight <= 0, "Narrow sidebar is still visible when closed");
  const capture = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(`harness-${name}.png`, Buffer.from(capture.result.data, "base64"));
}

await evaluate(`(() => {
  const values = { theme: ${JSON.stringify(previousTheme)}, ...${JSON.stringify(previousDefaults)} };
  for (const [key, value] of [["theme", values.theme], ["default-model", values.model], ["default-effort", values.effort], ["default-approval", values.approval], ["default-sandbox", values.sandbox], ["default-personality", values.personality]]) {
    if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  }
})()`);

socket.close();
console.log(JSON.stringify({ configured: state.configured, threadCount: state.threadCount, modelCount: state.modelCount, effortCount: state.effortCount, defaultEffort: state.effort, slashCommands: paletteCount }));
