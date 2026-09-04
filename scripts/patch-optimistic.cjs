// 乐观气泡收口：turn/started 或 item/started 只要服务端出现了任何用户消息，
// 且乐观气泡文本与服务端消息一致（或时间超过 3 秒），立即清除——
// 防止乐观气泡残留导致后续回合排到它前面（消息倒序的根源）
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");
const old = `      if (method === "turn/started") {
        setActiveTurnId(params.turn.id);
        setWorkStartedAt(Date.now());
        turnStartedAtRef.current.set(params.turn.id, Date.now());
        if (params.turn.items?.some((item: ThreadItem) => item.type === "userMessage")) setOptimisticInput(null);
      } else if (method === "turn/completed") {`;
if (!s.includes(old)) { console.log("ANCHOR NOT FOUND"); process.exit(1); }
const next = `      if (method === "turn/started") {
        setActiveTurnId(params.turn.id);
        setWorkStartedAt(Date.now());
        turnStartedAtRef.current.set(params.turn.id, Date.now());
        if (params.turn.items?.some((item: ThreadItem) => item.type === "userMessage")) setOptimisticInput(null);
      } else if (method === "item/started" && params.item?.type === "userMessage") {
        // 服务端用户消息已落地：乐观气泡立即让位（否则下一回合会渲染到它前面，造成消息倒序）
        setOptimisticInput((current) => {
          if (!current) return current;
          const optimisticText = (current.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\\n");
          const serverText = (params.item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\\n");
          return optimisticText.trim() === serverText.trim() || Date.now() - Number(current.id.split("-")[1] ?? 0) > 3000 ? null : current;
        });
      } else if (method === "turn/completed") {`;
fs.writeFileSync("src/App.tsx", s.replace(old, next));
console.log("optimistic clear tightened");
