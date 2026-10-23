import { escapeHtml as esc, renderMarkdown } from './rendering.js';
import { types, type StoredRecord } from './core.js';
import { type CustomPage, pageLayouts } from './custom-pages.js';
import { messages, displayDate, type Locale } from './i18n.js';
import { pageCopy } from './page-copy.js';

export function sidebar(pages: CustomPage[], locale: Locale, backend: string, activeType?: string, activePage?: string) {
  const t = messages[locale], c = pageCopy[locale];
  return `<aside><a class="brand" href="/?lang=${locale}">OpenLoci<span>${t.personalMemory}</span></a>
<nav aria-label="${t.recordTypes}"><a href="/?lang=${locale}" ${!activeType && !activePage ? 'aria-current="page"' : ''}>${t.allMemories}</a>${types.map(type => `<a href="/?type=${type}&amp;lang=${locale}" ${activeType === type && !activePage ? 'aria-current="page"' : ''}>${t.types[type]}</a>`).join('')}</nav>
<div class="custom-navigation"><p class="eyebrow">${c.yourPages}</p><nav aria-label="${c.yourPages}">${pages.map(page => `<a href="/pages/${page.id}?lang=${locale}" ${activePage === page.id ? 'aria-current="page"' : ''}>${esc(page.title)}</a>`).join('')}</nav><button type="button" id="new-page" class="more-button" aria-haspopup="dialog">+ ${c.more}</button></div>
<div class="sidebar-tools"><button type="button" data-import-source="notion" class="secondary">${c.importNotion}</button><button type="button" data-import-source="google-calendar" class="secondary">${c.importGoogle}</button></div>
<div class="storage"><span class="dot"></span> ${esc(backend)} ${t.databaseConnected}<br><small>${t.vault} · v0.1</small></div></aside>`;
}

export function dialogs(locale: Locale) {
  const t = messages[locale], c = pageCopy[locale];
  return `<dialog id="page-dialog" aria-labelledby="page-dialog-title"><div class="dialog-heading"><h2 id="page-dialog-title">${c.createPage}</h2><button type="button" id="close-page" class="secondary">${c.cancel}</button></div><form id="page-form"><label>${c.pageTitle}<input name="title" required maxlength="120" placeholder="${c.titlePlaceholder}"></label><label>${c.pageDescription}<textarea name="description" rows="3" maxlength="4000" placeholder="${c.descriptionPlaceholder}"></textarea></label><fieldset><legend>${c.layout}</legend><div class="layout-options">${pageLayouts.map((layout, i) => `<label class="layout-option"><input type="radio" name="layout" value="${layout}" ${i === 0 ? 'checked' : ''}><span class="layout-preview preview-${layout}" aria-hidden="true"><i></i><i></i><i></i></span><strong>${c[layout]}</strong><small>${c[`${layout}Help`]}</small></label>`).join('')}</div></fieldset><p id="page-status" role="status"></p><button type="submit">${c.create}</button></form></dialog>
<dialog id="import-dialog" aria-labelledby="import-dialog-title"><div class="dialog-heading"><h2 id="import-dialog-title">${c.importTitle}</h2><button type="button" id="close-import" class="secondary">${c.cancel}</button></div><p>${c.importHelp}</p><p class="muted" id="import-help"></p><form id="import-form"><div class="import-dates"><label>${t.from}<input type="date" name="from" required></label><label>${t.to}<input type="date" name="to" required></label></div><button type="submit">${c.preview}</button></form><p id="import-status" role="status" aria-live="polite"></p><a id="calendar-connect" class="quiet" href="https://calendar.notion.so/" target="_blank" rel="noopener noreferrer" hidden>${c.openNotion} →</a><div id="import-warnings" class="notice" hidden></div><section id="import-results" hidden><label class="select-all"><input type="checkbox" id="import-all" checked>${c.selectAll}</label><div id="import-records"></div><button id="import-save" type="button">${c.saveSelected}</button></section></dialog>`;
}

export function customRecords(records: StoredRecord[], page: CustomPage, locale: Locale) {
  const t = messages[locale], c = pageCopy[locale];
  if (!records.length) return `<div class="empty"><h3>${c.emptyTitle}</h3><p>${c.emptyHelp}</p></div>`;
  if (page.layout === 'table') return `<div class="record-table"><table><caption>${esc(page.title)}</caption><thead><tr><th>${t.date}</th><th>${t.title}</th><th>${t.notes}</th></tr></thead><tbody>${records.map(item => `<tr><td><time datetime="${item.record.date}">${displayDate(item.record.date, locale)}</time></td><td><a href="/records/${item.record.id}?lang=${locale}">${esc(item.record.title)}</a></td><td>${esc(item.record.body.slice(0, 180))}</td></tr>`).join('')}</tbody></table></div>`;
  if (page.layout === 'checklist') return `<div id="custom-checklist" data-page-id="${page.id}">${records.map(item => `<article class="check-item ${item.record.attributes.completed === true ? 'completed' : ''}"><input type="checkbox" data-record-id="${item.record.id}" data-hash="${item.hash}" aria-label="${c.completed}: ${esc(item.record.title)}" ${item.record.attributes.completed === true ? 'checked' : ''}><div><a class="check-title" href="/records/${item.record.id}?lang=${locale}">${esc(item.record.title)}</a><p class="record-meta"><time datetime="${item.record.date}">${displayDate(item.record.date, locale)}</time></p><div class="prose">${renderMarkdown(item.record.body.slice(0, 500))}</div></div></article>`).join('')}<p id="checklist-status" role="status"></p></div>`;
  return records.map(item => `<article><p class="record-meta"><time datetime="${item.record.date}">${displayDate(item.record.date, locale)}</time></p><h3><a href="/records/${item.record.id}?lang=${locale}">${esc(item.record.title)}</a></h3><div class="prose">${renderMarkdown(item.record.body.slice(0, 1500))}</div><a class="quiet" href="/records/${item.record.id}?lang=${locale}">${t.openRecord} →</a></article>`).join('');
}

export function customScript(locale: Locale) {
  return `
const c = ${JSON.stringify(pageCopy[locale])};
const pageDialog = document.querySelector('#page-dialog');
document.querySelector('#new-page')?.addEventListener('click', () => pageDialog.showModal());
document.querySelector('#close-page')?.addEventListener('click', () => pageDialog.close());
document.querySelector('#page-form')?.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[type=submit]'); button.disabled = true;
  try {
    const response = await fetch('/api/pages?lang=' + locale, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    const data = await response.json(); if(!response.ok) throw new Error(data.error || c.pageFailed);
    location.href = '/pages/' + data.page.id + '?lang=' + locale;
  } catch(error) { document.querySelector('#page-status').textContent = error.message || c.pageFailed; button.disabled = false; }
});
document.querySelector('#custom-checklist')?.addEventListener('change', async event => {
  const checkbox = event.target; if(!checkbox.matches('input[data-record-id]')) return;
  checkbox.disabled = true; const status = document.querySelector('#checklist-status'); status.textContent = '';
  try {
    const pageId = event.currentTarget.dataset.pageId;
    const response = await fetch('/api/pages/' + pageId + '/records/' + checkbox.dataset.recordId + '?lang=' + locale, {method:'PATCH',headers:{'Content-Type':'application/json','If-Match':checkbox.dataset.hash},body:JSON.stringify({completed:checkbox.checked})});
    const result = await response.json(); if(!response.ok) throw new Error(result.error || t.saveFailed);
    checkbox.dataset.hash = result.hash; checkbox.closest('.check-item').classList.toggle('completed', checkbox.checked);
  } catch(error) { checkbox.checked = !checkbox.checked; status.textContent = error.message || t.saveFailed; }
  finally { checkbox.disabled = false; }
});
const importDialog = document.querySelector('#import-dialog');
const importForm = document.querySelector('#import-form');
let importSource = 'notion', importPreview = null, importGeneration = 0, savedAny = false;
const localDate = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
document.querySelectorAll('[data-import-source]').forEach(button => button.addEventListener('click', () => {
  importSource = button.dataset.importSource; importPreview = null; importGeneration++;
  const now = new Date(), from = new Date(now); from.setDate(from.getDate()-29);
  importForm.elements.from.value = localDate(from); importForm.elements.to.value = localDate(now);
  importForm.querySelector('button').disabled = false;
  document.querySelector('#import-dialog-title').textContent = importSource === 'notion' ? c.importNotion : c.importGoogle;
  document.querySelector('#import-help').textContent = importSource === 'notion' ? c.notionHelp : c.googleHelp;
  document.querySelector('#import-results').hidden = true; document.querySelector('#import-warnings').hidden = true;
  document.querySelector('#calendar-connect').hidden = true; document.querySelector('#import-status').textContent = '';
  importDialog.showModal();
}));
document.querySelector('#close-import')?.addEventListener('click', () => { importGeneration++; importDialog.close(); if(savedAny) location.reload(); });
importDialog?.addEventListener('cancel', () => { importGeneration++; if(savedAny) location.reload(); });
importForm?.addEventListener('submit', async event => {
  event.preventDefault(); const generation = ++importGeneration; const button = importForm.querySelector('button'); button.disabled = true;
  const status = document.querySelector('#import-status'); status.textContent = c.loading;
  document.querySelector('#import-results').hidden = true; document.querySelector('#calendar-connect').hidden = true; document.querySelector('#import-warnings').hidden = true;
  try {
    const response = await fetch('/api/imports/preview?lang=' + locale, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:importSource,...Object.fromEntries(new FormData(importForm))})});
    const result = await response.json(); if(generation !== importGeneration) return;
    if(!response.ok) { if(result.code === 'calendar_connection_required') document.querySelector('#calendar-connect').hidden = false; throw new Error(result.error || t.saveFailed); }
    importPreview = result;
    const container = document.querySelector('#import-records'); container.replaceChildren();
    for(const record of result.records) {
      const label = document.createElement('label'); label.className = 'import-record';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.dataset.importId = record.id;
      checkbox.setAttribute('aria-label', c.selectRecord + ': ' + record.title);
      const body = document.createElement('div'), title = document.createElement('strong'), date = document.createElement('small'), excerpt = document.createElement('p');
      title.textContent = record.title; date.textContent = record.date + (record.calendar ? ' · ' + record.calendar : ''); excerpt.textContent = record.body;
      body.append(title,date,excerpt); label.append(checkbox,body); container.append(label);
    }
    document.querySelector('#import-all').checked = true; document.querySelector('#import-save').disabled = false;
    status.textContent = result.records.length ? c.found.replace('{count}',result.records.length) : c.noResults;
    document.querySelector('#import-results').hidden = !result.records.length;
    const warnings = result.warnings.map(warning => ({partial:c.partial,search_limit:c.searchLimit,truncated:c.truncated}[warning])).filter(Boolean);
    document.querySelector('#import-warnings').textContent = warnings.join(' '); document.querySelector('#import-warnings').hidden = !warnings.length;
  } catch(error) { if(generation === importGeneration) status.textContent = error.message || t.saveFailed; }
  finally { if(generation === importGeneration) button.disabled = false; }
});
document.querySelector('#import-all')?.addEventListener('change', event => {
  document.querySelectorAll('[data-import-id]').forEach(checkbox => checkbox.checked = event.target.checked);
  document.querySelector('#import-save').disabled = !event.target.checked;
});
document.querySelector('#import-records')?.addEventListener('change', () => { document.querySelector('#import-save').disabled = !document.querySelector('[data-import-id]:checked'); });
document.querySelector('#import-save')?.addEventListener('click', async event => {
  const ids = Array.from(document.querySelectorAll('[data-import-id]:checked')).map(input => input.dataset.importId);
  if(!importPreview || !ids.length) return;
  const button = event.currentTarget; button.disabled = true; const status = document.querySelector('#import-status'); status.textContent = c.saving;
  try {
    const response = await fetch('/api/imports/apply?lang=' + locale, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preview_id:importPreview.preview_id,ids})});
    const result = await response.json(); if(!response.ok) throw new Error(result.error || t.saveFailed);
    savedAny = savedAny || result.saved > 0;
    status.textContent = c.saved.replace('{count}',result.saved) + (result.failed ? ' ' + c.failed.replace('{count}',result.failed) : '');
    if(!result.failed) location.href = '/?lang=' + locale;
  } catch(error) { status.textContent = error.message || t.saveFailed; }
  finally { button.disabled = false; }
});
`;
}

export const customStyles = `
.custom-navigation{display:grid;gap:10px}.more-button{background:transparent;color:#527343;border:1px dashed #b8c8ac;text-align:left;padding:9px 12px;width:100%}.custom-navigation nav a{overflow-wrap:anywhere}.sidebar-tools{display:grid;gap:8px}.sidebar-tools button{white-space:normal;text-align:left;font-size:12px}.record-table{overflow:auto;border:1px solid #dce3d5;border-radius:10px;background:white}.record-table table{border-collapse:collapse;width:100%}.record-table caption{text-align:left;padding:14px;font-weight:600}.record-table th,.record-table td{text-align:left;padding:14px;border-top:1px solid #e0e5d8;vertical-align:top}.record-table th{font-size:12px;color:#63715f}.record-table td:first-child{white-space:nowrap}.record-table td a{color:#315c46;text-decoration:underline}.check-item{display:flex;gap:15px;align-items:flex-start}.check-item>input{width:19px;height:19px;flex:none;accent-color:#315c46;margin-top:5px}.check-item>div{min-width:0}.check-title{font-size:17px;font-weight:600}.check-item.completed .check-title{text-decoration:line-through;color:#7a876c}.page-description{max-width:750px}.custom-capture small{display:none}dialog{width:min(670px,calc(100vw - 32px));max-height:88vh;overflow:auto;border:1px solid #d4ddcc;border-radius:14px;padding:27px;color:#28352d;background:#f8f9f5}dialog::backdrop{background:rgba(24,35,28,.35)}.dialog-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}.dialog-heading h2{margin:0;font:400 26px Georgia,serif}#page-form{display:grid;gap:18px}fieldset{border:0;padding:0;margin:0;min-width:0}legend{font-size:12px;color:#64715c;margin-bottom:10px}.layout-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.layout-option{border:1px solid #d5dece;border-radius:9px;padding:13px;cursor:pointer;background:white;position:relative}.layout-option:has(input:checked){border-color:#315c46;outline:1px solid #315c46}.layout-option>input{width:auto;position:absolute;top:10px;right:10px;accent-color:#315c46}.layout-option small{line-height:1.5}.layout-preview{height:57px;display:grid;gap:5px;padding:13px 3px}.layout-preview i{display:block;height:4px;background:#dce5d4;width:85%}.layout-preview i:last-child{width:55%}.preview-checklist i{margin-left:12px;position:relative}.preview-checklist i::before{content:'';position:absolute;left:-12px;top:-1px;width:5px;height:5px;border:1px solid #a6b999}.preview-table i{width:100%;height:7px;border:1px solid #becdb3;background:transparent}.preview-table i:last-child{width:100%}.import-dates{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin:16px 0}.select-all{display:flex;flex-direction:row;align-items:center;gap:8px;margin:15px 0}.select-all input,.import-record>input{width:18px;height:18px;flex:none;accent-color:#315c46}.import-record{display:flex;flex-direction:row;gap:13px;padding:15px 0;border-top:1px solid #dce3d5}.import-record>div{min-width:0;display:grid;gap:4px}.import-record small{display:block}.import-record p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;margin:3px 0;max-height:110px;overflow:auto}#import-save{margin-top:14px}.shell .detail{align-self:start;margin:30px auto}aside{gap:26px}@media(max-width:700px){.custom-navigation nav{max-width:100%;overflow:auto}.sidebar-tools{display:flex;flex-wrap:wrap}.more-button{width:auto}.layout-options{grid-template-columns:1fr}.layout-preview{display:none}.layout-option{padding-right:35px}.import-dates{grid-template-columns:1fr}.shell .detail{margin:20px 16px}}
`;
