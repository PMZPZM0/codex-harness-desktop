/**
 * RelayModal —— 中转站弹层的**统一出口**（portal 到 body）。
 *
 * ⛔ 为什么必须 portal（10-09 用户报「管理界面是内嵌的，不好看」）：
 *   设置页容器带 transform（滑入动画 / 悬停 scale），而祖先上的 transform 会把
 *   `position: fixed` 劫持成「相对该容器定位」⇒ 弹层被嵌在设置内容列里、盖不住全窗。
 *   portal 到 body 一次性解决所有 relay-modal-backdrop（账号管理 / 登录 / 套餐 / 密钥管理）。
 */
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export function RelayModal({ onClose, children, backdropClassName }: { onClose: () => void; children: ReactNode; backdropClassName?: string }) {
  return createPortal(
    <div
      className={`relay-modal-backdrop${backdropClassName ? " " + backdropClassName : ""}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {children}
    </div>,
    document.body,
  );
}
