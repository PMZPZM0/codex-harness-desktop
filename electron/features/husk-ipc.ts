/**
 * husk-ipc（11-14）—— Husk（iPhone 上跑 Android）的宿主侧状态/引导
 *
 * 域：husk(3)
 * 通道：status / guide / reveal
 *
 * Husk 是 iPhone 应用：电脑侧只负责按需下载官方 Husk.ipa（runtime:install 的 GitHub 直下型，
 * 见 electron/husk-install.ts）与给出侧载指南。⛔ 不在电脑上「安装到 iPhone」——那需要真机 +
 * SideStore/AltStore/TrollStore 签名侧载，宿主不假装能做到。
 */
import { shell } from "electron";
import { spawn } from "node:child_process";
import { HUSK_GUIDE_URL, HUSK_REPO, HUSK_SOURCE_URL, huskInstallFacts, huskPaths, revealHuskFile } from "../husk-install";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

type HuskStatus = {
  installed: boolean;
  version: string;
  path: string;
  sizeBytes: number;
  tipaInstalled: boolean;
  tipaVersion: string;
  tipaPath: string;
  tipaSizeBytes: number;
  guideUrl: string;
  sourceUrl: string;
  /** iPhone 侧最低系统与侧载方式（卡片直接展示） */
  requirement: string;
  attribution: { license: string; home: string };
};

/** 汇总 Husk 的下载状态与安装指引（不探测 iPhone，电脑侧探测不到真机安装态）。 */
function statusOf(): HuskStatus {
  const facts = huskInstallFacts();
  return {
    ...facts,
    guideUrl: HUSK_GUIDE_URL,
    sourceUrl: HUSK_SOURCE_URL,
    requirement: "iOS 15.5+ · SideStore / AltStore / TrollStore 侧载；部分游戏需要 JIT",
    attribution: { license: "GPL-2.0-or-later", home: `https://github.com/${HUSK_REPO}` },
  };
}

type HuskDeviceState = { connected: boolean; devices: string[]; platform: string; detail: string };

/** 跑一段 PowerShell 并取 stdout（参数数组，不进 shell；超时 8s）。 */
function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (value: string) => { if (settled) return; settled = true; resolve(value); };
    try {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
      child.stdout?.on("data", (chunk) => { out += String(chunk); });
      child.on("error", () => done(""));
      child.on("close", () => done(out));
      setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } done(out); }, 8000);
    } catch { done(""); }
  });
}

/** 检测 iPhone 是否连着这台电脑（Windows 看 PnP，mac 看 USB 设备；⛔ 不做任何安装/授权动作）。 */
async function detectIphone(): Promise<HuskDeviceState> {
  if (process.platform === "win32") {
    const script = [
      "$d = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue",
      "if (-not $d) { $d = Get-WmiObject Win32_PnPEntity -ErrorAction SilentlyContinue }",
      "$d | Where-Object { $_.FriendlyName -match 'iPhone|Apple Mobile Device|Apple iPhone' } | ForEach-Object { $_.FriendlyName }",
    ].join("\n");
    const out = await runPowerShell(script);
    const devices = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      connected: devices.length > 0,
      devices,
      platform: "win32",
      detail: devices.length
        ? "检测到 Apple 设备连接；侧载仍需在 iPhone 上确认「信任这台电脑」并用 SideStore/AltStore/TrollStore 安装"
        : "没有检测到 iPhone：用数据线连接、在手机上点「信任」，再点一次检测",
    };
  }
  if (process.platform === "darwin") {
    const out = await new Promise<string>((resolve) => {
      let text = "";
      try {
        const child = spawn("system_profiler", ["SPUSBDataType"], { windowsHide: true });
        child.stdout?.on("data", (chunk) => { text += String(chunk); });
        child.on("error", () => resolve(""));
        child.on("close", () => resolve(text));
        setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } resolve(text); }, 8000);
      } catch { resolve(""); }
    });
    const devices = out.split(/\r?\n/).map((line) => line.trim()).filter((line) => /iPhone|iPad/i.test(line));
    return {
      connected: devices.length > 0,
      devices,
      platform: "darwin",
      detail: devices.length ? "检测到 iPhone/iPad 连接" : "没有检测到 iPhone/iPad：用数据线连接后重试",
    };
  }
  return { connected: false, devices: [], platform: process.platform, detail: "当前平台不支持 USB 检测；请在 iPhone 上直接侧载" };
}

const HUSK_CHANNELS = ["husk:status", "husk:guide", "husk:reveal", "husk:device"];

export const huskFeature = defineFeature<null>({
  id: "husk",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("husk: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("husk:status", async () => statusOf());
    ipcHost.handle("husk:guide", async () => {
      await shell.openExternal(HUSK_GUIDE_URL);
      return { ok: true, url: HUSK_GUIDE_URL };
    });
    ipcHost.handle("husk:reveal", async () => {
      revealHuskFile();
      return { ok: true, path: huskPaths().root };
    });
    ipcHost.handle("husk:device", async () => detectIphone());

    ctx.effect(() => {
      for (const ch of HUSK_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
