// spacer 与乐观气泡解耦：只按回合状态给缓冲；乐观消息存在时给 compact 跟随留白
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");
const old = `{/* 钉顶空间分段控制：发送瞬间（还没有回合内容）用大缓冲保证消息能钉顶；
              回合开始回复后收紧为小留白、跟随最新消息展示；回合结束后彻底移除，不留空白。 */}
          {optimisticInput && !activeTurnId ? <div className="timeline-bottom-spacer" aria-hidden />
            : (activeTurnId || sending) ? <div className="timeline-bottom-spacer compact" aria-hidden />
            : null}`;
if (!s.includes(old)) { console.log("SPACER BLOCK NOT FOUND"); process.exit(1); }
const next = `{/* 底部留白只按回合状态：活跃回合给 compact 跟随留白；空闲态一律不留空白。
              乐观气泡不再触发大缓冲（它会在服务端消息确认后消失，大缓冲会残留成空白）。 */}
          {(activeTurnId || sending || optimisticInput) ? <div className="timeline-bottom-spacer compact" aria-hidden />
            : null}`;
s = s.replace(old, next);
fs.writeFileSync("src/App.tsx", s);
console.log("spacer decoupled");
