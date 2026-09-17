const path = require("node:path");
const base = require("../package.json").build;

module.exports = {
  ...base,
  directories: { output: "release-mac" },
  extraResources: [],
  afterPack: path.resolve(__dirname, "copy-mac-tools.cjs"),
  mac: {
    target: "zip",
    category: "public.app-category.developer-tools",
    artifactName: "${productName}-${version}-${arch}-mac.${ext}",
    extendInfo: {
      NSAppleEventsUsageDescription: "Use desktop automation to control applications when you request it.",
      NSScreenCaptureUsageDescription: "Capture the screen for desktop automation when you request it.",
      // ⛔ 必须有（09-17 审计）：macOS 的 TCC 要求访问麦克风的 App 在 Info.plist 里声明用途，
      // 缺了这条不是「弹不出授权框」——是**进程直接被系统杀掉**（语音通话 / 语音输入首次取麦即闪退）。
      // 主进程 voice:mic-permission 会走 systemPreferences.askForMediaAccess("microphone")，
      // 渲染层 VoiceCallFloat / VoiceSettingsSection 会 navigator.mediaDevices.getUserMedia({audio})。
      NSMicrophoneUsageDescription: "Use the microphone for voice conversation, dictation and wake-word detection. Audio is processed locally on this device.",
    },
  },
};
