/**
 * 设置页 · 桌面宠物（09-30）。
 *
 * 用户需求：「把官方的宠物接口加上，并且在设置界面加好菜单选项，内置一些默认桌面宠物」。
 *
 * 这一页管三件事：
 *   ① 开关与外观（显示 / 大小 / 透明度）—— 改完立刻应用到浮窗；
 *   ② 宠物选择 —— **官方 Codex 宠物格式**的宠物包（内置的 + 用户放进目录的）；
 *   ③ 装着几个目录、怎么自己放一只 —— 目录清单 + 一键打开 + 导入。
 *
 * ⛔ 格式是**官方规范**（pet.json + 8 列 × N 行图集、默认每帧 192×208、九态行名有序），
 *    所以这里把格式写在界面上：用户拿官方宠物包或自己画一张就能用，
 *    不需要读我们的代码。⛔ 校验不过的包照实显示原因，不静默隐藏。
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Download, FolderOpen, Image as ImageIcon, PawPrint, RefreshCw, TriangleAlert } from "lucide-react";
import { petAssetUrl } from "../pet";
import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs";
import { SettingsGroupHead, SettingsPageHero } from "../../components/SettingsPageHero";

export type PetSettingsSectionProps = { onNotice?: (message: string) => void };

/** 预览缩略图高度（设置页里的列表用小帧，别把 192×208 原图直接铺出来） */
const PREVIEW_H = 56;

const SOURCE_LABEL: Record<PetPackage["source"], string> = {
  builtin: "内置",
  user: "已安装",
  codex: "Codex 自带",
  petdex: "Petdex",
};

/** 列表项的小预览：图集切第 0 行第 0 帧；动画包用 idle 静帧整张缩略。 */
function PetThumb({ pkg }: { pkg: PetPackage }) {
  const k = PREVIEW_H / (pkg.frameHeight || 208);
  const animationStill = pkg.animationSet?.idle?.stillSrc;
  const source = animationStill || pkg.spritesheet;
  return (
    <span
      className="pet-thumb"
      style={{
        width: `${pkg.frameWidth * k}px`,
        height: `${PREVIEW_H}px`,
        backgroundImage: source ? `url("${petAssetUrl(source)}")` : undefined,
        backgroundSize: animationStill ? "contain" : `${pkg.columns * pkg.frameWidth * k}px ${pkg.rows * pkg.frameHeight * k}px`,
        backgroundPosition: animationStill ? "center bottom" : "0 0",
      }}
    />
  );
}

export function PetSettingsSection({ onNotice }: PetSettingsSectionProps) {
  const [status, setStatus] = useState<PetStatus | null>(null);
  const [pets, setPets] = useState<PetPackage[]>([]);
  const [roots, setRoots] = useState<PetRootInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextPets, nextRoots, state] = await Promise.all([
        window.codex.petSettingsGet(),
        window.codex.petList(),
        window.codex.petRoots(),
        window.codex.petState(),
      ]);
      setStatus(nextStatus);
      setPets(Array.isArray(nextPets) ? nextPets : []);
      setRoots(Array.isArray(nextRoots) ? nextRoots : []);
      setOpen(Boolean(state?.open));
      setError("");
    } catch (reason: any) {
      setError(String(reason?.message ?? reason));
      // ⛔ 失败原因交回调用方（吞异常了，按钮侧回执靠它区分成败）
      return String(reason?.message ?? reason);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function apply(next: Partial<PetSettings>, notice?: string) {
    setBusy(true);
    try {
      const result = await window.codex.petSettingsSet(next);
      setStatus(result);
      if (notice) onNotice?.(notice);
    } catch (reason: any) {
      onNotice?.(`保存失败：${reason?.message ?? reason}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(enabled: boolean) {
    setBusy(true);
    try {
      const result = enabled ? await window.codex.petShow() : await window.codex.petHide();
      setStatus((current) => (current ? { ...current, settings: result.settings } : current));
      setOpen(Boolean(result.open));
      onNotice?.(enabled ? "桌面宠物已显示（可拖动到任意位置）" : "桌面宠物已关闭");
    } catch (reason: any) {
      onNotice?.(`操作失败：${reason?.message ?? reason}`);
    } finally {
      setBusy(false);
    }
  }

  async function openDir(which?: string) {
    const result = await window.codex.petOpenDir(which);
    if (!result?.ok) onNotice?.(`打开目录失败：${result?.error ?? "未知原因"}`);
    else if (which) onNotice?.(`已打开 ${result.dir}`);
  }

  async function importPet(pkg: PetPackage) {
    const result = await window.codex.petImport(pkg.dir);
    if (!result?.ok) { onNotice?.(`导入失败：${result?.error ?? "未知原因"}`); return; }
    onNotice?.(`已导入「${pkg.name}」到用户宠物目录`);
    await refresh();
  }

  if (!status) {
    return (
      <section className="settings-section stack pet-settings">
        <p className="muted">{error ? `读取桌面宠物设置失败：${error}` : "正在读取桌面宠物设置…"}</p>
      </section>
    );
  }

  const { settings, active } = status;
  const usable = pets.filter((p) => !p.problem);
  const broken = pets.filter((p) => p.problem);
  const external = pets.filter((p) => p.source === "codex" || p.source === "petdex");

  return (
    <section className="settings-section stack pet-settings settings-exp-page">
      <SettingsPageHero icon={<PawPrint size={20} />} title="桌面宠物" subtitle="一只浮在桌面上的小宠物，跟着任务变状态。内置六只，选一只就能用。" hint="可拖动到任意位置" />
      <SettingsGroupHead title="常用" hint="显示 · 大小 · 透明度" />

      <section className="pet-card">
        <h4><Check size={14} />显示</h4>
        <label className="pet-line">
          <input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => void toggleEnabled(event.target.checked)} />
          <span>
            在桌面显示宠物
            <small>透明置顶小窗，不占任务栏、不抢焦点；按住它可以直接拖到屏幕任意位置，位置会自动记住</small>
          </span>
        </label>
        <label className="pet-line">
          <input type="checkbox" checked={settings.enabled && open} readOnly />
          <span>
            当前状态
            <small>{settings.enabled ? (open ? "已显示" : "已开启，但窗口未打开（点上面的开关重试）") : "已关闭"}</small>
          </span>
        </label>
        <div className="pet-line pet-slider">
          <span>大小<small>{Math.round(settings.scale * 100)}%</small></span>
          <input
            type="range" min={0.6} max={1.8} step={0.05}
            value={settings.scale} disabled={busy}
            onChange={(event) => void apply({ scale: Number(event.target.value) }, `宠物大小 ${Math.round(Number(event.target.value) * 100)}%`)}
          />
        </div>
        <div className="pet-line pet-slider">
          <span>透明度<small>{Math.round(settings.opacity * 100)}%</small></span>
          <input
            type="range" min={0.4} max={1} step={0.02}
            value={settings.opacity} disabled={busy}
            onChange={(event) => void apply({ opacity: Number(event.target.value) }, `宠物透明度 ${Math.round(Number(event.target.value) * 100)}%`)}
          />
        </div>
      </section>

      <SettingsGroupHead title="选择宠物" hint="内置六只 · 点击切换" />
      <section className="pet-card">
        <h4><ImageIcon size={14} />选择宠物<small className="pet-count">{usable.length} 只可用</small></h4>
        {usable.length === 0 && (
          <p className="pet-warn"><TriangleAlert size={12} />一个可用的宠物包都没有。内置宠物在打包版里随应用提供；开发环境下把六张姿态图放进 <code>scripts/pet-art/&lt;名字&gt;/</code>，再跑 <code>python scripts/gen-pet-animation-set.py &lt;名字&gt;</code> 生成。</p>
        )}
        <div className="pet-grid">
          {usable.map((pkg) => (
            <button
              key={pkg.id}
              type="button"
              className={`pet-item${active?.id === pkg.id ? " is-active" : ""}`}
              disabled={busy}
              onClick={() => void apply({ active: pkg.id }, `已切换到「${pkg.name}」`)}
            >
              <PetThumb pkg={pkg} />
              <span className="pet-item-name">{pkg.name}</span>
              <span className={`pet-item-source source-${pkg.source}`}>{SOURCE_LABEL[pkg.source]}</span>
              {pkg.description && <span className="pet-item-desc">{pkg.description}</span>}
            </button>
          ))}
        </div>
        {broken.length > 0 && (
          <div className="pet-broken">
            <p className="muted">以下目录被识别成宠物包但不可用（照实列出，不隐藏）：</p>
            {broken.map((pkg) => (
              <p key={pkg.id}><code>{pkg.id}</code> —— {pkg.problem}</p>
            ))}
          </div>
        )}
      </section>

      <details className="settings-exp-advanced">
        <summary>宠物目录 / 导入 / 自己做一只<small>高级</small></summary>
      <section className="pet-card">
        <h4><FolderOpen size={14} />宠物目录<small className="pet-count">把官方宠物包整个文件夹丢进去即可</small></h4>
        <ul className="pet-roots">
          {roots.map((root) => (
            <li key={root.dir}>
              <span className="pet-root-flag">{root.source === "builtin" ? "内置" : root.writable ? "可写" : "只读"}</span>
              <code title={root.dir}>{root.dir}</code>
              <button type="button" disabled={!root.exists && !root.writable} onClick={() => void openDir(root.dir)}>打开</button>
            </li>
          ))}
        </ul>
        <div className="pet-actions">
          <button type="button" onClick={() => void openDir()}><FolderOpen size={13} />打开用户宠物目录</button>
          <button type="button" disabled={busy} onClick={() => void refreshWithReceipt(onNotice, "重新扫描宠物目录", () => refresh())}><RefreshCw size={13} />重新扫描</button>
        </div>
        {external.length > 0 && (
          <div className="pet-import">
            <p className="muted">检测到官方 Codex / Petdex 已装的宠物（只读展示）。导入 = 复制一份到用户目录，之后可独立管理：</p>
            {external.map((pkg) => (
              <div className="pet-import-row" key={pkg.id}>
                <PetThumb pkg={pkg} />
                <span>{pkg.name}<small>{SOURCE_LABEL[pkg.source]}</small></span>
                <button type="button" disabled={busy} onClick={() => void importPet(pkg)}><Download size={12} />导入</button>
              </div>
            ))}
          </div>
        )}
        <p className="muted pet-tip">
          也可以自己做一只。宠物包有两种格式：<br />
          <b>① 官方图集包</b>：<code>pet.json</code> + 一张 <b>8 列 × 9 行</b>、每帧 192×208 的图集，
          九行依次是 <code>idle</code> / <code>running-right</code> / <code>running-left</code> / <code>waving</code> /
          <code>jumping</code> / <code>failed</code> / <code>waiting</code> / <code>running</code> / <code>review</code>；<br />
          <b>② 动画包（内置六只用这个）</b>：九态各一段 30fps 动画 WebP + 静帧，可选 16 向看帧，画布 288×312 或 256×277。
          做法：六张姿态图（站立/欢呼/难过/奔跑/工作/审阅）放进 <code>scripts/pet-art/&lt;名字&gt;/</code>，
          加 <code>pet-meta.json</code>，运行 <code>python scripts/gen-pet-animation-set.py &lt;名字&gt;</code>。
          完整教程见仓库 <code>docs/PET-MAKING.md</code>。
        </p>
      </section>
      </details>
    </section>
  );
}
