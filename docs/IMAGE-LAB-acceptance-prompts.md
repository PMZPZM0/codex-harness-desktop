# 图像工坊（image-lab）测试验收提示词

> 用途：对着 `docs/IMAGE-LAB.md` 的实现做**人工验收**。下面每一条都是**可以直接粘进 Codex 会话**的原话，
> 每条附「预期现象」与「判据」。全部按 PID 顺序跑一遍即算验收完成。
>
> 对应提交：`640500e`；守卫：`scripts/guards/12b-image-lab.mjs`（16 条）。

---

## 0 验收前置（不做这几步，后面全都不准）

### ① 必须先构建

你的实例跑的是 `dist`。本轮改的是渲染层 + 主进程，**不 build 就是旧代码**：

```bash
# 在仓库根，Windows Git Bash
export CODEBUDDY_SAFE_DELETE_ENABLED=0
npm run build
```

判据：账号菜单 →「检查更新」页能看到**新的构建指纹**（`构建 YYYYMMDD-HHmm`）。
⛔ 别拿"我的实例是最新的"来推断——一定要看这行指纹。

### ② 必须新建会话（或对老会话 resume 一次）

工具面只在 `thread/start` 注册；老会话第一次要 resume 才有。

判据：新开会话后问一句 `你现在有哪些图像相关工具？`，回答里应出现
`image_generate / image_edit / image_info / image_view` 四个名字。

### ③ 生图接口要有 Key

`设置 → 插件 → 生图接口` 填好 API Key（`image_generate` 依赖它；`image_edit` 不依赖）。

### ④ 准备一张测试图

最省事的办法是让 Codex 自己造一张（顺带把生图也测了）：

> 用 image_generate 生成一张 1024x1024 的图片，画面是蓝天下一片向日葵，保存到当前工作目录。

判据：返回一个本地绝对路径，且**浮层弹出又自动收起**。这个路径就是后面所有编辑测试的 `SRC`。

> 若你想用自己准备的图：把文件放到**当前会话工作目录**里即可（可信目录 = 会话工作目录 / 应用数据目录）。

---

## 1 冒烟（3 条，先跑这个；不过就别往下测）

### S1 · 生图 + 浮层三态

> 用 image_generate 画一只戴墨镜的柴犬，1024x1024。

**预期**：① 浮层弹出，标题含"生成中"；② 出图后浮层内容换成产物；③ **约 1 秒后浮层自己收起**（不是瞬间消失，也不是一直留着）。
**判据**：三态都看到 = 通过。返回文案以「已生成 1/1 张：」开头。

### S2 · 读元信息（不弹浮层）

> 用 image_info 看一下 `SRC` 的尺寸、格式、有没有透明通道。

**预期**：返回形如 `<路径>：1024×1024，png，xxKB`；**不弹浮层**（这是纯读取）。
**判据**：数字与你肉眼看到的图一致。

### S3 · 预览浮层（不自动关）

> 用 image_view 打开 `SRC` 给我看看。

**预期**：浮层弹出显示这张图；**停住不自动关**，要你自己点关闭。
**判据**：故意等 10 秒，浮层仍在 = 通过（若自动关了就是 bug，见 §4）。

---

## 2 编辑能力覆盖（20 种 op，按组测）

> 把 `SRC` 换成 §0④ 得到的路径。每组一条提示词，跑完在文件管理器里核对产物。

### G1 · 几何

> 把 `SRC` 做这些处理并另存为新文件：先裁剪 512x512（从左上角开始），再缩放到宽 800，最后顺时针转 90 度。

**预期**：产出 `<名字>-edit.png`，返回 `已编辑 1 张，产出：<路径>（800×512，png，xxKB）`。
**覆盖**：`crop` → `resize` → `rotate`（顺序敏感：后一个接前一个的产物）。

### G2 · 色调

> 把 `SRC` 调亮一点、对比度加一点，然后自动色阶，另存。

**预期**：产物肉眼比原图亮、层次更分明。
**覆盖**：`brightness{value:0.2}` → `contrast{value:0.2}` → `normalize`。

### G3 · 风格化

> 把 `SRC` 分别做成四个版本：灰度、棕褐色、反相、四色阶海报。文件名带后缀区分。

**预期**：四个文件，风格各异。
**覆盖**：`greyscale` / `sepia` / `invert` / `posterize{n:4}`。

### G4 · 马赛克 / 模糊

> 把 `SRC` 打上马赛克（块大小 12），另存；再出一版高斯模糊（半径 8）。

**预期**：马赛克版能看出方块；模糊版整体虚化。
**覆盖**：`pixelate{size:12}` / `gaussian{radius:8}`。

### G5 · 翻转 / 透明

> 把 `SRC` 水平翻转，再把整体透明度设成 50%（png 输出）。

**预期**：产物左右镜像，且半透明（用 image_info 复查应显示"带透明通道"）。
**覆盖**：`flip{axis:"horizontal"}` / `opacity{value:0.5}`。

### G6 · 叠加（水印）+ 文字

> 给 `SRC` 右下角叠一个小图当水印（水印图就用 `SRC` 缩到 10% 再做一张），然后左上角写一行英文 `SAMPLE`。

**预期**：产物右下有小水印、左上有 `SAMPLE` 字样。
**覆盖**：`resize`(造水印) → `composite{path,x,y,opacity}` / `text{text,x,y,size,color}`。
⛔ 已知限制：`text` **只支持英文数字**，写中文会是空白（见 §3 N6）。

### G7 · 透明底压色

> 对 `SRC` 先抠成带透明的版本（把某个区域设成透明），再用 `#ffffff` 压成白底。

若手上真有带透明的 png：直接
> 把 `SRC` 的透明底压成纯白 `#ffffff`。
**覆盖**：`background{color:"#ffffff"}`。

### G8 · 格式与质量

> 把 `SRC` 转成 jpeg，质量 60，另存。

**预期**：产物后缀 `.jpg`，体积明显小于原 png。
**覆盖**：`format:"jpeg"` + `quality:60`。

### G9 · 多图批处理

> 把工作目录里所有 png 都缩到 512 宽，各自另存。

**预期**：一次调用处理多张（走 `paths` 数组），返回「已编辑 N 张」并逐行列路径。
**覆盖**：`paths:[...]` + 同一组 `ops` 逐张应用。

---

## 3 边界与负向（**这节是"能正常运行"的真正判据，必须测**）

> 这些是**期望失败**的用例。只要不是崩溃/静默通过，就算对。

| 编号 | 提示词 | 预期结果 |
|---|---|---|
| N1 | 用 image_edit 把 `SRC` 缩放一下，但 `ops` 里写一个 `{"op":"hue-shift"}` | 明确报错「不认识的编辑操作：hue-shift」——⛔ **绝不静默跳过** |
| N2 | 用 image_edit 处理 `C:\Windows\notepad.exe` | 拒绝：不在可信目录 / 扩展名不在白名单 |
| N3 | 用 image_edit 处理 `C:\Users\Administrator\Desktop\任意文件.txt` | 拒绝：不是图片扩展名 |
| N4 | 用 image_info 读一个不存在的路径 `D:\no-such-file.png` | 报错「文件不存在」类文案，不崩 |
| N5 | 用 image_edit 把 `SRC` resize 到 `width: 999999` | 二选一：要么明确报错，要么产出一张巨大图但**不卡死进程**；两者都算通过，卡死算失败 |
| N6 | 用 image_edit 在图上写中文 `测试` | 能正常产出文件（图上该处为空白）；⛔ **不能报错、不能崩** —— 这是文档已声明的限制 |

**为什么 N1/N2 最关键**：这两条正是守卫【img】做过变异测试的地方（去掉"未知 op 报错"、去掉"路径闸"都会被守卫抓红）。

---

## 4 浮层协议验收（用户明确要求的行为）

| 编号 | 操作 | 预期 |
|---|---|---|
| P1 | 触发 `image_generate` | 弹出（生成中）→ 换成产物 → **约 1 秒后自动收起** |
| P2 | 触发 `image_edit` | 先亮**源图**（让你看清"在改哪张"）→ 换成产物 → 自动收起 |
| P3 | 触发 `image_view` | 弹出后**不自动收起**，等你自己关 |
| P4 | 让 `image_edit` 故意失败（跑 N1） | 浮层显示**错误态**，然后收起；应用不崩、会话能继续 |
| P5 | 编辑过程中连点关闭按钮 | 能正常关，不残留半个浮层 |

**判据**：P1/P2 的"自动收起"要**看得出有个短暂停留**（约 900ms），不能"啪一下没了"。
若瞬间消失或永不消失，都是 bug。

---

## 5 验收结果表（照填）

```
构建指纹：            构建 __________-______         [ ]
新会话工具面四件套可见：                            [ ]
S1 生图+浮层三态                                    [ ]
S2 image_info 不弹浮层                              [ ]
S3 image_view 不自动关                              [ ]
G1 几何 crop/resize/rotate                          [ ]
G2 色调 brightness/contrast/normalize               [ ]
G3 风格 greyscale/sepia/invert/posterize            [ ]
G4 pixelate/gaussian                                [ ]
G5 flip/opacity                                     [ ]
G6 composite/text                                   [ ]
G7 background                                       [ ]
G8 format/quality                                   [ ]
G9 paths 批处理                                     [ ]
N1 未知 op 报错、不静默                             [ ]
N2 目录外拒绝                                       [ ]
N3 非图片扩展名拒绝                                 [ ]
N4 不存在路径报错不崩                               [ ]
N5 超大尺寸不卡死                                   [ ]
N6 中文 text 不崩（空白已知）                       [ ]
P1~P5 浮层协议                                      [ ]
```

---

## 6 失败了怎么定位

| 症状 | 先查这里 |
|---|---|
| 工具名根本调不出来 | 没 build / 老会话没 resume（§0①②） |
| 工具能调但报"未知工具" | 四个工具是**渲染层注册的独立 dynamicTool**（`part08/01-seg.tsx` 的 `imageToolDefs`），执行端在 `image-lab.ts` 的四条通道；检查 `image-lab:generate/:edit/:info/:view` 是否都在 manifest + preload + ipc-registry（跑 `node scripts/guards/12b-image-lab.mjs`） |
| 编辑报 `Cannot find module 'jimp'` | 依赖没装 / 打包漏了 jimp（`npm i jimp@^1.6.1`） |
| 报 `Unsupported MIME type: undefined` | 输出格式推导异常，查 `image-lab.ts` 的 `EXT_TO_FORMAT` |
| 浮层不弹 / 不关 | 渲染层 `ImageLabBridge` 是否挂在 `AppView`；`image-lab:event` 推送是否发出 |
| 中文文字是空白 | **不是 bug**，jimp 内置位图字体仅 ASCII（已记入 `docs/IMAGE-LAB.md` 已知限制） |

一键回归：`node scripts/guards/12b-image-lab.mjs`（应 16/16）。
