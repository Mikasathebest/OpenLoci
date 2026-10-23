import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export function renderMarkdown(body: string) {
  return sanitizeHtml(marked.parse(body, { async: false }), {
    allowedTags: ['p', 'br', 'strong', 'em', 'del', 'blockquote', 'code', 'pre', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['https', 'http', 'mailto'], allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noreferrer noopener' }) },
  });
}
export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
