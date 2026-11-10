// 首次打开时的示例数据。全部带 sample 标记，界面上有一键清空入口。
import { currentLang, normalizeLang } from './i18n.js'
import { PRESET_VERSION, migratePresets, presetText, seedPresets } from './style-presets.js'

const A = name => `media-desk/assets/${name}`

const RAW = [
  { k: 'image', img: ['hills', 900, 620], t: '普通人第一次用 AI 做出能赚钱的东西，到底卡在哪', b: '不是不会提示词，是不知道第一个可以卖的东西长什么样。把这一步拆成三张图。', tags: ['AI', '变现'], a: 'case', p: ['newbie'], st: 'draft', day: 0, src: '路上想到' },
  { k: 'quote', t: '好的选题不是想出来的，是被你反复抱怨出来的。', b: '把一周的吐槽记下来，重复三次以上的就是选题。', tags: ['方法论'], a: 'opinion', p: ['creator'], st: 'idea', day: 0, src: '读书笔记' },
  { k: 'video', vid: ['v-aurora', 540, 720], t: '30 秒看懂 Agent 和聊天机器人的区别', b: '一个等你问，一个替你干。用极光般流动的任务图做开场。', tags: ['AI', '科普'], a: 'explain', p: ['newbie'], st: 'outline', day: -1, sch: [2, 20], pf: '抖音', src: '竖屏脚本' },
  { k: 'web', img: ['topo', 720, 720], t: '一份给独立开发者的定价地图', b: '把 40 个独立产品的定价页放在一张地形图上，高地与洼地一目了然。', tags: ['独立开发', '定价'], a: 'data', p: ['indie'], st: 'idea', day: -1, url: 'https://example.com/pricing-map', src: 'example.com' },
  { k: 'image', img: ['facade', 720, 940], t: '老城立面：被时间改写的设计系统', b: '每一扇窗都是后来者的补丁。用来讲软件的技术债，再合适不过。', tags: ['设计', '隐喻'], a: 'analogy', p: ['creator'], st: 'idea', day: -2, src: '街拍' },
  { k: 'note', t: '发布前 10 分钟检查清单', b: '标题有没有动词；前三秒说人话；封面手机上看得清；结尾只留一个行动。', tags: ['工作流'], a: 'list', p: ['creator'], st: 'ready', day: -2, sch: [1, 9], pf: '小红书', src: '自用清单' },
  { k: 'image', img: ['poster', 720, 960], t: '慢写：把一个念头养成一篇长文', b: '不追热点的一周实验：每天只写 200 字，第七天拼成一篇。', tags: ['写作'], a: 'story', p: ['creator'], st: 'published', day: -18, pub: -9, pf: '公众号', src: '封面实验' },
  { k: 'quote', t: '工具的终点，是让你忘记它。', b: '写一篇关于「无感」的产品观察。', tags: ['产品'], a: 'opinion', p: ['indie'], st: 'idea', day: -3, src: '随手记' },
  { k: 'video', vid: ['v-tide', 720, 540], t: '潮汐式工作法：两小时深潜，一小时靠岸', b: '用潮水比喻注意力，开头 5 秒海浪空镜配一句反问。', tags: ['效率'], a: 'analogy', p: ['newbie', 'creator'], st: 'draft', day: -3, sch: [4, 12], pf: 'B站', src: '分镜草图' },
  { k: 'image', img: ['ink', 720, 960], t: '山水里的信息层级', b: '近景实、远景虚。中国画早就讲透了界面设计里的层级关系。', tags: ['设计', '文化'], a: 'analogy', p: ['creator'], st: 'outline', day: -4, sch: [6, 20], pf: '公众号', src: '展览笔记' },
  { k: 'web', img: ['collage', 780, 620], t: '十个让人想截图的数据图', b: '收集做得克制又好看的图表，拆解它们是怎么取舍的。', tags: ['数据', '设计'], a: 'list', p: ['creator'], st: 'idea', day: -4, url: 'https://example.com/charts', src: 'example.com' },
  { k: 'image', img: ['dunes', 720, 960], t: '一人公司第 300 天：沙漠里的三次转向', b: '收入曲线、踩过的坑和那个差点放弃的下午。', tags: ['一人公司', '复盘'], a: 'story', p: ['indie'], st: 'published', day: -24, pub: -14, pf: '公众号', src: '复盘手稿' },
  { k: 'note', t: '评论区问得最多的 5 个问题', b: '1. 没有技术背景能做吗；2. 每月成本多少；3. 用哪个模型；4. 数据安全吗；5. 多久能上手。', tags: ['用户洞察'], a: 'qa', p: ['newbie'], st: 'outline', day: -5, src: '评论区' },
  { k: 'image', img: ['riso', 720, 860], t: '封面用色实验：高饱和条纹为什么点击率高', b: '做了三组 A/B，条纹款点击率最高，但完播并没有更好。', tags: ['封面', '实验'], a: 'data', p: ['creator'], st: 'published', day: -30, pub: -21, pf: '小红书', src: '实验记录' },
  { k: 'quote', t: '你不是缺灵感，你是缺一个存放灵感的地方。', b: '可以作为工作台本身的开场白。', tags: ['方法论'], a: 'opinion', p: ['creator'], st: 'idea', day: -6, src: '随手记' },
  { k: 'video', vid: ['v-bus', 720, 480], t: '夜班巴士上写完的第一个产品', b: '城市光斑做背景，第一人称讲述。情绪优先，技术点到为止。', tags: ['故事', '独立开发'], a: 'story', p: ['indie', 'newbie'], st: 'published', day: -36, pub: -28, pf: '抖音', src: 'Vlog' },
  { k: 'image', img: ['sea', 900, 600], t: '留白的勇气：三个删掉一半功能后变好的产品', b: '删除也是一种设计决策，用具体案例讲。', tags: ['产品', '设计'], a: 'case', p: ['indie', 'creator'], st: 'idea', day: -7, src: '产品观察' },
  { k: 'web', img: ['stairs', 720, 720], t: '增长的台阶：从 0 到 1 万粉的真实阶段', b: '每一级台阶上该做的事都不一样，别用十万粉的方法做第一千粉。', tags: ['增长'], a: 'data', p: ['creator'], st: 'draft', day: -8, sch: [8, 20], pf: '公众号', url: 'https://example.com/steps', src: 'example.com' },
  { k: 'image', img: ['still', 720, 860], t: '桌上的橘子：一个关于「注意力」的开场', b: '盯着一个橘子看一分钟，然后问观众：你上一次这样专注是什么时候？', tags: ['开场', '效率'], a: 'story', p: ['newbie'], st: 'idea', day: -9, src: '灵感速记' },
  { k: 'image', img: ['emboss', 760, 760], t: '字体的触感：为什么浮雕字让人想摸屏幕', b: '从印刷工艺聊到界面里的拟物回潮。', tags: ['设计', '字体'], a: 'explain', p: ['creator'], st: 'idea', day: -10, src: '样张' },
  { k: 'video', vid: ['v-ink', 600, 600], t: '一滴墨的 8 秒：转场素材库', b: '水墨扩散可以当章节转场，整理成一套素材。', tags: ['素材', '剪辑'], a: 'list', p: ['creator'], st: 'idea', day: -11, src: '素材' },
  { k: 'note', t: '这周只做一件事', b: '把「灵感 → 成稿」的路径缩短到 24 小时之内，跟踪一周看发文量变化。', tags: ['实验', '工作流'], a: 'story', p: ['creator'], st: 'idea', day: -12, src: '周计划' },
  { k: 'image', img: ['aurora', 800, 800], t: '渐变回潮：AI 产品的审美为什么越来越像', b: '当所有产品都用同一种渐变，差异化该落在哪里。', tags: ['设计', 'AI'], a: 'opinion', p: ['creator', 'indie'], st: 'idea', day: -13, src: '趋势观察' },
  { k: 'image', img: ['night', 720, 900], t: '城市夜光：给长文配图的 6 种情绪', b: '整理一套不撞图的配图情绪板。', tags: ['素材'], a: 'list', p: ['creator'], st: 'idea', day: -15, src: '情绪板' },
  { k: 'image', img: ['blush', 800, 800], t: '给焦虑的新手写一封信', b: '不教方法，只讲第一年真实会发生什么。', tags: ['新手', '共情'], a: 'story', p: ['newbie'], st: 'outline', day: -16, src: '读者来信' },
]

/** RAW 的英文文字，顺序和 RAW 一一对应：[标题, 补充, 标签, 来源]。 */
const RAW_EN = [
  ['Why your first AI side project never makes a dollar', 'It\'s not the prompts. It\'s not knowing what your first sellable thing should look like. Break that step down in three images.', ['AI', 'Monetization'], 'Thought on a walk'],
  ['Good topics aren\'t dreamed up. They\'re the things you keep complaining about.', 'Log a week of complaints. Anything that comes up three times is a topic.', ['Method'], 'Reading notes'],
  ['Agents vs. chatbots, explained in 30 seconds', 'One waits for you to ask, the other does the work. Open on a task map that flows like an aurora.', ['AI', 'Explainer'], 'Vertical script'],
  ['A pricing map for indie developers', 'Forty indie pricing pages on one topographic map, so the peaks and valleys jump out.', ['Indie hacking', 'Pricing'], 'example.com'],
  ['Old facades: a design system rewritten by time', 'Every window is a patch from whoever came later. A perfect way to talk about tech debt.', ['Design', 'Metaphor'], 'Street photo'],
  ['A 10-minute checklist before you hit publish', 'Does the title have a verb? Are the first three seconds plain English? Is the cover readable on a phone? Does the ending ask for just one thing?', ['Workflow'], 'My own checklist'],
  ['Slow writing: growing one thought into a long-form post', 'A week of not chasing trends: 200 words a day, stitched into one piece on day seven.', ['Writing'], 'Cover experiment'],
  ['The best tools end up forgotten.', 'A product essay about the things you stop noticing.', ['Product'], 'Quick note'],
  ['Tidal working: two hours deep, one hour ashore', 'Attention as a tide. Open with five seconds of waves and one question.', ['Productivity'], 'Storyboard sketch'],
  ['What landscape painting knows about visual hierarchy', 'Sharp foreground, misty distance. Chinese ink painters worked out interface hierarchy centuries ago.', ['Design', 'Culture'], 'Exhibition notes'],
  ['Ten charts worth a screenshot', 'Collect restrained, beautiful charts and break down what each one chose to leave out.', ['Data', 'Design'], 'example.com'],
  ['Day 300 of a one-person company: three pivots in the desert', 'The revenue curve, the mistakes, and the afternoon I almost quit.', ['Solo business', 'Retrospective'], 'Retro draft'],
  ['The 5 questions people ask most in the comments', '1. Can I do this without a tech background? 2. What does it cost per month? 3. Which model? 4. Is my data safe? 5. How long until I get the hang of it?', ['Audience insight'], 'Comments'],
  ['Cover color test: why bold stripes get more clicks', 'Three A/B rounds. Stripes won on clicks but didn\'t keep people watching any longer.', ['Covers', 'Experiment'], 'Test log'],
  ['You don\'t lack ideas. You lack a place to keep them.', 'Could be the opening line for Media Desk itself.', ['Method'], 'Quick note'],
  ['The first product I finished on a night bus', 'City lights in the background, told in first person. Mood first, go light on the tech.', ['Story', 'Indie hacking'], 'Vlog'],
  ['The nerve to leave space: three products that got better after cutting half their features', 'Deleting is a design decision too. Make the case with real examples.', ['Product', 'Design'], 'Product notes'],
  ['The growth staircase: the real stages from 0 to 10k followers', 'Each step needs different work. Don\'t use a 100k playbook to win your first thousand.', ['Growth'], 'example.com'],
  ['An orange on the desk: an opening about attention', 'Stare at an orange for one minute, then ask the viewer: when did you last focus like that?', ['Openings', 'Productivity'], 'Quick idea'],
  ['The feel of type: why embossed letters make you want to touch the screen', 'From letterpress to the comeback of skeuomorphism in interfaces.', ['Design', 'Typography'], 'Type specimen'],
  ['Eight seconds of ink: a transition library', 'Ink spreading in water works as a chapter transition. Package it as a set.', ['Footage', 'Editing'], 'Stock clips'],
  ['Just one thing this week', 'Cut the path from idea to finished post to under 24 hours, then track how much more you publish in a week.', ['Experiment', 'Workflow'], 'Weekly plan'],
  ['Gradients are back: why every AI product looks the same', 'When every product uses the same gradient, where does the difference go?', ['Design', 'AI'], 'Trend watch'],
  ['City lights at night: 6 moods for long-form images', 'A mood board of images that won\'t look like everyone else\'s.', ['Footage'], 'Mood board'],
  ['A letter to the anxious beginner', 'No tactics. Just what actually happens in your first year.', ['Beginners', 'Empathy'], 'Reader letter'],
]

const ANGLES = [
  ['case', '真实案例', '一个人做了什么，结果如何', '从一个具体的人和具体的数字切入，再抽象方法。'],
  ['opinion', '反常识观点', '大家都说 A，但其实是 B', '先摆出普遍看法，再用证据推翻它，结尾留下讨论点。'],
  ['explain', '三十秒讲明白', '用一句人话讲清一个概念', '只用一个类比，不出现术语，让外行能复述。'],
  ['data', '数据实验', '我测了 N 次，结果是', '给出样本量、过程与反直觉结论，附上可复现方法。'],
  ['analogy', '跨界类比', '这件事和 X 其实是一回事', '用跨领域的画面重新解释老问题。'],
  ['list', '清单收藏', '存下来，用得上', '结构清晰、可以直接照做，适合收藏传播。'],
  ['story', '第一人称故事', '那天我差点放弃', '有场景、有转折、有情绪，技术点到为止。'],
  ['qa', '评论区回答', '你们问得最多的问题', '直接回答真实问题，把读者的原话放进标题。'],
]

const ANGLES_EN = {
  case: ['Real case', 'What one person did, and how it went', 'Start from a specific person and specific numbers, then pull out the method.'],
  opinion: ['Contrarian take', 'Everyone says A. It\'s actually B.', 'Lay out the common view, knock it down with evidence, and end on a question worth discussing.'],
  explain: ['30-second explainer', 'One plain sentence that makes a concept click', 'One analogy, no jargon, so an outsider could explain it back.'],
  data: ['Data experiment', 'I tested it N times. Here\'s what happened.', 'Give the sample size, the process and the counterintuitive result, plus a way to reproduce it.'],
  analogy: ['Cross-domain analogy', 'This is really the same thing as X', 'Re-explain an old problem with a picture from another field.'],
  list: ['Save-worthy list', 'Save this, you\'ll need it', 'Clear structure people can follow as is. Built to be saved and shared.'],
  story: ['First-person story', 'The day I almost quit', 'A scene, a turn and real feeling. Keep the tech light.'],
  qa: ['Answering comments', 'The questions you ask most', 'Answer real questions directly and put readers\' own words in the title.'],
}

const PEOPLE = [
  ['newbie', '想入门的小林', '目标读者', '25–32 岁，上班族，想用 AI 提效或做副业，但怕被术语吓退。', ['怕术语', '想要第一步', '刷短视频'], 0],
  ['creator', '自媒体同行阿澈', '目标读者', '已有数千粉，关心选题、封面和流程，愿意为方法论付费。', ['方法控', '爱收藏', '看数据'], 1],
  ['indie', '独立开发者老周', '目标读者', '能写代码，缺增长和定价经验，喜欢看真实收入复盘。', ['重真实', '讨厌鸡汤', '长文读者'], 2],
  ['editor', '剪辑搭子小满', '协作者', '负责短视频剪辑和封面，周二、周四有空档。', ['剪辑', '封面'], 3],
]

const PEOPLE_EN = {
  newbie: ['Lena, curious beginner', 'Target reader', '25 to 32, office job, wants AI to save time or start a side project, but gets scared off by jargon.', ['Jargon-shy', 'Wants a first step', 'Watches short videos']],
  creator: ['Alex, fellow creator', 'Target reader', 'A few thousand followers. Cares about topics, covers and workflow, and will pay for a good method.', ['Method nerd', 'Saves everything', 'Checks the numbers']],
  indie: ['Sam, indie developer', 'Target reader', 'Can code, but short on growth and pricing experience. Loves honest revenue breakdowns.', ['Wants the real story', 'Hates fluff', 'Long-form reader']],
  editor: ['Maya, editing partner', 'Collaborator', 'Handles short-video edits and covers. Free on Tuesdays and Thursdays.', ['Editing', 'Covers']],
}

const SKILLS = [
  ['开头先给数字', '开头 50 字内出现一个具体数字或结果，不做背景铺垫。', '示例：来自 3 篇高阅读内容', 'active', 0.82],
  ['一篇只讲一件事', '删掉所有不服务于核心观点的段落，宁可拆成系列。', '示例：你在 2 篇草稿里都这样改过', 'active', 0.74],
  ['标题里写读者原话', '从评论区摘原句放进标题，比自己概括的点击更高。', '示例：待更多数据确认', 'proposed', 0.51],
]

const SKILLS_EN = [
  ['Lead with a number', 'Put a concrete number or result in the first 50 words. No warm-up.', 'Example: from 3 high-performing posts'],
  ['One piece, one point', 'Cut every paragraph that doesn\'t serve the main point. Split it into a series if you have to.', 'Example: you made this edit in 2 drafts'],
  ['Use readers\' words in the title', 'Lift exact phrases from the comments into the title. They get more clicks than your own summary.', 'Example: needs more data to confirm'],
]

export function migrateState(state) {
  if (state.activeStyleId === undefined) state.activeStyleId = null
  // 加入英文之前的数据都是中文示例
  if (state.sampleLang === undefined) state.sampleLang = 'zh'
  if (state.sampleLang === 'en') stashChineseLeftovers(state)
  return migratePresets(state)
}

const SAMPLE_HANDLE = { zh: '示例账号', en: 'Sample account' }

const ACCOUNTS = [
  ['公众号', '示例账号', 12840],
  ['小红书', '示例账号', 8620],
  ['抖音', '示例账号', 21300],
  ['B站', '示例账号', 5470],
]

function shift(base, days, hour = 10, minute = 0) {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

/**
 * 以 now 为基准生成示例状态，让日历和排期始终落在当前日期附近。
 * @param {Date} now - 基准时间。
 * @param {'zh'|'en'} [lang] - 示例用哪种语言写，默认跟随当前请求。
 * @returns {object} 完整状态。
 */
function mediaOf(row) {
  return row.img
    ? { src: A(`${row.img[0]}.jpg`), w: row.img[1], h: row.img[2] }
    : row.vid
      ? { src: A(`${row.vid[0]}.mp4`), poster: A(`${row.vid[0]}-poster.jpg`), w: row.vid[1], h: row.vid[2] }
      : null
}

// 图里印着中文的示例，英文界面换一张英文版
const MEDIA_EN = { seed_7: 'poster-en', seed_20: 'emboss-en' }

export function buildSeed(now, lang = currentLang()) {
  const items = RAW.map((row, index) => {
    const id = `seed_${index + 1}`
    const media = mediaOf(row)
    return {
      id,
      kind: row.k,
      title: row.t,
      body: row.b,
      tags: row.tags,
      status: row.st,
      angleId: row.a,
      personaIds: row.p,
      media,
      url: row.url ?? null,
      source: row.src,
      createdAt: shift(now, row.day, 9 + (index % 11), (index * 7) % 60),
      scheduledAt: row.sch ? shift(now, row.sch[0], row.sch[1]) : row.pub !== undefined ? shift(now, row.pub, 20) : null,
      publishedAt: row.pub !== undefined ? shift(now, row.pub, 20) : null,
      platform: row.pf ?? null,
      drafts: {},
      sample: true,
    }
  })

  const metrics = []
  const published = items.filter(item => item.publishedAt)
  // 每篇已发布内容生成一段衰减的日阅读，数据只用于演示复盘界面
  const PEAK = { seed_7: 8200, seed_12: 21400, seed_14: 12600, seed_16: 34800 }
  for (const item of published) {
    const start = new Date(item.publishedAt)
    const peak = PEAK[item.id] ?? 6000
    for (let d = 0; d < 9; d += 1) {
      const date = new Date(start)
      date.setDate(date.getDate() + d)
      if (date > now) break
      const views = Math.round(peak * Math.exp(-d * 0.55) * (0.9 + ((d * 37) % 20) / 100))
      metrics.push({
        id: `seed_m_${item.id}_${d}`, itemId: item.id, platform: item.platform, date: date.toISOString(), views,
        likes: Math.round(views * 0.046), comments: Math.round(views * 0.009), shares: Math.round(views * 0.012), saves: Math.round(views * (item.platform === '小红书' ? 0.05 : 0.018)), sample: true,
      })
    }
  }

  const state = {
    version: 1,
    sampleCleared: false,
    sampleLang: 'zh',
    items,
    people: PEOPLE.map(([id, name, role, note, traits, tone]) => ({ id, name, role, note, traits, tone, sample: true })),
    angles: ANGLES.map(([id, name, hook, prompt]) => ({ id, name, hook, prompt, sample: true })),
    skills: SKILLS.map(([name, rule, evidence, status, confidence], index) => ({ id: `seed_s_${index + 1}`, name, rule, source: '示例', evidence, status, confidence, sample: true })),
    accounts: ACCOUNTS.map(([platform, handle, followers], index) => ({ id: `seed_ac_${index + 1}`, platform, handle, followers, url: null, sample: true })),
    metrics,
    styles: seedPresets(),
    presetVersion: PRESET_VERSION,
    activeStyleId: null,
    chat: [],
  }
  return normalizeLang(lang) === 'en' ? localizeSamples(state, 'en') : state
}

// 示例文字的两种语言版本：集合 → id → 字段。只有这些字段会随界面语言切换。
function textTables(lang) {
  const en = lang === 'en'
  return {
    items: Object.fromEntries(RAW.map((row, index) => {
      const id = `seed_${index + 1}`
      const [title, body, tags, source] = en ? RAW_EN[index] : [row.t, row.b, row.tags, row.src]
      if (!MEDIA_EN[id]) return [id, { title, body, tags, source }]
      const media = mediaOf(row)
      return [id, { title, body, tags, source, media: en ? { ...media, src: A(`${MEDIA_EN[id]}.jpg`) } : media }]
    })),
    people: Object.fromEntries(PEOPLE.map(([id, ...zh]) => {
      const [name, role, note, traits] = en ? PEOPLE_EN[id] : zh
      return [id, { name, role, note, traits }]
    })),
    angles: Object.fromEntries(ANGLES.map(([id, ...zh]) => {
      const [name, hook, prompt] = en ? ANGLES_EN[id] : zh
      return [id, { name, hook, prompt }]
    })),
    skills: Object.fromEntries(SKILLS.map(([name, rule, evidence], index) => [`seed_s_${index + 1}`, en ? { name: SKILLS_EN[index][0], rule: SKILLS_EN[index][1], evidence: SKILLS_EN[index][2], source: 'Sample' } : { name, rule, evidence, source: '示例' }])),
    accounts: Object.fromEntries(ACCOUNTS.map((row, index) => [`seed_ac_${index + 1}`, { handle: SAMPLE_HANDLE[lang] }])),
  }
}

const TABLES = { zh: textTables('zh'), en: textTables('en') }

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** 字段还是某种语言的原文时才换成目标语言，用户改过的不动。返回是否改了。 */
function swapFields(row, original, target) {
  let changed = false
  for (const [field, value] of Object.entries(target)) {
    if (same(row[field], value)) continue
    if (!original.some(text => text && same(row[field], text[field]))) continue
    row[field] = structuredClone(value)
    changed = true
  }
  return changed
}

// 示例卡片在每种语言下各有一份：标题、正文和生成过的成稿。切走时把当前这份收起来，切回来原样放回。
const ITEM_FIELDS = ['title', 'body', 'tags', 'source', 'media', 'production', 'drafts']

const CJK = /[\u4e00-\u9fff]/

// 2.6.0 切到英文时，示例上生成过的中文成稿和改过的中文标题会留在英文界面里。把它们收进中文那份。
function stashChineseLeftovers(state) {
  if (state.sampleCleared) return
  for (const row of state.items ?? []) {
    const text = row?.sample && !row.otherLang ? TABLES.en.items[row.id] : null
    if (text?.media && same(row.media, TABLES.zh.items[row.id].media)) row.media = structuredClone(text.media)
    if (!text || !ITEM_FIELDS.some(field => row[field] !== undefined && CJK.test(JSON.stringify(row[field])))) continue
    swapItem(row, 'zh', 'en', text)
  }
}

function swapItem(row, from, target, text) {
  if (from === target) {
    swapFields(row, [TABLES.zh.items[row.id], TABLES.en.items[row.id]], text)
    return
  }
  const saved = {}
  for (const field of ITEM_FIELDS) if (row[field] !== undefined) saved[field] = row[field]
  const stash = { ...(row.otherLang ?? {}), [from]: saved }
  const back = stash[target]
  delete stash[target]
  if (back) {
    for (const field of ITEM_FIELDS) {
      if (back[field] === undefined) delete row[field]
      else row[field] = back[field]
    }
  } else {
    Object.assign(row, structuredClone(text))
    delete row.production
    row.drafts = {}
  }
  row.otherLang = stash
}

/**
 * 界面语言和示例数据的语言不一致时需要换一遍。
 * @param {object} state - 当前状态。
 * @param {string} lang - 界面语言。
 * @returns {boolean} 是否需要调用 localizeSamples。
 */
export function samplesNeedLocale(state, lang) {
  return (state?.sampleLang ?? 'zh') !== normalizeLang(lang)
}

/**
 * 把还是示例的行（sample: true）和没改过的内置预设换成另一种语言。
 * 示例卡片的文字、成稿和草稿每种语言各存一份，来回切换不会丢；状态、排期、数据和用户自己的内容都不碰。按 id 对应，可以重复调用。
 * @param {object} state - 会被就地修改的状态。
 * @param {string} lang - 目标语言。
 * @returns {object} 同一个 state。
 */
export function localizeSamples(state, lang) {
  const target = normalizeLang(lang)
  const from = normalizeLang(state.sampleLang ?? 'zh')
  if (!state.sampleCleared) {
    for (const row of state.items ?? []) {
      const to = row?.sample ? TABLES[target].items[row.id] : null
      if (to) swapItem(row, from, target, to)
    }
    for (const key of ['people', 'angles', 'skills', 'accounts']) {
      for (const row of state[key] ?? []) {
        const to = row?.sample ? TABLES[target][key][row.id] : null
        if (to) swapFields(row, [TABLES.zh[key][row.id], TABLES.en[key][row.id]], to)
      }
    }
  }
  for (const row of state.styles ?? []) {
    if (!row?.preset) continue
    const to = presetText(row.id, target)
    if (to) swapFields(row, [presetText(row.id, 'zh'), presetText(row.id, 'en')], to)
  }
  state.sampleLang = target
  return state
}
