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
      { role: 'system', content: '你是爱豆公众号编辑。写作像真实粉丝向公众号，不要新闻通稿腔，不要 AI 套话。只写公开动态和看图说话，不造谣。' },
      { role: 'user', content: `请根据关键词“${keyword}”生成一篇 300-400 字“${config.brandName}”风格公众号文章。要求：标题有点击感但不夸张造假；多粉丝感表达；包含评论互动引导；避开未证实恋情、爆料、引战、身体羞辱、整容猜测、私生活攻击。输出 JSON：{"title":"...","markdown":"# 标题\\n\\n正文..."}` }
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
