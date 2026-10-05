// vanta npm 包没有类型（UMD dist）；本应用只用到 NET 效果的最小面。
// three 没装 @types（它只作为 vanta 的入参透传）⇒ 声明成 any 命名空间。
declare module "three";
declare module "vanta/dist/vanta.net.min.js" {
  const vantaNet: (options: Record<string, unknown>) => { destroy: () => void };
  export default vantaNet;
}
