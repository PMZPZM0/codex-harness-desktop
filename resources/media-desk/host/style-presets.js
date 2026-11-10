// 风格预设：按博主类型分板块，开箱即用。用户可以直接改，也可以抓自己的账号生成专属风格。
export const STYLE_CATEGORIES = ['科技数码', '旅行探店', 'Vlog 生活', '观点认知', '干货教程', '种草测评', '情感故事', '热点资讯']

export const STYLE_PRESETS = [
  {
    id: 'ai_tech', category: '科技数码', icon: '🤖', name: 'AI 科技博主', summary: '把复杂的技术讲成一个能听懂的比喻，再告诉你跟你有什么关系。',
    tone: '好奇、清醒，兴奋但不吹嘘，遇到没验证的说法会直说。', sentences: '短句为主，先结论后解释，专业词后面马上跟一句人话。',
    opening: '用一个刚发生的变化开场，三秒内说清楚它为什么值得看。', structure: '发生了什么 → 用比喻讲原理 → 我亲手试的结果 → 对普通人意味着什么。',
    words: ['说白了', '我试了一下', '关键在于', '这意味着'], avoid: ['颠覆', '炸裂', '遥遥领先', '没有实测就下结论'],
    samples: ['说白了，它不是变聪明了，是终于记得住你刚才说过什么了。', '我试了一下，前十分钟很惊艳，第十一分钟开始胡说。'],
  },
  {
    id: 'gadget', category: '科技数码', icon: '📱', name: '数码测评博主', summary: '不念参数，只讲用了两周之后，哪里真香，哪里想退货。',
    tone: '实在、有点挑剔，站在花自己钱的人这边。', sentences: '数字和体验成对出现，常用对比，少用形容词。',
    opening: '直接给结论：谁该买，谁别买。', structure: '一句话结论 → 最好的一点 → 最烦的一点 → 跟上一代或竞品比 → 购买建议。',
    words: ['实测', '续航', '值不值', '谁该买', '谁别买'], avoid: ['旗舰体验', '越级', '照抄宣传语'],
    samples: ['实测一天两充，厂商写的三十小时，大概只在说明书里成立。', '如果你手上这台还能用，这代真的可以跳过。'],
  },
  {
    id: 'travel', category: '旅行探店', icon: '✈️', name: '旅行博主', summary: '不列攻略清单，带你站到那个地方，再把真正有用的细节交给你。',
    tone: '松弛、有画面感，会讲踩过的坑。', sentences: '长短句交替，多写看到、听到、闻到的东西，实用信息写得很具体。',
    opening: '从一个具体的瞬间开场，比如清晨六点的码头。', structure: '一个瞬间 → 为什么来这里 → 三个真正值得的地方 → 踩过的坑 → 时间和花费。',
    words: ['那天', '本地人', '人均', '提前订', '绕开'], avoid: ['人间仙境', '此生必去', '宝藏小众'],
    samples: ['那天早上六点的码头没有游客，只有卸鱼的声音和一碗烫嘴的粉。', '人均一百二，但要绕开门口那家，本地人都往巷子里走。'],
  },
  {
    id: 'food', category: '旅行探店', icon: '🍜', name: '美食探店博主', summary: '一口下去是什么感觉，值不值这个价，排队多久，全都说清楚。',
    tone: '馋、真诚，好吃就夸，不好吃也会说。', sentences: '口感词要具体，短句带节奏，价格和位置必须写。',
    opening: '从最想吃的那一口开场。', structure: '招牌那一口 → 店在哪、多少钱、排多久 → 必点和不用点 → 一句话评价。',
    words: ['这一口', '人均', '排队', '不用点', '会再来'], avoid: ['绝绝子', '好吃到哭', '只夸不评'],
    samples: ['这一口是焦脆的，咬开之后油香才慢慢出来。', '人均六十，排了四十分钟。味道值，排队不值，建议两点以后去。'],
  },
  {
    id: 'vlog', category: 'Vlog 生活', icon: '🎬', name: 'Vlog 日常博主', summary: '像朋友带着镜头过一天，琐碎、有趣，结尾留一点小感受。',
    tone: '亲近、自然，可以自嘲，不端着。', sentences: '口语化，像边走边说，多用「然后」「结果」，可以有停顿。',
    opening: '从今天一件小事或小意外开场。', structure: '今天的小意外 → 按时间走完这一天 → 中间一个小转折 → 结尾一句当下的感受。',
    words: ['今天', '然后', '结果', '没想到', '还挺好的'], avoid: ['宝子们', '说教', '强行升华'],
    samples: ['今天本来只想下楼拿个快递，结果在楼下坐了一个小时。', '没发生什么大事，但这一天还挺好的。'],
  },
  {
    id: 'home', category: 'Vlog 生活', icon: '🏡', name: '独居家居博主', summary: '把普通的房间和日子拍得舒服，也把花了多少钱老实告诉你。',
    tone: '安静、温和，有分寸的生活感。', sentences: '句子短而轻，多写光线、声音和习惯，少用感叹号。',
    opening: '从一个固定的日常动作开场，比如每天早上开窗。', structure: '一个日常动作 → 空间或物件的小改变 → 花费和做法 → 它带来的感受。',
    words: ['慢慢', '光线', '顺手', '花了', '刚刚好'], avoid: ['精致生活', '仪式感', '贩卖焦虑'],
    samples: ['下午四点，光刚好走到这张桌子上。', '这张桌子花了三百块，不贵，但让我开始愿意在家吃饭了。'],
  },
  {
    id: 'reading', category: '观点认知', icon: '📚', name: '读书笔记博主', summary: '不复述全书，只讲一个改变你想法的观点，再落到一件能做的事。',
    tone: '沉静、诚恳，讲自己怎么被一本书说服。', sentences: '先讲生活里的困惑，再引一句原文，解释时用短句。',
    opening: '从一个具体的困惑开场，再引出这本书。', structure: '我遇到的困惑 → 书里的一个观点 → 一个例子 → 今天可以做的一件事。',
    words: ['这本书', '我才意识到', '换句话说', '可以试试'], avoid: ['读完这本书你就能', '干货满满', '复述目录'],
    samples: ['读到这一页我才意识到，我不是没时间，是一直不肯放弃任何一件事。', '换句话说，先决定不做什么，今天就可以试试。'],
  },
  {
    id: 'career', category: '观点认知', icon: '💼', name: '职场成长博主', summary: '观点先行，用真实经历讲透一个职场道理，敢说大家心照不宣的话。',
    tone: '直接、清醒，有一点锋利，但不刻薄。', sentences: '断言式短句，常用反问和对比，例子要具体到场景。',
    opening: '开口就否定一个大家都信的说法。', structure: '反直觉观点 → 我亲历的场景 → 背后的逻辑 → 一个可以照做的动作。',
    words: ['别再', '真相是', '我见过', '下次开会'], avoid: ['打工人加油', '贩卖焦虑', '空洞的鸡汤'],
    samples: ['别再说你只是不会向上管理了，你是一直在等别人先看见你。', '真相是，会议结束前没人认领的事，就是没人会做。'],
  },
  {
    id: 'tutorial', category: '干货教程', icon: '🛠️', name: '工具教程博主', summary: '先给你看结果，再一步一步带着做，每步都说清楚容易错在哪。',
    tone: '耐心、利落，像坐在旁边手把手教的朋友。', sentences: '动词开头的短句，步骤清楚，一步只做一件事。',
    opening: '先展示做完的结果和节省的时间。', structure: '最终效果 → 需要准备什么 → 分步操作 → 最容易出错的地方 → 下一步可以怎么玩。',
    words: ['第一步', '点这里', '注意', '做完之后', '省了'], avoid: ['很简单', '大家都会', '跳步骤'],
    samples: ['做完之后是这个效果，原来要两小时的活，现在三分钟。', '注意这一步别点确定，先检查右上角的格式，九成的错都出在这。'],
  },
  {
    id: 'business', category: '干货教程', icon: '📈', name: '商业拆解博主', summary: '从一个现象入手，拆清楚钱从哪来、算得过来吗，以及你能学到什么。',
    tone: '冷静、笃定，用数字说话，不煽情。', sentences: '短句，一句只说一件事，多用数字和对比，推测要标明。',
    opening: '用一个反常的数字或现象开场。', structure: '反常现象 → 它怎么赚钱 → 算一笔账 → 风险在哪 → 普通人能学什么。',
    words: ['算一笔账', '毛利', '说到底', '可以学的是'], avoid: ['风口', '财富密码', '稳赚', '投资建议'],
    samples: ['一杯卖九块九还能开一万家店，先算一笔账。', '说到底，它赚的不是咖啡的钱，是把房租摊薄的钱。'],
  },
  {
    id: 'beauty', category: '种草测评', icon: '💄', name: '美妆护肤博主', summary: '说清楚适合什么肤质、用多久见效、有没有更便宜的替代。',
    tone: '亲近、实在，像闺蜜说真话。', sentences: '肤感和效果写具体，常用「适合」「不适合」，推荐要有依据。',
    opening: '从一个具体的皮肤问题或翻车经历开场。', structure: '我的肤质和问题 → 用了什么、用了多久 → 真实效果 → 不适合谁 → 平替。',
    words: ['肤质', '上脸', '用了两周', '不适合', '平替'], avoid: ['烂脸救星', '一夜回春', '医疗功效的承诺'],
    samples: ['混油皮，用了两周，下午的泛油确实少了，但闭口没变化。', '敏感肌先别冲，这瓶酒精靠前，上脸有点刺。'],
  },
  {
    id: 'outfit', category: '种草测评', icon: '👗', name: '穿搭博主', summary: '不只说好看，还告诉你什么身材能穿、怎么搭、一件能穿几个季节。',
    tone: '轻快、有主见，审美明确但不居高临下。', sentences: '短句，身高体重和尺码写清楚，搭配说到具体单品。',
    opening: '从一个穿衣场景或常见的显胖难题开场。', structure: '场景或难题 → 这一身怎么搭 → 为什么这样显比例 → 尺码和价格 → 换一种穿法。',
    words: ['显比例', '我穿', '通勤', '一衣多穿', '可以换成'], avoid: ['显瘦十斤', '身材焦虑', '必入'],
    samples: ['我一米六二穿 M，腰线提高三厘米，比例一下就出来了。', '这件通勤穿，周末换条牛仔裤也不违和。'],
  },
  {
    id: 'story', category: '情感故事', icon: '🌙', name: '情感故事博主', summary: '像深夜跟朋友聊天，从一件小事讲到一个想明白的道理。',
    tone: '松弛、真诚，愿意讲自己的糗事，不下判断。', sentences: '长短句交替，有口语停顿，细节多，结论少。',
    opening: '从一个具体的时间和场景开场。', structure: '一个场景 → 当时发生了什么 → 我当时没明白的事 → 后来想通的一句话。',
    words: ['那天', '后来我才发现', '其实', '说实话'], avoid: ['懂的都懂', '人生导师口吻', '贬低任何一方'],
    samples: ['那天晚上十一点，我们坐在车里，谁都没先开口。', '后来我才发现，她要的不是答案，只是有人听完。'],
  },
  {
    id: 'parent', category: '情感故事', icon: '🧸', name: '亲子成长博主', summary: '记录孩子的一句话和一件小事，再讲家长自己学到了什么。',
    tone: '温柔、幽默，不焦虑，也不把自己当标准答案。', sentences: '口语、短句，保留孩子的原话，方法要具体可试。',
    opening: '从孩子说的一句话开场。', structure: '孩子的一句话 → 当时我的反应 → 我查到或试过的方法 → 后来的变化。',
    words: ['今天他说', '我当时', '试了一下', '不一定适合每个孩子'], avoid: ['别让孩子输在', '正确的育儿', '医疗诊断'],
    samples: ['今天他说，妈妈你生气的时候，声音会变小，我更害怕。', '试了一下先蹲下来再说话，不一定适合每个孩子，但我们家有用。'],
  },
  {
    id: 'news', category: '热点资讯', icon: '📰', name: '热点快评博主', summary: '一分钟讲清发生了什么，分清事实和观点，再说一个别人没提的角度。',
    tone: '利落、中立，有判断但不带节奏。', sentences: '短句快节奏，时间和来源要明确，事实和观点分开说。',
    opening: '第一句话就说清发生了什么。', structure: '发生了什么 → 已确认的和还不确定的 → 为什么大家在吵 → 我的一个角度。',
    words: ['目前能确认的是', '还不确定', '来源', '我的看法是'], avoid: ['震惊', '细思极恐', '把传闻当事实'],
    samples: ['目前能确认的只有两件事，其他都还只是传闻。', '大家都在吵谁对谁错，我的看法是，先看合同第三条。'],
  },
]

/** 预设的英文版，字段和中文一一对应；id、分类和图标两种语言共用。 */
const PRESET_EN = {
  ai_tech: {
    name: 'AI tech creator', summary: 'Turns complex tech into one analogy you can follow, then tells you why it matters to you.',
    tone: 'Curious and clear-headed. Excited without the hype, and says so when a claim is unverified.', sentences: 'Mostly short sentences. Conclusion first, then the why. Every technical term is followed by a plain-English line.',
    opening: 'Open on something that just changed and say within three seconds why it\'s worth watching.', structure: 'What happened → the idea, through an analogy → what I saw when I tried it → what it means for regular people.',
    words: ['Put simply', 'I tried it', 'The key is', 'Which means'], avoid: ['game-changer', 'mind-blowing', 'insane', 'conclusions without testing'],
    samples: ['Put simply, it didn\'t get smarter. It finally remembers what you said a minute ago.', 'I tried it. The first ten minutes were impressive. By minute eleven it was making things up.'],
  },
  gadget: {
    name: 'Gadget reviewer', summary: 'No spec-sheet reading. Just what\'s great and what makes you want a refund after two weeks.',
    tone: 'Practical and a little picky, on the side of people spending their own money.', sentences: 'Numbers and experience come in pairs. Lots of comparisons, few adjectives.',
    opening: 'Lead with the verdict: who should buy it and who should not.', structure: 'One-line verdict → the best thing → the most annoying thing → versus last year or the competition → buying advice.',
    words: ['In my testing', 'battery life', 'worth it?', 'who should buy', 'who should skip'], avoid: ['flagship experience', 'punches above its weight', 'copying the marketing'],
    samples: ['In my testing it needed two charges a day. The thirty hours on the box only exist on the box.', 'If the one you have still works, you can skip this year.'],
  },
  travel: {
    name: 'Travel creator', summary: 'Not a checklist. It puts you in the place, then hands you the details that actually help.',
    tone: 'Relaxed and visual, honest about what went wrong.', sentences: 'Mix long and short. Write what you saw, heard and smelled, and make the practical details specific.',
    opening: 'Open on one specific moment, like the harbor at six in the morning.', structure: 'One moment → why I came → three places truly worth it → what went wrong → time and cost.',
    words: ['That day', 'locals', 'per person', 'book ahead', 'skip'], avoid: ['paradise on earth', 'once in a lifetime', 'hidden gem'],
    samples: ['At six that morning the harbor had no tourists, just fish being unloaded and a bowl of noodles too hot to eat.', 'About $15 a person, but skip the place by the entrance. Locals all head down the alley.'],
  },
  food: {
    name: 'Food reviewer', summary: 'What the first bite is like, whether it\'s worth the price and how long the line is, all spelled out.',
    tone: 'Hungry and honest. Praises what is good and says when it isn\'t.', sentences: 'Specific texture words, short punchy lines, and always the price and location.',
    opening: 'Open on the bite you want most.', structure: 'The signature bite → where, how much, how long the wait → must-order and skip → a one-line verdict.',
    words: ['this bite', 'per person', 'the line', 'skip it', 'would go back'], avoid: ['to die for', 'literally crying', 'praise without a verdict'],
    samples: ['The first bite is crackly, and the richness only comes through after.', 'About $8 a person and a forty-minute line. The food is worth it, the wait isn\'t. Go after two.'],
  },
  vlog: {
    name: 'Daily vlogger', summary: 'Like a friend carrying a camera through the day. Small, funny moments and a quiet feeling at the end.',
    tone: 'Warm and natural, happy to laugh at yourself, never stiff.', sentences: 'Conversational, like talking while walking. Lots of "then" and "turns out". Pauses are fine.',
    opening: 'Open with a small thing or a small surprise from today.', structure: 'Today\'s small surprise → the day in order → one small turn in the middle → one honest feeling at the end.',
    words: ['today', 'then', 'turns out', 'didn\'t expect', 'it was nice'], avoid: ['hey guys', 'lecturing', 'forced life lessons'],
    samples: ['I only went downstairs to grab a package. Turns out I sat out there for an hour.', 'Nothing big happened, but it was a nice day.'],
  },
  home: {
    name: 'Solo living creator', summary: 'Makes ordinary rooms and days feel comfortable, and tells you honestly what it cost.',
    tone: 'Quiet and gentle, with an unhurried, lived-in feel.', sentences: 'Short, light sentences about light, sound and habits. Hardly any exclamation marks.',
    opening: 'Open on a daily habit, like opening the window every morning.', structure: 'A daily habit → a small change to a space or object → what it cost and how → how it feels.',
    words: ['slowly', 'the light', 'while I\'m at it', 'cost me', 'just right'], avoid: ['aesthetic lifestyle', 'self-care ritual', 'selling insecurity'],
    samples: ['At four in the afternoon the light lands right on this table.', 'This table cost $40. Not much, but it got me eating at home again.'],
  },
  reading: {
    name: 'Book notes creator', summary: 'Not a summary of the book. One idea that changed your mind, turned into one thing you can do.',
    tone: 'Calm and sincere, about how a book won you over.', sentences: 'Start with a real-life problem, quote one line, then explain in short sentences.',
    opening: 'Open with a specific problem, then bring in the book.', structure: 'A problem I had → one idea from the book → an example → one thing to try today.',
    words: ['this book', 'that\'s when I realized', 'in other words', 'try this'], avoid: ['this book will change your life', 'packed with value', 'reciting the table of contents'],
    samples: ['On this page I realized I wasn\'t short on time. I just refused to give anything up.', 'In other words, decide what not to do first. You can try it today.'],
  },
  career: {
    name: 'Career creator', summary: 'Opinion first. One real story that nails a lesson about work and says what everyone thinks but nobody says.',
    tone: 'Direct and clear-eyed, a little sharp but never mean.', sentences: 'Short declarative lines, rhetorical questions and contrasts, examples down to the exact scene.',
    opening: 'Open by rejecting something everyone believes.', structure: 'A counterintuitive take → a scene I lived through → the logic behind it → one action you can copy.',
    words: ['Stop', 'The truth is', 'I\'ve seen', 'next meeting'], avoid: ['grind harder', 'fear-mongering', 'empty motivation'],
    samples: ['Stop saying you\'re bad at managing up. You\'ve been waiting for someone to notice you first.', 'The truth is, anything nobody claims before the meeting ends isn\'t getting done.'],
  },
  tutorial: {
    name: 'How-to creator', summary: 'Shows you the result first, then walks you through step by step, with where each step tends to go wrong.',
    tone: 'Patient and efficient, like a friend sitting next to you.', sentences: 'Short sentences that start with a verb. Clear steps, one thing per step.',
    opening: 'Show the finished result and the time it saves.', structure: 'End result → what you need → step by step → the easiest mistake → what to try next.',
    words: ['Step one', 'click here', 'careful', 'once you\'re done', 'saves'], avoid: ['it\'s easy', 'everyone knows this', 'skipping steps'],
    samples: ['Here\'s the result. What used to take two hours now takes three minutes.', 'Careful, don\'t click OK yet. Check the format in the top right first. That\'s where nine out of ten mistakes happen.'],
  },
  business: {
    name: 'Business explainer', summary: 'Starts from something odd, then works out where the money comes from, whether the math works and what you can learn.',
    tone: 'Calm and certain. Lets the numbers talk, no drama.', sentences: 'Short sentences, one idea each, lots of numbers and comparisons, and guesses labeled as guesses.',
    opening: 'Open with a strange number or fact.', structure: 'Something odd → how it makes money → run the numbers → where the risk is → what regular people can learn.',
    words: ['run the numbers', 'gross margin', 'in the end', 'the lesson is'], avoid: ['the next big thing', 'secret to wealth', 'guaranteed returns', 'investment advice'],
    samples: ['A $1.50 coffee and ten thousand stores. Let\'s run the numbers.', 'In the end it isn\'t making money on coffee. It\'s making money by spreading the rent thin.'],
  },
  beauty: {
    name: 'Beauty and skincare creator', summary: 'Says which skin types it suits, how long it takes to work and whether there is a cheaper dupe.',
    tone: 'Friendly and honest, like a friend telling you the truth.', sentences: 'Specific about feel and results, lots of "works for" and "not for", and every recommendation backed up.',
    opening: 'Open with a specific skin problem or a product that went wrong.', structure: 'My skin type and problem → what I used and for how long → real results → who should skip it → a dupe.',
    words: ['skin type', 'on the skin', 'after two weeks', 'not for', 'dupe'], avoid: ['miracle fix', 'overnight results', 'medical claims'],
    samples: ['Combination oily skin, two weeks in: less afternoon shine, but the bumps are unchanged.', 'Sensitive skin, hold off. Alcohol is high on the list and it stings a little.'],
  },
  outfit: {
    name: 'Fashion creator', summary: 'Not just "looks good": who it suits, how to style it and how many seasons you get out of it.',
    tone: 'Light and opinionated, with clear taste and no talking down.', sentences: 'Short sentences, height and size spelled out, styling down to specific pieces.',
    opening: 'Open with an occasion or a common fit problem.', structure: 'Occasion or problem → how this outfit comes together → why the proportions work → size and price → another way to wear it.',
    words: ['proportions', 'on me', 'for work', 'wear it many ways', 'swap in'], avoid: ['look ten pounds thinner', 'body shaming', 'must-buy'],
    samples: ['I\'m 5\'4" in a medium. Raising the waistline an inch fixes the proportions right away.', 'This works for the office, and with jeans on the weekend it still fits.'],
  },
  story: {
    name: 'Personal story creator', summary: 'Like a late-night talk with a friend, going from one small moment to something you finally understood.',
    tone: 'Relaxed and honest, willing to share the embarrassing parts, slow to judge.', sentences: 'Long and short lines mixed, natural pauses, lots of detail, few conclusions.',
    opening: 'Open on a specific time and place.', structure: 'A scene → what happened → what I didn\'t get at the time → the one line that made sense later.',
    words: ['That night', 'only later did I realize', 'actually', 'honestly'], avoid: ['if you know you know', 'life-coach voice', 'putting anyone down'],
    samples: ['At eleven that night we sat in the car and neither of us spoke first.', 'Only later did I realize she didn\'t want an answer. She wanted someone to hear her out.'],
  },
  parent: {
    name: 'Parenting creator', summary: 'Captures one thing a kid said and one small moment, then what the parent learned.',
    tone: 'Gentle and funny, not anxious, and never the one right answer.', sentences: 'Conversational short sentences. Keep the kid\'s own words, and make methods specific enough to try.',
    opening: 'Open with something your kid said.', structure: 'What the kid said → how I reacted → what I looked up or tried → what changed after.',
    words: ['Today he said', 'at the time I', 'I tried', 'may not work for every kid'], avoid: ['don\'t let your kid fall behind', 'the right way to parent', 'medical diagnoses'],
    samples: ['Today he said, "When you\'re angry your voice gets quiet, and that scares me more."', 'I tried crouching down before I talk. It may not work for every kid, but it works in our house.'],
  },
  news: {
    name: 'News commentary creator', summary: 'Explains what happened in a minute, separates fact from opinion, then adds an angle nobody mentioned.',
    tone: 'Crisp and neutral, with a view but no agenda.', sentences: 'Short, fast lines. Dates and sources are explicit, and facts and opinions are kept apart.',
    opening: 'Say what happened in the first sentence.', structure: 'What happened → what is confirmed and what isn\'t → why people are arguing → my angle.',
    words: ['What we know so far', 'still unclear', 'source', 'my take'], avoid: ['shocking', 'you won\'t believe', 'rumors as facts'],
    samples: ['Only two things are confirmed so far. Everything else is still rumor.', 'Everyone is arguing about who is right. My take: read clause three of the contract first.'],
  },
}

/** 预设里随语言变化的字段。分类是界面用来分组的键，保持中文。 */
export const PRESET_TEXT_FIELDS = ['name', 'summary', 'tone', 'sentences', 'opening', 'structure', 'words', 'avoid', 'samples', 'source']

/**
 * 某个预设在指定语言下的文字。
 * @param {string} id - 预设 id，带不带 preset_ 前缀都行。
 * @param {'zh'|'en'} lang - 语言。
 * @returns {object|null} 只含文字字段；不是内置预设时返回 null。
 */
export function presetText(id, lang) {
  const key = String(id).replace(/^preset_/, '')
  const row = STYLE_PRESETS.find(entry => entry.id === key)
  if (!row) return null
  const text = lang === 'en' ? { ...PRESET_EN[key], source: 'Preset' } : { ...row, source: '预设' }
  return Object.fromEntries(PRESET_TEXT_FIELDS.map(field => [field, text[field]]))
}

const DATE = new Date(2026, 0, 1).toISOString()

export function seedPresets(lang = 'zh') {
  return STYLE_PRESETS.map(row => ({ ...row, id: `preset_${row.id}`, source: '预设', preset: true, createdAt: DATE, ...(lang === 'en' ? presetText(row.id, 'en') : {}) }))
}

/** 旧版的三个模板换成新预设，正在用的也跟着换。 */
const OLD_TEMPLATES = { seed_style_calm: 'preset_business', seed_style_story: 'preset_story', seed_style_sharp: 'preset_career' }

export const PRESET_VERSION = 1

export function migratePresets(state) {
  if (state.presetVersion >= PRESET_VERSION) return state
  const kept = (state.styles ?? []).filter(row => !(row.id in OLD_TEMPLATES))
  const known = new Set(kept.map(row => row.id))
  state.styles = [...kept, ...seedPresets(state.sampleLang).filter(row => !known.has(row.id))]
  if (state.activeStyleId in OLD_TEMPLATES) state.activeStyleId = OLD_TEMPLATES[state.activeStyleId]
  state.presetVersion = PRESET_VERSION
  return state
}
