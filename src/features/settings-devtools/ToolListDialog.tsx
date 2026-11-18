import { useEffect, useState } from "react";
import { Blocks, BriefcaseBusiness, ChevronRight, Copy, Cpu, Film, Folder, LayoutGrid, ListChecks, MonitorCog, RefreshCw, RotateCcw, Search, Smartphone, Terminal } from "lucide-react";
import { AppSelect } from "../../components/AppSelect";
import { SettingsDialog } from "../../components/SettingsDialog";
import { copyTextToClipboard } from "../../lib/clipboard";
import { CRAFT_APPS, normalizeCraftKey } from "./artcraft-apps";
import { RUNTIME_GROUPS, runtimeGroupItems, type RuntimeRow } from "./runtime-groups";

type Item = { id: string; name: string; desc: string; group: string; prompt: string; method: string; target?: string; state?: string };
const purposes = [
  { name: '开发环境', icon: Terminal, groups: ['基础运行时', '开发工具链', '系统级安装'] },
  { name: '桌面自动化', icon: MonitorCog, groups: ['桌面后端'] },
  { name: '浏览器自动化', icon: LayoutGrid, groups: ['桌面与浏览器自动化'] },
  { name: '设计与影音', icon: Film, groups: ['媒体与文档', '影音与创作', '创作套件', 'Craft 创作应用'] },
  { name: '办公与教学', icon: BriefcaseBusiness, groups: ['协作办公', '教育与课堂'] },
  { name: '手机与设备', icon: Smartphone, groups: ['移动设备'] },
  { name: '本地 AI', icon: Cpu, groups: ['本地智能'] },
  { name: 'Codex 技能', icon: Blocks, groups: ['精选技能包'] },
  { name: '其他工具', icon: Folder, groups: [] },
];
// 安装入口不等于用途：同一个 Launcher 里的办公软件应当和其它办公工具一起出现。
const purposeOverrides: Record<string, string> = {
  markitdown: '办公与教学', 'craft:wordcraft': '办公与教学', 'craft:gridcraft': '办公与教学',
  'craft:deckcraft': '办公与教学', 'craft:pdfcraft': '办公与教学', 'craft:mailcraft': '办公与教学',
  'craft:craft-anything': '开发环境', rea: '开发环境', nuphus: '桌面自动化', ponytail: '开发环境', 'yt-dlp': '设计与影音',
};
const stateChoices = ['可用', '未检测到', '安装中', '安装包已就绪', '缺少依赖', '未能检测'];
/** 安装包下载完不代表设备已安装，只有实际可用的三种检测结果合并展示。 */
function stateFilter(state = '未能检测') {
  return ['已安装', '系统已装', '已就绪'].includes(state) ? '可用' : state;
}
const special: Record<string, string> = {
  'cheat-on-content': '影音与创作',
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
  const [purpose, setPurpose] = useState('');
  const [state, setState] = useState('');
  const [selectedId, setSelected] = useState<string | null>(null);
  const selected = items.find(i => i.id === selectedId);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('读取中…');
  const [copied, setCopied] = useState('');
  useEffect(() => {
    let alive = true;
    setStatus('读取中…');
    void Promise.allSettled([
      window.codex.listRuntimes(), window.codex.listSkillPacks(), window.codex.egoStatus(), window.codex.openfilmStatus(), window.codex.artcraftStatus(),
      window.codex.toolStatus(), window.codex.feishuCliStatus(), window.codex.fileeStatus(), window.codex.openmaicStatus(),
    ]).then(([rt, packs, ego, film, suite, desktop, feishu, filee, classroom]) => {
      if (!alive) return;
      const rows = rt.status === 'fulfilled' ? rt.value : [];
      const craft: Item[] = CRAFT_APPS.map(a => ({ id: 'craft:'+a.key, group: 'Craft 创作应用', name: a.name, desc: a.zh, method: 'Launcher 内安装', prompt: `请帮我安装 Craft 应用「${a.name}」。从开发工具的 Craft 全家桶检查并打开 ArtCraft Launcher；在 Launcher 目录中安装这一项，不单独下载替代包。需要授权时由我确认，完成后回到 Craft 卡片重新检测安装位置。` }));
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
      const byId = new Map(rows.map(row => [row.id, runtimeItem(row)]));
      for (const [id, probe] of [['feishu-cli', feishu], ['filee', filee], ['openmaic', classroom], ['artcraft', suite]] as const) {
        const item = byId.get(id);
        if (!item || item.state === '安装中') continue;
        if (probe.status === 'fulfilled') {
          item.state = probe.value.installed ? '已安装' : '未检测到';
          if (probe.value.installed) {
            const s = probe.value;
            item.target = ('path' in s ? s.path : 'appDir' in s ? s.appDir : s.launcherPath) || item.target;
          }
        } else if (item.state === '未检测到') item.state = '未能检测';
      }
      if (desktop.status === 'fulfilled') for (const tool of desktop.value.filter(t => t.scope === 'computer')) {
        const id = tool.id === 'nuphus-mcp' ? 'nuphus' : tool.id;
        const old = byId.get(id);
        const target = tool.command || old?.target || `应用工具目录的 npm-global 下，由组件更新器按本机平台管理 ${id === 'computer-use' ? 'open-computer-use' : id} 包`;
        byId.set(id, { id, group: '桌面后端', name: tool.name, desc: tool.detail, target,
          method: old?.method ?? '组件安装与更新', state: old?.state === '安装中' ? '安装中' : tool.binaryReady && tool.installed ? '已就绪' : tool.installed ? '缺少依赖' : '未检测到',
          prompt: old?.prompt || `请帮我检查${tool.name}。先核对平台支持和本机组件状态，缺失时使用应用的组件更新器为 ${id} 安装对应平台版本（国内镜像优先），完成后在桌面自动化设置重新检测启动器与平台主程序。安装或检测位置：${target}` });
      }
      setItems([...byId.values(), ...entries]);
      window.dispatchEvent(new Event('codex-tool-list-refreshed'));
      setStatus([rt.status === 'rejected' && '运行时', packs.status === 'rejected' && '技能包', desktop.status === 'rejected' && '桌面后端', suite.status === 'rejected' && 'Craft'].filter(Boolean).join('、'));
    });
    return () => { alive = false; };
  }, [revision]);
  useEffect(() => { const refresh = () => setRevision(v => v + 1); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, []);
  const refreshButton = <button type="button" className="secondary-setting" disabled={status === '读取中…'} onClick={() => setRevision(v => v + 1)}><RefreshCw size={14}/>重新检测</button>;
  const groups = new Map(purposes.map(p => [p.name, [] as Item[]]));
  const available = new Set<string>();
  const keyword = query.trim().toLowerCase();
  let matches = 0;
  let craftMatches = 0;
  for (const item of items) {
    const name = purposeOverrides[item.id] ?? purposes.find(p => p.groups.includes(item.group))?.name ?? '其他工具';
    available.add(name);
    if (state && stateFilter(item.state) !== state) continue;
    if (!`${name} ${item.group} ${item.id} ${item.name} ${item.desc}`.toLowerCase().includes(keyword)) continue;
    const isCraft = item.id.startsWith('craft:');
    if (isCraft) craftMatches++;
    groups.get(name)!.push(item);
    matches++;
  }
  const craftView = purpose === 'Craft 全家桶';
  const count = craftView ? craftMatches : purpose ? groups.get(purpose)?.length ?? 0 : matches;
  const filtered = Boolean(purpose || query || state);
  const visibleGroups = [...groups].filter(([name]) => !purpose || craftView || name === purpose)
    .map(([name, list]): [string, Item[]] => [name, craftView ? list.filter(i => i.id.startsWith('craft:')) : list]);
  return <><SettingsDialog size="lg" title="开发工具清单" icon={<ListChecks size={17}/>} hint="本机工具与安装提示词" onClose={onClose}>
    <div className="tool-list-layout">
      <div className="tool-list-nav" role="group" aria-label="按用途筛选"><h3>工具用途</h3>
        {[{ name: '', icon: LayoutGrid }, ...purposes.filter(p => available.has(p.name) || p.name === purpose)].map(({ name, icon: Icon }) => <button type="button" key={name} aria-pressed={purpose === name} data-tool-purpose={name} onClick={() => setPurpose(name)}><Icon size={15}/>{name || '全部工具'}<small>{name ? groups.get(name)?.length : matches}</small></button>)}
        <button type="button" aria-pressed={craftView} data-tool-purpose="Craft 全家桶" onClick={() => setPurpose('Craft 全家桶')}><Blocks size={15}/>Craft 全家桶<small>{craftMatches}</small></button>
      </div>
      <div className="tool-list-results"><div className="tool-list-toolbar">
        <label className="tool-list-search"><Search size={15}/><input autoFocus type="search" aria-label="搜索工具或分类" placeholder="搜索工具名称、用途或关键词" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <AppSelect ariaLabel="安装状态" value={state} onChange={setState} options={[{value: '', label: '全部安装状态'}, ...stateChoices.map(s => ({value: s, label: s}))]}/>{refreshButton}
      </div>
      <div className="tool-list-summary"><span role="status">{purpose || '全部工具'} · {count} 项</span>{filtered && <button type="button" onClick={() => { setQuery(''); setState(''); setPurpose(''); }}><RotateCcw size={13}/>清除筛选</button>}</div>
    {status && <p role="status">{status === '读取中…' ? status : <>{status}清单读取失败。<button type="button" className="secondary-setting" onClick={() => setRevision(v => v+1)}>重试</button></>}</p>}
      {!status && !count && <p className="tool-list-empty">没有匹配的工具</p>}
      {visibleGroups.filter(([, list]) => list.length).map(([group, list]) => <section key={group} className="tool-list-group"><h3>{group} <small>{list.length}</small></h3>{list.map(i => <button type="button" key={i.id} data-tool-preview={i.id} onClick={() => { setCopied(''); setSelected(i.id); }}><span><strong>{i.name}</strong><small>{i.desc}</small></span><small className="tool-list-state" data-state={stateFilter(i.state)}>{i.state}</small><ChevronRight size={14}/></button>)}</section>)}
      </div></div>
  </SettingsDialog>{selected && <SettingsDialog elevated title={selected.name} hint={`${selected.group} · ${selected.method}`} onClose={() => setSelected(null)}>
    <p><b>安装或检测位置</b></p><div className="tool-list-preview">{selected.target || '当前桌面壳未返回位置'}</div><p>本机状态：{selected.state}　{refreshButton}</p>
    <p>{selected.desc}</p><h3>Codex 安装提示词</h3><pre className="tool-list-preview">{selected.prompt || '当前桌面版本未提供此项的安装提示词，请更新应用后重试。'}</pre>
    <button type="button" className="primary-setting" disabled={!selected.prompt} onClick={async () => { try { await copyTextToClipboard(selected.prompt); setCopied('已复制，可粘贴到 Codex 会话'); } catch { setCopied('复制失败，可选中上方文字手动复制'); } }}><Copy size={14}/>复制安装提示词</button> <small role="status">{copied}</small>
  </SettingsDialog>}</>;
}
