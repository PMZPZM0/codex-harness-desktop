/**
 * 输入框上方「N 个文件已修改 +X -Y」胶囊（10-06 夜，用户对照 WorkBuddy 图三/图四定稿）：
 *   · 运行中的回合出现文件改动时，贴在输入框上方 —— 与排队消息 / 询问卡 / 审批卡是
 *     **上下排序关系**（卡片栈里的一行，不互相遮），位置=这一组的首位（"最新消息的最后一行"之后）；
 *   · 鼠标悬停 → 向上展开文件清单（类型图标 + 文件名 + 该文件的 +N -N / 已删除）；
 *   · 数据跟着运行状态**实时更新**（同一个 turn-file-changes-live 源，2.5s 一拍）；
 *   · 回合结束**自动消失**（收尾由流里的「已更改 N 个文件」汇总卡接管）。
 * ⛔ 不许做成 portal 浮层：它是输入框卡片栈的普通一行，遮挡问题从形态上就不该存在。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileCode2 } from "lucide-react";
import { getTurnLiveFileChanges, subscribeTurnFileChanges } from "../../lib/turn-file-changes.mjs";
import { FileTypeIcon } from "../../components/FileTypeIcon";

const POP_LIMIT = 8;

function baseName(path: string): string {
  const norm = String(path ?? "").replaceAll("\\", "/");
  return norm.split("/").pop() ?? norm;
}

export function LiveEditedFilesCard({ runningTurnId }: { runningTurnId: string | null }) {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [popSide, setPopSide] = useState<"above" | "below">("above");
  const cardRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!runningTurnId) return;
    return subscribeTurnFileChanges((changedTurnId: string) => { if (changedTurnId === runningTurnId) setTick((v) => v + 1); });
  }, [runningTurnId]);
  useEffect(() => { if (!runningTurnId) setOpen(false); }, [runningTurnId]);
  // ⛔ 弹出位置自适应（用户 10-06：「别固定，固定容易截掉、展示不全」）：按卡片上下空间选边，
  //   内容超高时按所选边的可用空间收窄（内部滚动），左侧钳进视口 —— 永不越界。
  useLayoutEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    const pop = popRef.current;
    if (!card || !pop) return;
    const rect = card.getBoundingClientRect();
    const vh = window.innerHeight;
    const spaceAbove = rect.top - 12;
    const spaceBelow = vh - rect.bottom - 12;
    const side = spaceAbove >= spaceBelow ? "above" : "below";
    setPopSide(side);
    pop.style.maxHeight = Math.max(120, Math.min(320, (side === "above" ? spaceAbove : spaceBelow) - 8)) + "px";
    const pr = pop.getBoundingClientRect();
    // ⛔ 弹层是 position:absolute，基准是**卡片**（position:relative）——left 必须写「相对卡片的
    //   偏移」：直接写视口坐标会叠加卡片自身左缘（实测 358 的卡片 + 358 的样式 = 画在 716，看着"歪"）。
    //   锚点取**胶囊中心**：胶囊居中后，弹层也以胶囊中心居中（用户 10-06：「放上去展示的那个也要居中」，
    //   左缘对齐会看着偏向右），再钳进视口。
    const anchorRect = pillRef.current ? pillRef.current.getBoundingClientRect() : rect;
    const anchorCenter = anchorRect.left + anchorRect.width / 2;
    const desiredViewLeft = Math.max(8, Math.min(anchorCenter - pr.width / 2, window.innerWidth - pr.width - 8));
    pop.style.left = Math.round(desiredViewLeft - rect.left) + "px";
    pop.style.right = "auto";
  }, [open]);
  const files = runningTurnId ? getTurnLiveFileChanges(runningTurnId) : [];
  if (!runningTurnId || !files.length) return null;
  const totals = files.reduce((sum, file) => ({ added: sum.added + (file.added ?? 0), deleted: sum.deleted + (file.deleted ?? 0) }), { added: 0, deleted: 0 });
  return (
    <div ref={cardRef} className="edited-files-card" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {open && (
        <div ref={popRef} className={`edited-files-pop pop-${popSide}`} role="status" aria-label="本次运行改动的文件">
          {files.slice(0, POP_LIMIT).map((file) => (
            <div className="edited-files-row" key={file.path} title={file.path}>
              <FileTypeIcon path={file.path} size={12} />
              <code>{baseName(file.path)}</code>
              <span className="edited-files-stats">
                {file.status === "deleted" ? <i className="completed-file-gone">已删除</i> : <><b>+{file.added}</b><i>-{file.deleted}</i></>}
              </span>
            </div>
          ))}
          {files.length > POP_LIMIT && <div className="edited-files-more">还有 {files.length - POP_LIMIT} 个文件…</div>}
        </div>
      )}
      <button ref={pillRef} type="button" className="edited-files-pill" title="本次运行中改动的文件（悬停看清单）">
        <FileCode2 size={13} />
        <span>{files.length} 个文件已修改</span>
        <b className="diff-add">+{totals.added}</b>
        <i className="diff-delete">-{totals.deleted}</i>
      </button>
    </div>
  );
}
