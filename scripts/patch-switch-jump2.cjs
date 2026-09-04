// 切会话瞬时跳底（CRLF 安全版，全部行级操作）
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");
const EOL = s.includes("\r\n") ? "\r\n" : "\n";
const lines = s.split(/\r?\n/);

// 1) 声明标记：插在 ponytailOn state 行后
let stIdx = lines.findIndex((l) => l.includes("const [ponytailOn, setPonytailOn] = useState(false);"));
if (stIdx < 0) { console.log("STATE LINE NOT FOUND"); process.exit(1); }
if (!s.includes("switchJumpRef")) {
  lines.splice(stIdx + 1, 0, "  // 刚切换会话：首跳用瞬时滚动（auto），之后的流式跟随仍用平滑", "  const switchJumpRef = useRef(false);");
}

// 2) openThread 置位：插在“切会话后滚动位置”注释的下一行
let otIdx = lines.findIndex((l) => l.includes("// 切会话后滚动位置属于旧会话"));
if (otIdx >= 0 && !s.includes("switchJumpRef.current = true")) {
  lines.splice(otIdx + 1, 0, "    switchJumpRef.current = true;");
}

// 3) [thread] 效果首跳 auto
const effIdx = lines.findIndex((l) => l.includes('scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })'));
if (effIdx < 0) { console.log("EFFECT LINE NOT FOUND"); process.exit(1); }
if (!lines[effIdx - 1].includes("switchJumpRef.current ?")) {
  lines.splice(effIdx, 1,
    "    // 刚切换会话：瞬时跳底（长会话 smooth 动画会滚好几秒）；其余场景保持平滑跟随",
    '    const behavior = switchJumpRef.current ? "auto" : "smooth";',
    "    switchJumpRef.current = false;",
    '    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });');
}

fs.writeFileSync("src/App.tsx", lines.join(EOL));
console.log("switch jump auto applied");
