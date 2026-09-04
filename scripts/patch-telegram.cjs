// Telegram 接线补丁（脚本文件避免 -e 转义问题）
const fs = require("fs");
let s = fs.readFileSync("electron/main.ts", "utf8");

// 1) import
const impAnchor = 'import { WeixinGateway } from "./weixin-gateway";';
if (!s.includes(impAnchor)) { console.log("import anchor missing"); process.exit(1); }
if (!s.includes("TelegramGateway")) s = s.replace(impAnchor, impAnchor + '\nimport { TelegramGateway } from "./telegram-gateway";');

// 2) gateway + handler + IPC，插在 weixin:status 之后
const anchor = 'ipcMain.handle("weixin:status", async () => ({ bound: weixinGateway?.hasSession() ?? false }));';
if (!s.includes(anchor)) { console.log("ipc anchor missing"); process.exit(1); }
const block = `

const telegramGateway = new TelegramGateway({
  onMessage: (message) => void handleTelegramMessage(message),
  log: (level, message) => {
    channelLogs.push({ at: Date.now(), level, message });
    sendToWindow("channel-bot:event", { level, message, at: Date.now(), status: channelBot.status() });
  },
});
const telegramBindings = new Map<string, number>();
async function handleTelegramMessage(message: { from: string; chatId: number; text: string }) {
  try {
    const model = await readCustomModel();
    if (!model) { await telegramGateway.sendText(message.chatId, "请先在应用里配置模型。"); return; }
    let threadId = weixinBindings.get("tg:" + message.from) ?? "";
    if (threadId) { try { await server.request("thread/resume", { threadId, excludeTurns: false }); } catch { threadId = ""; weixinBindings.delete("tg:" + message.from); } }
    if (!threadId) {
      const botConfig = await readChannelBot().catch(() => null);
      const started = await server.request("thread/start", { model: model.model, cwd: botConfig?.workspace || app.getPath("home"), approvalPolicy: "never", sandbox: "danger-full-access", modelProvider: model.provider }) as any;
      threadId = started.thread.id;
      weixinBindings.set("tg:" + message.from, threadId);
    }
    const chatId = message.chatId;
    const onDoneProxy = (event: any) => {
      if (event.kind !== "notification" || event.method !== "turn/completed" || event.params?.threadId !== threadId) return;
      server.off("event", onDoneProxy);
      const finalText = [...(event.params?.turn?.items ?? [])].reverse().find((item: any) => item.type === "agentMessage")?.text ?? "";
      if (finalText.trim()) telegramGateway.sendText(chatId, finalText.trim()).catch(() => undefined);
    };
    server.on("event", onDoneProxy);
    await server.request("turn/start", { threadId, input: [{ type: "text", text: message.text, text_elements: [] }], model: model.model, effort: "high" });
  } catch (error: any) {
    telegramGateway.sendText(message.chatId, \`处理失败：\${error.message}\`).catch(() => undefined);
  }
}
ipcMain.handle("telegram:connect", async (_event, token: string) => { try { return { ok: true, ...(await telegramGateway.connect(String(token ?? ""))) }; } catch (error: any) { return { ok: false, error: error.message }; } });
ipcMain.handle("telegram:status", async () => ({ bound: telegramGateway.hasSession() }));`;
s = s.replace(anchor, anchor + block);
fs.writeFileSync("electron/main.ts", s);
console.log("telegram wired ok");
