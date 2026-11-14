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
  } catch { /* 首次运行没有文件 */ }
}

/** 当前是否禁止新设备配对。 */
export function isPairingLocked(): boolean {
  return locked;
}

/** 切换锁定并落盘，通知订阅者作废在途请求；返回落定后的状态。 */
export function setPairingLocked(next: boolean): boolean {
  locked = next === true;
  if (file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ version: 1, locked }, null, 2), "utf8");
    } catch { /* 写不了就只保留内存态 */ }
  }
  for (const listener of listeners) {
    try { listener(locked); } catch { /* 单个订阅者失败不影响其他 */ }
  }
  return locked;
}

/** 订阅锁定变化（返回取消函数）；锁定瞬间各服务据此作废在途请求。 */
export function onPairingLockChange(listener: (locked: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
