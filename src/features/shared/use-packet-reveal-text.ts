/** usePacketRevealText（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { useState, useRef, useEffect } from "react";
import { revealProgressStore } from "../../lib/reveal-progress-store";

export function usePacketRevealText(
  key: string,
  text: string,
  active: boolean,
  markerStore?: Map<string, string>,
  threshold = 24,
) {
  const initial = (() => {
    const marked = markerStore?.get(key);
    // ⛔ 只有「一次性整包交付」的 marker 才允许起播动画；其余情况（**含切会话回来**）
    // 一律直接显示到当前实时进度 —— 用户定稿：「实时进度在哪里，进来就在哪里」，
    // 任何形式的存量复播都不允许（旧实现会从 `slice(0,10)` 起播 = 整段重播）。
    if (marked != null && text.startsWith(marked)) return marked;
    return text;
  })();
  const [displayed, setDisplayed] = useState(initial);
  const [revealing, setRevealing] = useState(initial.length < text.length);
  const displayedRef = useRef(displayed);
  const revealingRef = useRef(revealing);
  // 本组件实例是否是「第一次跑揭示 effect」（= 刚挂载）。用来区分「重挂载补齐存量」与
  // 「挂载后新到的增量」——只有前者必须一次性显示（见 isStockOnMount）。
  const firstRunRef = useRef(true);
  useEffect(() => { displayedRef.current = displayed; }, [displayed]);
  useEffect(() => { revealingRef.current = revealing; }, [revealing]);
  useEffect(() => {
    const marked = markerStore?.get(key);
    let start = displayedRef.current;
    if (marked != null && text.startsWith(marked) && start.length < marked.length) {
      start = marked;
      displayedRef.current = start;
      setDisplayed(start);
    }
    // 进度表优先级介于 marker 与本地 state 之间：跨卸载重建后本地 state 是空的（initial
    // 已读过进度表），这里再对齐一次，兜住「initial 读了但 effect 前文本又追加」的窗口。
    const progressed = revealProgressStore.get(key);
    if (progressed != null && text.startsWith(progressed) && start.length < progressed.length) {
      start = progressed;
      displayedRef.current = start;
      setDisplayed(start);
    }
    // ⛔ 单调保证（09-12 用户「重放还是有」实测定位，**别删**）：同一个 key 的揭示位置
    // **只能前进、不能后退**。实测切回会话时，同一条消息先按存量续播（`{from:178,to:232}`），
    // 紧接着又冒出一批 `{from:2,to:4}` 的揭示——把已经显示过的 170 多字重播了一遍，
    // 用户看到的就是「正文先缩回去再重新出字」（DOM 采样 172→59→125→…→391）。
    // 这里给 start 加一条**硬下限**：不得小于进度表里已播长度所对应的前缀。
    // 注意**不要求** `text.startsWith(stored)`：内容被替换 / 快照落后时 startsWith 会失败，
    // 而那条路径正是 from 回退到 2 的来源（回退本身就是重播）。
    {
      const storedRaw = revealProgressStore.get(key);
      const storedLen = storedRaw != null ? Math.min(storedRaw.length, text.length) : 0;
      if (storedLen > start.length) {
        start = text.slice(0, storedLen);
        displayedRef.current = start;
        setDisplayed(start);
      }
    }
    if (!text.startsWith(start)) {
      displayedRef.current = text;
      setDisplayed(text);
      setRevealing(false);
      markerStore?.delete(key);
      return;
    }
    const remaining = text.length - start.length;
    if (remaining <= 0) {
      setRevealing(false);
      markerStore?.delete(key);
      return;
    }
    // active（流式运行中）：内容在增长就平滑续字，不要求大跳才追——小增量也逐字流出。
    // 非 active 或一次性整包交付（marker）也追，避免整段瞬间出现；纯历史不做动画。
    //
    // ⚠️ 但**存量正文必须一次性显示**（09-12 用户实测实锤）：流式中切走再切回时，
    // 进度表里存的是切走那一刻的位置（如 244 字），而正文已经长到 1078 字——
    // 若照旧揭示，就会把 834 个字的**存量**从头播一遍，表现为「切过去正文重新出字」。
    // 判据：待播字数远超单帧/单批的正常增量（> REVEAL_INSTANT_JUMP）时，判定为
    // 「重挂载后补齐存量」而非「新到的增量」→ 直接显示，不做动画。
    // ⛔ 存量必须一次性显示（09-12 用户「切换一下就重复播放一次」的**真根因**）：
    // 判据不是「待播字数多大」，而是「**这次是不是重挂载后第一次跑、且已经有存量**」。
    // 实测反例：切走时 173 字，切回后存量涨到 532 字 → remaining=334 < 400 的旧阈值，
    // 于是把这 334 个**已经显示过的**字又逐字播了一遍（reveal 打点 `animated:334`），
    // 用户看到的就是「切一下就重播一次」。凡是挂载时就有存量（start 明显不止初始 10 字），
    // 一律整段直接显示；**之后新到的增量**才走打字机。
    const isStockOnMount = firstRunRef.current && remaining > 0 && marked == null;
    firstRunRef.current = false;
    const REVEAL_INSTANT_JUMP = 400;
    const allowReveal = isStockOnMount
      ? false                                    // 挂载时就有待播内容 = 存量 → 一次性显示
      : (revealingRef.current || active || marked != null);
    const shouldReveal = allowReveal && remaining <= REVEAL_INSTANT_JUMP;
    if (!shouldReveal) {
      displayedRef.current = text;
      setDisplayed(text);
      setRevealing(false);
      return;
    }
    setRevealing(true);
    // 诊断（09-12）：记录「这次揭示要播多少字」。切会话若出现异常大的 animated 值
    // （接近全文长度），就是「正文重复播放」的实锤——e2e 读 window.__adbg 核对。
    try {
      const w = window as any;
      if (!w.__adbg) w.__adbg = [];
      w.__adbg.push({ r: "reveal", key: String(key).slice(0, 12), from: start.length, to: text.length, animated: remaining });
    } catch { /* 诊断失败不影响功能 */ }
    // 速率按剩余量自适应：尾段逐字精雕（打字感），长文自动提速不拖沓。
    const step = Math.max(1, Math.min(revealStepFor(remaining), Math.ceil(remaining / 3)));
    let end = start.length;
    const timer = window.setInterval(() => {
      end = Math.min(text.length, end + step);
      const next = text.slice(0, end);
      displayedRef.current = next;
      revealProgressStore.set(key, next);
      setDisplayed(next);
      window.dispatchEvent(new Event("codex:packet-reveal"));
      if (end >= text.length) {
        window.clearInterval(timer);
        markerStore?.delete(key);
        // 进度表保留全文前缀：运行中的回合还没结束，切会话回来时 active 仍为 true，
        // 若删掉进度会从「前 10 字」二次重播。文本不匹配时由上方分支自然清理。
        setRevealing(false);
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [active, key, markerStore, text, threshold]);
  return { displayed, revealing };
}

function revealStepFor(remaining: number) {
  // 超大输出（命令日志等可能几万字符）：≤1.5s 追完，不拖沓
  if (remaining > 3600) return Math.max(32, Math.ceil(remaining / 90));
  if (remaining > 1200) return 10;   // 长文：快速追（约 625 字符/秒）
  if (remaining > 300) return 4;     // 中段：平稳流出（约 250 字符/秒）
  return 2;                          // 尾段：精细逐字（约 125 字符/秒，打字感）
}
