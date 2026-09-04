// TurnView 接收 hookBadge prop（App 根计算后下传）
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");

// 1) TurnView 签名加 hookBadge
const sigOld = "function TurnView({ turn, usage, tokenUsage, fallbackWindow, waitingForApproval, interruptedAt, onCopy, onQuote, onFork, onImageCopy, onEdit }: { turn: Turn; usage?: any; tokenUsage?: any; fallbackWindow?: number; waitingForApproval?: boolean; interruptedAt?: number; onCopy: (text: string) => void; onQuote: (text: string) => void; onFork: (turnId: string) => void; onImageCopy: (path: string) => void; onEdit?: (turnId: string, item: ThreadItem) => void }) {";
if (!s.includes(sigOld)) { console.log("TV SIG NOT FOUND"); process.exit(1); }
const sigNew = "function TurnView({ turn, usage, tokenUsage, fallbackWindow, waitingForApproval, interruptedAt, onCopy, onQuote, onFork, onImageCopy, onEdit, hookBadge }: { turn: Turn; usage?: any; tokenUsage?: any; fallbackWindow?: number; waitingForApproval?: boolean; interruptedAt?: number; onCopy: (text: string) => void; onQuote: (text: string) => void; onFork: (turnId: string) => void; onImageCopy: (path: string) => void; onEdit?: (turnId: string, item: ThreadItem) => void; hookBadge?: any }) {";
s = s.replace(sigOld, sigNew);

// 2) footer 用 hookBadge prop
const fOld = "extraIcon={hookPulse.hooks.length > 0 && turn.id === latestCompletedTurn?.id ? <HookBadge hooks={hookPulse.hooks} /> : undefined}";
if (!s.includes(fOld)) { console.log("FOOTER REF NOT FOUND"); process.exit(1); }
s = s.replace(fOld, "extraIcon={hookBadge}");

// 3) App 层 TurnView 调用点传值
const callOld = "onEdit={(turnId, item) => void editResend(turnId, item)} key={turn.id} />";
if (!s.includes(callOld)) { console.log("CALL NOT FOUND"); process.exit(1); }
const callNew = "onEdit={(turnId, item) => void editResend(turnId, item)} hookBadge={hookPulse.hooks.length > 0 && turn.id === latestCompletedTurn?.id ? <HookBadge hooks={hookPulse.hooks} /> : undefined} key={turn.id} />";
s = s.replace(callOld, callNew);

fs.writeFileSync("src/App.tsx", s);
console.log("TurnView hookBadge prop wired");
