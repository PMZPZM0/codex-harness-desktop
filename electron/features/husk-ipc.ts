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

const HUSK_CHANNELS = ["husk:status", "husk:guide", "husk:reveal"];

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

    ctx.effect(() => {
      for (const ch of HUSK_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
