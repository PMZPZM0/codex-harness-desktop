/**
 * 数据目录（userData）自定义 —— bootstrap 指路牌 + 启动期解析。
 *
 * ⛔ 为什么指路牌不放 userData 里：数据目录**本身**就是要被切的对象，切走之后
 *    指路牌必须留在一个**固定锚点**（appData 根下的默认目录）才能被下一次启动找到。
 *    ⇒ `%APPDATA%\Codex Harness Desktop\data-dir.json`，与用户数据本体隔离。
 *
 * ⛔【91】本模块是叶子：只依赖 electron app + node 内置，模块体零副作用；
 *    main.ts 在模块体**第一句** setPath 之前调用 resolveStartupUserData()，
 *    因此迁移（复制旧目录 → 新目录）发生在引擎 spawn / 任何 runtime 路径求值之前 ——
 *    复制时没有任何进程在写这些文件，这是整条链路里唯一安全的迁移时机。
 *
 * 优先级：CODEX_HARNESS_USER_DATA env（开发/测试覆盖，不做迁移）> bootstrap > 默认目录。
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type DataDirBootstrap = { dir?: string; migrate?: boolean };

/** 固定锚点：默认 userData（appData 下的应用目录），bootstrap 指路牌所在。 */
export function defaultUserDataDir(): string {
  return path.join(app.getPath("appData"), "Codex Harness Desktop");
}

function bootstrapFile(): string {
  return path.join(defaultUserDataDir(), "data-dir.json");
}

export function readDataDirBootstrap(): DataDirBootstrap | null {
  try {
    const raw = JSON.parse(fs.readFileSync(bootstrapFile(), "utf8")) as DataDirBootstrap;
    if (!raw || typeof raw !== "object") return null;
    return raw;
  } catch {
    return null; // 文件不存在/损坏 ⇒ 无自定义，走默认
  }
}

export function writeDataDirBootstrap(next: DataDirBootstrap): void {
  const file = bootstrapFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
}

/** 迁移要跳过的文件：指路牌本体（留在锚点）与锁/临时文件（复制过来也是坏的）。 */
function migrationFilter(src: string): boolean {
  const base = path.basename(src);
  if (base === "data-dir.json") return false;
  if (/^(lock|Singleton.*)$/i.test(base)) return false;
  return true;
}

function dirIsEmpty(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length === 0;
  } catch {
    return true; // 不存在视为空
  }
}

/**
 * 解析本次启动应使用的 userData 目录（含一次性迁移）。
 * 迁移失败时**回退默认目录**并保留 migrate 标记（下次启动重试），绝不静默丢数据。
 */
export function resolveStartupUserData(): string {
  const envOverride = process.env.CODEX_HARNESS_USER_DATA;
  if (envOverride) return envOverride;

  const fallback = defaultUserDataDir();
  const boot = readDataDirBootstrap();
  const target = boot?.dir;
  if (!target || path.resolve(target) === path.resolve(fallback)) return fallback;

  // 基本合法性：必须绝对路径、不能是盘根（防止用户填 "D:\" 把整盘当数据目录）
  if (!path.isAbsolute(target) || path.parse(target).root === target) {
    console.warn(`[data-dir] 自定义目录不合法（${target}），回退默认`);
    return fallback;
  }

  if (boot.migrate && dirIsEmpty(target)) {
    const source = fallback;
    if (fs.existsSync(source)) {
      try {
        fs.cpSync(source, target, { recursive: true, filter: migrationFilter });
        // 迁移完成 ⇒ 清标记（幂等：下次启动不再复制）
        writeDataDirBootstrap({ dir: target });
        console.log(`[data-dir] 已把数据从 ${source} 迁移到 ${target}`);
      } catch (error) {
        console.warn(`[data-dir] 迁移失败，本次回退默认目录：${error instanceof Error ? error.message : String(error)}`);
        return fallback; // 保留 migrate 标记，下次启动重试
      }
    } else {
      writeDataDirBootstrap({ dir: target }); // 源目录都不在了，没必要再迁
    }
  }
  return target;
}
