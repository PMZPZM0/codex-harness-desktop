/**
 * orencut 域：OrenCut Studio 的**按需下载**（11-28 用户令：「orencut 开源项目…做成按需下载，
 * 跟开发工具里面的飞书 cli 界面一样，然后看看能不能接到侧边栏」）。
 *
 * 它是什么：`OrenFang/orencut`（MIT）—— 33 个可编辑的静音 Remotion 动效组件 + Studio 预览 +
 * Agent Skill，**纯静态站点**（studio.html + studio-assets + previews，仓库里带 .nojekyll 就是 Pages 站）。
 * ⇒ 不需要 Docker/Bun/Rust，下载 zip 解压即可跑（这与 OpenCut 那种要构建的完全不同，别混）。
 *
 * 通道：orencut:status（是否已装 / 版本 / 体积）/ orencut:install（下载 + 解压）/ orencut:remove。
 * ⛔ 下载目标与协议根同源（orencutRoot），装完渲染层用 `orencut://app/studio.html` 直接 iframe。
 * ⛔ 版本按下载时间记（仓库无 release）；重装 = 覆盖，旧目录先删。
 */
import fs from "node:fs";
import path from "node:path";
import { defineFeature } from "../../context";
import type { IpcHost } from "../../ipc-host";
import { orencutRoot } from "../../orencut-protocol";
import { extractZip } from "../../zip-extract";

const REPO = "OrenFang/orencut";
const ZIP_URL = `https://codeload.github.com/${REPO}/zip/refs/heads/main`;

export type OrencutStatus = {
  installed: boolean;
  /** 下载时间（ISO）；未装为空。 */
  installedAt: string;
  /** 安装目录里的文件数（给用户一个"真的下下来了"的证据）。 */
  files: number;
  /** 最近一次失败原因（安装失败时由 install 自己返回，这里只给现状）。 */
  error: string;
};

/** 现状：只看 studio.html 是否在（那是渲染层唯一的入口文件）。 */
export function orencutStatus(): OrencutStatus {
  const root = orencutRoot();
  const entry = path.join(root, "studio.html");
  try {
    if (!fs.existsSync(entry)) return { installed: false, installedAt: "", files: 0, error: "" };
    let files = 0;
    const walk = (dir: string) => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (item.isDirectory()) walk(path.join(dir, item.name));
        else files += 1;
      }
    };
    walk(root);
    const stamp = path.join(root, ".orencut-installed-at");
    const installedAt = fs.existsSync(stamp) ? fs.readFileSync(stamp, "utf8").trim() : "";
    return { installed: true, installedAt, files, error: "" };
  } catch (error) {
    return { installed: false, installedAt: "", files: 0, error: String((error as Error)?.message ?? error) };
  }
}

/** 下载仓库 zip → 解压 → 去掉顶层目录 → 落到 orencutRoot（先清旧）。 */
export async function installOrencut(): Promise<OrencutStatus> {
  const root = orencutRoot();
  const work = path.join(root, "..", `orencut-dl-${Date.now()}`);
  try {
    const response = await fetch(ZIP_URL, { redirect: "follow" });
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) throw new Error("下载内容太小，可能被代理拦截");
    fs.mkdirSync(work, { recursive: true });
    extractZip(buffer, work);
    /* GitHub 的 zip 会带一层 `orencut-main/`；有就搬它的内容上来。 */
    const entries = fs.readdirSync(work, { withFileTypes: true }).filter((e) => e.isDirectory());
    const inner = entries.length === 1 ? path.join(work, entries[0].name) : work;
    if (!fs.existsSync(path.join(inner, "studio.html"))) throw new Error("包里没有 studio.html（上游结构变了？）");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    for (const item of fs.readdirSync(inner)) {
      fs.renameSync(path.join(inner, item), path.join(root, item));
    }
    fs.writeFileSync(path.join(root, ".orencut-installed-at"), new Date().toISOString(), "utf8");
    return orencutStatus();
  } catch (error) {
    return { installed: false, installedAt: "", files: 0, error: String((error as Error)?.message ?? error) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** 卸载：删安装目录（⛔ 只删 orencutRoot，不碰同级其它目录）。 */
export function removeOrencut(): OrencutStatus {
  const root = orencutRoot();
  try {
    if (path.basename(root) !== "orencut") throw new Error("安装目录名异常，拒绝删除");
    fs.rmSync(root, { recursive: true, force: true });
  } catch (error) {
    return { installed: false, installedAt: "", files: 0, error: String((error as Error)?.message ?? error) };
  }
  return orencutStatus();
}

export const orencutFeature = defineFeature<null>({
  id: "orencut",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("orencut: 缺少 ipc 服务（宿主未提供）");
    ipcHost.handle("orencut:status", () => orencutStatus());
    ipcHost.handle("orencut:install", () => installOrencut());
    ipcHost.handle("orencut:remove", () => removeOrencut());
  },
});
