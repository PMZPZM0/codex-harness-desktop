// 切会话首跳瞬时化：openThread 设置 switchJumpRef，[thread] 效果第一跳走 auto；
// 后续流式跟随保持 smooth 体验
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");

// 1) 声明标记（挂在 hookPulse 旁）
const stAnchor = "  const [ponytailOn, setPonytailOn] = useState(false);";
if (!s.includes(stAnchor)) { console.log("STATE ANCHOR MISSING"); process.exit(1); }
s = s.replace(stAnchor, stAnchor + "\n  // 刚切换会话：首跳用瞬时滚动（auto），之后的流式跟随仍用平滑\n  const switchJumpRef = useRef(false);");

// 2) openThread 里置位
const otOld = "    // 切会话后滚动位置属于旧会话，不能带过来；等新内容渲染后直接跳到最新消息\n    requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = 0; });";
if (!s.includes(otOld)) { console.log("OT ANCHOR MISSING"); process.exit(1); }
s = s.replace(otOld, otOld + "\n    switchJumpRef.current = true;");

// 3) [thread] 效果首跳走 auto
const effOld = `  useEffect(() => {
    if (pinActiveRef.current) return; // 钉顶阶段不抢滚动
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread, pending]);`;
if (!s.includes(effOld)) { console.log("EFF ANCHOR MISSING"); process.exit(1); }
const effNew = `  useEffect(() => {
    if (pinActiveRef.current) return; // 钉顶阶段不抢滚动
    // 刚切换会话：瞬时跳底（长会话 smooth 动画会滚好几秒）；其余场景保持平滑跟随
    const behavior = switchJumpRef.current ? "auto" : "smooth";
    switchJumpRef.current = false;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
  }, [thread, pending]);`;
s = s.replace(effOld, effNew);

fs.writeFileSync("src/App.tsx", s);
console.log("switch jump auto applied");
