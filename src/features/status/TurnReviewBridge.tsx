/**
 * 汇总卡 → 右栏「审阅」的打开桥（10-18）。
 *
 * 点文件时 `turn-review-store` 发 "open"；这里只负责**打开右栏并切到审阅页**。
 * ⛔ 右栏内的文件切换发的是 "select"，不重新打开（否则每次点文件都会重置滚动位置）。
 */
import { useEffect, useRef } from "react";
import { subscribeTurnReview } from "../../lib/turn-review-store.mjs";

export function TurnReviewBridge({ onOpen }: { onOpen: () => void }) {
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => subscribeTurnReview((event) => {
    if (event?.reason === "open") openRef.current();
  }), []);
  return null;
}
