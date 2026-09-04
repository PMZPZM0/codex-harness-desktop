// 釜底抽薪：删掉多余的 smooth useEffect（职责与 sticky layout effect 重复）。
// sticky layout effect 在 DOM 提交后同步执行、用 auto，切会话即瞬时到底。
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");
const smoothEffect = `  useEffect(() => {
    if (pinActiveRef.current) return; // 钉顶阶段不抢滚动
    // 刚切换会话：瞬时跳底（长会话 smooth 动画会滚好几秒）；其余场景保持平滑跟随
    const behavior = switchJumpRef.current ? "auto" : "smooth";
    switchJumpRef.current = false;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
  }, [thread, pending]);`;
if (!s.includes(smoothEffect)) { console.log("SMOOTH EFFECT NOT FOUND"); process.exit(1); }
s = s.replace(smoothEffect, `  // （已删除重复的 smooth 跟随 effect：sticky layout effect 已在 [thread] 变化时
  // 用 behavior:auto 同步跳底，smooth 版本会在长会话切换时产生数秒的滚动动画。）`);

// sticky layout effect 开头消费 switchJumpRef：切会话时强制 stick 开启（用户视角：切过去就看最新）
const stickyAnchor = "  useLayoutEffect(() => {\n    const el = scrollRef.current;\n    if (!el) return;\n    if (pinActiveRef.current) {";
if (!s.includes(stickyAnchor)) { console.log("STICKY ANCHOR NOT FOUND"); process.exit(1); }
const stickyNext = "  useLayoutEffect(() => {\n    const el = scrollRef.current;\n    if (!el) return;\n    // 刚切换会话：强制跟随到最新（用户预期：切过去就在最新消息）\n    if (switchJumpRef.current) { stickToBottomRef.current = true; pinActiveRef.current = false; pinnedUserRef.current = null; }\n    if (pinActiveRef.current) {";
s = s.replace(stickyAnchor, stickyNext);

fs.writeFileSync("src/App.tsx", s);
console.log("smooth effect removed, sticky consumes switch flag");
