// 回合 footer 末尾追加 Hook 徽标：小钩子图标（有注入时出现，微脉冲动效），hover 弹出本次注入的 hook 明细
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");

const old = `{completedTask && finalAgent && <MessageFooter item={finalAgent} turn={turn} usage={usage} tokenUsage={tokenUsage} fallbackWindow={fallbackWindow} onCopy={onCopy} onQuote={onQuote} onFork={() => onFork(turn.id)} />}`;
if (!s.includes(old)) { console.log("FOOTER LINE NOT FOUND"); process.exit(1); }
const next = `{completedTask && finalAgent && <MessageFooter item={finalAgent} turn={turn} usage={usage} tokenUsage={tokenUsage} fallbackWindow={fallbackWindow} onCopy={onCopy} onQuote={onQuote} onFork={() => onFork(turn.id)} extraIcon={hookPulse.hooks.length > 0 && turn.id === latestCompletedTurn?.id ? <HookBadge hooks={hookPulse.hooks} /> : undefined} />}`;
s = s.replace(old, next);

// HookBadge 组件（放在 ReasoningCard 附近之前插入）
const anchor = "function noticeTone(text: string)";
if (!s.includes(anchor)) { console.log("BADGE ANCHOR MISSING"); process.exit(1); }
const badge = `/** Hook 注入徽标：footer 末尾的小钩子图标，hover 展开本次注入的 hook 列表 */
function HookBadge({ hooks }: { hooks: { name: string; done: boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="hook-badge-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className={\`hook-badge \${hooks.every((h) => h.done) ? "done" : "running"}\`} title="本回合注入的 Hook"><Wrench size={12} />{hooks.length}</span>
      {open && (
        <span className="hook-badge-pop">
          {hooks.map((hook) => <span className="hook-badge-row" key={hook.name}><span className={\`hook-dot \${hook.done ? "ok" : ""}\`} />{hook.name}</span>)}
        </span>
      )}
    </span>
  );
}

function noticeTone(text: string)`;
s = s.replace(anchor, badge);

// MessageFooter 支持 extraIcon
const mfOld = "function MessageFooter({ item, turn, usage, tokenUsage, fallbackWindow, onCopy, onQuote, onFork, onEdit }: { item: ThreadItem; turn?: Turn; usage?: any; tokenUsage?: any; fallbackWindow?: number; onCopy: (text: string) => void; onQuote: (text: string) => void; onFork?: () => void; onEdit?: () => void }) {";
if (!s.includes(mfOld)) { console.log("MF SIGNATURE NOT FOUND"); process.exit(1); }
const mfNew = "function MessageFooter({ item, turn, usage, tokenUsage, fallbackWindow, onCopy, onQuote, onFork, onEdit, extraIcon }: { item: ThreadItem; turn?: Turn; usage?: any; tokenUsage?: any; fallbackWindow?: number; onCopy: (text: string) => void; onQuote: (text: string) => void; onFork?: () => void; onEdit?: () => void; extraIcon?: any }) {";
s = s.replace(mfOld, mfNew);
// footer 渲染尾部追加 extraIcon
const tailOld = `      {isAgent && text && <button className="message-action message-action-extra" title="引用到输入框" onClick={() => onQuote(text)}><Quote size={12} /></button>}
    </div>
  );
}`;
if (!s.includes(tailOld)) { console.log("MF TAIL NOT FOUND"); process.exit(1); }
const tailNew = `      {isAgent && text && <button className="message-action message-action-extra" title="引用到输入框" onClick={() => onQuote(text)}><Quote size={12} /></button>}
      {extraIcon}
    </div>
  );
}`;
s = s.replace(tailOld, tailNew);

fs.writeFileSync("src/App.tsx", s);
console.log("hook badge wired into footer");
