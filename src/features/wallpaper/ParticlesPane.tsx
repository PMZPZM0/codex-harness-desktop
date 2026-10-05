/**
 * 粒子壁纸面板（tsparticles 接线，2026-10-05）：**整块懒加载** ——
 * ⛔ 不许被顶层 import 进主包：@tsparticles/react 的包装器会静态拖进 @tsparticles/engine，
 *   只有把本文件作为独立 chunk（React.lazy），引擎才不占主包。
 */
import Particles, { ParticlesProvider, useParticlesProvider } from "@tsparticles/react";
import type { FC } from "react";

/** 主题主色转 hex（tsparticles 只吃具体色值，不吃 CSS 变量）。
 *  ponytail: 挂载时取一次，运行中换主题不跟随 —— 升级路径 = 监听 data-theme 变化重建。 */
function accentHex(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : "#7a9e7e";
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ParticlesInner({ color }: { color: string }) {
  const { loaded } = useParticlesProvider();
  if (!loaded) return null;
  return (
    <Particles
      id="wallpaper-particles"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      options={{
        // ⛔ fullScreen 必须关：默认全屏会劫持 body，壁纸层只属于聊天区
        fullScreen: { enable: false },
        background: { color: "transparent" },
        detectRetina: true,
        particles: {
          number: { value: 42 },
          color: { value: [color] },
          opacity: { value: 0.4 },
          size: { value: { min: 1, max: 2.6 } },
          move: { enable: !prefersReducedMotion(), speed: 0.55, direction: "none", outModes: "out" },
          links: { enable: false },
        },
      }}
    />
  );
}

const ParticlesPane: FC = () => {
  const color = accentHex();
  return (
    <ParticlesProvider
      init={async (engine) => {
        const { loadFull } = await import("tsparticles");
        await loadFull(engine);
      }}
    >
      <ParticlesInner color={color} />
    </ParticlesProvider>
  );
};

export default ParticlesPane;
