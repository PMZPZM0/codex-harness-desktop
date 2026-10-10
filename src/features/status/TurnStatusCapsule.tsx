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
 *   · 生命周期（10-06 夜四轮 + 夜六轮，用户实测三条）：
 *     ① **回合结束（跑完/被停止）⇒ 步骤区随整卡消失**——步骤区与文件区一样**只在回合运行中显示**
 *        （用户：「清单不会自动消失」；含被 /stop 停掉的回合）；
 *     ② **步骤全部完成 ⇒ 步骤区隐藏**（跑着也一样，收工了没内容可跟）；
 *     ③ **新回合开工（用户直发消息）⇒ 宿主清掉上一轮清单**（tasks:clear，见 send.tsx）——
 *        旧清单不许跨回合冒出来（用户：「新回合，旧的任务清单还在」）；同轮内模型续建的
 *        全完成清单在 task_add 时也会被自动清（electron/rpa-store.ts 的 addTask，批内补步不受影响）。
 * ⛔ 原「目标与进程」面板（tb-goals-entry + goals-pop + 顶栏 ··· 菜单里的清单入口）已按用户令
 *   撤掉 —— 任务清单的**唯一常驻入口**就是这条胶囊。
 * ⛔ 不许做成 portal 浮层：它是输入框卡片栈的普通一行（与排队消息 / 询问卡 / 审批卡
 *   上下排序、不互相遮从形态上保证）。
 * ⛔ 文件区数据源、自适应弹层定位逻辑沿用 Round J 版本（那套用户逐条验收过：按空间选边、
 *   按可用空间收窄、以胶囊中心居中、left 写相对卡片偏移——写视口坐标会叠卡片左缘画歪）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, Circle, ListChecks, LoaderCircle } from "lucide-react";
import { getTurnLiveFileChanges, subscribeTurnFileChanges } from "../../lib/turn-file-changes.mjs";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { ToolCodeBlock } from "../shared/ToolCodeBlock";
import { isImagePath } from "../../lib/is-image-path";
import { openImageLightbox } from "../../lib/ui-channels";

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
  // 回合结束 ⇒ 两区都隐藏（见下方 hasSteps）⇒ 悬停分区一律清掉。⛔ 不清的话，zone 这个 state
  // 会在「渲染 null 的空档」里留着旧值，下一回合一出现胶囊就凭空弹着旧面板（不悬停也开着）。
  useEffect(() => { if (!runningTurnId) { setZone(null); setPinned(false); setExpanded(false); } }, [runningTurnId]);
  /* ── 常驻（10-10 用户反馈「点击没有常驻展示，没法点开更多文件」）────────────────
     悬停展开的面板一移开就没了 ⇒ 想点里面的行根本点不到。⇒ **点击 = 钉住**：
     钉住后 onMouseLeave 不再收起，点面板外部 / Esc 才收；再点同区段 = 取消钉住并收起。 */
  const [pinned, setPinned] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [review, setReview] = useState<{ path: string; diff: string; added: number; deleted: number; status: string } | null>(null);
  useEffect(() => {
    if (!pinned && !review) return;
    const close = () => { setPinned(false); setZone(null); setExpanded(false); };
    const onDown = (event: MouseEvent) => {
      const card = cardRef.current;
      if (card && event.target instanceof Node && card.contains(event.target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); setReview(null); } };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [pinned, review]);
  const openZone = (next: "steps" | "files") => {
    if (zone === next && pinned) { setPinned(false); setZone(null); setExpanded(false); return; }
    setZone(next);
    setPinned(true);
  };
  /* 行点击 → 改动预览（10-10 用户：「每个修改过的文件，要支持我点击打开预览 diff，查看改动区域」）。
     数据源就是实时扫的伪 diff（turn-file-watch 的 lineDelta），已经在 payload 里，不用再拉。
     图片没有行级 diff ⇒ 走灯箱看图。 */
  const openDiff = (file: { path: string; diff?: string; added?: number; deleted?: number; status?: string }) => {
    if (isImagePath(file.path)) { openImageLightbox(file.path, baseName(file.path)); return; }
    setReview({ path: file.path, diff: String(file.diff ?? ""), added: file.added ?? 0, deleted: file.deleted ?? 0, status: String(file.status ?? "") });
  };
  // 步骤全部完成 ⇒ 步骤区隐藏，悬停分区若停在 steps 也清掉（与上一行同款）
  useEffect(() => {
    if (Array.isArray(taskList) && taskList.length > 0 && taskList.every((task: any) => task?.status === "done")) {
      setZone((current) => (current === "steps" ? null : current));
    }
  }, [taskList]);
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
  // 步骤按**创建顺序**展示（①②③④ 从上往下读；store 接口的顺序是 updatedAt 倒序，这里重排）
  const steps: StepRow[] = (Array.isArray(taskList) ? [...taskList] : [])
    .sort((a, b) => Number(a?.createdAt ?? 0) - Number(b?.createdAt ?? 0))
    .map((task) => ({
      id: String(task?.id ?? ""),
      text: String(task?.text ?? ""),
      state: String(task?.status ?? "todo"),
    }));
  /* ⛔ 步骤区 = **只在回合运行中显示**（用户 10-06 夜四轮 + 夜六轮实测：「任务跑完，清单不会自动
     消失」「新回合，旧的任务清单还在」）：
       · 回合结束（跑完/被 /stop 停止）⇒ 整卡消失（runningTurnId 由 composer 按活动回合传入，
         会话切走/空闲时同样为 null）—— 与文件区同款「只活在运行中」；
       · 步骤全部完成 ⇒ 隐藏（这轮收工了没内容可跟；running 中也一样，与夜四轮行为一致）。
     下一轮开工时宿主 tasks:clear + 模型自己的 task_add 会带上新清单，步骤区随之重新出现。 */
  const hasSteps = Boolean(runningTurnId) && steps.length > 0 && steps.some((step) => step.state !== "done");
  const hasFiles = Boolean(runningTurnId) && files.length > 0;
  if (!hasSteps && !hasFiles) return null;
  const doneCount = steps.filter((step) => step.state === "done").length;
  const totals = files.reduce((sum, file) => ({ added: sum.added + (file.added ?? 0), deleted: sum.deleted + (file.deleted ?? 0) }), { added: 0, deleted: 0 });
  return (
    <div ref={cardRef} className="edited-files-card" onMouseLeave={() => { if (!pinned) setZone(null); }}>
      {zone && (
        <div ref={popRef} className={`edited-files-pop pop-${popSide}`} role="status" aria-label={zone === "steps" ? "任务清单" : "本次运行改动的文件"}>
          {zone === "steps" ? (
            <>
              {(expanded ? steps : steps.slice(0, STEP_LIMIT)).map((step) => (
                <div className={`turn-step-row ${step.state === "done" ? "done" : step.state === "doing" ? "doing" : ""}`} key={step.id} title={step.text}>
                  {step.state === "done" ? <CircleCheck size={13} /> : step.state === "doing" ? <LoaderCircle size={13} className="spin" /> : <Circle size={13} />}
                  <span>{step.text}</span>
                </div>
              ))}
              {steps.length > STEP_LIMIT && (
                <button type="button" className="edited-files-more" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "收起" : `还有 ${steps.length - STEP_LIMIT} 步…`}
                </button>
              )}
            </>
          ) : (
            <>
              {(expanded ? files : files.slice(0, POP_LIMIT)).map((file) => (
                <div className="edited-files-row" key={file.path} title={`${file.path} · 点击查看改动区域`}
                  role="button" tabIndex={0} onClick={() => openDiff(file)}>
                  <FileTypeIcon path={file.path} size={12} />
                  <code>{baseName(file.path)}</code>
                  <span className="edited-files-stats">
                    {file.status === "deleted" ? <i className="completed-file-gone">已删除</i> : <><b>+{file.added}</b><i>-{file.deleted}</i></>}
                  </span>
                </div>
              ))}
              {files.length > POP_LIMIT && (
                <button type="button" className="edited-files-more" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "收起" : `还有 ${files.length - POP_LIMIT} 个文件…`}
                </button>
              )}
            </>
          )}
        </div>
      )}
      <button ref={pillRef} type="button" className="edited-files-pill" title="回合状态：步骤清单 / 本次运行改动的文件（悬停对应区段展开）">
        {runningTurnId ? <LoaderCircle size={13} className="spin" /> : <ListChecks size={13} />}
        {hasSteps && (
          <span className="capsule-zone capsule-zone-steps" role="button" tabIndex={0}
            onMouseEnter={() => setZone("steps")} onClick={() => openZone("steps")}
            title="悬停 / 点击查看步骤清单（点击后常驻，点外部或 Esc 收起）">
            步骤 {doneCount}/{steps.length}
          </span>
        )}
        {hasSteps && hasFiles && <span className="capsule-sep" aria-hidden>·</span>}
        {hasFiles && (
          <span className="capsule-zone capsule-zone-files" role="button" tabIndex={0}
            onMouseEnter={() => setZone("files")} onClick={() => openZone("files")}
            title="悬停 / 点击查看已修改的文件（点击后常驻，可点文件行看改动）">
            <span>{files.length} 个文件已修改</span>
            <b>+{totals.added}</b>
            <i>-{totals.deleted}</i>
          </span>
        )}
      </button>
      {review && createPortal((
        <div className="turn-diff-modal-mask" onClick={() => setReview(null)}>
          <div className="turn-diff-modal" role="dialog" aria-label={`${review.path} 改动预览`} onClick={(event) => event.stopPropagation()}>
            <header>
              <code>{review.path}</code>
              <span className="turn-diff-modal-stats">
                {review.status === "deleted" ? "已删除" : <><b>+{review.added}</b><i>-{review.deleted}</i></>}
              </span>
              <button type="button" onClick={() => setReview(null)}>关闭</button>
            </header>
            {/* 实时扫的是伪 diff（共同前后缀裁剪）；没扫到内容时给一句可操作的话，⛔ 不是空白 */}
            <ToolCodeBlock language="diff" maxHeight={560}
              text={review.diff || "（这一圈还没扫到这个文件的改动内容 —— 稍等约 2.5 秒再点一次，或等回合结束后在汇总卡里看完整 diff。）"} />
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
