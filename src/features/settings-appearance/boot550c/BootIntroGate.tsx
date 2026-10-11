/**
 * 启动页分派：用不用 550C 片头。
 *
 * 判据（三选一成立就**不播**，走既有的 BootSplash）：
 *   · 档位 = 关闭；· 系统「减弱动效」；· 桌面宠物浮窗 `?pet=1`。
 *
 * ⛔ 决策只在挂载时算一次（useState 初值）：档位读 localStorage、动效偏好读 matchMedia，
 *    中途变化不该把正在播的片头掐掉或凭空唤起。
 */
import { useState } from "react";
import { BootSplash, type BootStage } from "../../../components/BootSplash";
import { bootIntroPlayMode, readBootIntroMode, readBootIntroScheme, shouldPlayBootIntro } from "../../../lib/boot-intro.mjs";
import { BootIntro550c } from "./BootIntro550c";

export function BootIntroGate({ stage, done }: { stage: BootStage; done: boolean }) {
  const [decision] = useState(() => {
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    const reducedMotion =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const petWindow =
      typeof location !== "undefined" && new URLSearchParams(location.search).get("pet") === "1";
    const mode = readBootIntroMode(storage);
    return {
      play: shouldPlayBootIntro(mode, { reducedMotion, petWindow }),
      mode: bootIntroPlayMode(mode),
      scheme: readBootIntroScheme(storage),
    };
  });
  const [introDone, setIntroDone] = useState(false);

  if (decision.play) {
    // 片头整段盖住启动过程；播完 / 跳过后若还没就绪，再把既有启动页交回去兜底。
    if (!introDone) return <BootIntro550c mode={decision.mode} scheme={decision.scheme} onDone={() => setIntroDone(true)} />;
    return done ? null : <BootSplash stage={stage} done={done} />;
  }
  return <BootSplash stage={stage} done={done} />;
}
