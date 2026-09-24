import { useEffect, useState, useSyncExternalStore } from "react";
import { getUserIdentity, subscribeUserIdentity } from "../lib/user-identity.mjs";

/** 订阅当前用户身份（名字 + 头像）—— 与 codex-identity 同构，见 user-identity.mjs 的说明。 */
export function useUserIdentity() {
  return useSyncExternalStore(subscribeUserIdentity, getUserIdentity, getUserIdentity);
}

/** 订阅用户名字。没设过时回落「你」—— 与左下角账户名的兜底保持一致。 */
export function useUserName(): string {
  const identity = useUserIdentity();
  return identity.name || "你";
}

/** 用户头像：三态（上传的图片 / 选的表情 / 都没有时用名字首字）。
 *  **圆形** —— 与 Codex 的圆角方形刻意区分开（09-17 用户：「人也要有名字和头像，位置跟 Codex 一样」）。
 *  ⛔ 图片加载失败时回落到名字首字：`<img>` 坏了会渲染成一片空白，比"没有头像"更难看
 *  （与 CodexAvatar 同一套理由，见那边的注释）。 */
export function UserAvatar({ size = 22 }: { size?: number }) {
  const identity = useUserIdentity();
  const { type, value } = identity.avatar;
  const initial = (identity.name || "你").trim().charAt(0) || "你";
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [value, type]);
  const showImage = type === "image" && Boolean(value) && !broken;
  return (
    <span className="user-avatar" aria-hidden style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.46)) }}>
      {showImage
        ? <img src={value} alt="" onError={() => setBroken(true)} />
        : type === "emoji" && value
          ? <span className="">{value}</span>
          : <span className="user-avatar-initial">{initial}</span>}
    </span>
  );
}
