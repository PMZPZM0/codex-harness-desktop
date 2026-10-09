# Compositor 逆向分析（2026-10-10）

源码位置：`.workbuddy/compositor-reference/`（浅克隆，`morluto` 之外的 `robbietilton/Compositor`，MIT，8.5MB）

> 本文是**源码分析**，不是二进制逆向。见 §0。

---

## 0. 为什么这件事不该用 REA

REA 的 SKILL.md **第 3 行**就写着：

> "Skip REA for ordinary source-repository architecture analysis."

正文更明确：

> "For ordinary analysis of a complete source repository, use normal repository tools and
> **do not run REA readiness or provider commands**."

Compositor 是**完整公开的源码仓库**（230 个 `.swift`，49,759 行）。有源码却去反编译，是绕远路且更不准。
REA 的正确用途是**没有源码的二进制**（闭源 app、固件、交付给客户的产物）。

另外：REA 当前**尚未激活**（本会话工具面无 `rea_*` 工具），`~/.workbuddy/mcp.json` 已就位，
需到连接器管理页 Trust 后重开会话。

---

## 1. 关键实现（对我们 image-doc 有直接价值的）

### 1.1 混合模式：24 种全部委托 Core Image

`Compositor/Document/LayerAppearance.swift` + `Rendering/GPUCanvas.swift`：

```
colorBurn → CIColorBurnBlendMode      linearBurn  → CILinearBurnBlendMode
colorDodge→ CIColorDodgeBlendMode     linearDodge → CILinearDodgeBlendMode
softLight → CISoftLightBlendMode      vividLight  → CIVividLightBlendMode
darken    → CIDarkenBlendMode         linearLight → CILinearLightBlendMode
multiply  → CIMultiplyBlendMode       pinLight    → CIPinLightBlendMode
lighten   → CILightenBlendMode        hardMix     → CIHardMixBlendMode
screen    → CIScreenBlendMode         subtract    → CISubtractBlendMode
overlay   → CIOverlayBlendMode        divide      → CIDivideBlendMode
hardLight → CIHardLightBlendMode      difference  → CIDifferenceBlendMode
exclusion → CIExclusionBlendMode      hue/saturation/color/luminosity → CI*BlendMode
```

⛔ **决定性细节**（`SeparableBlend.swift` 第 14–17 行注释）：

> "Core Image works in a linear space unless told otherwise, and Color Burn / Color Dodge
> **are not separable from the gamma they are computed in** … The blend has to happen in the
> **same sRGB the canvas is in**."

⇒ 他们用 `.workingColorSpace: sRGB` 强制。**我们的 blend.ts 正是在 sRGB 0..1 上算的 —— 口径对了。**

另一处：Core Graphics 的 Color Burn / Color Dodge **忽略源透明度**（"a soft brush comes out with a hard edge"），
所以这两个模式被单独拿出来走 surface 路径。

### 1.2 色阶：官方在**预乘 alpha** 缓冲上算，我们是直通 —— **两者等价，别照抄**

`Rendering/LevelsPixels.c`：

```c
float alpha = p[3];
if (!alpha) continue;
float x = fminf(255, p[channel]*255.0f/alpha);   // ← 反预乘
float result = table[lo] + (table[hi]-table[lo])*(x-lo);   // LUT 线性插值
p[channel] = (uint8_t)fminf(alpha, fmaxf(0, roundf(result*alpha)));  // ← 重新预乘
```

它之所以要反预乘，是因为**跑在 CoreGraphics 的预乘缓冲上**（`SeparableBlend.swift` 显式
`CGImageAlphaInfo.premultipliedLast`）。而 jimp 的 bitmap 与我们的累积缓冲是**直通 alpha**，
数据本身就已经是真实颜色 C。

两条路径**数学等价**：预乘侧 `LUT(C)·a`，直通侧 `LUT(C)`，C 是同一个真实颜色。

⛔ **10-10 我自己踩了一次**：先照抄反预乘进 `adjust.ts`，验证时发现会把直通数据再除一次 alpha
（半透明处整体偏错）⇒ 已回退，并在代码里留注警示：**抄公式前先看清数据的色彩空间**。

同一文件还有 `cube_apply`：**3D LUT**（dimension³ RGBA，red 最快变），**8 邻居三线性插值**，
同样在反预乘后的颜色上做。我们没实现 3D LUT。

### 1.3 调整图层：离屏 surface + padding halo

`Rendering/AdjustmentSurface.swift`：空间型调整（模糊/噪点）需要脏矩形之外的像素，
所以在离屏 surface 上渲一个**带 padding 的光晕区**，再裁剪回目标区域。
⇒ 我们直接对整幅画布做，边界像素会不同（模糊/噪点在边缘少一圈采样）。

### 1.4 渲染架构

| 组件 | 作用 |
|---|---|
| `GPUCanvas.swift`（582 行） | Metal 画布，纹理管理、混合、`CIBlendWithRedMask` 蒙版 |
| `TiledLayerRenderer.swift`（419 行） | **分块渲染**（大画布只渲可见块） |
| `LayerRenderer.swift`（176 行） | 图层绘制调度、device scale |
| `LayerEffectsSurface` / `MetalLayerEffects` | 6 种图层效果（GPU） |
| `LiveMaskRenderer` / `MetalBrushCoverage` | 蒙版与笔刷覆盖（GPU） |
| 一批 `.c` 像素内核 | `BrushPixels` `HealPixels` `ContentFill` `DitherPixels` `LensPixels` `NoisePixels` `WandPixels` `LevelsPixels` |

⇒ **性能敏感的部分是 C + Metal**；我们在 JS 里做，大数据量下会慢一到两个数量级。

---

## 2. 我们 image-doc 的偏差清单（按严重程度）

来源：`docs/project-format.md`（版本 1–11 的字段级规格，比 `writing-comp-files.md` 精确得多）

| 项 | 我们现在的字段 | 官方字段 | 判定 |
|---|---|---|---|
| Gaussian Blur | `radius` | **`blurRadius`**（0.1–250 文档像素） | ❌ 错 |
| Motion Blur | `radius` / `angle` | **`motionAngle`**（−90..90）/ **`motionDistance`**（1–2000） | ❌ 错 |
| Add Noise | `amount` | **`noiseAmount`**（0.1–400）+ `noiseGaussian` + `noiseMonochromatic` + **`noiseSeed`** | ❌ 错；官方**有 seed 字段**（跨会话稳定） |
| Gradient Map | `gradientStops[{position,color}]` | **`gradientMapSettings{shadows, highlights, reversed}`** —— 两色渐变，不是 stops 数组 | ❌ 错 |
| Black & White | `reds/greens/blues` | **`blackWhiteSettings`** | ❌ 结构不对 |
| Exposure | `exposure/offset/gamma`（平铺） | **`exposureSettings`**（嵌套对象） | ❌ 结构不对 |
| Grain | `amount` | **`grainSettings`** | ❌ 结构不对 |
| Hue/Saturation | 任意数值 | `hue` **±360**、`saturation`/`lightness` **±100**（越界/非有限值会被**拒绝**） | ⚠️ 要夹紧 |
| Levels / Curves | 有，4 通道 RGB→R,G,B | 同 | ✅ 一致 |
| 色彩空间 | 直通 alpha | **预乘 alpha**（Levels/Cube） | ⚠️ 半透明处不同 |
| 蒙版命名 | `<id>.mask.png` | `<UUID>.mask.png`，**v6 起组也能带** | ✅ 基本一致 |
| 文本层 | 无 | `text` 元数据 + `colorRuns`(v10) + `fontRuns`(v11) | ❌ 未实现 |
| 图层效果 | 无 | `effects`：`stroke`/`shadow`/`colorOverlay`/`innerShadow`/`outerGlow`/`innerGlow` | ❌ 未实现 |
| shape / maskPlacement | 无 | 有（形状层保留样式、蒙版可取消链接并独立变换） | ❌ 未实现 |
| 3D LUT | 无 | `cube_apply`（8 邻居三线性） | ❌ 未实现 |

**结论：能力面骨架对了（图层栈/混合/变换/蒙版/调整），但"参数字段"这一层基本没对齐官方规格。**
好消息是这些大多是**字段名/结构的机械修正**，不是算法重写；而且我们已做"未知字段原样透传"，
所以读 Compositor 产出的 `.comp` 不会丢东西，只是**解释不了**那些参数。

---

## 3. "复刻一个一模一样的双版本"——可行性判断

**目标可行，但路径不是"用 REA 一键复刻"。**

- ✅ **双平台是可行的**：用 **Electron + Web 栈**重写 ⇒ 一份代码，Windows / mac 同时出包。
  本项目（Codex Harness Desktop）本身就是 Electron 双平台应用，构建链现成。
- ❌ **REA 不做复刻**：它返回证据与伪代码，由 agent 自行实现；且对有源码的仓库明确建议不用。
- ❌ **Swift 版搬不到 Windows**：已实证（AppKit 146 / SwiftUI 58 / Metal 6 处引用，Windows 全无对应物）。

**真实工作量**（对照 Compositor 实测规模）：

| 层 | 官方规模 | 我们现状 | 还需 |
|---|---|---|---|
| 文档模型 + IO | 17,815 行 | ~400 行（骨架） | 补齐文本层/效果/shape/字段对齐 |
| 合成渲染 | 7,506 行 | ~926 行（已跑通） | 预乘修正、3D LUT、分块、性能 |
| **界面** | **8,917 行** | **0** | **全部** |

⇒ "一模一样"的量级是**数千到上万行 + 一整个界面层**，不是一轮能交付的。
能一轮交付的是 **§2 的字段对齐修正**（机械、有明确规格、立刻提升互操作性）。
