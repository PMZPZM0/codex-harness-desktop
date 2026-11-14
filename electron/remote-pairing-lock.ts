/**
 * 「禁止新设备配对」锁定（11-14 用户令）
 *
 * 用户口径：「匹配好手机之后，可以加一个禁止其他任何手机匹配的开关，这样更安全」。
 * 语义：
 *   · 关闭（默认）= 现在的行为，新手机可以凭 6 位码 + 电脑端点「允许」配对；
 *   · 开启 = **只允许已批准的设备**（凭设备秘密自动重连），新手机/Bot 渠道一律拒绝；
 *     同时把在途的待批请求全部作废，并轮换配对码（截屏/旧链接里的码立即失效）。
 *
 * ⛔ 状态落在 `<userData>/remote-pairing-lock.json`（本机私密文件，不进 git）。
 * ⛔ 路径**惰性**求值：模块体早于 `app.setPath("userData")`，构造函数里不许碰 app.getPath。
 * ⛔ 订阅者（remote / bot-pairing）在锁定时负责各自作废在途请求，见 onPairingLockChange。
 */
import fs from "node:fs";
import path from "node:path";

let locked = false;
let file = "";
const listeners = new Set<(locked: boolean) => void>();

/** 绑定数据目录并读回上次的锁定状态（在壳完成 setPath(userData) 后调用一次）。 */
export function configurePairingLock(userDataDir: string): void {
  file = userDataDir ? path.join(userDataDir, "remote-pairing-lock.json") : "";
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    locked = raw?.locked === true;
  } catch {
    /* 文件存在但读/解析失败 ⇒ 按锁定处理（fail-closed）；只有「首次运行没有文件」才默认关。
       ⛔ 别改成 catch 一律 false：半截写入/权限异常会把「已锁」静默降级成「允许任意新设备」。 */
    locked = Boolean(file) && fs.existsSync(file);
  }
}

/** 当前是否禁止新设备配对。 */
export function isPairingLocked(): boolean {
  return locked;
}

/** 切换锁定并落盘，通知订阅者作废在途请求。
 *  返回 `locked`（落定状态）与 `persisted`（是否真写进磁盘）。
 *  ⛔ 落盘失败**不能静默**：内存态仍生效（本次会话是锁的），但重启后会回到旧状态 ——
 *    界面必须能区分「已生效且记住」与「只在本次会话生效」，否则用户以为永久关了。 */
export function setPairingLocked(next: boolean): { locked: boolean; persisted: boolean } {
  locked = next === true;
  let persisted = true;
  if (file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ version: 1, locked }, null, 2), "utf8");
    } catch {
      persisted = false;
    }
  } else {
    // 没有数据目录 ⇒ 一定没落盘（本次会话仍然生效）
    persisted = false;
  }
  for (const listener of listeners) {
    try { listener(locked); } catch { /* 单个订阅者失败不影响其他 */ }
  }
  return { locked, persisted };
}

/** 订阅锁定变化（返回取消函数）；锁定瞬间各服务据此作废在途请求。 */
export function onPairingLockChange(listener: (locked: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
