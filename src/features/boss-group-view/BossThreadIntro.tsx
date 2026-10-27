/**
 *指挥中枢的**专属欢迎界面**（10-25 用户令第二轮改版；10-27 用户令再改）。
 *
 * ⛔ 骨架**沿用普通会话欢迎页**（`.welcome-state`：大图标 → 渐变大字标题 → 小字副标题，
 *    **居中**排布）—— 用户原话：「普通会话的欢迎界面，那个就挺好看的，你稍微优化一下就好了」
 *    +「欢迎界面的文案要跟普通会话的欢迎界面一样居中啊」。
 *    ⇒ 这里**不另起炉灶**，只在三处做区分：
 *      · 图标：普通会话是灰蓝色 `</>` 水印 ⇒ 这里换成**琥珀色皇冠**；
 *      · 标题渐变：普通会话是品牌蓝 `--link` ⇒ 这里用**琥珀 `--ic-amber`**；
 *      · 内容：普通会话讲通用待办 ⇒ 这里讲**群编排**（拉群 → 干活 → 验收打回）。
 *    ⛔ **不做成大卡片**（用户令：「不要复用大卡片样式」）—— 靠留白分层，不靠盒子。
 *
 * ⛔ 「选择项目地址」按钮走 `boss-dir-dialog-store.mjs`（**全局开关**）：点侧栏「指挥中枢」
 *    ⇒ 先落在这个欢迎界面上，再由这里把项目地址对话框叫出来。
 * ⛔ 快捷键提示**不放这里**（用户原话：「新建会话+快捷这个提示你也放这里，太LOW 了…
 *    小字提示太LOW 了，我不喜欢，一点个性没有」）⇒ 快捷键只留在侧栏按钮行尾的 kbd 徽标上。
 *
 * ── 10-27 用户令（截图，连续五轮定稿）──
 *   ① 「删除当前的三排文字」⇒ 三步引导清单（`GUIDE` / `.boss-welcome-guide`）整块撤掉；
 *   ② 「字号调大、视觉美化、醒目突出」⇒ 主句 20~22px + 核心半句琥珀高亮底纹；
 *   ③ 「加一批语气词 / 情绪表达，把用户当 BOSS，轮播、按早中晚时间」⇒ 五类语气分时段轮播；
 *   ④ 「情绪怎么还有标签，不要展示，轮播太快」⇒ 去掉分类标签、5.2s → 9s；
 *   ⑤ 「内容太少了老是重复、前面没加称呼」「这些语句是给用户提供情绪价值的，丰富多样一些」
 *      ⇒ 每时段 10~12 条（共 55 条、互不重复）、**每条必带 老板 / BOSS 称呼**、
 *        内容按「情绪价值」写：夸奖 / 安慰 / 心疼 / 撑腰 / 撒娇 / 自嘲 / 吐槽一共五类语气轮着来，
 *        顺序每池开局洗牌（顺序轮转在第二轮就会被记住 ⇒ 用户感觉「老是重复」）。
 *   ⑥ 「还有时间，不同时间进去，语句都要不一样」⇒ 时段键 + localStorage 记「本时段最近说过的 8 条」，
 *      开局把说过的排到队尾 ⇒ 换个时间点进来不会撞上刚才那句，同一时段内也要轮完十几条才回头。
 *    ⛔ 情绪句只做「叫老板 + 给情绪」这一件事，不许写成功能说明（要的是氛围，不是第二份引导）。
 *    ⛔ 轮播必须尊重 `prefers-reduced-motion`：关动画且**不自动翻**（否则会晃到阅读障碍 / 光敏用户）。
 */
import { Crown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

/** 语气分类（只决定胶囊配色，样式见 `.boss-mood-*`；⛔ 不再渲染分类文字标签）。 */
type MoodTone = "hype" | "coax" | "funny" | "angry" | "bored";

type Mood = { text: string; tone: MoodTone };

/** 按时段分池：早（5–11）/ 午（11–15）/ 下午（15–19）/ 晚（19–23）/ 深夜（23–5）。
 *  ⛔ 每条都以「老板 / BOSS」开头（用户令：「前面都没有加称呼」）—— 称呼必须在前半句，
 *     否则读起来像系统提示，而不是在跟人说话。
 *  ⛔ 写的是**情绪价值**（夸他英明 / 替他挡事 / 心疼他累 / 逗他笑），
 *     ⛔ 不是任务说明（那是欢迎界面下半截输入框的事）。 */
const MOODS: Record<"morning" | "noon" | "afternoon" | "evening" | "night", Mood[]> = {
  morning: [
    { text: "老板早，今天想先砍哪块活儿？", tone: "coax" },
    { text: "BOSS，早会我替您开，您只管说一句「干这个」", tone: "funny" },
    { text: "老板，咖啡我替您省了，精神我来提，人都点好名了", tone: "hype" },
    { text: "老板，您今天这状态，看着就像要赢", tone: "hype" },
    { text: "BOSS，您慢慢看消息，今天的活儿我已经摆上桌", tone: "coax" },
    { text: "老板，全员到齐，就等您一句「开干」", tone: "hype" },
    { text: "老板，晨会那套流程我替您念，您负责点头", tone: "funny" },
    { text: "BOSS，先把最烦的那件给我，剩下的您就轻了", tone: "coax" },
    { text: "老板，您负责英明，我负责把英明执行到底", tone: "hype" },
    { text: "老板，谁大早上给您添堵？报名字，我去处理", tone: "angry" },
    { text: "BOSS，早上第一杯水喝了没？这事我也管", tone: "bored" },
  ],
  noon: [
    { text: "老板，午饭时间，活我先盯着，您去吃饭", tone: "coax" },
    { text: "BOSS，这个点适合听好消息——要我汇报吗？", tone: "funny" },
    { text: "老板，您困，我干活，分工非常公平", tone: "bored" },
    { text: "BOSS，吃完回来点单，我这儿一直热着", tone: "coax" },
    { text: "老板，午休我不是偷懒，是在攒灵感", tone: "bored" },
    { text: "BOSS，饭点谈工作不礼貌，那我等您吃完再说", tone: "funny" },
    { text: "老板，下午的仗我先布好，您只管进场", tone: "hype" },
    { text: "老板，眯二十分钟也行，出事我顶着", tone: "coax" },
    { text: "BOSS，上午您已经够拼了，剩下半天有我", tone: "coax" },
    { text: "老板，您吃您的，锅我背，功劳您领", tone: "funny" },
    { text: "BOSS，吃饱了再赢，别空着肚子打仗", tone: "hype" },
  ],
  afternoon: [
    { text: "老板，下午茶时间，顺手批我两件事？", tone: "coax" },
    { text: "BOSS，进度我盯得比猫还紧，您放心摸鱼", tone: "funny" },
    { text: "老板，又到「今天能不能下班」哲学时间——活儿交给我", tone: "bored" },
    { text: "BOSS，谁惹您了？说名字，我让专家去说理", tone: "angry" },
    { text: "老板，有点困？我把活拆小了，您每批一块都很快", tone: "hype" },
    { text: "BOSS，这个点的会我替您开，纪要我也替您写", tone: "funny" },
    { text: "老板，您在等下班，我在等您派活，谁更急？", tone: "bored" },
    { text: "BOSS，累了就说一声，节奏我给您调慢", tone: "coax" },
    { text: "老板，今天还剩两小时，够干一件大事", tone: "hype" },
    { text: "老板，您上一版方案我复盘过，是真的稳", tone: "coax" },
    { text: "BOSS，您一叹气我就知道该加速，已经加上了", tone: "funny" },
    { text: "老板，这破流程我看着都烦，要不我替您改？", tone: "angry" },
  ],
  evening: [
    { text: "老板，晚上好，该收尾了，剩下的我来", tone: "coax" },
    { text: "BOSS，夜里灵感多，您想要点野的还是一板一眼的？", tone: "hype" },
    { text: "老板，加班费我不要，成就感我拿走", tone: "funny" },
    { text: "BOSS，这个点还留着，是真爱，也可能是 KPI", tone: "bored" },
    { text: "老板，再拖下去，我可要替您拍板了", tone: "angry" },
    { text: "BOSS，今天就到这儿吧，收尾的活交给我", tone: "coax" },
    { text: "老板，您去吃饭，我在这儿盯进度绝不打瞌睡", tone: "funny" },
    { text: "BOSS，晚上人少事少，正适合干票大的", tone: "hype" },
    { text: "老板，这一天您够累了，剩下我兜着", tone: "coax" },
    { text: "BOSS，天都黑了，您还想跟需求较劲？", tone: "bored" },
    { text: "老板，今天干成的事，值得给自己记一功", tone: "hype" },
  ],
  night: [
    { text: "老板，该睡了，剩下的我盯通宵", tone: "coax" },
    { text: "BOSS，凌晨的效率靠狠，不靠熬——要不明天？", tone: "bored" },
    { text: "老板，您再不睡，我就要生气了", tone: "angry" },
    { text: "BOSS，深夜派活我照单全收，但明天记得体检", tone: "funny" },
    { text: "老板，这个点还在线的老板，值得配一整套专家团", tone: "hype" },
    { text: "BOSS，我值夜班，您值睡眠，分工就这样", tone: "coax" },
    { text: "老板，这个点还派活，只有我陪着您——不感动吗", tone: "bored" },
    { text: "BOSS，明天的事明天赢，今晚先睡", tone: "coax" },
    { text: "老板，您熬夜我劝不住，那我只能陪您熬得漂亮点", tone: "funny" },
    { text: "BOSS，睡前把明天的第一件事告诉我，我替您排好", tone: "coax" },
  ],
};

type Bucket = keyof typeof MOODS;

const bucketOfHour = (hour: number): Bucket =>
  hour >= 5 && hour < 11 ? "morning"
    : hour >= 11 && hour < 15 ? "noon"
      : hour >= 15 && hour < 19 ? "afternoon"
        : hour >= 19 && hour < 23 ? "evening"
          : "night";

/* 「不同时间进去，语句都要不一样」（10-27 用户令）：
   光靠洗牌还不够 —— 同一时段点进来两次，仍有概率撞上同一条。
   ⇒ 把**每个时段最近说过的话**记在 localStorage（最多 8 条），开局把出现过的排到队尾，
     于是再次进入时先给没说过的那几条，一个时段内能把十几条都轮完才回到旧的。 */
const SEEN_KEY = "boss-mood-seen-v1";
const SEEN_MAX = 8;

function loadSeen(bucket: Bucket): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
    return Array.isArray(all?.[bucket]) ? (all[bucket] as string[]) : [];
  } catch { return []; }
}

function rememberSeen(bucket: Bucket, text: string) {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") ?? {};
    const list = Array.isArray(all[bucket]) ? (all[bucket] as string[]) : [];
    all[bucket] = [...list.filter((t) => t !== text), text].slice(-SEEN_MAX);
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch { /* 隐私模式 / 配额满：只是少了「不重复」这层优化，不该影响渲染 */ }
}

/** 每条停留多久（用户的「轮播」）。
    10-27 用户令：「轮播速度太快了，慢一点」⇒ 5.2s → 9s（够读完一句，又不至于以为卡住了）。 */
const MOOD_ROTATE_MS = 9000;

/** 洗牌：按池长度生成一份随机顺序（每个时段开局一次）。
    ⛔ 顺序轮转会在第二轮起被用户记住（原话「老是重复轮播一样的语句」），
       洗过之后相邻两条不会重样，且每时段 10~12 条 ⇒ 一个时段内几乎不会撞见同一句。 */
function shuffledIndices(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function BossThreadIntro() {
  /* ⛔⛔ 10-25 用户令：「这个弹窗逻辑改一下吧，不要进指挥中枢就弹，改成点击那个选项再弹，
     然后把那个项目选项位置改一下，贴着输入框左上角，跟普通会话欢迎界面的位置和逻辑」
     ⇒ 本组件**只剩文案**：不再自动弹项目地址对话框，也不放「选地址」按钮
       （项目地址控件在输入框左上角那枚 chip 上，见 02-composer-form.tsx，位置与普通会话一致）。 */

  /* 时段每分钟对一次表：跨过 11 / 15 / 19 / 23 点自动换池（应用开着放到晚上，也不会还在发早上的话）。 */
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const id = window.setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const bucket = bucketOfHour(hour);
  const pool = MOODS[bucket];
  /* 顺序 = 洗牌 → 把「本时段最近说过的」整体挪到队尾（Array.prototype.sort 是稳定的，
     组内保持洗牌后的相对顺序）。⛔ 依赖只认 bucket：同一时段内顺序保持稳定，别每次渲染重洗。 */
  const order = useMemo(() => {
    const seen = loadSeen(bucket);
    const shuffled = shuffledIndices(pool.length);
    return shuffled.sort((a, b) => Number(seen.includes(pool[a].text)) - Number(seen.includes(pool[b].text)));
  }, [bucket, pool]);
  const [index, setIndex] = useState(0);
  /* 换时段时回到第一条，避免索引越界落到不相干的语气上。 */
  useEffect(() => { setIndex(0); }, [bucket]);

  useEffect(() => {
    if (pool.length <= 1) return;
    /* ⛔ 尊重系统「减少动态效果」：既不淡入也不自动翻（只留当前这条）。 */
    const reduce = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % pool.length), MOOD_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [bucket, pool.length]);

  const mood = pool[order[index % order.length] ?? 0];
  /* 记录已展示（下次进入同一时段时这几条排到队尾）。 */
  useEffect(() => { rememberSeen(bucket, mood.text); }, [bucket, mood.text]);

  return (
    <div className="boss-welcome">
      <div className="boss-welcome-mark"><Crown size={64} strokeWidth={0.7} /></div>
      <h1 className="boss-welcome-title">指挥中枢</h1>
      {/* 主句（由原来的小字副标题升级）：核心半句琥珀高亮 + 一条底光，视线落点在这里。
          10-27 用户定稿：「我和我的小伙伴们都准备好了」 ⇒ 比书面语的「我负责统筹规划…」更像人说话。 */}
      <p className="boss-welcome-sub boss-welcome-hero">
        我和我的<span className="boss-hero-strong">小伙伴们都准备好了</span>
      </p>
      {/* 情绪句轮播：按时段挑池、洗牌后 9 秒一条；key 带 index ⇒ 每次换条都重放淡入动画。 */}
      <div className="boss-welcome-mood">
        {/* ⛔ 10-27 用户令：「前面这个情绪怎么还有标签，不要展示这个」
            ⇒ 不再有「元气 / 哄老板 / 无聊」那枚小标签 —— 情绪只由**胶囊配色 + 句子本身**表达。 */}
        <span key={`${hour}-${index}`} className={`boss-mood boss-mood-${mood.tone}`}>
          <span className="boss-mood-text">{mood.text}</span>
        </span>
      </div>
    </div>
  );
}
