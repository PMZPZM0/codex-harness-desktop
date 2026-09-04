import fs from "fs";

let s = fs.readFileSync("src/App.tsx", "utf8").replace(/\r\n/g, "\n");
let n = 0;
function rep(oldStr, newStr) {
  const i = s.indexOf(oldStr);
  if (i === -1) { console.error("NOT FOUND: " + JSON.stringify(oldStr.slice(0, 90))); process.exit(1); }
  s = s.slice(0, i) + newStr + s.slice(i + oldStr.length);
  n++;
}

// 1. togglePinned 函数（放在 deleteMemoryRecord 相关的记忆操作旁，加在 saveMemoryRecord 前）
rep(`  async function saveMemoryRecord() {`, `  async function togglePinned(id: string) {
    const entry = memories.find((item) => item.id === id);
    if (!entry) return;
    try {
      const saved = await window.codex.saveMemory({ id, category: entry.category, content: entry.content, sourceThreadId: entry.sourceThreadId, pinned: !entry.pinned, workspace: (entry as any).workspace });
      setMemories((current) => current.map((item) => item.id === id ? saved : item));
      setMemoryStatus(saved.pinned ? "已置顶为核心记忆" : "已取消置顶");
    } catch (error: any) { setMemoryStatus(error.message); }
  }

  async function saveMemoryRecord() {`);

// 2. 记忆卡片：加 pinned 星标 + 工作区标签
rep(`                  <article className="memory-card" key={entry.id}>
                    <div className="memory-card-head">
                      <span className="memory-category-pill">{entry.category}</span>
                      <button className="icon-button" title="删除" onClick={() => void deleteMemoryRecord(entry.id)}><Trash2 size={12} /></button>
                    </div>
                    <p>{entry.content}</p>
                    <small>{entry.sourceThreadId ? \`来源 \${entry.sourceThreadId.slice(0, 8)}\` : "手动保存"}</small>
                  </article>`,
`                  <article className={\`memory-card \${(entry as any).pinned ? "pinned" : ""}\`} key={entry.id}>
                    <div className="memory-card-head">
                      <span className="memory-category-pill">{entry.category}</span>
                      {(entry as any).pinned && <span className="memory-pin-badge" title="核心记忆，不被自动清理">★ 核心</span>}
                      {(entry as any).workspace && <span className="memory-ws-badge" title="项目记忆">{(entry as any).workspace.split(/[\\\\/]/).pop()}</span>}
                      <button className={\`icon-button \${(entry as any).pinned ? "pin-on" : ""}\`} title={(entry as any).pinned ? "取消置顶" : "置顶为核心记忆"} onClick={() => void togglePinned(entry.id)}><Star size={12} /></button>
                      <button className="icon-button" title="删除" onClick={() => void deleteMemoryRecord(entry.id)}><Trash2 size={12} /></button>
                    </div>
                    <p>{entry.content}</p>
                    <small>{entry.sourceThreadId ? \`来源 \${entry.sourceThreadId.slice(0, 8)}\` : "手动保存"}</small>
                  </article>`);

fs.writeFileSync("src/App.tsx", s.replace(/\n/g, "\r\n"), "utf8");
console.log("App.tsx patched: " + n);
