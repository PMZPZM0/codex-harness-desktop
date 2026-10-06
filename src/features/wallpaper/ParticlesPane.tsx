/**
 * 粒子壁纸面板（tsparticles 接线，2026-10-05）：**整块懒加载** ——
 * ⛔ 不许被顶层 import 进主包：@tsparticles/react 的包装器会静态拖进 @tsparticles/engine，
 *   只有把本文件作为独立 chunk（React.lazy），引擎才不占主包。
 */
import Particles, { ParticlesProvider, useParticlesProvider } from "@tsparticles/react";
import type { Engine } from "@tsparticles/engine";
import type { FC } from "react";
import { useEffect, useState } from "react";

/** 主题主色转 hex（tsparticles 只吃具体色值，不吃 CSS 变量）。
 *  ⛔ 10-06 用户实测：粒子档在深色主题下整块发白 —— 引擎对 background 选项的默认处理不可信，
 *   颜色/背景一律双保险（选项 + CSS !important），且跟随主题换色（data-theme 变化重挂）。 */
function accentHex(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : "#7a9e7e";
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 跟随主题：data-theme 变化 ⇒ 重新取 accent 并重挂引擎（key=color） */
function useThemeColor(): string {
  const [color, setColor] = useState(accentHex);
  useEffect(() => {
    const ob = new MutationObserver(() => setColor(accentHex()));
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => ob.disconnect();
  }, []);
  return color;
}

function ParticlesInner({ color }: { color: string }) {
  const { loaded } = useParticlesProvider();
  if (!loaded) return null;
  return (
    <Particles
      key={color}
      id="wallpaper-particles"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: "transparent" }}
      options={{
        // ⛔ fullScreen 必须关：默认全屏会劫持 body，壁纸层只属于聊天区
        fullScreen: { enable: false },
        background: { color: "transparent" },
        detectRetina: true,
        particles: {
          // ⛔ 首版「42 个 1~2.6px 素点」肉眼几乎不可见（10-05 用户报「粒子没效果」）——
          //   经典粒子网络 = 点 + 邻近连线，数量/半径/连线距离给足才有存在感。
          number: { value: 70 },
          color: { value: [color] },
          opacity: { value: 0.65 },
          size: { value: { min: 2, max: 4.5 } },
          move: { enable: !prefersReducedMotion(), speed: 0.8, direction: "none", outModes: "out" },
          links: { enable: true, distance: 130, color, opacity: 0.28, width: 1 },
        },
      }}
    />
  );
}

/** ⛔ init 回调必须是模块级常量：tsparticles v4 校验「init across the app lifecycle」，
 *  内联箭头函数每次渲染都是新引用 ⇒ 整树抛错（10-06 启动报错实录）。 */
const initEngine = async (engine: Engine): Promise<void> => {
  const { loadFull } = await import("tsparticles");
  try {
    await loadFull(engine);
  } catch (err) {
    (window as unknown as { __wpLoadErr?: string }).__wpLoadErr = String(err);
    throw err;
  }
};

const ParticlesPane: FC = () => {
  const color = accentHex();
  return (
    <ParticlesProvider init={initEngine}>
      <ParticlesInner color={color} />
    </ParticlesProvider>
  );
};

export default ParticlesPane;
