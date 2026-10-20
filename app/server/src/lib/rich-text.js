// Làm sạch HTML rich-text bằng sanitize-html (thay bộ lọc regex của bản cũ).
const sanitize = require('sanitize-html');

const MAX_RAW_BYTES = 1024 * 1024;
const MAX_HTML_BYTES = 200 * 1024;
const OPTIONS = {
  allowedTags: ['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
    'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'span'],
  allowedAttributes: { a: ['href', 'title'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], span: ['data-mention'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: { a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
  disallowedTagsMode: 'discard',
};
OPTIONS.allowedAttributes.a.push('rel', 'target');

function richTextError(message) { const e = new Error(message); e.status = 422; e.code = 'INVALID_RICH_TEXT'; return e; }

function sanitizeHtml(input) {
  if (input == null) return '';
  if (typeof input !== 'string') throw richTextError('Nội dung phải là chuỗi');
  if (Buffer.byteLength(input, 'utf8') > MAX_RAW_BYTES) throw richTextError('Nội dung vượt giới hạn 1 MB');
  const out = sanitize(input, OPTIONS).trim();
  if (Buffer.byteLength(out, 'utf8') > MAX_HTML_BYTES) throw richTextError('Nội dung sau làm sạch vượt 200 KB');
  return out;
}
function htmlToText(html) {
  return sanitize(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h3|h4|tr)>/gi, '\n'), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Lấy danh sách @username được nhắc trong văn bản.
function mentions(text) {
  return [...new Set([...String(text || '').matchAll(/(?:^|[\s(])@([a-z0-9._-]{3,50})/gi)].map(m => m[1].toLowerCase()))];
}

module.exports = { sanitizeHtml, htmlToText, mentions, MAX_HTML_BYTES };
