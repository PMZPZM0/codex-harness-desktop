// 切会话直接到底：openThread 拿到消息后立刻滚到最新（两帧重试确保渲染完成），
// 不再先归零慢慢找
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");
const old = `    // 切会话后从顶部开始（滚动位置属于旧会话，不能带过来）
    requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = 0; });`;
if (!s.includes(old)) { console.log("ANCHOR NOT FOUND"); process.exit(1); }
const next = `    // 切会话后滚动位置属于旧会话，不能带过来；等新内容渲染后直接跳到最新消息
    requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = 0; });`;
s = s.replace(old, next);
// setThread(result.thread) 后追加跳底
const anchor = `      threadRef.current = result.thread;
      setThread(result.thread);
      setModelId(\`custom:\${customModel?.provider ?? "custom"}:\${result.model}\`);`;
if (!s.includes(anchor)) { console.log("SETTHREAD ANCHOR NOT FOUND"); process.exit(1); }
const anchorNext = `      threadRef.current = result.thread;
      setThread(result.thread);
      // 内容渲染完成后立即定位到最新消息（两帧重试，等 React 提交 DOM）
      requestAnimationFrame(() => requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }));
      setModelId(\`custom:\${customModel?.provider ?? "custom"}:\${result.model}\`);`;
s = s.replace(anchor, anchorNext);
fs.writeFileSync("src/App.tsx", s);
console.log("openThread jump-to-latest added");
