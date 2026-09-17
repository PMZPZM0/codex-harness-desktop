import { useSyncExternalStore } from "react";
import { getCodexIdentity, subscribeCodexIdentity, CODEX_DEFAULT_NAME, type CodexAvatarSpec } from "../lib/codex-identity.mjs";
import { DefaultCodexAvatar } from "./DefaultCodexAvatar";

/** Codex 头像：用户上传过就显示图片，否则用内置默认头像（见 DefaultCodexAvatar 的设计说明）。 */
export function CodexAvatar({ size = 24, avatar }: { size?: number; avatar?: CodexAvatarSpec }) {
  const identity = useSyncExternalStore(subscribeCodexIdentity, getCodexIdentity, getCodexIdentity);
  const spec = avatar ?? identity.avatar;
  if (spec.type === "image" && spec.value) {
    return <img className="codex-avatar-img" src={spec.value} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  }
  return <DefaultCodexAvatar size={size} />;
}

/** 订阅当前 Codex 名字（未取名时回落到默认名）。 */
export function useCodexName(): string {
  const identity = useSyncExternalStore(subscribeCodexIdentity, getCodexIdentity, getCodexIdentity);
  return identity.name || CODEX_DEFAULT_NAME;
}
