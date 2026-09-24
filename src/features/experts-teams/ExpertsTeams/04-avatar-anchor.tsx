/**
 * ExpertsTeams 的「avatar-anchor」部分（09-22 从同目录 ExpertsTeams.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { useState, useEffect, useRef, useLayoutEffect } from "react";
export function useAvatarAnchor(memberId: string): number | null {
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const wrap = document.querySelector(".timeline-wrap");
    if (!wrap || !memberId) { setTop(null); return; }
    const measure = () => {
      const node = document.querySelector(`.team-rail-node[data-member-id="${memberId}"]`);
      if (!node) { setTop(null); return; }
      const wrapRect = wrap.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const center = nodeRect.top - wrapRect.top + nodeRect.height / 2;
      // 夹取一下：面板是 translateY(-50%) 定位的，锚点太靠边会被 timeline-wrap 的 overflow 裁掉
      const margin = Math.min(150, wrapRect.height / 2);
      setTop(Math.round(Math.min(Math.max(center, margin), Math.max(margin, wrapRect.height - margin))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    const track = document.querySelector(".team-rail-track");
    if (track) observer.observe(track);
    window.addEventListener("resize", measure);
    const timer = window.setTimeout(measure, 380); // 头像轨有 0.3s 入场动画，落定后再量一次
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.clearTimeout(timer); };
  }, [memberId]);
  return top;
}
