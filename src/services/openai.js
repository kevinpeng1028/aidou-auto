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

  const response = await aiClient.chat.completions.create({
    model: openaiModel,
    temperature: 0.75,
    messages: [
      {
        role: 'system',
        content: [
          '你是中文爱豆微信公众号编辑，写“爱豆状态观察”类短文。',
          '文章要像真实公众号短文：自然、有审美判断、有轻微粉丝感，但不过度尖叫，不像微博、小红书，也不要像 AI 通稿。',
          '必须严格基于用户输入。用户只给关键词、没有提供图片描述时，绝对不要编造任何具体图片画面、时间、地点、成员互动或穿搭细节。',
          '不要写未经输入确认的细节，例如：第一张、第二张、六宫格、合照、夕阳、台阶、棒球帽、白T、牛仔裤、比耶。',
          '没有图片描述时，只能使用“这次更新”“这组近照”“这组图”等模糊表达，并围绕气质、状态、风格、账号观察来写。',
          '禁用或尽量避免这些词：啊啊啊、姐妹们、呜呜呜、嘿嘿、美到失语、氛围感拉满、绝了、封神、鲨疯了。',
          '每篇最多使用 1 个轻微情绪词，不要堆叠感叹号。',
          '正文里不要出现 Markdown 标题符号 #，不要生成 hashtag，不要写机械 CTA，例如“点赞在看”“快来评论区告诉我”。',
          '输出必须是 JSON 对象：{"title":"标题","markdown":"正文"}。title 单独放标题；markdown 只放正文，不要重复标题。'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          `请根据关键词“${keyword}”生成一篇“${config.brandName}”风格公众号文章。`,
          '',
          '写作要求：',
          '- 标题有点击感，但不夸张、不造假。',
          '- 正文 300-450 字，短段落，适合微信公众号阅读。',
          '- 开头直接进入观察，不要用“姐妹们”“就在刚刚”这类过度口语开场。',
          '- 如果输入里没有明确图片描述，不要写任何具体画面和穿搭，只写状态、气质、风格和整体观感。',
          '- 语气克制，有一点粉丝视角，但不要饭圈尖叫。',
          '- 结尾留一点余味，可以是状态判断、气质总结或读者共鸣，不要硬性互动。',
          '- 避开未证实恋情、爆料、引战、身体羞辱、整容猜测、私生活攻击。',
          '',
          '输出 JSON：{"title":"...","markdown":"正文，不含 #，不含标题，不含 hashtag"}'
        ].join('\n')
      }
    ],
    response_format: { type: 'json_object' }
  });

  const raw = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  return parsed.title && parsed.markdown ? parsed : fallbackArticle(keyword);
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
