# 桌面宠物制作教程（2026-10-21 第二版）

本应用兼容两种宠物包格式。**内置六只全部使用动画包**；官方 Codex / Petdex 的 8×9 图集包仍然可以直接导入。

## 1. 内置六只

| ID | 名字 | 角色 | 画布 | 源图 |
|---|---|---|---|---|
| `harness-fox` | 阿焰 | 细毛小狐狸（默认） | 288×312 | `scripts/pet-art/harness-fox/` |
| `harness-mochi` | 阿糯 | 奶油猫 | 256×277 | `scripts/pet-art/harness-mochi/` |
| `harness-tuantuan` | 阿团 | 垂耳兔 | 256×277 | `scripts/pet-art/harness-tuantuan/` |
| `harness-chai` | 阿柴 | 柯基 | 256×277 | `scripts/pet-art/harness-chai/` |
| `harness-lizi` | 阿栗 | 小熊猫 | 256×277 | `scripts/pet-art/harness-lizi/` |
| `harness-qingtuan` | 阿青 | 小龙 | 256×277 | `scripts/pet-art/harness-qingtuan/` |

成品在 `public/pets/<slug>/`，构建时复制到 `dist/pets/`。⛔ 不要放 `src/` 让 JS import：打包裁剪只认 js/css 与 CSS 里的 `url()`，位图会被当陈旧死块删掉。

## 2. 动画包格式（推荐）

```
public/pets/<slug>/
  pet.json
  idle.webp / idle-still.webp
  running-right.webp / running-right-still.webp
  ...（九态各一对）
  look-00.webp ... look-15.webp
```

`pet.json` 的关键字段：

```json
{
  "id": "my-pet",
  "displayName": "小名",
  "description": "一句话介绍",
  "columns": 8,
  "rows": 9,
  "states": ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"],
  "frameSize": { "width": 256, "height": 277 },
  "fps": 30,
  "supportsLookTracking": true,
  "animationSet": {
    "idle": { "animatedSrc": "idle.webp", "stillSrc": "idle-still.webp" }
  },
  "lookFrameSet": ["look-00.webp", "..."],
  "builtin": true
}
```

- 九态顺序不可改：`idle / running-right / running-left / waving / jumping / failed / waiting / running / review`。
- 每态一段 30fps 动画 WebP + 一张静帧（减少动效偏好用）。
- `lookFrameSet` 可选；有 16 张时悬停会切看帧，没有就用 CSS 轻倾兜底。
- 动画 WebP 透明、无背景；整包建议 ≤8MB。

## 3. 从零做一只

### 3.1 出六张姿态图

用生图模型（ImageGen 等）出一张 **3 列 × 2 行** 的角色表，六格分别是：

1. 站立（正面，尾巴完整可见）
2. 欢呼（一只爪子举起）
3. 难过（坐着、眼泪、耳朵下垂）
4. 奔跑（侧身向右、短腿、尾巴向后）
5. 工作（坐在深蓝/深灰笔记本后打字）
6. 审阅（举着银色放大镜）

要求：**纯白背景、无地面阴影、无文字/水印/边框**；同一角色六格比例一致；Q 版（大头、短腿、大而有高光的眼睛）；毛色尽量**偏暖/有饱和度**（奶油、桃色、蜜橘等），纯白毛在抠底时容易被当成背景。

### 3.2 裁成六张单姿态

把整张角色表裁成六格（每格约 512×512；右下角审阅格若含平台水印，先裁掉/清掉水印），放进：

```
scripts/pet-art/<slug>/
  stand.png cheer.png tired.png run.png work.png review.png
  pet-meta.json
```

`pet-meta.json` 示例：

```json
{
  "displayName": "小名",
  "description": "一句话介绍",
  "cleanup": "light",
  "fillGaps": true,
  "trimWorkBottom": true,
  "tailSide": { "stand": "right", "cheer": "right", "tired": "right", "run": "left", "work": "right", "review": "right" },
  "render": { "frameWidth": 256, "frameHeight": 277, "artHeight": 240, "footY": 264, "centerX": 128, "frames": 24, "idleFrames": 40, "quality": 78 }
}
```

- `cleanup`：`light`（浅色/蓬松毛，只严格抠白底，不跑激进阴影清理）/ `full`（深色毛，允许白洞与地面阴影清理）。
- `fillGaps`：填毛缝里露出的白底（浅色蓬松角色建议开）。
- `tailSide`：尾巴在每张姿态的哪一侧；默认 `run` 左、其余右。
- `laptopGlow` / `trimWorkBottom`：旧版蓝色反光清理，按需开。
- `render`：可省略（默认 288×312）；浅色宠物建议 256×277 降低包体。

### 3.3 生成动画包

```bash
python scripts/gen-pet-animation-set.py <slug>
```

脚本会：
- 抠白底、按 `cleanup` 清理、补毛缝、归一化；
- 生成九态 30fps 动画 WebP + 静帧、16 向看帧；
- 写 `public/pets/<slug>/pet.json`。

生成后：

```bash
npm run build
```

重启应用 → 设置 → 桌面宠物 → 选择新宠物。

### 3.4 验收

```bash
node scripts/guards/06-app-behavior.mjs          # 只跑模块时末尾计数会报整仓基准，属正常
node scripts/guards/12ab-pet-activity.mjs        # 宠物格式 / 看帧 / 动画
npm run build && node scripts/accept.mjs --only pet-activity
```

## 4. 官方 8×9 图集包（兼容格式）

社区包 / Petdex / Codex 官方包的结构：

```
pet.json + spritesheet.png|webp
图集 8 列 × 9 行，每帧 192×208
九行顺序同上
```

`scripts/gen-pet-spritesheets.mjs` 保留为格式示例生成器（`PETS` 已清空，按原结构填一项即可出图集）；`scripts/gen-pet-from-art.py` 是 AI 美术 → 8×9 图集的参考管线。内置宠物不再使用这条路线。

## 5. 目录与导入

- 内置：`dist/pets/`（打包）/ `public/pets/`（开发）
- 用户：`<userData>/pets/`（设置页可打开、可写）
- 官方 / Petdex：`~/.codex/pets`、`~/.petdex/pets`（只读展示，点「导入」复制到用户目录）

设置页「宠物目录」可以打开这些目录、重新扫描；把整个宠物文件夹放进去即可。

## 6. 注意

- ⛔ 不要复制 Qoder、影视、游戏等有版权的角色；内置六只都是本项目自产素材。
- ⛔ 浅色宠物不要用普通 60 容差抠底（会把奶油毛抠出黑洞）；用 `cleanup: "light"`。
- ⛔ 动画包必须透明；不要把白底或场景背景烘进宠物。
- ⛔ 改了 `pet.json` / 素材后必须 `npm run build`，否则运行的是 `dist/pets` 旧产物。
