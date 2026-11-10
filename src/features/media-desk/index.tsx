/**
 * 自媒体工作台（11-09）：**开源 dsh-media-desk 2.6.2 原样嵌入**（MIT）。
 *
 * 界面与流程由它的原版客户端在本地服务里渲染（主进程 media-desk/embed.ts），
 * 这里只负责拿到地址并铺满设置页 —— ⛔ 不再自己画一套界面。
 * 数据与 Codex 工具共用同一份（`<userData>/media-desk-host/media-desk/state.json`）。
 */
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

const SOURCE_URL = "https://github.com/woniuniuniu/dsh-media-desk";

/** 工作台页面：iframe 打开主进程起的原版界面（同源本地服务，只监听 127.0.0.1）。 */
export function MediaDeskPage() {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    window.codex.mediaDeskEndpoint?.()
      .then((url: string) => { if (alive) setSrc(String(url ?? "")); })
      .catch((e: unknown) => { if (alive) setError(String((e as { message?: unknown } | null)?.message ?? e)); });
    return () => { alive = false; };
  }, []);
  if (error) return <p className="media-desk-error" role="status">工作台启动失败：{error}</p>;
  if (!src) return <p className="media-desk-loading" role="status">正在打开工作台…</p>;
  return (
    <div className="media-desk-page">
      <iframe className="media-desk-frame" src={src} title="自媒体工作台" />
      <div className="media-desk-note">
        <span>界面与流程来自开源项目 dsh-media-desk（MIT）；数据只存本机，排期不会自动发布。</span>
        <button type="button" className="media-desk-link" onClick={() => void window.codex.openExternal(SOURCE_URL)}>
          <ExternalLink size={12} />
          开源项目
        </button>
      </div>
    </div>
  );
}
