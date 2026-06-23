const blockedImageTerms = [
  'audition', 'apply', 'recruit', 'recruitment', 'trainee', 'casting', 'global audition',
  'academy', 'banner', 'header', 'footer', 'logo', 'icon', 'ad', 'advertisement',
  'promo', 'promotion', 'event banner', 'apply now',
  '오디션', '지원', '모집', '연습생', '캐스팅', '배너', '광고', '프로모션', '지원하기', '참가', '공고',
  '招募', '练习生', '選秀', '选秀', '报名', '報名', '申请', '申請', '广告', '廣告', '横幅', '橫幅', '宣传图', '宣傳圖'
];

const blockedPageTerms = [
  'audition', 'apply', 'recruit', 'recruitment', 'trainee', 'casting', 'careers', 'academy',
  'notice', 'event', 'shop', 'merch', 'ticket', 'login', 'signup', 'app download',
  '오디션', '지원', '모집', '연습생', '캐스팅', '공지', '이벤트', '쇼핑', '티켓', '로그인'
];

function normalizeText(value = '') {
  return String(value || '').toLowerCase();
}

function includesBlockedTerm(value, terms = blockedImageTerms) {
  const text = normalizeText(value);
  return terms.find((term) => text.includes(normalizeText(term))) || '';
}

function imageText(image = {}, pageTitle = '') {
  return [
    image.original_url,
    image.url,
    image.image_alt,
    image.alt,
    image.image_caption,
    image.caption,
    image.surrounding_text,
    image.image_description,
    pageTitle
  ].filter(Boolean).join(' ');
}

function sourcePageText(input = {}) {
  return [
    input.source_url,
    input.url,
    input.title,
    input.original_title,
    input.content,
    input.snippet,
    input.source_summary,
    input.original_excerpt
  ].filter(Boolean).join(' ');
}

function rejectImageByText(image = {}, pageTitle = '') {
  const term = includesBlockedTerm(imageText(image, pageTitle), blockedImageTerms);
  if (!term) return null;
  if (['banner', 'event banner', '横幅', '橫幅', '배너'].includes(term)) return 'banner_or_header_image';
  if (['logo', 'icon', 'header', 'footer'].includes(term)) return 'logo_icon_or_layout_image';
  if (['ad', 'advertisement', 'promo', 'promotion', '广告', '廣告', '宣传图', '宣傳圖', '광고', '프로모션'].includes(term)) return 'ad_or_promo_image';
  return 'audition_apply_recruitment_image';
}

function rejectSourcePage(input = {}) {
  const term = includesBlockedTerm(sourcePageText(input), blockedPageTerms);
  if (!term) return null;
  if (/audition|apply|recruit|trainee|casting|academy|오디션|지원|모집|연습생|캐스팅/i.test(term)) {
    return 'non_idol_audition_or_recruitment_page';
  }
  return 'non_idol_notice_event_shop_or_login_page';
}

function rejectByMetadata(metadata = {}) {
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height) return null;
  if (width < 300 || height < 300) return 'logo_icon_too_small';
  if (width < 500 || height < 300) return 'image_too_small';
  if (width / height > 3.2) return 'banner_aspect_ratio';
  return null;
}

function containsSubject(text = '', candidate = {}) {
  const normalized = normalizeText(text);
  return [candidate.idol_name, candidate.group_name, candidate.keyword]
    .filter(Boolean)
    .some((value) => normalized.includes(normalizeText(value)));
}

function scoreImageCandidate(image = {}, candidate = {}, pageTitle = '') {
  const rejectReason = rejectImageByText(image, pageTitle);
  if (rejectReason) {
    return { score: 0, usable: false, rejectReason };
  }

  const descriptiveText = [image.image_alt, image.image_caption, image.caption, image.surrounding_text, image.image_description].filter(Boolean).join(' ');
  const pageText = [pageTitle, candidate.title, candidate.source_summary].filter(Boolean).join(' ');
  if (containsSubject(descriptiveText, candidate)) return { score: 95, usable: true, rejectReason: '' };
  if (containsSubject(pageText, candidate) && String(image.usage_hint || '').includes('inline')) return { score: 85, usable: true, rejectReason: '' };
  if (containsSubject(pageText, candidate) && String(image.usage_hint || '').includes('cover')) return { score: 72, usable: false, rejectReason: 'og_image_without_person_context' };
  return { score: 55, usable: false, rejectReason: 'image_subject_uncertain' };
}

module.exports = {
  blockedImageTerms,
  blockedPageTerms,
  rejectImageByText,
  rejectSourcePage,
  rejectByMetadata,
  scoreImageCandidate
};
