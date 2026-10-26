import { escapeHtml as esc, renderMarkdown } from './rendering.js';
import { type StoredRecord, type MemoryQuery } from './core.js';
import { displayDate, languageNames, locales, messages, type Locale } from './i18n.js';
import type { CustomPage } from './custom-pages.js';
import { sidebar, dialogs, customRecords, customScript } from './custom-ui.js';
import { pageCopy } from './page-copy.js';
import { domainTypes as types } from './domain-service.js';

export function languageSwitcher(locale: Locale, parameters: Record<string, string> = {}) {
  const t = messages[locale];
  const hidden = Object.entries(parameters).filter(([key]) => key !== 'lang').map(([key, value]) => `<input type="hidden" name="${esc(key)}" value="${esc(value)}">`).join('');
  return `<form class="language-switch" method="get">${hidden}<label for="language">${t.language}<select id="language" name="lang">${locales.map(value => `<option value="${value}" lang="${value}" ${value === locale ? 'selected' : ''}>${languageNames[value]}</option>`).join('')}</select></label><button class="secondary" type="submit">${t.apply}</button></form>`;
}

function documentStart(locale: Locale, title: string) {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · OpenLoci</title><link rel="stylesheet" href="/assets/style.css"></head><body>`;
}
function script(locale: Locale) { return `<script src="/assets/app.js?lang=${locale}" defer></script>`; }

export function page(records: StoredRecord[], query: MemoryQuery, backend: string, errorCount: number, locale: Locale = 'en', context: { pages?: CustomPage[]; currentPage?: CustomPage } = {}) {
  const t = messages[locale];
  const c = pageCopy[locale], currentPage = context.currentPage;
  const parameters = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  const link = (parameters: Record<string, string> = {}) => (currentPage ? `/pages/${currentPage.id}?` : '/?') + new URLSearchParams({ lang: locale, ...parameters }).toString();
  const recordLink = (id: string) => `/records/${id}?lang=${locale}`;
  const options = types.map(type => `<option value="${type}" ${query.type === type ? 'selected' : ''}>${t.types[type]}</option>`).join('');
  return `${documentStart(locale, currentPage?.title || t.personalMemory)}<div class="shell">${sidebar(context.pages || [], locale, backend, query.type, currentPage?.id)}
<main><div class="topbar">${languageSwitcher(locale, parameters)}</div><header><div><p class="eyebrow">${t.eyebrow}</p><h1>${currentPage ? esc(currentPage.title) : query.type ? t.types[query.type] : t.headline}</h1><div class="muted prose page-description">${currentPage ? renderMarkdown(currentPage.description) : t.introduction}</div></div><a class="button" href="#capture">+ ${currentPage ? c.addEntry : t.addMemory}</a></header>
${errorCount ? `<p class="notice">${t.validationNotice.replace('{count}', String(errorCount))}</p>` : ''}
<form class="filters" method="get"><input type="hidden" name="lang" value="${locale}"><label>${t.search}<input name="q" placeholder="${t.searchPlaceholder}" value="${esc(query.q || '')}"></label><label>${t.type}<select name="type"><option value="">${t.allTypes}</option>${options}</select></label><label>${t.from}<input type="date" name="from" value="${query.from || ''}"></label><label>${t.to}<input type="date" name="to" value="${query.to || ''}"></label><button>${t.search}</button></form>
<div class="workspace"><section class="timeline" aria-label="${t.timeline}"><div class="section-title"><h2>${query.q ? t.searchResults : currentPage ? c[currentPage.layout] : t.timeline}</h2><span>${records.length} ${t.shown}</span></div>
${currentPage ? customRecords(records, currentPage, locale) : records.length ? records.map(item => `<article><div class="record-meta"><span class="badge">${t.types[item.record.type]}</span><time datetime="${item.record.date}">${displayDate(item.record.date, locale)}</time>${item.record.source.kind === 'import' ? `<span>${t.imported}</span>` : ''}${item.record.sensitivity === 'restricted' ? `<span>${t.restricted}</span>` : ''}</div><h3><a href="${recordLink(item.record.id)}">${esc(item.record.title)}</a></h3><div class="prose">${renderMarkdown(item.record.body.slice(0, 1500))}</div><a class="quiet" href="${recordLink(item.record.id)}">${t.openRecord} →</a></article>`).join('') : `<div class="empty"><h3>${t.emptyTitle}</h3><p>${t.emptyBody}</p></div>`}
${records.length === query.limit ? `<a class="quiet" href="${esc(link({ ...parameters, offset: String(query.offset + query.limit) }))}">${t.nextPage} →</a>` : ''}</section>
<div><section class="capture" id="capture"><p class="eyebrow">${t.captureEyebrow}</p><h2>${currentPage ? c.addEntry : t.addMemory}</h2><form id="capture-form">${currentPage ? `<input type="hidden" name="type" value="journal"><input type="hidden" name="page_id" value="${currentPage.id}">` : `<label>${t.type}<select name="type">${options}</select></label>`}<label>${t.title}<input name="title" required maxlength="500" placeholder="${t.titlePlaceholder}"></label><label>${t.date}<input type="date" name="date" required></label><label>${t.notes}<textarea name="body" rows="6" placeholder="${t.notesPlaceholder}"></textarea></label>${currentPage ? '<input type="hidden" name="attributes" value="{}">' : `<label>${t.attributes}<textarea name="attributes" rows="3" placeholder='{"duration_seconds": 1800}'>{}</textarea></label><small>${t.expenseHelp}</small>`}<button type="submit">${t.saveMemory}</button><p id="capture-status" role="status"></p></form></section>
<section class="integrations"><h2>${t.sources}</h2><p class="muted">${t.sourceDescription}</p><button id="integration-status" class="secondary">${t.checkSetup}</button><p id="integration-result" role="status"></p><small>${t.signInHelp}</small></section></div></div>
<footer>${t.footer}</footer></main></div>${dialogs(locale)}${script(locale)}</body></html>`;
}

export function recordPage(item: StoredRecord, locale: Locale = 'en', context: { pages?: CustomPage[]; currentPage?: CustomPage; backend?: string } = {}) {
  const t = messages[locale];
  const parent = context.currentPage;
  return `${documentStart(locale, item.record.title)}<div class="shell">${sidebar(context.pages || [], locale, context.backend || 'sqlite', undefined, parent?.id)}<main class="detail"><div class="topbar">${languageSwitcher(locale)}</div><a class="quiet" href="${parent ? `/pages/${parent.id}?lang=${locale}` : `/?lang=${locale}`}">← ${parent ? esc(parent.title) : t.allMemories}</a><p class="record-meta">${t.types[item.record.type]} · <time datetime="${item.record.date}">${displayDate(item.record.date, locale)}</time> · ${esc(item.record.timezone)}</p><h1>${esc(item.record.title)}</h1><div class="prose">${renderMarkdown(item.record.body)}</div><h2>${t.attributes}</h2><pre>${esc(JSON.stringify(item.record.attributes, null, 2))}</pre><p class="muted">${esc(item.path)}<br>${t.revision}: ${item.hash}</p></main></div>${dialogs(locale)}${script(locale)}</body></html>`;
}

export function browserScript(locale: Locale = 'en') {
  const t = messages[locale];
  // External script only, with text encoded as data; no inline event handlers or HTML injection.
  return `
const locale = ${JSON.stringify(locale)};
const t = ${JSON.stringify({ invalidAttributes: t.invalidAttributes, saveFailed: t.saveFailed, transportConnected: t.transportConnected, enabled: t.enabled, disabled: t.disabled, needs: t.needs, noConnections: t.noConnections, statusFailed: t.statusFailed })};
document.querySelector('#language')?.addEventListener('change', event => event.target.form.requestSubmit());
const form = document.querySelector('#capture-form');
if (form) {
  const date = form.querySelector('[name=date]');
  const now = new Date(); date.value = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
  form.addEventListener('submit', async event => {
    event.preventDefault(); const status = document.querySelector('#capture-status');
    const button = form.querySelector('button'); button.disabled = true;
    try {
      const input = Object.fromEntries(new FormData(form));
      try { input.attributes = JSON.parse(input.attributes); if (!input.attributes || typeof input.attributes !== 'object' || Array.isArray(input.attributes)) throw new Error(); }
      catch { throw new Error(t.invalidAttributes); }
      const response = await fetch('/api/records?lang=' + locale, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input)});
      const result = await response.json(); if (!response.ok) throw new Error(result.error || t.saveFailed);
      location.href = input.page_id ? '/pages/' + input.page_id + '?lang=' + locale : '/records/' + encodeURIComponent(result.record.id) + '?lang=' + locale;
    } catch (error) { status.textContent = error.message || t.saveFailed; button.disabled = false; }
  });
}
document.querySelector('#integration-status')?.addEventListener('click', async () => {
  const output = document.querySelector('#integration-result');
  try { const response = await fetch('/api/integrations?lang=' + locale); if(!response.ok) throw new Error(); const data = await response.json();
    const visible = data.filter(server => server.id === 'notion' || server.connected || !server.missingEnv.length);
    output.textContent = visible.length ? visible.map(server => server.id + ': ' + (server.connected ? t.transportConnected : server.enabled ? t.enabled : t.disabled)).join(' · ') : t.noConnections;
  } catch { output.textContent = t.statusFailed; }
});
${customScript(locale)}
`;
}
