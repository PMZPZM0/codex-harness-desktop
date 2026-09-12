/**
 * 把主进程返回的 Float32 PCM Base64 还原为 Float32Array。
 *
 * 为什么不用 Electron IPC 直接传 Float32Array：sherpa-onnx 的音频最初来自 native
 * external ArrayBuffer；即使在 worker 中复制/transfer，经过多层 structured clone 后仍可能被
 * Electron 判定为 external backing store 并抛 "External buffers are not allowed"。
 * Base64 只是一段普通字符串，不受 backing store 类型影响，跨 contextBridge 也稳定。
 */
export function decodeFloat32Base64(base64: string | undefined): Float32Array {
  if (!base64) return new Float32Array(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  // Float32Array 要求 byteOffset 4 字节对齐；bytes 是独立 ArrayBuffer 且 offset=0。
  const usableLength = bytes.byteLength - (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT);
  if (usableLength <= 0) return new Float32Array(0);
  return new Float32Array(bytes.buffer, 0, usableLength / Float32Array.BYTES_PER_ELEMENT);
}
