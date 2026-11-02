import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Code2, Info, MessageSquare, Network, Palette, RefreshCw, ShieldCheck, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import { SettingsPageHero } from "./SettingsPageHero";
import { ToggleSwitch } from "./SettingsWidgets";
import {
  DEFAULT_FRONTEND_DESIGN_STYLE,
  FRONTEND_DESIGN_STYLES,
  FRONTEND_REFERENCE_SYSTEMS,
  frontendDesignPrompt,
  normalizeFrontendDesignStyle,
} from "../lib/frontend-design-style.mjs";
import {
  APP_ARCHITECTURE_NORMS,
  DEFAULT_APP_ARCHITECTURE_NORM,
  DEFAULT_SOFTWARE_DEV_NORM,
  SOFTWARE_DEV_NORMS,
  engineeringNormsPrompt,
  normalizeAppArchitectureNorm,
  normalizeSoftwareDevNorm,
  type EngineeringNormPreset,
} from "../lib/engineering-norms.mjs";

type PersonalizationConfig = {
  nickname?: string;
  customInstructions?: string;
  frontendDesignStyle?: string;
  frontendDesignNotes?: string;
  frontendDesignEnabled?: boolean;
  softwareDevStyle?: string;
  softwareDevNotes?: string;
  softwareDevEnabled?: boolean;
  appArchitectureStyle?: string;
  appArchitectureNotes?: string;
  appArchitectureEnabled?: boolean;
};

/** personalization:verify 的回读结果：直接读真实落盘的 AGENTS.md，不是「我以为写成功了」 */
type VerifyResult = {
  exists: boolean;
  expects: boolean;
  applied: boolean;
  inSync: boolean;
  preview: string;
  agentsPath: string;
};

const stylePresets = [
  /* 10-27 用户令：「四个正方形卡片太丑了，Codex 回复风格尾部选项里面加上这四个选项，不需要过多文字赘述」
     ⇒ 大卡片整块去掉，改成标题行右侧的胶囊分段控件；说明只留在 title 悬停里，界面上只有档位名。 */
  { value: "inquiry", title: "需求询问", desc: "动手前先按 grill-me 技能问清目标 / 边界 / 验收，问完再做" },
  { value: "challenge", title: "敢于反驳", desc: "按 challenge-requirements 技能审需求：有错先指出并给依据与更优方案；你坚持就照做并写清风险" },
  { value: "essence", title: "直击本质", desc: "按 essence-first 技能先看本质目标：点名的手段若绕路，先给更上游的做法与代价对照；你坚持就照做" },
  { value: "pragmatic", title: "务实", desc: "直接给结论和代码，少铺垫" },
  { value: "friendly", title: "友好", desc: "解释更详细，主动交代思路与取舍" },
  { value: "none", title: "默认", desc: "跟随模型默认风格，不额外注入语气指令" },
];

/** 软件开发规范 / 应用架构规范共用的规范卡（胶囊预设 + 参考文档 + 规范全文 + 自定义内容）。
 *  ⛔ 与设计风格卡同一套交互与样式，但内容来自 engineering-norms；⛔ 不另造第二套设计语言。 */
function NormCard({
  cardId,
  title,
  icon,
  hint,
  presets,
  style,
  onStyle,
  notes,
  onNotes,
  enabled,
  onEnabled,
  ariaLabel,
  placeholder,
}: {
  cardId: string;
  title: string;
  icon: ReactNode;
  hint: string;
  presets: EngineeringNormPreset[];
  style: string;
  onStyle: (value: string) => void;
  notes: string;
  onNotes: (value: string) => void;
  enabled: boolean;
  onEnabled: (value: boolean) => void;
  ariaLabel: string;
  placeholder: string;
}) {
  const selected = presets.find((preset) => preset.id === style) ?? presets[0];
  return (
    <div className={`personalization-group card-norm${enabled ? "" : " is-off"}`} data-norm-card={cardId}>
      <div className="settings-subhead">
        {icon}{title}
        <span className="settings-subhead-hint">{hint}</span>
        <ToggleSwitch
          checked={enabled}
          label={`启用${title}`}
          title={enabled ? "关闭后不写入 AGENTS.md，也不带给专家；配置保留" : "启用后写入 AGENTS.md，并带给专家"}
          className="norm-toggle"
          onChange={onEnabled}
        />
      </div>
      {enabled ? null : (
        <p className="personalization-norm-off" role="status">已关闭：不写入 AGENTS.md，也不带给专家；下方配置会保留，随时可再打开。</p>
      )}
      <div className="frontend-style-chips" role="radiogroup" aria-label={ariaLabel}>
        {presets.map((preset) => {
          const active = style === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={active}
              data-norm-id={preset.id}
              className={`frontend-style-chip${active ? " active" : ""}`}
              title={preset.desc}
              onClick={() => onStyle(preset.id)}
            >
              <span>{preset.label}</span>
              {active ? <Check size={12} /> : null}
            </button>
          );
        })}
      </div>
      <p className="frontend-style-current">{selected.desc}</p>
      {selected.refs.length ? (
        <p className="frontend-style-refs">
          参考：
          {selected.refs.map((ref, index) => (
            <span key={ref.url}>
              {index ? " · " : ""}
              <a href={ref.url} onClick={(event) => { event.preventDefault(); void window.codex.openExternal(ref.url); }}>
                {ref.name}
              </a>
            </span>
          ))}
        </p>
      ) : null}
      <details className="frontend-style-spec">
        <summary>查看规范全文（{selected.label}）</summary>
        <pre>{selected.spec}</pre>
      </details>
      <textarea
        className="personalization-instructions personalization-frontend-notes"
        value={notes}
        spellCheck={false}
        maxLength={4000}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(event) => onNotes(event.target.value)}
      />
      <div className="personalization-actions">
        <span className="personalization-counter">{notes.length} / 4000</span>
      </div>
    </div>
  );
}

/**
 * 个性化设置页：回复风格 + 自定义指令。
 * 自定义指令写到 Codex 原生的 $CODEX_HOME/AGENTS.md，引擎每个会话开始时自动注入
 * （user 级指令层），并与项目仓库里的 AGENTS.md 分层合并；保存后自动重启引擎。
 *
 * 10-27 用户令：「个性化里面的用户称呼可以删了，还有语气自适应也删了，跟用户中心和控制台的ahd重复了」——
 * 称呼已并入「用户中心 → 基本资料」，语气自适应的开关挪到「控制台 → 回复风格」，本页不再重复。
 */
export function PersonalizationPage({
  personality,
  onPersonalityChange,
  onNotice,
  onOpenComponentLibrary,
}: {
  personality: string;
  onPersonalityChange: (value: string) => void;
  onNotice: (message: string) => void;
  onOpenComponentLibrary?: () => void;
}) {
  const [config, setConfig] = useState<PersonalizationConfig>({});
  const [instructions, setInstructions] = useState("");
  const [frontendStyle, setFrontendStyle] = useState(DEFAULT_FRONTEND_DESIGN_STYLE);
  const [frontendNotes, setFrontendNotes] = useState("");
  const [frontendEnabled, setFrontendEnabled] = useState(true);
  const [softwareDevStyle, setSoftwareDevStyle] = useState(DEFAULT_SOFTWARE_DEV_NORM);
  const [softwareDevNotes, setSoftwareDevNotes] = useState("");
  const [softwareDevEnabled, setSoftwareDevEnabled] = useState(true);
  const [appArchStyle, setAppArchStyle] = useState(DEFAULT_APP_ARCHITECTURE_NORM);
  const [appArchNotes, setAppArchNotes] = useState("");
  const [appArchEnabled, setAppArchEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const initial = useRef<PersonalizationConfig>({});

  const runVerify = useCallback(async () => {
    setVerifying(true);
    try { setVerify(await window.codex.verifyPersonalization()); }
    catch { setVerify(null); }
    finally { setVerifying(false); }
  }, []);

  useEffect(() => {
    let alive = true;
    void window.codex
      .readPersonalization()
      .then((next) => {
        if (!alive) return;
        setConfig(next);
        setInstructions(next.customInstructions ?? "");
        setFrontendStyle(normalizeFrontendDesignStyle(next.frontendDesignStyle));
        setFrontendNotes(next.frontendDesignNotes ?? "");
        setFrontendEnabled(next.frontendDesignEnabled !== false);
        setSoftwareDevStyle(normalizeSoftwareDevNorm(next.softwareDevStyle));
        setSoftwareDevNotes(next.softwareDevNotes ?? "");
        setSoftwareDevEnabled(next.softwareDevEnabled !== false);
        setAppArchStyle(normalizeAppArchitectureNorm(next.appArchitectureStyle));
        setAppArchNotes(next.appArchitectureNotes ?? "");
        setAppArchEnabled(next.appArchitectureEnabled !== false);
        initial.current = next;
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoaded(true); });
    void runVerify();
    return () => { alive = false; };
  }, [runVerify]);

  const dirty = instructions.trim() !== (initial.current.customInstructions ?? "")
    || frontendStyle !== normalizeFrontendDesignStyle(initial.current.frontendDesignStyle)
    || frontendNotes.trim() !== (initial.current.frontendDesignNotes ?? "")
    || frontendEnabled !== (initial.current.frontendDesignEnabled !== false)
    || softwareDevStyle !== normalizeSoftwareDevNorm(initial.current.softwareDevStyle)
    || softwareDevNotes.trim() !== (initial.current.softwareDevNotes ?? "")
    || softwareDevEnabled !== (initial.current.softwareDevEnabled !== false)
    || appArchStyle !== normalizeAppArchitectureNorm(initial.current.appArchitectureStyle)
    || appArchNotes.trim() !== (initial.current.appArchitectureNotes ?? "")
    || appArchEnabled !== (initial.current.appArchitectureEnabled !== false);
  const selectedFrontendStyle = FRONTEND_DESIGN_STYLES.find((preset) => preset.id === frontendStyle) ?? FRONTEND_DESIGN_STYLES[0];

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      /* ⛔ 只传本页负责的字段（自定义指令 + 前端设计风格）；昵称改到「用户中心」后这里就**不碰** nickname 了。
         writePersonalization 是 partial 语义（字段 undefined = 保留原值），
         所以昵称不会被这页保存误清掉。 */
      const next = await window.codex.savePersonalization({
        customInstructions: instructions.trim(),
        frontendDesignStyle: frontendStyle,
        frontendDesignNotes: frontendNotes.trim(),
        frontendDesignEnabled: frontendEnabled,
        softwareDevStyle,
        softwareDevNotes: softwareDevNotes.trim(),
        softwareDevEnabled,
        appArchitectureStyle: appArchStyle,
        appArchitectureNotes: appArchNotes.trim(),
        appArchitectureEnabled: appArchEnabled,
      });
      setConfig(next);
      initial.current = next;
      // 保存完立刻回读 AGENTS.md，确认真的写进去了再提示成功
      const check = await window.codex.verifyPersonalization().catch(() => null);
      if (check) setVerify(check);
      const hasAny = Boolean(
        next.customInstructions
        || frontendDesignPrompt(next.frontendDesignStyle, next.frontendDesignNotes, next.frontendDesignEnabled)
        || engineeringNormsPrompt(next),
      );
      if (!check?.exists) onNotice("已保存，但引擎主目录还没生成——先去「模型」页配置一个供应商，个性化才会写入");
      else if (check.inSync) onNotice(hasAny ? "个性化已写入 AGENTS.md 并重启引擎，下次对话生效" : "已清空个性化设置，AGENTS.md 已同步移除");
      else onNotice("已保存，但引擎的 AGENTS.md 还没对上——点「重新校验」确认，或重启应用");
    } catch (error: any) {
      onNotice(`保存个性化失败：${error?.message ?? error}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section stack personalization-page settings-exp-page">
      <SettingsPageHero icon={<Sparkles size={20} />} title="个性化" subtitle="回复风格与自定义指令：让 Codex 用你顺手的写法说话，并永远遵守你的约定。" hint="改完下一次对话生效" />

      {/* 分组规则（10-11 重排）：一处设置 = 一张组卡；组卡自带标题行（.settings-subhead）与 1px 边界，
          组间只用一个间距值 ⇒ 不再靠标题的零散 margin 撑版式。 */}

      <div className="personalization-group card-style">
        <div className="settings-subhead">
          <MessageSquare size={13} />回复风格
          <div className="segmented-tabs personalization-style-tabs" role="group" aria-label="回复风格">
            {stylePresets.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={personality === preset.value ? "active" : ""}
                aria-pressed={personality === preset.value}
                title={preset.desc}
                onClick={() => onPersonalityChange(preset.value)}
              >
                {preset.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`personalization-group card-frontend-design${frontendEnabled ? "" : " is-off"}`}>
        <div className="settings-subhead">
          <Palette size={13} />前端设计风格
          <span className="settings-subhead-hint">前端 UI 专用 · 随应用更新</span>
          <ToggleSwitch
            checked={frontendEnabled}
            label="启用前端设计规范"
            title={frontendEnabled ? "关闭后不写入 AGENTS.md，也不带给专家；配置保留" : "启用后写入 AGENTS.md，并带给专家"}
            className="norm-toggle"
            onChange={setFrontendEnabled}
          />
        </div>
        {frontendEnabled ? null : (
          <p className="personalization-norm-off" role="status">已关闭：不写入 AGENTS.md，也不带给专家；下方配置会保留，随时可再打开。</p>
        )}
        <div className="frontend-style-chips" role="radiogroup" aria-label="前端设计风格">
          {FRONTEND_DESIGN_STYLES.map((preset) => {
            const active = frontendStyle === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={active}
                data-style-id={preset.id}
                className={`frontend-style-chip${active ? " active" : ""}`}
                title={preset.desc}
                onClick={() => setFrontendStyle(preset.id)}
              >
                <span className="frontend-style-swatches" aria-hidden>
                  {preset.swatches.slice(0, 3).map((color) => <i key={color} style={{ backgroundColor: color }} />)}
                </span>
                <span>{preset.label}</span>
                {active ? <Check size={12} /> : null}
              </button>
            );
          })}
        </div>
        <p className="frontend-style-current">
          {selectedFrontendStyle.desc}。具体色值仍从项目 DESIGN.md / CSS 变量派生。
        </p>
        {selectedFrontendStyle.refs.length ? (
          <p className="frontend-style-refs">
            参考：
            {selectedFrontendStyle.refs.map((ref, index) => (
              <span key={ref.url}>
                {index ? " · " : ""}
                <a
                  href={ref.url}
                  onClick={(event) => { event.preventDefault(); void window.codex.openExternal(ref.url); }}
                >
                  {ref.name}
                </a>
              </span>
            ))}
          </p>
        ) : null}
        {selectedFrontendStyle.materials.length ? (
          <p className="frontend-style-refs frontend-style-materials">
            素材：
            {selectedFrontendStyle.materials.map((item, index) => (
              <span key={item.url}>
                {index ? " · " : ""}
                <a
                  href={item.url}
                  onClick={(event) => { event.preventDefault(); void window.codex.openExternal(item.url); }}
                >
                  {item.name}
                </a>
              </span>
            ))}
          </p>
        ) : null}
        <details className="frontend-style-spec">
          <summary>查看设计规范（色彩 / 字体 / 布局 / 组件 / 动效）</summary>
          <pre>{selectedFrontendStyle.spec}</pre>
        </details>
        <details className="frontend-style-refs-more">
          <summary>国内设计系统参考（{FRONTEND_REFERENCE_SYSTEMS.length} 个）</summary>
          <div className="frontend-style-reference-grid">
            {FRONTEND_REFERENCE_SYSTEMS.map((ref) => (
              <a
                key={ref.url}
                href={ref.url}
                onClick={(event) => { event.preventDefault(); void window.codex.openExternal(ref.url); }}
              >
                {ref.name}
                <small>{ref.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</small>
              </a>
            ))}
          </div>
        </details>
        <details className="frontend-style-prompt">
          <summary>查看将注入的提示词</summary>
          <pre>{frontendDesignPrompt(frontendStyle, frontendNotes) || "跟随项目：不额外注入视觉方向，只按项目 DESIGN.md 与现有组件落地。"}</pre>
        </details>
        <div className="frontend-style-library">
          <span>实现时 Codex 会先查内置组件库，再按这套风格改造。</span>
          {onOpenComponentLibrary ? <button type="button" onClick={onOpenComponentLibrary}>打开组件库</button> : null}
        </div>
        <textarea
          className="personalization-instructions personalization-frontend-notes"
          value={frontendNotes}
          spellCheck={false}
          maxLength={4000}
          aria-label="前端设计自定义内容"
          placeholder={"例如：\n· 主色 #6b5cff，圆角 10px，字体 Inter / 思源黑体\n· 不要渐变和重阴影，卡片一律 1px 边框\n· 表格行高 36px，焦点环 2px"}
          onChange={(event) => setFrontendNotes(event.target.value)}
        />
        <div className="personalization-actions">
          <span className="personalization-counter">{frontendNotes.length} / 4000</span>
        </div>
      </div>

      <NormCard
        cardId="software-dev"
        title="软件开发规范（后端）"
        icon={<Code2 size={13} />}
        hint="面向后端 / 服务端 · 随应用更新 · 专家同样生效"
        presets={SOFTWARE_DEV_NORMS}
        style={softwareDevStyle}
        onStyle={setSoftwareDevStyle}
        notes={softwareDevNotes}
        onNotes={setSoftwareDevNotes}
        enabled={softwareDevEnabled}
        onEnabled={setSoftwareDevEnabled}
        ariaLabel="软件开发规范（后端）"
        placeholder={"例如：\n· 接口必须校验输入、写清错误码与超时\n· 写操作要有幂等键，重试不能重复扣款 / 重复发消息\n· 修 bug 先写复现测试，再改代码"}
      />

      <NormCard
        cardId="app-architecture"
        title="应用架构规范（后端 / 全栈）"
        icon={<Network size={13} />}
        hint="后端 / 全栈架构 · 随应用更新 · 专家同样生效"
        presets={APP_ARCHITECTURE_NORMS}
        style={appArchStyle}
        onStyle={setAppArchStyle}
        notes={appArchNotes}
        onNotes={setAppArchNotes}
        enabled={appArchEnabled}
        onEnabled={setAppArchEnabled}
        ariaLabel="应用架构规范（后端 / 全栈）"
        placeholder={"例如：\n· 分层单向依赖，禁止跨层深链与循环依赖\n· 写服务契约：请求 / 响应 / 错误码 / 超时 / 重试\n· 关键路径必须有日志、指标与回滚方案"}
      />

      <div className="personalization-group card-instructions">
        <div className="settings-subhead"><Wrench size={13} />自定义指令<span className="settings-subhead-hint">每次对话都生效，优先级高于风格默认</span></div>
        <textarea
          className="personalization-instructions"
          value={instructions}
          spellCheck={false}
          maxLength={8000}
          aria-label="自定义指令"
          placeholder={"例如：\n· 回复一律用简体中文，代码注释用中文\n· 修改前先说明影响范围，再动手\n· 不要自动执行 git push"}
          onChange={(event) => setInstructions(event.target.value)}
        />
        <div className="personalization-actions">
          <span className="personalization-counter">{instructions.length} / 8000</span>
        </div>
      </div>

      <div className="personalization-savebar">
        <span className="personalization-save-hint">修改后保存，下一次对话生效；专家与专家团会话同样带上这些规范。</span>
        <button type="button" className="primary-setting" disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? <span className="spinner" aria-hidden /> : <Check size={14} />}保存并重启引擎
        </button>
      </div>

      {/* 校验条独立成块：它汇报的是「自定义指令」的落盘结果，不并入上面任何一组。 */}
      <div className={`personalization-verify ${verify ? (verify.inSync ? "ok" : "warn") : ""}`} role="status">
        {verifying ? <RefreshCw size={14} className="spin" />
          : verify?.inSync ? <ShieldCheck size={14} />
          : <TriangleAlert size={14} />}
        <div className="personalization-verify-body">
          <strong>
            {!verify ? "引擎指令校验中…"
              : !verify.exists ? "引擎主目录还没生成"
              : !verify.expects ? "未设置个性化：引擎只保留基础指令（emoji / 语言）"
              : verify.applied ? "已确认写入 AGENTS.md，Codex 每次对话都会读到"
              : "还没写进 AGENTS.md，点「保存并重启引擎」"}
          </strong>
          {verify?.exists && verify.applied ? <pre className="personalization-verify-preview">{verify.preview}</pre> : null}
          {verify ? <span className="personalization-verify-path">{verify.agentsPath}</span> : null}
        </div>
        <button type="button" className="secondary-setting" disabled={verifying} onClick={() => void runVerify()}>
          <RefreshCw size={13} />重新校验
        </button>
      </div>

      <div className="personalization-note">
        <Info size={14} />
        <div>
          <strong>这些内容怎么生效</strong>
          <p>自定义指令写入 Codex 原生的 <code>AGENTS.md</code>（引擎主目录），每个会话开始时引擎自动把它注入对话——和你在项目仓库里放的 <code>AGENTS.md</code> 是同一条原生指令链，项目级约定会自动叠加在上面。纯 Markdown 落盘，随便写路径和引号都不会破坏配置。回复风格走 <code>thread/start</code> 的 personality，切换后下一个回合生效。上面的校验条是回读真实文件得出的，不是「保存成功」的乐观提示。</p>
        </div>
      </div>

      {loaded && config.customInstructions ? (
        <p className="settings-status">当前已保存自定义指令</p>
      ) : null}
    </section>
  );
}
