import { useEffect, useState } from "react";
import { ChevronRight, Copy, ListChecks, RefreshCw, Search } from "lucide-react";
import { SettingsDialog } from "../../components/SettingsDialog";
import { copyTextToClipboard } from "../../lib/clipboard";
import { CRAFT_APPS, normalizeCraftKey } from "./artcraft-apps";
import { RUNTIME_GROUPS, runtimeGroupItems, type RuntimeRow } from "./runtime-groups";

type Item = { id: string; name: string; desc: string; group: string; prompt: string; method: string; target?: string; state?: string };
const special: Record<string, string> = {
  artcraft: '创作套件', moekoe: '影音与创作', 'feishu-cli': '协作办公', filee: '协作办公', openmaic: '教育与课堂',
  apkstart: '移动设备', husk: '移动设备', 'husk-tipa': '移动设备', 'platform-tools': '移动设备', 'phone-harness': '移动设备', laya: '本地智能',
};
const external: Item[] = [
  { id: 'ego-lite', name: 'Ego Lite', desc: '浏览器自动化', group: '桌面与浏览器自动化', method: '外部安装器', prompt: '请帮我安装 Ego Lite。先检测 ego-browser；若尚未安装，从开发工具的「桌面与浏览器自动化 → Ego Lite」打开对应平台的官方下载入口。请让我完成安装器和首次浏览器引导，再重新检测 CLI 版本。' },
  { id: 'openfilm', name: 'OpenFilm 视频剪辑', desc: '剪辑 CLI 与渲染引擎', group: '影音与创作', method: '专用安装器', prompt: '请帮我配置 OpenFilm 视频剪辑。先在开发工具的 OpenFilm 卡片检查 CLI 和渲染引擎；缺失时使用该卡片的「下载并安装」，下载源选自动镜像，保留校验。完成后重新检测 CLI 和浏览器并报告结果。桌面编辑器是单独的可选安装包，请先询问我。' },
];
/** 清单保留专用卡片和隐藏的安装变体；同一运行时只展示一次。 */
function runtimeItem(row: RuntimeRow): Item {
  const group = special[row.id] ?? RUNTIME_GROUPS.find(g => runtimeGroupItems(g, [row]).length)?.title ?? '其它按需下载';
  const ready = row.id === 'husk' || row.id === 'husk-tipa' ? '安装包已就绪' : '已安装';
  return { id: row.id, name: row.name, desc: row.description, group, prompt: row.fallbackPrompt ?? '', target: row.installTarget ?? row.fallbackPrompt?.match(/· 装到哪：([^\n]+)/)?.[1], state: row.installing ? '安装中' : row.installedBySystem ? '系统已装' : row.installed ? ready : '未检测到', method: row.kind === 'guide' ? '系统安装' : row.bundled || row.builtIn ? '随包工具' : '按需安装' };
}
/** 功能入口的只读目录；只有复制操作，不调用安装通道。 */
export function ToolListDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelected] = useState<string | null>(null);
  const selected = items.find(i => i.id === selectedId);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('读取中…');
  const [copied, setCopied] = useState('');
  useEffect(() => {
    let alive = true;
    setStatus('读取中…');
    void Promise.allSettled([window.codex.listRuntimes(), window.codex.listSkillPacks(), window.codex.egoStatus(), window.codex.openfilmStatus(), window.codex.artcraftStatus()]).then(([rt, packs, ego, film, suite]) => {
      if (!alive) return;
      const rows = rt.status === 'fulfilled' ? rt.value : [];
      const craft: Item[] = rows.some(r => r.id === 'artcraft') ? CRAFT_APPS.map(a => ({ id: 'craft:'+a.key, group: 'Craft 创作应用', name: a.name, desc: a.zh, method: 'Launcher 内安装', prompt: `请帮我安装 Craft 应用「${a.name}」。从开发工具的 Craft 全家桶检查并打开 ArtCraft Launcher；在 Launcher 目录中安装这一项，不单独下载替代包。需要授权时由我确认，完成后回到 Craft 卡片重新检测安装位置。` })) : [];
      const skills: Item[] = packs.status === 'fulfilled' ? packs.value.map(p => ({ id: 'skill:'+p.id, group: '精选技能包', name: p.name, desc: p.description, method: '技能包安装器', prompt: `请帮我安装精选技能包「${p.name}」。在开发工具的精选技能包中核对来源 ${p.repo} 和许可 ${p.license}，使用该条目的镜像安装入口。不要覆盖已有自定义技能；完成后重新读取已安装技能清单并确认结果。` })) : [];
      const apps = suite.status === 'fulfilled' ? suite.value as typeof suite.value & {roots?: string[]; customRoot?: string} : null;
      const entries = [...external, ...craft, ...skills].map(i => {
        let target = '', state = '未能检测';
        if (i.id === 'ego-lite') {
          const s = ego.status === 'fulfilled' ? ego.value : null;
          target = s?.appPath || s?.cliPath || '使用平台官方安装器的默认应用目录，完成首次引导后检测 ego-browser CLI';
          if (s) state = s.installed ? '已安装' : '未检测到';
        } else if (i.id === 'openfilm') {
          const s = film.status === 'fulfilled' ? film.value : null;
          target = s?.installRoot || s?.cli?.path || '由 OpenFilm 安装器写入应用工具目录的 openfilm 子目录';
          if (s) state = s.phase === 'ready' ? '已就绪' : s.phase === 'broken' ? '缺少依赖' : s.phase === 'installing' ? '安装中' : '未检测到';
        } else if (i.id.startsWith('craft:')) {
          const app = apps?.installedApps.find(a => normalizeCraftKey(a.id) === normalizeCraftKey(i.id.slice(6)));
          target = app?.dir || apps?.customRoot || apps?.roots?.join('；') || '由 Launcher 管理；若选择自定义目录，请在 Craft 卡片「安装位置」指定该目录';
          if (apps) state = app ? '已安装' : '未检测到';
        } else if (packs.status === 'fulfilled') {
          const p = packs.value.find(p => i.id === 'skill:'+p.id); target = p?.skillsRoot ?? ''; state = p?.installed ? '已安装' : '未检测到';
        }
        return { ...i, target, state, prompt: `${i.prompt}\n安装或检测位置：${target}` };
      });
      setItems([...rows.map(runtimeItem), ...entries]);
      window.dispatchEvent(new Event('codex-tool-list-refreshed'));
      setStatus([rt.status === 'rejected' && '运行时', packs.status === 'rejected' && '技能包'].filter(Boolean).join('、'));
    });
    return () => { alive = false; };
  }, [revision]);
  useEffect(() => { const refresh = () => setRevision(v => v + 1); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, []);
  const refreshButton = <button type="button" className="secondary-setting" disabled={status === '读取中…'} onClick={() => setRevision(v => v + 1)}><RefreshCw size={14}/>重新检测</button>;
  const groups = new Map<string, Item[]>();
  for (const i of items) if (`${i.group} ${i.name} ${i.desc}`.toLowerCase().includes(query.trim().toLowerCase())) groups.set(i.group, [...(groups.get(i.group) ?? []), i]);
  return <><SettingsDialog title="开发工具清单" icon={<ListChecks size={17}/>} hint="基础工具与专业工具 · 安装提示词" onClose={onClose}>
    <label className="tool-list-search"><Search size={15}/><input autoFocus type="search" aria-label="搜索工具或分类" placeholder="搜索工具或分类" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {status && <p role="status">{status === '读取中…' ? status : <>{status}清单读取失败。<button type="button" className="secondary-setting" onClick={() => setRevision(v => v+1)}>重试</button></>}</p>}
    {!status && !groups.size && <p>没有匹配的工具。</p>}
    {refreshButton}{[...groups].map(([group, list]) => <section key={group} className="tool-list-group"><h3>{group} <small>{list.length}</small></h3>{list.map(i => <button type="button" key={i.id} data-tool-preview={i.id} onClick={() => { setCopied(''); setSelected(i.id); }}><span><strong>{i.name}</strong><small>{i.desc}</small></span><small>{i.state}</small><ChevronRight size={14}/></button>)}</section>)}
  </SettingsDialog>{selected && <SettingsDialog elevated title={selected.name} hint={`${selected.group} · ${selected.method}`} onClose={() => setSelected(null)}>
    <p><b>安装或检测位置</b></p><div className="tool-list-preview">{selected.target || '当前桌面壳未返回位置'}</div><p>本机状态：{selected.state}　{refreshButton}</p>
    <p>{selected.desc}</p><h3>Codex 安装提示词</h3><pre className="tool-list-preview">{selected.prompt || '当前桌面版本未提供此项的安装提示词，请更新应用后重试。'}</pre>
    <button type="button" className="primary-setting" disabled={!selected.prompt} onClick={async () => { try { await copyTextToClipboard(selected.prompt); setCopied('已复制，可粘贴到 Codex 会话'); } catch { setCopied('复制失败，可选中上方文字手动复制'); } }}><Copy size={14}/>复制安装提示词</button> <small role="status">{copied}</small>
  </SettingsDialog>}</>;
}
