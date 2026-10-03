/**
 * 外观 · 主界面壁纸（10-03，独立板块 src/features/wallpaper/）。
 *
 * ⛔ 选中即生效、写入 localStorage，**不给「应用」按钮**：这类外观设置即时反馈才有用。
 * ⛔ 关掉时写 `data-wallpaper="off"`（显式值）而不是删属性 ——
 *   CSS 用 `[data-wallpaper]` 选择器，必须该属性**存在**才生效；删掉属性等于
 *   "没设置"，两者语义不同（一个是"关"，一个是"从未配置"）。
 *
 * ⛔ 适配档位只有 cover/contain/auto，**没有"拉伸"** —— 拉伸变形是需求明确禁止的，
 *   界面上就不该给这个选项（守卫【251】第2 条同时钉住 CSS 与类型两处）。
 */
import { useCallback, useEffect, useState } from "react";
import { Check, FolderOpen, ImageOff, LoaderCircle, Trash2 } from "lucide-react";
import {
  FIT_LABELS,
  WALLPAPER_DIM_KEY,
  WALLPAPER_FIT_KEY,
  WALLPAPER_KEY,
  WALLPAPER_OFF,
  normalizeDim,
  normalizeFit,
  wallpaperUrlFromBundled,
  wallpaperUrlFromPath,
} from "../../lib/wallpaper";
import type { WallpaperEntry, WallpaperFit } from "./wallpaper-types";

const readId = () => {
  try { return localStorage.getItem(WALLPAPER_KEY) || WALLPAPER_OFF; } catch { return WALLPAPER_OFF; }
};
const readFit = (): WallpaperFit => { try { return normalizeFit(localStorage.getItem(WALLPAPER_FIT_KEY)); } catch { return "cover"; } };
const readDim = () => { try { return normalizeDim(localStorage.getItem(WALLPAPER_DIM_KEY)); } catch { return 8; } };

/**
 * 把状态落到 <html> 上：CSS 靠这两个属性决定背景与遮罩。
 * ⛔ 用 CSS 自定义属性传图 URL 而不是内联 style 拼 background-image ——
 *   属性值里的引号/括号转义坑太多，交给 CSS 规则处理更稳。
 */
function applyWallpaper(id: string, url: string | null, fit: WallpaperFit, dim: number) {
  const el = document.documentElement;
  if (id === WALLPAPER_OFF || !url) {
    el.setAttribute("data-wallpaper", "off");
    el.style.removeProperty("--wallpaper-image");
    return;
  }
  el.setAttribute("data-wallpaper", fit);
  el.setAttribute("data-wallpaper-id", id);
  el.style.setProperty("--wallpaper-image", `url("${url}")`);
  el.style.setProperty("--wallpaper-fit", fit === "cover" ? "cover" : fit === "contain" ? "contain" : "auto");
  // 遮罩强度按主题分档写入（浅色主题要用白遮罩，见 25-wallpaper.css）
  const dark = el.dataset.theme === "dark";
  el.style.setProperty(dark ? "--wp-veil-rgba" : "--wp-veil-rgba-light",
    dark ? `rgba(5, 7, 13, ${(dim / 100).toFixed(2)})` : `rgba(255, 255, 255, ${(dim / 100).toFixed(2)})`);
  el.style.setProperty("--wp-panel", `${Math.max(35, 100 - Math.round(dim * 0.6))}%`);
}

export function WallpaperSettingsSection({ onNotice }: { onNotice?: (title: string, text?: string) => void }) {
  const [items, setItems] = useState<WallpaperEntry[]>([]);
  const [pickedId, setPickedId] = useState<string>(readId);
  const [fit, setFit] = useState<WallpaperFit>(readFit);
  const [dim, setDim] = useState<number>(readDim);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);

  const urlOf = useCallback((w: WallpaperEntry) =>
    w.bundled ? wallpaperUrlFromBundled(w.bundled) : wallpaperUrlFromPath(w.filePath ?? ""), []);

  const refresh = useCallback(async () => {
    try {
      const list = (await window.codex.listWallpapers()) as WallpaperEntry[];
      setItems(Array.isArray(list) ? list : []);
    } catch (error) {
      onNotice?.("读取壁纸列表失败", String((error as Error)?.message ?? error).slice(0, 120));
    }
  }, [onNotice]);

  useEffect(() => { void refresh(); }, [refresh]);

  // 首屏也要生效（设置页没打开过时，用户自己选的壁纸必须已经在显示）
  useEffect(() => {
    const el = document.documentElement;
    const id = readId();
    if (id === WALLPAPER_OFF) { applyWallpaper(WALLPAPER_OFF, null, fit, dim); return; }
    void window.codex.listWallpapers().then((list) => {
      const hit = (list as WallpaperEntry[]).find((w) => w.id === id);
      // ⛔ 找不到（文件被挪走/删了）⇒ 退回纯色，而不是留一张破图 + 一句报错
      applyWallpaper(hit ? id : WALLPAPER_OFF, hit ? urlOf(hit) : null, fit, dim);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 只在挂载时跑一次

  // 主题切换时重算遮罩（浅/深用的是不同颜色的遮罩，见 applyWallpaper 注释）
  useEffect(() => {
    const el = document.documentElement;
    const dark = el.dataset.theme === "dark";
    el.style.setProperty(dark ? "--wp-veil-rgba" : "--wp-veil-rgba-light",
      dark ? `rgba(5, 7, 13, ${(dim / 100).toFixed(2)})` : `rgba(255, 255, 255, ${(dim / 100).toFixed(2)})`);
  }, [dim]);

  const choose = (w: WallpaperEntry) => {
    setPickedId(w.id);
    try { localStorage.setItem(WALLPAPER_KEY, w.id); } catch { /* 隐私模式 */ }
    applyWallpaper(w.id, urlOf(w), fit, dim);
  };

  const chooseOff = () => {
    setPickedId(WALLPAPER_OFF);
    try { localStorage.removeItem(WALLPAPER_KEY); } catch { /* 忽略 */ }
    applyWallpaper(WALLPAPER_OFF, null, fit, dim);
  };

  const setFitAnd = (next: WallpaperFit) => {
    setFit(next);
    try { localStorage.setItem(WALLPAPER_FIT_KEY, next); } catch { /* 忽略 */ }
    const cur = items.find((w) => w.id === pickedId);
    if (cur && pickedId !== WALLPAPER_OFF) applyWallpaper(pickedId, urlOf(cur), next, dim);
  };

  const setDimAnd = (next: number) => {
    const v = normalizeDim(next);
    setDim(v);
    try { localStorage.setItem(WALLPAPER_DIM_KEY, String(v)); } catch { /* 忽略 */ }
    const cur = items.find((w) => w.id === pickedId);
    if (cur && pickedId !== WALLPAPER_OFF) applyWallpaper(pickedId, urlOf(cur), fit, v);
  };

  const pickFile = async () => {
    setBusy(true);
    try {
      const r = (await window.codex.pickWallpaper()) as { ok: boolean; reason?: string; wallpaper?: WallpaperEntry };
      if (r?.ok && r.wallpaper) {
        await refresh();
        choose(r.wallpaper);
        onNotice?.("已添加壁纸", r.wallpaper.label);
      } else if (r?.reason) onNotice?.("选择失败", r.reason);
    } catch (error) {
      onNotice?.("选择失败", String((error as Error)?.message ?? error).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  const applyManual = async () => {
    const value = manual.trim();
    if (!value) { onNotice?.("未填写路径", "请填写图片的绝对路径"); return; }
    setBusy(true);
    try {
      const r = (await window.codex.verifyWallpaperPath(value)) as { ok: boolean; reason?: string; wallpaper?: WallpaperEntry };
      if (r.ok && r.wallpaper) {
        setManual("");
        await refresh();
        choose(r.wallpaper);
        onNotice?.("已应用壁纸", r.wallpaper.label);
      } else onNotice?.("路径不可用", r.reason ?? "请检查路径是否正确");
    } catch (error) {
      onNotice?.("路径不可用", String((error as Error)?.message ?? error).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  const forget = async (w: WallpaperEntry) => {
    try {
      await window.codex.forgetWallpaper(w.id);
      await refresh();
      if (pickedId === w.id) chooseOff();
      onNotice?.("已从列表移除", `${w.label}（原图仍在你的磁盘上）`);
    } catch (error) {
      onNotice?.("移除失败", String((error as Error)?.message ?? error).slice(0, 120));
    }
  };

  const isLocal = (w: WallpaperEntry) => Boolean(w.filePath);

  return (
    <>
      <div className="settings-subhead">
        <FolderOpen size={13} />主界面壁纸
        <span className="settings-subhead-hint">铺满或居中裁剪，随窗口尺寸实时自适应</span>
      </div>

      <div className="wp-toolbar">
        <button type="button" className="wp-btn" onClick={pickFile} disabled={busy}>
          {busy ? <LoaderCircle size={13} className="spin" /> : <FolderOpen size={13} />}浏览本地图片…
        </button>
        <input
          className="wp-manual"
          type="text"
          value={manual}
          placeholder="或粘贴图片绝对路径，如 D:\\Pictures\\bg.jpg"
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void applyManual(); }}
        />
        <button type="button" className="wp-btn" onClick={() => void applyManual()} disabled={busy || !manual.trim()}>应用路径</button>
      </div>

      <div className="wp-grid" role="group" aria-label="壁纸">
        <button type="button" className={`wp-card ${pickedId === WALLPAPER_OFF ? "active" : ""}`} aria-pressed={pickedId === WALLPAPER_OFF} onClick={chooseOff}>
          <span className="wp-thumb wp-thumb-off"><ImageOff size={18} /></span>
          <span className="wp-label">纯色{pickedId === WALLPAPER_OFF ? <em><Check size={11} /></em> : null}</span>
        </button>
        {items.map((w) => (
          <div key={w.id} className={`wp-cell ${pickedId === w.id ? "active" : ""}`}>
            <button type="button" className="wp-card" aria-pressed={pickedId === w.id} onClick={() => choose(w)} title={w.filePath ?? w.bundled}>
              <span className="wp-thumb"><img src={urlOf(w)} alt="" loading="lazy" /></span>
              <span className="wp-label">
                {w.label}
                {pickedId === w.id ? <em><Check size={11} /></em> : null}
              </span>
            </button>
            {/* ⛔ 只对「本地图」给移除按钮：自带素材是应用自己的文件，删不得*/}
            {isLocal(w) && (
              <button type="button" className="wp-forget" title="从列表移除（原图仍在你的磁盘上）" onClick={() => void forget(w)}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
      </div>

      {pickedId !== WALLPAPER_OFF && (
        <>
          <div className="settings-subhead">
            适配方式
            <span className="settings-subhead-hint">
              {fit === "cover" ? "铺满窗口，保持比例、裁掉溢出部分（不留黑边）"
                : fit === "contain" ? "完整显示整张图，保持比例，空余处填底色"
                : "按原始像素 1:1 显示"}
            </span>
          </div>
          <div className="theme-switch three" role="group" aria-label="适配方式">
            {(["cover", "contain", "auto"] as WallpaperFit[]).map((f) => (
              <button key={f} type="button" className={fit === f ? "active" : ""} onClick={() => setFitAnd(f)}>
                <span className="fs-demo fs-demo-compact">{FIT_LABELS[f]}</span>
              </button>
            ))}
          </div>

          <div className="settings-subhead">
            遮罩强度
            <span className="settings-subhead-hint">加深背景以保证侧栏与正文可读</span>
          </div>
          <div className="wp-dim-row">
            <input type="range" min={0} max={100} step={5} value={dim} onChange={(e) => setDimAnd(Number(e.target.value))} />
            <span className="wp-dim-val">{dim}%</span>
          </div>
        </>
      )}
    </>
  );
}
