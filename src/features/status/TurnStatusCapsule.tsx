/**
 * 回合状态胶囊（10-06 夜三轮，用户对照 Qoder：「步骤 0/6 · 5 个文件已修改 +177 -8」）：
 *   · **左区「步骤 N/M」** = Codex 自己维护的任务清单（task_add / task_update，分发在
 *     part05/event-router/02-request.tsx，常驻指令第 14 条督促它开工建清单、完成一步更新一步）；
 *     悬停展开步骤清单（todo / doing / done 三态）；清单为空时整段不显示。
 *   · **右区「X 个文件已修改 +A -D」** = 运行中实时文件改动（turn-file-changes-live 源，
 *     主进程每 ~2.5s 轻量重扫）；悬停展开文件清单；只在运行中且确实有改动时显示。
 *   · 两区都没有 ⇒ 整卡不渲染。⛔ 用户 10-06 夜定稿的展示规则：**两区各自都能独立居中展示
 *     （只有步骤 = 只显示「步骤 N/M」；只有文件 = 只显示「X 个文件已修改 +A -D」），只有在
 *     两区同时存在时才拼接成「步骤 N/M · X 个文件已修改 +A -D」** —— 别再改成强制同现。
 * ⛔ 原「目标与进程」面板（tb-goals-entry + goals-pop + 顶栏 ··· 菜单里的清单入口）已按用户令
 *   撤掉 —— 任务清单的**唯一常驻入口**就是这条胶囊。
 * ⛔ 不许做成 portal 浮层：它是输入框卡片栈的普通一行（与排队消息 / 询问卡 / 审批卡
 *   上下排序、不互相遮从形态上保证）。
 * ⛔ 文件区数据源、自适应弹层定位逻辑沿用 Round J 版本（那套用户逐条验收过：按空间选边、
 *   按可用空间收窄、以胶囊中心居中、left 写相对卡片偏移——写视口坐标会叠卡片左缘画歪）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleCheck, Circle, ListChecks, LoaderCircle } from "lucide-react";
import { getTurnLiveFileChanges, subscribeTurnFileChanges } from "../../lib/turn-file-changes.mjs";
import { FileTypeIcon } from "../../components/FileTypeIcon";

const POP_LIMIT = 8;
const STEP_LIMIT = 10;

function baseName(path: string): string {
  const norm = String(path ?? "").replaceAll("\\", "/");
  return norm.split("/").pop() ?? norm;
}

type StepRow = { id: string; text: string; state: string };

export function TurnStatusCapsule({ runningTurnId, taskList }: { runningTurnId: string | null; taskList: any[] }) {
  const [, setTick] = useState(0);
  const [zone, setZone] = useState<"steps" | "files" | null>(null);
  const [popSide, setPopSide] = useState<"above" | "below">("above");
  const cardRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!runningTurnId) return;
    return subscribeTurnFileChanges((changedTurnId: string) => { if (changedTurnId === runningTurnId) setTick((v) => v + 1); });
  }, [runningTurnId]);
  // 回合结束后文件区不再有数据 ⇒ 悬停分区若停在 files 需要清掉（steps 区照常）
  useEffect(() => { if (!runningTurnId) setZone((current) => (current === "files" ? null : current)); }, [runningTurnId]);
  // 弹出位置自适应（用户 10-06：「别固定，固定容易截掉、展示不全」）：按卡片上下空间选边，
  // 内容超高时按所选边的可用空间收窄（内部滚动），左右钳进视口 —— 永不越界。
  useLayoutEffect(() => {
    if (!zone) return;
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
    //   锚点取**胶囊中心**：胶囊居中后，弹层也以胶囊中心居中（用户 10-06：「放上去展示的那个也要居中」），
    //   再钳进视口。
    const anchorRect = pillRef.current ? pillRef.current.getBoundingClientRect() : rect;
    const anchorCenter = anchorRect.left + anchorRect.width / 2;
    const desiredViewLeft = Math.max(8, Math.min(anchorCenter - pr.width / 2, window.innerWidth - pr.width - 8));
    pop.style.left = Math.round(desiredViewLeft - rect.left) + "px";
    pop.style.right = "auto";
  }, [zone]);
  const files = runningTurnId ? getTurnLiveFileChanges(runningTurnId) : [];
  const steps: StepRow[] = (Array.isArray(taskList) ? taskList : []).map((task) => ({
    id: String(task?.id ?? ""),
    text: String(task?.text ?? ""),
    state: String(task?.status ?? "todo"),
  }));
  const hasSteps = steps.length > 0;
  const hasFiles = Boolean(runningTurnId) && files.length > 0;
  if (!hasSteps && !hasFiles) return null;
  const doneCount = steps.filter((step) => step.state === "done").length;
  const totals = files.reduce((sum, file) => ({ added: sum.added + (file.added ?? 0), deleted: sum.deleted + (file.deleted ?? 0) }), { added: 0, deleted: 0 });
  return (
    <div ref={cardRef} className="edited-files-card" onMouseLeave={() => setZone(null)}>
      {zone && (
        <div ref={popRef} className={`edited-files-pop pop-${popSide}`} role="status" aria-label={zone === "steps" ? "任务清单" : "本次运行改动的文件"}>
          {zone === "steps" ? (
            <>
              {steps.slice(0, STEP_LIMIT).map((step) => (
                <div className={`turn-step-row ${step.state === "done" ? "done" : step.state === "doing" ? "doing" : ""}`} key={step.id} title={step.text}>
                  {step.state === "done" ? <CircleCheck size={13} /> : step.state === "doing" ? <LoaderCircle size={13} className="spin" /> : <Circle size={13} />}
                  <span>{step.text}</span>
                </div>
              ))}
              {steps.length > STEP_LIMIT && <div className="edited-files-more">还有 {steps.length - STEP_LIMIT} 步…</div>}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
      <button ref={pillRef} type="button" className="edited-files-pill" title="回合状态：步骤清单 / 本次运行改动的文件（悬停对应区段展开）">
        {runningTurnId ? <LoaderCircle size={13} className="spin" /> : <ListChecks size={13} />}
        {hasSteps && (
          <span className="capsule-zone capsule-zone-steps" onMouseEnter={() => setZone("steps")} title="悬停查看步骤清单">
            步骤 {doneCount}/{steps.length}
          </span>
        )}
        {hasSteps && hasFiles && <span className="capsule-sep" aria-hidden>·</span>}
        {hasFiles && (
          <span className="capsule-zone capsule-zone-files" onMouseEnter={() => setZone("files")} title="悬停查看已修改的文件">
            <span>{files.length} 个文件已修改</span>
            <b>+{totals.added}</b>
            <i>-{totals.deleted}</i>
          </span>
        )}
      </button>
    </div>
  );
}
