// mergeTurn 引用保持补丁：回合快照替换时内容等值的 item 沿用旧引用，memo 不失效
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");
const old = `function mergeTurn(thread: Thread | null, nextTurn: Turn) {
  if (!thread) return thread;
  const current = thread.turns.find((turn) => turn.id === nextTurn.id);
  const items = current ? [...current.items] : [];
  for (const item of nextTurn.items) {
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index === -1) items.push(item);
    else items[index] = item;
  }
  // 保留回合级 usage（引擎在 turn/completed 时附带，旧消息也能展示 token / 缓存）
  const turn = current ? { ...current, ...nextTurn, items, usage: nextTurn.usage ?? current.usage } : nextTurn;
  return { ...thread, turns: current ? thread.turns.map((entry) => entry.id === turn.id ? turn : entry) : [...thread.turns, turn] };
}`;
if (!s.includes(old)) { console.log("MERGETURN NOT FOUND"); process.exit(1); }
const next = `function mergeTurn(thread: Thread | null, nextTurn: Turn) {
  if (!thread) return thread;
  const current = thread.turns.find((turn) => turn.id === nextTurn.id);
  const items = current ? [...current.items] : [];
  for (const item of nextTurn.items) {
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index === -1) { items.push(item); continue; }
    // 引用保持：内容没变的 item 沿用旧引用，memo 才能跳过未变化消息；
    // turn/completed 整回合替换时不再引发全树重渲染（闪烁根源）
    items[index] = stableItem(items[index], item);
  }
  // 保留回合级 usage（引擎在 turn/completed 时附带，旧消息也能展示 token / 缓存）
  const turn = current ? { ...current, ...nextTurn, items, usage: nextTurn.usage ?? current.usage } : nextTurn;
  return { ...thread, turns: current ? thread.turns.map((entry) => entry.id === turn.id ? turn : entry) : [...thread.turns, turn] };
}

/** 服务端快照 vs 本地流式状态：所有字段深比较等值则保留旧引用（memo 命中） */
function stableItem(existing: ThreadItem, next: ThreadItem): ThreadItem {
  const keys = new Set([...Object.keys(existing), ...Object.keys(next)]);
  for (const key of keys) {
    if (JSON.stringify((existing as any)[key]) !== JSON.stringify((next as any)[key])) return next;
  }
  return existing;
}`;
fs.writeFileSync("src/App.tsx", s.replace(old, next));
console.log("mergeTurn reference-preserve patch applied");
