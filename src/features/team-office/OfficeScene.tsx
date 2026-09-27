/**
 * 虚拟办公室场景（team-office 域 09-27 v8「PixiJS 渲染」）。
 *
 * ⛔ v8 为什么换渲染：用户看了 workbzw/ai-office-react（PixiJS + Spine）后要求「复刻过来」，
 *    SVG 手绘人物与 Kenney 3D 渲染家具放一起违和。现在改用 PixiJS 渲染：
 *    家具 = Kenney CC0 等距渲染件（Sprite），人物 = Graphics API 程序绘制。
 *    动画由 office-director 每拍驱动（快照单源，右栏看板同源）。
 *
 * ⛔ 域组件收显式 props（规则第 4 条，禁收 app / 禁深链 useHarnessApp）。
 */
import { OfficeCanvas } from "./OfficeCanvas";
import type { DirectorSnapshot } from "./office-director";

export type OfficeMember = { id: string; name: string; profession: string; running: boolean; hasThread: boolean };
export type OfficeSceneProps = {
  ceoName: string;
  ceoProfession: string;
  members: OfficeMember[];
  /** 姿势快照 —— ⛔ 由调用方（弹窗）持有的**唯一**导演产出，场景只负责画（右栏看板同源）。 */
  snapshot: DirectorSnapshot;
  onOpenThread?: (memberId: string) => void;
};

export function OfficeScene(props: OfficeSceneProps) {
  return <OfficeCanvas {...props} />;
}
