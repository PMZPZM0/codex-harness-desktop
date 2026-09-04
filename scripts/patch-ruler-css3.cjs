// CSS 修正 v3：
// 1) 恢复对话框滚动条（隐藏规则删除）
// 2) 刻度尺区域自身变可滚（悬停时滚轮滚动刻度选区，不是对话内容）
const fs = require("fs");
const cssPath = "src/styles.css";
const s = fs.readFileSync(cssPath, "utf8");

// 1) 删掉隐藏滚动条的规则
const hideRule = "\n/* 隐藏滚动条但保留滚轮：定位交给左侧消息刻度尺 */\n.timeline { scrollbar-width: none; }\n.timeline::-webkit-scrollbar { display: none; }";
if (s.includes(hideRule)) {
  fs.writeFileSync(cssPath, s.replace(hideRule, ""), "utf8");
  console.log("timeline scrollbar restored");
} else {
  console.log("hide rule not found (already restored?)");
}
