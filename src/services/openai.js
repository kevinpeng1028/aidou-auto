const OpenAI = require('openai');
const config = require('../config');
const { localRiskReview } = require('./risk');

const openaiApiKey = process.env.OPENAI_API_KEY || config.openaiApiKey;
const openaiBaseURL = process.env.OPENAI_BASE_URL || '';
const openaiModel = process.env.OPENAI_MODEL || config.openaiModel;

const clientOptions = openaiApiKey ? { apiKey: openaiApiKey } : null;
if (clientOptions && openaiBaseURL) {
  clientOptions.baseURL = openaiBaseURL;
}

const client = clientOptions ? new OpenAI(clientOptions) : null;

const FORBIDDEN_STYLE_WORDS = [
  '姐妹们',
  '啊啊啊',
  '呜呜呜',
  '美到失语',
  '甜到晕',
  '晕古七',
  '反复去世',
  '我直接喊老婆',
  '老婆嫁我',
  '谁懂啊',
  '我先磕为敬',
  '快来评论区',
  '点赞在看',
  '一起尖叫',
  '绝了',
  '封神',
  '鲨疯了',
  '神颜',
  '饭拍',
  '安利'
];

const FORBIDDEN_IMAGE_DETAILS = [
  '第一张',
  '第二张',
  '最后一张',
  '六宫格',
  '照片里',
  '图里',
  '怼脸拍',
  '全身照',
  '合照',
  '窗边',
  '阳光',
  '夕阳',
  '台阶',
  '棒球帽',
  '白T',
  '白色T恤',
  '蕾丝衬衫',
  '牛仔裤',
  '牛仔短裤',
  '马丁靴',
  '小扇子',
  '西瓜',
  '比耶',
  '梨涡',
  '下颌线',
  '鼻尖',
  '毛孔',
  '腿长两米八'
];

function getClient() {
  if (!client) {
    throw new Error('AI API Key 未配置，请检查 OPENAI_API_KEY');
  }
  return client;
}

function fallbackTopics(keyword) {
  return [
    { title: `${keyword}这组新动态，粉丝评论区已经开始加油了`, angle: '围绕公开动态、造型细节和粉丝应援氛围写一篇温柔向选题。' },
    { title: `${keyword}最近的状态感，真的很适合做今日份能量补给`, angle: '从舞台感、生活化瞬间和粉丝陪伴感切入。' },
    { title: `看完${keyword}的新图，想说这份努力感藏不住`, angle: '看图说话，避免夸张爆料，只写公开可见内容。' }
  ];
}

function fallbackArticle(keyword) {
  const title = `${keyword}这波状态，粉丝的加油声可以安排上了`;
  const markdown = `# ${title}\n\n今天刷到${keyword}的新动态，第一眼就是很舒服的清爽感。没有太多用力的表情，反而是那种自然站在镜头前、状态慢慢铺开的感觉，很适合做一份今日加油能量。\n\n看图最先注意到的是整体氛围：造型干净，动作也不抢戏，细节里有一种认真营业的稳定感。对粉丝来说，这种公开动态其实最能让人安心，不需要过度解读，只要看到他把工作和舞台一点点做好，就已经足够开心。\n\n评论区也很有画面感，大家一边夸状态，一边把“继续走花路”打得很整齐。追星有时候就是这样，被某个瞬间击中，然后把这份喜欢变成今天继续努力的理由。\n\n希望${keyword}接下来的公开行程顺顺利利，也希望大家理性看图、开心互动。你最喜欢这组动态里的哪个细节？评论区来聊聊。`;
  return { title, markdown };
}

function hasExplicitImageDescription(input) {
  return /(image_description|图片描述|图片说明|配图描述|照片描述|画面描述|图像描述)\s*[:：]/i.test(String(input || ''));
}

function normalizeArticlePayload(payload) {
  return {
    title: String(payload?.title || '').trim(),
    body: String(payload?.body || payload?.markdown || '').trim()
  };
}

function extractJsonObject(raw) {
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;

  try {
    return JSON.parse(candidate);
  } catch (error) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw error;
  }
}

function parseArticleResponse(raw) {
  return normalizeArticlePayload(extractJsonObject(raw));
}

function countBodyChars(body) {
  return Array.from(String(body || '').replace(/\s/g, '')).length;
}

function validateArticleDraft(draft, sourceInput) {
  const errors = [];
  const title = String(draft?.title || '').trim();
  const body = String(draft?.body || '').trim();
  const compactBody = body.replace(/\s/g, '');

  if (!title) errors.push('缺少 title 字段');
  if (!body) errors.push('缺少 body 字段');

  const bodyLength = countBodyChars(body);
  if (body && (bodyLength < 300 || bodyLength > 420)) {
    errors.push(`正文长度为 ${bodyLength} 字，必须控制在 300-420 字`);
  }

  const styleHits = FORBIDDEN_STYLE_WORDS.filter((word) => body.includes(word));
  if (styleHits.length) {
    errors.push(`正文包含禁止饭圈化词语：${styleHits.join('、')}`);
  }

  if (!hasExplicitImageDescription(sourceInput)) {
    const detailHits = FORBIDDEN_IMAGE_DETAILS.filter((word) => body.includes(word));
    if (detailHits.length) {
      errors.push(`未提供图片描述，但正文包含具体画面词：${detailHits.join('、')}`);
    }
  }

  if (body.includes('#')) {
    errors.push('正文包含 Markdown 标题符号或 hashtag 符号 #');
  }

  if (/(^|\s)#[\p{L}\p{N}_-]+/u.test(body)) {
    errors.push('正文包含微博/小红书式 hashtag');
  }

  if (title && compactBody.includes(title.replace(/\s/g, ''))) {
    errors.push('正文重复标题');
  }

  const emojiCount = (body.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emojiCount > 2) {
    errors.push('emoji 过多');
  }

  if (body.slice(-120).includes('素材来源')) {
    errors.push('正文结尾包含“素材来源”');
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function buildArticleMessages(keyword, previousErrors = []) {
  const retryInstruction = previousErrors.length
    ? [
        '',
        '上一次生成未通过检查，违规原因如下：',
        ...previousErrors.map((error) => `- ${error}`),
        '请完全重写，不要局部修补。'
      ].join('\n')
    : '';

  return [
    {
      role: 'system',
      content: [
        '你是中文微信公众号编辑，写“爱豆状态观察”类短文。文章要像真实公众号，不像微博、小红书，也不要像 AI 通稿。',
        '核心任务：根据用户输入生成一篇克制、自然、有审美判断的爱豆状态观察。多写状态、气质、风格变化和整体观感，保留轻微粉丝感，但不能写成饭圈尖叫文。',
        '',
        '硬性禁止编造规则：',
        '1. 如果输入里没有明确 image_description 或图片描述，禁止写任何具体画面。',
        '2. 禁止自行添加服装、动作、道具、场景、光线、表情、成员互动、时间、地点。',
        '3. 禁止写“照片里”“那张”“第一张”“第二张”“最后一张”“六宫格”等具体图片描述。',
        '4. 禁止写未经输入提供的信息：西瓜、白T、白色T恤、蕾丝衬衫、牛仔裤、牛仔短裤、短裤、小扇子、阳光、夕阳、台阶、棒球帽、比耶、合照、成员合照、怼脸拍、全身照、窗边、马丁靴、梨涡、下颌线、鼻尖、毛孔、腿长两米八。',
        '5. 如果只收到关键词，只能使用安全表达：这次更新、这组近照、这组图、状态、气质、风格、账号观察、整体观感。',
        '',
        '硬性禁止口吻：',
        '禁止使用：姐妹们、啊啊啊、呜呜呜、美到失语、甜到晕、晕古七、反复去世、我直接喊老婆、老婆嫁我、谁懂啊、我先磕为敬、快来评论区、点赞在看、一起尖叫、绝了、封神、鲨疯了、神颜、饭拍、安利、嘿嘿。',
        '禁止使用微博/小红书 hashtag。禁止硬性互动 CTA。不要堆叠感叹号。',
        '',
        '硬性输出格式：',
        '只输出 JSON 对象：{"title":"标题","body":"正文"}。',
        'title 放标题；body 只放正文，不要重复标题。正文不要出现 Markdown 标题符号 #。正文 300-420 字，短段落，适合微信公众号阅读。',
        '',
        '生成前自检：',
        '在最终输出前，检查正文是否出现任何违禁词、违禁细节、Markdown 标题符号、hashtag、硬性互动 CTA、重复标题、emoji 过多、“素材来源”，或任何未经用户输入确认的具体画面。只要出现，必须重写正文后再输出。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `请根据关键词“${keyword}”生成一篇“${config.brandName}”风格公众号文章。`,
        '',
        '生成方向：',
        '- 写成“爱豆状态观察”，不是饭圈尖叫文。',
        '- 用审美观察写法，多写状态、气质、风格变化和整体观感。',
        '- 如果关键词里没有明确 image_description 或图片描述，不要写任何具体画面、服装、动作、道具、场景、光线、表情或成员互动。',
        '- 开头直接进入观察，不要用微博/小红书式口吻。',
        '- 结尾要有余味，可以是状态判断、气质总结或读者共鸣，不要硬互动。',
        '- 避开未证实恋情、爆料、引战、身体羞辱、整容猜测、私生活攻击。',
        '',
        '再次强调：body 字段只能是正文，不要重复标题，不要 #，不要 hashtag，不要“素材来源”。',
        retryInstruction
      ].filter(Boolean).join('\n')
    }
  ];
}

async function generateArticleOnce(aiClient, keyword, previousErrors) {
  const response = await aiClient.chat.completions.create({
    model: openaiModel,
    temperature: 0.75,
    messages: buildArticleMessages(keyword, previousErrors),
    response_format: { type: 'json_object' }
  });

  const raw = response.choices[0]?.message?.content || '{}';
  return parseArticleResponse(raw);
}

async function generateTopics(keyword) {
  const aiClient = getClient();

  const response = await aiClient.chat.completions.create({
    model: openaiModel,
    temperature: 0.8,
    messages: [
      { role: 'system', content: '你是微信公众号选题编辑，只写公开、低风险、粉丝友好的韩流/爱豆内容选题。输出 JSON 对象：{"topics":[{"title":"...","angle":"..."}]}。' },
      { role: 'user', content: `基于关键词“${keyword}”生成 5 个“${config.brandName}”候选选题。标题有点击感但不能造假夸张，不涉及未证实恋情、爆料、攻击、整容或身体羞辱。` }
    ],
    response_format: { type: 'json_object' }
  });

  const raw = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.topics || fallbackTopics(keyword);
}

async function generateArticle(keyword) {
  const aiClient = getClient();
  let validationErrors = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let draft;
    try {
      draft = await generateArticleOnce(aiClient, keyword, validationErrors);
    } catch (error) {
      validationErrors = ['模型输出不是有效 JSON，必须返回 {"title":"...","body":"..."}'];
      continue;
    }

    const validation = validateArticleDraft(draft, keyword);
    if (validation.ok) {
      return { title: draft.title, markdown: draft.body };
    }

    validationErrors = validation.errors;
  }

  const error = new Error('文章未通过事实与风格检查，请人工修改或补充图片描述');
  error.validationErrors = validationErrors;
  throw error;
}

async function auditArticle(markdown) {
  const local = localRiskReview(markdown);
  if (!client) return local;

  const response = await client.chat.completions.create({
    model: openaiModel,
    temperature: 0.2,
    messages: [
      { role: 'system', content: '你是微信公众号内容安全审核员。输出 JSON：score 0-100, allowed boolean, report markdown, hits array。低于 85 不允许创建草稿。' },
      { role: 'user', content: `审核以下文章，重点检查未证实恋情、爆料、辱骂、人身攻击、粉圈引战、身体羞辱、整容猜测、政治敏感、私生活攻击、未成年人擦边。\n\n${markdown}` }
    ],
    response_format: { type: 'json_object' }
  });

  const raw = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  return {
    score: Number(parsed.score || local.score),
    allowed: Boolean(parsed.allowed ?? local.allowed),
    report: parsed.report || local.report,
    hits: parsed.hits || local.hits
  };
}

module.exports = { generateTopics, generateArticle, auditArticle };
