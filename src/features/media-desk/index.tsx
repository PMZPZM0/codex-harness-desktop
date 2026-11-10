/**
 * 自媒体工作台（11-09 立项；逻辑移植自开源 dsh-media-desk 2.6.2，MIT）。
 *
 * 独立板块：灵感墙 → 一键成稿（计划/口播脚本/封面/分镜）→ 排期 → 数据记录 → 风格。
 * ⛔ 自包含：状态在本组件 + 主进程 state.json，不进 bag；⛔ 不新增全局 store。
 * ⛔ 生图/模型都走「设置」或应用当前供应商；密钥只在主进程，页面只显示「已配置」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Columns3, Image as ImageIcon, Lightbulb, ListChecks, Palette, Plus, RefreshCw, Settings2, Trash2, Undo2, Wand2 } from "lucide-react";
import { imageUrl } from "../../lib/image-url";
import { AppSelect } from "../../components/AppSelect";

type Inspiration = { id: string; text: string; url?: string; title?: string; desc?: string; image?: string; tags: string[]; createdAt: number };
type PostImage = { id: string; label: string; path: string };
type PostPlan = { title: string; angle: string; points: string[]; coverText: string; shots: { text: string }[] };
type Post = { id: string; title: string; platform: string; kind: string; status: string; inspirationIds: string[]; styleId?: string; plan?: PostPlan | null; script: string; cover?: string; images: PostImage[]; createdAt: number; updatedAt: number };
type Schedule = { id: string; postId?: string; title: string; when: number; platform: string; status: string };
type StylePreset = { id: string; name: string; description: string; prompt: string };
type Metric = { id: string; postId?: string; date: string; views: number; likes: number; comments: number; shares: number; note?: string };
type Settings = { assistant: { baseUrl: string; model: string; apiKey: string }; image: { baseUrl: string; model: string; apiKey: string; size: string; quality: string }; imageCount: number; shotCount: number; language: string };
type DeskState = { inspirations: Inspiration[]; posts: Post[]; schedules: Schedule[]; styles: StylePreset[]; metrics: Metric[]; settings: Settings; hasAssistantKey?: boolean; hasImageKey?: boolean };

const TABS = [
  { id: "home", label: "灵感墙", Icon: Lightbulb },
  { id: "content", label: "内容", Icon: ListChecks },
  { id: "schedule", label: "排期", Icon: Columns3 },
  { id: "insights", label: "数据", Icon: ImageIcon },
  { id: "style", label: "风格", Icon: Palette },
  { id: "settings", label: "设置", Icon: Settings2 },
] as const;
type TabId = typeof TABS[number]["id"];

const PLATFORMS = ["抖音", "小红书", "视频号", "B站", "公众号", "通用"];
const EMPTY: DeskState = {
  inspirations: [], posts: [], schedules: [], styles: [], metrics: [],
  settings: { assistant: { baseUrl: "", model: "", apiKey: "" }, image: { baseUrl: "", model: "", apiKey: "", size: "1536x1024", quality: "" }, imageCount: 2, shotCount: 6, language: "zh" },
};

const fmt = (ms: number) => { try { return new Date(ms).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

/** IPC 结果（各通道形状不同，只取页面用到的字段）。 */
type OpResult = { ok?: boolean; error?: string; state?: DeskState; failed?: string[]; reply?: string } | null | undefined;
type AddFn = (collection: string, item: Record<string, unknown>) => Promise<OpResult>;
type UpdateFn = (collection: string, id: string, patch: Record<string, unknown>) => Promise<OpResult>;
type RemoveFn = (collection: string, id: string) => Promise<OpResult>;
type ProduceFn = (postId: string, what: string) => Promise<OpResult>;
type Totals = { views: number; likes: number; comments: number; shares: number };

const errText = (error: unknown) => String((error as { message?: unknown } | null)?.message ?? error);

/** 自媒体工作台页面（设置 → 能力与内容 → 自媒体工作台）。 */
export function MediaDeskPage() {
  const [state, setState] = useState<DeskState>(EMPTY);
  const [tab, setTab] = useState<TabId>("home");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [studioId, setStudioId] = useState("");
  const busyRef = useRef(false);

  const apply = (next: DeskState | null | undefined) => { if (next) setState(next); };
  const refresh = useCallback(async () => {
    try { apply(await window.codex.mediaDeskState?.()); } catch (error: unknown) { setError(errText(error)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (label: string, fn: () => Promise<OpResult>, done?: string): Promise<OpResult> => {
    if (busyRef.current) return null;
    busyRef.current = true; setBusy(label); setError(""); setNotice("");
    try {
      const res = await fn();
      if (res?.state) apply(res.state);
      if (res && res.ok === false && res.error) setError(String(res.error));
      else if (done) setNotice(done);
      return res;
    } catch (error: unknown) { setError(errText(error)); return null; }
    finally { busyRef.current = false; setBusy(""); }
  };

  const add: AddFn = (collection, item) => run("保存中…", async () => ({ state: await window.codex.mediaDeskAdd?.(collection, item) }), "已保存");
  const update: UpdateFn = (collection, id, patch) => run("保存中…", async () => ({ state: await window.codex.mediaDeskUpdate?.(collection, id, patch) }), "已保存");
  const remove: RemoveFn = (collection, id) => run("删除中…", async () => ({ state: await window.codex.mediaDeskDelete?.(collection, id) }), "已删除");
  const produce: ProduceFn = (postId, what) => run(what === "images" ? "正在生图（可能要几分钟）…" : "正在生成…", () => window.codex.mediaDeskProduce?.(postId, what), "完成");

  const studio = useMemo(() => state.posts.find((p) => p.id === studioId) ?? null, [state.posts, studioId]);

  return (
    <section className="mdk-page settings-exp-page">
      <header className="mdk-head">
        <div className="mdk-tabs" role="tablist" aria-label="自媒体工作台">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => { setTab(id); setStudioId(""); }}>
              <Icon size={13} />{label}
            </button>
          ))}
        </div>
        <div className="mdk-head-actions">
          {busy && <span className="mdk-busy">{busy}</span>}
          <button type="button" className="mdk-btn" title="撤销上一步" onClick={() => run("撤销中…", async () => ({ state: await window.codex.mediaDeskUndo?.() }), "已撤销")}><Undo2 size={13} />撤销</button>
          <button type="button" className="mdk-btn" title="刷新" onClick={() => void refresh()}><RefreshCw size={13} /></button>
        </div>
      </header>
      {error && <p className="mdk-error" role="status">{error}</p>}
      {notice && <p className="mdk-notice" role="status">{notice}</p>}

      {tab === "home" && <HomeTab state={state} add={add} remove={remove} produce={produce} setStudioId={(id: string) => { setStudioId(id); setTab("content"); }} />}
      {tab === "content" && (studio
        ? <Studio post={studio} state={state} busy={busy} update={update} produce={produce} plan={(id: string) => run("正在生成计划…", async () => ({ ...(await window.codex.mediaDeskPlan?.(id)) }), "计划已生成")} onBack={() => setStudioId("")} />
        : <ContentTab state={state} add={add} remove={remove} open={(id: string) => setStudioId(id)} />)}
      {tab === "schedule" && <ScheduleTab state={state} add={add} update={update} remove={remove} />}
      {tab === "insights" && <InsightsTab state={state} add={add} remove={remove} />}
      {tab === "style" && <StyleTab state={state} add={add} remove={remove} />}
      {tab === "settings" && <SettingsTab state={state} onSave={(patch: MediaDeskSettingsPatch) => run("保存中…", async () => ({ state: await window.codex.mediaDeskSettings?.(patch) }), "设置已保存")} />}
    </section>
  );
}

/* ── 灵感墙 ─────────────────────────────────────────────── */
function HomeTab({ state, add, remove, produce, setStudioId }: { state: DeskState; add: AddFn; remove: RemoveFn; produce: ProduceFn; setStudioId: (id: string) => void }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<{ title?: string; desc?: string; image?: string; error?: string } | null>(null);
  const [harvesting, setHarvesting] = useState(false);
  const harvest = async () => {
    if (!url.trim() || harvesting) return;
    setHarvesting(true); setMeta(null);
    try { setMeta(await window.codex.mediaDeskHarvest?.(url.trim())); } finally { setHarvesting(false); }
  };
  const save = async () => {
    if (!text.trim() && !url.trim()) return;
    const item = { text: text.trim() || meta?.title || url.trim(), url: url.trim() || undefined, title: meta?.title, desc: meta?.desc, image: meta?.image, tags: [] };
    await add("inspirations", item);
    setText(""); setUrl(""); setMeta(null);
  };
  /** 灵感一键成稿：建一篇稿子（带灵感 id）→ 立刻生成计划 + 脚本 + 配图。 */
  const draftFrom = async (item: Inspiration) => {
    const res = await add("posts", { title: item.title || item.text.slice(0, 24) || "未命名选题", platform: "通用", kind: "oral", status: "idea", inspirationIds: [item.id], script: "", images: [] });
    const post = res?.state?.posts?.[0];
    if (post?.id) { await produce(post.id, "all"); setStudioId(post.id); }
  };
  const createEmpty = async () => {
    const res = await add("posts", { title: "未命名选题", platform: "通用", kind: "oral", status: "idea", inspirationIds: [], script: "", images: [] });
    const post = res?.state?.posts?.[0];
    if (post?.id) setStudioId(post.id);
  };
  return (
    <div className="mdk-tab">
      <div className="mdk-card mdk-capture">
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="记一句灵感…（可只贴链接，点采集自动补标题/摘要/封面）" />
        <div className="mdk-row">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="粘贴链接（可选）" />
          <button type="button" className="mdk-btn" disabled={harvesting || !url.trim()} onClick={() => void harvest()}>{harvesting ? "采集中…" : "采集链接"}</button>
          <button type="button" className="mdk-btn primary" onClick={() => void save()}><Plus size={13} />加入灵感</button>
          <button type="button" className="mdk-btn" onClick={() => void createEmpty()}><Wand2 size={13} />新建稿子</button>
        </div>
        {meta?.error && <p className="mdk-error">{meta.error}</p>}
        {meta && !meta.error && (meta.title || meta.desc) && (
          <div className="mdk-harvest">
            {meta.image && <img src={meta.image} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
            <div><b>{meta.title}</b><small>{meta.desc}</small></div>
          </div>
        )}
      </div>
      {state.inspirations.length === 0 ? <p className="mdk-empty">还没有灵感。上面记一句，或贴个链接。</p> : (
        <div className="mdk-grid">
          {state.inspirations.map((item: Inspiration) => (
            <article className="mdk-card mdk-idea" key={item.id}>
              {item.image && <img className="mdk-idea-cover" src={item.image} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
              <b>{item.title || item.text.slice(0, 40)}</b>
              <p>{item.text}</p>
              {item.url && <a href={item.url} title={item.url} onClick={(e) => { e.preventDefault(); void window.codex.openExternal?.(item.url!); }}>来源链接</a>}
              <div className="mdk-row">
                <button type="button" className="mdk-btn primary" onClick={() => void draftFrom(item)}><Wand2 size={12} />一键成稿</button>
                <button type="button" className="mdk-btn" onClick={() => void remove("inspirations", item.id)}><Trash2 size={12} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 内容列表 ─────────────────────────────────────────── */
function ContentTab({ state, add, remove, open }: { state: DeskState; add: AddFn; remove: RemoveFn; open: (id: string) => void }) {
  const create = () => add("posts", { title: "未命名选题", platform: "通用", kind: "oral", status: "idea", inspirationIds: [], script: "", images: [] });
  return (
    <div className="mdk-tab">
      <div className="mdk-row">
        <button type="button" className="mdk-btn primary" onClick={() => void create()}><Plus size={13} />新建稿子</button>
      </div>
      {state.posts.length === 0 ? <p className="mdk-empty">还没有稿子。从灵感墙「一键成稿」最快。</p> : (
        <div className="mdk-grid">
          {state.posts.map((post: Post) => (
            <article className="mdk-card mdk-post" key={post.id}>
              {post.cover && <img className="mdk-idea-cover" src={imageUrl(post.cover)} alt="" />}
              <b>{post.title}</b>
              <small>{post.platform} · {statusLabel(post.status)}{post.plan ? " · 已有计划" : ""}</small>
              <p>{(post.script || "（还没有正文）").slice(0, 80)}</p>
              <div className="mdk-row">
                <button type="button" className="mdk-btn primary" onClick={() => open(post.id)}>打开工作室</button>
                <button type="button" className="mdk-btn" onClick={() => void remove("posts", post.id)}><Trash2 size={12} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 工作室 ───────────────────────────────────────────── */
function Studio({ post, state, busy, update, produce, plan, onBack }: { post: Post; state: DeskState; busy: string; update: UpdateFn; produce: ProduceFn; plan: (id: string) => Promise<OpResult>; onBack: () => void }) {
  const [script, setScript] = useState(post.script ?? "");
  const [chat, setChat] = useState("");
  const [reply, setReply] = useState("");
  useEffect(() => { setScript(post.script ?? ""); }, [post.id, post.updatedAt]);
  const planView: PostPlan | null = post.plan ?? null;
  const sendChat = async () => {
    if (!chat.trim()) return;
    const res = await window.codex.mediaDeskChat?.(post.id, chat.trim());
    setReply(res?.ok ? String(res.reply ?? "") : String(res?.error ?? "失败"));
    setChat("");
  };
  return (
    <div className="mdk-tab">
      <div className="mdk-row">
        <button type="button" className="mdk-btn" onClick={onBack}>← 返回</button>
        <input className="mdk-title-input" value={post.title} onChange={(e) => void update("posts", post.id, { title: e.target.value })} />
        <AppSelect className="mdk-select" value={post.platform} onChange={(value) => void update("posts", post.id, { platform: value })} options={PLATFORMS.map((p) => ({ value: p, label: p }))} ariaLabel="平台" />
        <AppSelect className="mdk-select" value={post.styleId ?? ""} onChange={(value) => void update("posts", post.id, { styleId: value || undefined })} options={[{ value: "", label: "不指定风格" }, ...state.styles.map((s: StylePreset) => ({ value: s.id, label: s.name }))]} ariaLabel="写作风格" />
      </div>
      <div className="mdk-row">
        <button type="button" className="mdk-btn" disabled={Boolean(busy)} onClick={() => void plan(post.id)}>生成计划</button>
        <button type="button" className="mdk-btn" disabled={Boolean(busy)} onClick={() => void produce(post.id, "article")}>写口播脚本</button>
        <button type="button" className="mdk-btn" disabled={Boolean(busy)} onClick={() => void produce(post.id, "images")}>生成封面/配图</button>
        <button type="button" className="mdk-btn primary" disabled={Boolean(busy)} onClick={() => void produce(post.id, "all")}><Wand2 size={13} />一键生成</button>
      </div>
      <div className="mdk-studio">
        <div className="mdk-card mdk-plan">
          <b>计划</b>
          {planView ? (
            <div className="mdk-plan-body">
              <p><em>角度</em>{planView.angle || "—"}</p>
              <p><em>封面</em>{planView.coverText || "—"}</p>
              <ul>{planView.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
              {planView.shots.length > 0 && <small>分镜：{planView.shots.map((s: { text: string }) => s.text).join("；")}</small>}
            </div>
          ) : <p className="mdk-empty">还没有计划，点「生成计划」。</p>}
        </div>
        <div className="mdk-card mdk-script">
          <b>口播脚本</b>
          <textarea rows={14} value={script} onChange={(e) => setScript(e.target.value)} placeholder="点「写口播脚本」生成，或自己写；改完点保存。" />
          <div className="mdk-row"><button type="button" className="mdk-btn primary" onClick={() => void update("posts", post.id, { script })}>保存脚本</button></div>
        </div>
      </div>
      <div className="mdk-card">
        <b>封面与配图</b>
        {post.cover || post.images.length ? (
          <div className="mdk-media">
            {post.cover && <figure><img src={imageUrl(post.cover)} alt="" /><figcaption>封面</figcaption></figure>}
            {post.images.map((img: PostImage) => <figure key={img.id}><img src={imageUrl(img.path)} alt="" /><figcaption>{img.label}</figcaption></figure>)}
          </div>
        ) : <p className="mdk-empty">还没有图，点「生成封面/配图」（需先在设置里配图片 API）。</p>}
      </div>
      <div className="mdk-card">
        <b>创作助手</b>
        <div className="mdk-row">
          <input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="让它改标题 / 换开头 / 精简到 30 秒…" onKeyDown={(e) => { if (e.key === "Enter") void sendChat(); }} />
          <button type="button" className="mdk-btn" onClick={() => void sendChat()}>发送</button>
        </div>
        {reply && <pre className="mdk-reply">{reply}</pre>}
      </div>
    </div>
  );
}

/* ── 排期 ─────────────────────────────────────────────── */
function ScheduleTab({ state, add, update, remove }: { state: DeskState; add: AddFn; update: UpdateFn; remove: RemoveFn }) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [platform, setPlatform] = useState("抖音");
  const save = async () => {
    if (!title.trim() || !when) return;
    await add("schedules", { title: title.trim(), when: new Date(when).getTime(), platform, status: "planned" });
    setTitle(""); setWhen("");
  };
  const rows = [...state.schedules].sort((a: Schedule, b: Schedule) => a.when - b.when);
  return (
    <div className="mdk-tab">
      <div className="mdk-card mdk-row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="排期标题" />
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <AppSelect className="mdk-select" value={platform} onChange={setPlatform} options={PLATFORMS.map((p) => ({ value: p, label: p }))} ariaLabel="平台" />
        <button type="button" className="mdk-btn primary" onClick={() => void save()}><Plus size={13} />加排期</button>
      </div>
      <p className="mdk-hint">排期只是本地计划，不会自动发布到平台。</p>
      {rows.length === 0 ? <p className="mdk-empty">还没有排期。</p> : (
        <div className="mdk-list">
          {rows.map((row: Schedule) => (
            <div className="mdk-list-row" key={row.id}>
              <span className="mdk-when">{fmt(row.when)}</span>
              <b>{row.title}</b>
              <small>{row.platform}</small>
              <span className={`mdk-status ${row.status}`}>{row.status === "done" ? "已完成" : "待发"}</span>
              <button type="button" className="mdk-btn" onClick={() => void update("schedules", row.id, { status: row.status === "done" ? "planned" : "done" })}>{row.status === "done" ? "撤回" : "完成"}</button>
              <button type="button" className="mdk-btn" onClick={() => void remove("schedules", row.id)}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 数据 ─────────────────────────────────────────────── */
function InsightsTab({ state, add, remove }: { state: DeskState; add: AddFn; remove: RemoveFn }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [views, setViews] = useState(""); const [likes, setLikes] = useState(""); const [comments, setComments] = useState(""); const [shares, setShares] = useState(""); const [note, setNote] = useState("");
  const save = async () => {
    await add("metrics", { date, views: Number(views) || 0, likes: Number(likes) || 0, comments: Number(comments) || 0, shares: Number(shares) || 0, note: note.trim() || undefined });
    setViews(""); setLikes(""); setComments(""); setShares(""); setNote("");
  };
  const totals = state.metrics.reduce((sum: Totals, m: Metric) => ({ views: sum.views + m.views, likes: sum.likes + m.likes, comments: sum.comments + m.comments, shares: sum.shares + m.shares }), { views: 0, likes: 0, comments: 0, shares: 0 });
  return (
    <div className="mdk-tab">
      <p className="mdk-hint">手动记录每篇的数据（不接平台 API，只做本地汇总）。</p>
      <div className="mdk-card mdk-row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input value={views} onChange={(e) => setViews(e.target.value)} placeholder="播放/阅读" />
        <input value={likes} onChange={(e) => setLikes(e.target.value)} placeholder="点赞" />
        <input value={comments} onChange={(e) => setComments(e.target.value)} placeholder="评论" />
        <input value={shares} onChange={(e) => setShares(e.target.value)} placeholder="转发" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（哪篇）" />
        <button type="button" className="mdk-btn primary" onClick={() => void save()}><Plus size={13} />记一笔</button>
      </div>
      <div className="mdk-totals">
        <span>播放/阅读 <b>{totals.views}</b></span><span>点赞 <b>{totals.likes}</b></span><span>评论 <b>{totals.comments}</b></span><span>转发 <b>{totals.shares}</b></span>
      </div>
      {state.metrics.length === 0 ? <p className="mdk-empty">还没有数据记录。</p> : (
        <div className="mdk-list">
          {state.metrics.map((m: Metric) => (
            <div className="mdk-list-row" key={m.id}>
              <span className="mdk-when">{m.date}</span>
              <b>{m.note || "—"}</b>
              <small>播放 {m.views} · 赞 {m.likes} · 评 {m.comments} · 转 {m.shares}</small>
              <button type="button" className="mdk-btn" onClick={() => void remove("metrics", m.id)}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 风格 ─────────────────────────────────────────────── */
function StyleTab({ state, add, remove }: { state: DeskState; add: AddFn; remove: RemoveFn }) {
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [prompt, setPrompt] = useState("");
  const save = async () => {
    if (!name.trim() || !prompt.trim()) return;
    await add("styles", { name: name.trim(), description: description.trim(), prompt: prompt.trim() });
    setName(""); setDescription(""); setPrompt("");
  };
  return (
    <div className="mdk-tab">
      <div className="mdk-card">
        <div className="mdk-row"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="风格名（如：犀利点评）" /><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话说明" /></div>
        <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="写作要求（会拼进计划与脚本的提示词）" />
        <div className="mdk-row"><button type="button" className="mdk-btn primary" onClick={() => void save()}><Plus size={13} />新增风格</button></div>
      </div>
      <div className="mdk-grid">
        {state.styles.map((s: StylePreset) => (
          <article className="mdk-card" key={s.id}>
            <b>{s.name}</b><small>{s.description}</small><p>{s.prompt}</p>
            <div className="mdk-row"><button type="button" className="mdk-btn" onClick={() => void remove("styles", s.id)}><Trash2 size={12} />删除</button></div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ── 设置 ─────────────────────────────────────────────── */
function SettingsTab({ state, onSave }: { state: DeskState; onSave: (patch: MediaDeskSettingsPatch) => Promise<OpResult> }) {
  const [draft, setDraft] = useState<Settings>(state.settings);
  useEffect(() => { setDraft(state.settings); }, [state.settings]);
  const setA = (key: string, value: string) => setDraft((d) => ({ ...d, assistant: { ...d.assistant, [key]: value } }));
  const setI = (key: string, value: string) => setDraft((d) => ({ ...d, image: { ...d.image, [key]: value } }));
  return (
    <div className="mdk-tab">
      <div className="mdk-card">
        <b>文本模型（留空 = 用应用当前供应商）</b>
        <div className="mdk-row"><input value={draft.assistant.baseUrl} onChange={(e) => setA("baseUrl", e.target.value)} placeholder="Base URL（如 https://api.xxx.com/v1）" /><input value={draft.assistant.model} onChange={(e) => setA("model", e.target.value)} placeholder="模型名" /></div>
        <input type="password" value={draft.assistant.apiKey} onChange={(e) => setA("apiKey", e.target.value)} placeholder={state.hasAssistantKey ? "已配置（留空保持不变）" : "API Key"} />
      </div>
      <div className="mdk-card">
        <b>生图接口（OpenAI 兼容 /images/generations）</b>
        <div className="mdk-row"><input value={draft.image.baseUrl} onChange={(e) => setI("baseUrl", e.target.value)} placeholder="Base URL" /><input value={draft.image.model} onChange={(e) => setI("model", e.target.value)} placeholder="模型名（如 gpt-image-1 / flux）" /></div>
        <div className="mdk-row"><input type="password" value={draft.image.apiKey} onChange={(e) => setI("apiKey", e.target.value)} placeholder={state.hasImageKey ? "已配置（留空保持不变）" : "API Key"} /><input value={draft.image.size} onChange={(e) => setI("size", e.target.value)} placeholder="尺寸 1536x1024" /><input value={draft.image.quality} onChange={(e) => setI("quality", e.target.value)} placeholder="质量（可空）" /></div>
      </div>
      <div className="mdk-card">
        <b>生成数量</b>
        <div className="mdk-row">
          <label>配图 <input type="number" min={0} max={4} value={draft.imageCount} onChange={(e) => setDraft((d) => ({ ...d, imageCount: Number(e.target.value) || 0 }))} /></label>
          <label>分镜 <input type="number" min={0} max={6} value={draft.shotCount} onChange={(e) => setDraft((d) => ({ ...d, shotCount: Number(e.target.value) || 0 }))} /></label>
        </div>
      </div>
      <div className="mdk-row"><button type="button" className="mdk-btn primary" onClick={() => void onSave(draft)}>保存设置</button></div>
    </div>
  );
}

function statusLabel(status: string): string {
  return ({ idea: "灵感", draft: "草稿", ready: "可发", published: "已发" } as Record<string, string>)[status] ?? status;
}
