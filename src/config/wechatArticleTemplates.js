'use strict';

const defaultWechatArticleTemplate = {
  id: 'default-wechat-clean',
  name: '默认微信清爽排版',
  source: 'system_default',
  enabled: true,
  styles: {
    wrapper: 'margin:0;padding:0;',
    paragraph: 'font-size:16px;line-height:1.9;letter-spacing:0.5px;color:#333333;margin:0 0 18px;text-align:justify;',
    intro: 'font-size:16px;line-height:1.9;color:#333333;margin:0 0 20px;font-weight:normal;',
    image: 'width:100%;max-width:100%;display:block;margin:18px auto;border-radius:6px;',
    caption: 'font-size:13px;line-height:1.6;color:#999999;text-align:center;margin:-6px 0 18px;',
    strong: 'font-weight:600;color:#333333;'
  },
  html: '{{BODY_PARAGRAPHS}}'
};

const templates = [defaultWechatArticleTemplate];

function getEnabledTemplates() {
  return templates.filter((template) => template.enabled);
}

function getTemplateById(templateId) {
  if (!templateId) return null;
  return templates.find((template) => template.id === templateId) || null;
}

function getDefaultTemplate() {
  return getEnabledTemplates()[0] || defaultWechatArticleTemplate;
}

module.exports = {
  defaultWechatArticleTemplate,
  templates,
  getEnabledTemplates,
  getTemplateById,
  getDefaultTemplate
};
