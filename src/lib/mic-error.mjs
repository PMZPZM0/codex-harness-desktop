/**
 * 麦克风错误 → 人话 + 排查提示（通话采集与语音唤醒**共用**一份）。
 *
 * 为什么单独抽出来：这两条链路各自 `getUserMedia`，09-13 之前的唤醒链路**没有**这层翻译，
 * 于是界面上直接显示 Chromium 的原始英文 `Requested device not found`（用户实测截图），
 * 既看不懂也不知道怎么查。翻译只有一份，改一处两条链路都受益。
 *
 * 纯函数、零依赖：`scripts/check-preflight.mjs` 直接 import 跑断言。
 */

/** @param {unknown} error getUserMedia 抛出的 DOMException（或任意错误） */
export function describeMicError(error) {
  const name = String((error && error.name) || "");
  const msg = String((error && error.message) || error || "");
  if (name === "NotFoundError" || /requested device not found/i.test(msg)) {
    return "未找到可用的麦克风设备（Requested device not found）。请检查：(1) 麦克风已物理接入并被系统识别；(2) 没有被其它程序独占（浏览器、Zoom、VoiceMeeter、OBS 等）；(3) Windows：在「设置 → 系统 → 声音」里能看到输入设备且没禁用；macOS：在「系统设置 → 隐私与安全 → 麦克风」授权本应用。也可以在「设置 → 语音通话 → 麦克风」里换一个输入设备试试。";
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "麦克风权限被拒绝。请到系统的「麦克风隐私设置」里授权本应用，然后重试。";
  }
  if (name === "NotReadableError" || /in use/i.test(msg)) {
    return "麦克风正被其它程序独占（could not start audio source）。请关掉占用麦克风的应用再试。";
  }
  if (name === "OverconstrainedError") {
    return "请求的麦克风参数不被设备支持（OverconstrainedError）。通常是采样率/通道数不匹配，或所选设备已不可用——可到「设置 → 语音通话 → 麦克风」改回系统默认。";
  }
  if (name === "AbortError") {
    return "打开麦克风被中断（AbortError），请重试。";
  }
  return `打开麦克风失败：${msg}`;
}
