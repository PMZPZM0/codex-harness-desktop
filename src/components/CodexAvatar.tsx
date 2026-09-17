import { useEffect, useState, useSyncExternalStore } from "react";
import { getCodexIdentity, subscribeCodexIdentity, CODEX_DEFAULT_NAME, type CodexAvatarSpec } from "../lib/codex-identity.mjs";
import { DefaultCodexAvatar } from "./DefaultCodexAvatar";

/** Codex 头像：用户上传过就显示图片，否则用内置默认头像（见 DefaultCodexAvatar 的设计说明）。
 *
 *  ⛔ **图片加载失败必须回退默认头像**（09-17 用户报「Codex 头像又不见了」的真因）：
 *  `<img>` 加载失败时浏览器渲染成**一片空白**，但元素尺寸/可见性全都正常 —— DOM 上完全看不出
 *  异常（探针实测 22×22、visible、opacity 1，就是没像素）。会出现这种状态的场景：
 *    · 头像 base64 被截断 / JSON 损坏；
 *    · 上传的图片太大，localStorage 写失败（配额），下次启动读到旧值或读不到；
 *    · 用户上传的文件本身就是坏图/空图。
 *  这些都不该表现为「头像凭空消失」，所以统一 onError 兜回默认头像。
 */
export function CodexAvatar({ size = 24, avatar }: { size?: number; avatar?: CodexAvatarSpec }) {
  const identity = useSyncExternalStore(subscribeCodexIdentity, getCodexIdentity, getCodexIdentity);
  const spec = avatar ?? identity.avatar;
  // 加载失败标记：换了 src（用户重新上传）要重置，否则修好一次之后永远回不去图片。
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [spec.value, spec.type]);
  if (spec.type === "image" && spec.value && !broken) {
    return (
      <img
        className="codex-avatar-img"
        src={spec.value}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        onError={() => setBroken(true)}
      />
    );
  }
  return <DefaultCodexAvatar size={size} />;
}

/** 订阅当前 Codex 名字（未取名时回落到默认名）。 */
export function useCodexName(): string {
  const identity = useSyncExternalStore(subscribeCodexIdentity, getCodexIdentity, getCodexIdentity);
  return identity.name || CODEX_DEFAULT_NAME;
}
