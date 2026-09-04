// startQueued「立即」语义修复：先打断当前回合再启动排队
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");
const EOL = "\r\n";
const old = [
  "  async function startQueued(id?: string) {",
  "    if (!thread) return;",
  "    try {",
  '      await window.codex.request("thread/queue/start", { threadId: thread.id, ...(id ? { queuedSubmissionId: id } : {}) });',
  "      await refreshQueue(thread.id);",
  "    } catch (error: any) {",
  "      setNotice(`启动排队消息失败：${error.message}`);",
  "    }",
  "  }",
].join(EOL);
if (!s.includes(old)) { console.log("STARTQUEUED NOT FOUND"); process.exit(1); }
const next = [
  "  async function startQueued(id?: string) {",
  "    if (!thread) return;",
  "    try {",
  "      // 「立即」语义：打断当前回合再启动排队消息。回合运行中引擎拒绝 queue/start",
  "      //（active or pending turn），必须先 interrupt 并等它真正停止。",
  "      const running = activeTurnId !== null || sending;",
  "      if (running) {",
  '        try { await window.codex.request("turn/interrupt", { threadId: thread.id, turnId: activeTurnId! }); } catch { /* 可能刚好完成 */ }',
  "        for (let attempt = 0; attempt < 20; attempt++) {",
  '          await new Promise((resolve) => setTimeout(resolve, 500));',
  '          const done = await window.codex.request("thread/get", { threadId: thread.id }).then((r: any) => !r.thread?.turns?.some((turn: Turn) => turn.status === "inProgress")).catch(() => true);',
  "          if (done) break;",
  "        }",
  "      }",
  '      await window.codex.request("thread/queue/start", { threadId: thread.id, ...(id ? { queuedSubmissionId: id } : {}) });',
  "      await refreshQueue(thread.id);",
  "    } catch (error: any) {",
  "      setNotice(`启动排队消息失败：${error.message}`);",
  "    }",
  "  }",
].join(EOL);
s = s.replace(old, next);
fs.writeFileSync("src/App.tsx", s);
console.log("startQueued interrupt-first applied");
