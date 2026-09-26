---
id: 2026-09-26-change-办公室-v7换-kenney-cc0-等距素材含构建期静默失败与图层三段式两处坑
date: 2026-09-26
kind: change
area: team-office
title: 办公室 v7：换 Kenney CC0 等距素材（含构建期静默失败与图层三段式两处坑）
tags: [team-office, assets, kenney, iso, silent-failure]
commits: []
files: [src/features/team-office/OfficeFurniture.tsx, src/features/team-office/OfficeScene.tsx, src/features/team-office/office-iso.ts, src/assets/office]
importance: high
---

# 办公室 v7：换 Kenney CC0 等距素材（含构建期静默失败与图层三段式两处坑）

## 需求

用户给了参考项目 `workbzw/ai-office-react`（AI 同事办公室预览），要求「把我们办公室预览改成他这种，复刻过来」，
随后明确「**看看他用什么完成的，不一定要 SVG**」。

## 调研结论（决定了做法）

| 方案 | 结论 |
|---|---|
| LimeZu「Modern Interiors」 | ❌ **免费版仅限私人用途**（作者亲口回复过），有商用风险 ⇒ 排除 |
| DiceBear / open-peeps / avataaars | ❌ 全是**半身或头像**，且输出扁平化（无部件分组）⇒ 不能做坐姿部件动画 |
| **Kenney「Furniture Kit」** | ✅ **CC0 1.0**（可商用、免署名，来源 kenney.nl）；120 种家具、**每件 4 个朝向**的等距渲染件 |
| 参考项目本身 | PixiJS 8 + `@esotericsoftware/spine-pixi-v8` + **一张 1.5MB 预渲染房间大图** + Spine 骨骼角色；作者 README 明写「**素材版权问题**」⇒ 素材不能搬 |

⇒ 采用 Kenney 素材替换家具与环境；**角色仍自绘**（素材包没有等距人物，而角色要能做「坐姿 + 打字/抬杯」的部件动画）。

## 实现

- **素材**：23 个等距渲染件复制进 `src/assets/office/`（共 39KB，vite 全部**内联进 JS** ⇒ 打包零外部文件依赖）。
- **尺寸表**：`SPRITE_SIZE` 是**实测 PNG 头**读出来的（不是估的：错一个数家具整体错位）。
- **图层次序（关键）**：工位拆成三段 `IsoDeskBack`（显示器）→ `IsoDeskChair` → **人** → `IsoDeskFront`（桌子）。
  早先是「家具先画、人后画」⇒ 人浮在桌子上方，看着像站在桌前 —— 这是 v6「人像躲在桌子底下」的真因。
- **场景**：地板收窄 110px（原房间太宽，工位只占中间一条 = 「大房间摆小桌」）+ 地板双方向拼缝（等 u 线 + 等 v 线）。
- **删掉** v6 的 5 个粗描边 SVG 家具（墙架/白板/饮水机/打印机/挂钟）：与 3D 渲染件放同一屏一眼就是"两种画风拼的"。

## 踩的坑（全部是实测，不是推理）

1. **`import.meta.glob` 静默失败**：本模块被 vite root 之外的入口加载时，glob **匹配到 0 个文件**，
   而失败是静默的 —— `IsoSprite` 直接 `return null`，整间办公室的家具"凭空消失"却零报错。
   ⇒ 改**静态 import**（守卫【169】①钉死）。
2. **素材缩放与人的抬高必须联动**：等距 sprite 的垂直占用 = 深度投影(≈半宽) + 实际高度，
   桌子一变高就把坐着的人整个盖住。`SEAT_LIFT` 实测走了 58 → 78 → 90 → 110 四轮；
   最终抽成 `SEAT_LIFT / TAG_LIFT / HANDOFF_LIFT` 三个常量（不再散落魔数）。
3. **显示器的桌面高度试了三档**：`DESK_TOP` 46（整块坐在桌面之下，只露 14px）→ 78（升到肩膀旁，像"扛着屏幕"）
   → **88**（= sprite 的整个垂直投影 = 桌面后边缘，才是"显示器立在桌子后缘"）。
4. **脚本删大块代码又一次翻车**：用「从函数签名起第一个 `{` 做大括号配平」定边界 ——
   签名里的**参数类型注解**本身就带 `{}`，在那里就配平了，结果只删掉签名行、函数体留在文件里（tsc 报 TS1128）。
   ✅ 改用**顶格 `\n}\n`** 作边界（函数体内一律缩进）。
5. **断言误红**：`!furnSrc.includes("import.meta.glob")` 被**注释里提到的 API 名**命中 ⇒ 判据改带左括号（只认调用形式）。

## 判据

- 守卫【169】4 条（静态 import / 尺寸表覆盖全部素材 / 工位三段式顺序 / 素材来源与许可留在文件头），
  **两条变异验证均可红**（删 `sideTable` 尺寸 ⇒ 准确报出"缺：sideTable_NE.png"；把桌子提到人之前 ⇒ 顺序断言红）。
- 【168】⑨⑩ 更新：家具动效改由 CSS 挂在素材节点上（吊扇轻摆 / 绿植微摇）+ 断言动效宿主真的在场景里（防"只有 CSS 没有宿主"的假绿）。
- 真机级验证靠离线预览（react 组件单独渲染 + Edge headless 按真实时间截图）：实测姿势在换（统筹中 → 喝口茶、打盹 → 待命）。

## 遗留

- `20-team-office.css` 里 v6 的手绘家具动画规则（`ofc-drift` / `ofc-swing` / `ofc-rise` / `ofc-print` / `ofc-leaf` / `ofc-draw`）
  随宿主删除后已无节点引用，属死样式，待下一轮清理。
- 若将来要更接近参考实现的质感，方向是**换整套素材包**（需含等距人物的包），而不是继续调参。
