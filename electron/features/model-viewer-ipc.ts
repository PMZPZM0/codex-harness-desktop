// 3D 模型预览域（model-viewer，2026-10-05 立项）：会话产出的 GLB/glTF 在应用内旋转查看。
// 联动链：引擎经 harness_tools 网关 `preview_3d`（dispatch-rpc）推 `model-viewer:open` →
// 渲染层 ModelViewerBridge 弹窗（src/features/model-viewer/）→ `model-viewer:read` 拉模型字节
// → Blob URL 喂 <model-viewer>（CSP connect-src 已放行 blob:，index.html）。
// ⛔ 安全面沿用 fs:read 口径（isInsideTrustedRoots + 扩展名白名单 + 大小上限），只读不写。
import path from "node:path";
import fs from "node:fs/promises";
import { isInsideTrustedRoots } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const MODEL_EXTENSIONS = [".glb", ".gltf"];
// ponytail: 上限 256MB（实测 Lux3D/Tripo GLB 多在 2~50MB）；更大的模型走「打开文件夹」用系统
// 查看器，升级路径 = model:// 流式协议（照 sketch-protocol 样板），不要直接抬高这个数。
const MAX_MODEL_BYTES = 256 * 1024 * 1024;

/** 预览路径校验（dispatch-rpc 的 preview_3d 与 model-viewer:read 共用同一道闸）：
 *  可信根内 + 扩展名白名单 + 存在 + 大小上限。返回规范化的绝对路径，不合法就抛错。 */
export async function resolveModelPath(rawPath: string): Promise<string> {
  const candidate = path.resolve(String(rawPath ?? "").trim());
  if (!MODEL_EXTENSIONS.includes(path.extname(candidate).toLowerCase())) {
    throw new Error(`只支持 ${MODEL_EXTENSIONS.join(" / ")} 模型文件`);
  }
  // ⛔ isInsideTrustedRoots 是内核独占判定（fs:read 同款，不经接缝）——任意路径读 = XSS 即可读全盘
  if (!isInsideTrustedRoots(candidate)) throw new Error("路径不在可信目录内（会话工作目录 / 应用数据目录）");
  const stat = await fs.stat(candidate).catch(() => null);
  if (!stat?.isFile()) throw new Error("模型文件不存在");
  if (stat.size > MAX_MODEL_BYTES) {
    throw new Error(`模型超过 ${Math.round(MAX_MODEL_BYTES / 1024 / 1024)}MB 上限（当前 ${Math.round(stat.size / 1024 / 1024)}MB）`);
  }
  return candidate;
}

export const modelViewerFeature = defineFeature<null>({
  id: "model-viewer",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("model-viewer: 缺少 ipc 服务（宿主未提供）");
    ipcHost.handle("model-viewer:read", async (_event, input: { path?: string } = {}) => {
      const file = await resolveModelPath(String(input?.path ?? ""));
      const data = await fs.readFile(file);
      // Uint8Array 走结构化克隆直传（不转 base64 —— 50MB 模型转码白多 33% 内存）
      return { data: new Uint8Array(data), size: data.byteLength };
    });
    ctx.effect(() => {
      ipcHost.removeHandler("model-viewer:read");
    });
  },
});
