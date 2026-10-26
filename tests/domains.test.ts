import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { JSDOM } from 'jsdom';
import { openApplication } from '../src/application.js';
import { createHttpApp } from '../src/http.js';
import { McpManager } from '../src/integrations/mcp.js';
import { instant, minorUnits, saveExpense, expenseSummary, allRecords, parseDataFile, parseHealthXml, parseTravelEmail, recognize } from '../src/domain-service.js';

async function fixture(t: {after(fn:()=>Promise<void>):void}) {
 const app = await openApplication({vault:await mkdtemp(join(tmpdir(),'openloci-domain-')),timezone:'Asia/Shanghai'});
 const server=createHttpApp(app,new McpManager([])).listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await app.close();});
 const post=async(path:string,input:unknown,method='POST',headers={})=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
 return {app,base,post};
}
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=';

test('calendar wall time honors timezone and rejects DST gaps; money is exact across currencies',()=>{
 assert.equal(instant('2026-10-26','09:30','Asia/Shanghai'),'2026-10-26T01:30:00.000Z');
 assert.throws(()=>instant('2026-03-08','02:30','America/New_York'));
 assert.equal(minorUnits('12.34','CNY'),1234);assert.equal(minorUnits('-12.34','USD'),-1234);assert.equal(minorUnits('123','JPY'),123);
 assert.throws(()=>minorUnits('12.5','JPY'));assert.throws(()=>minorUnits('9007199254740992','JPY'));
});

test('income, refunds and replaceable monthly budgets stay separate by currency',async t=>{
 const {app}=await fixture(t);
 for(const [amount,direction,currency] of [['1000','income','CNY'],['100','expense','CNY'],['-20','expense','CNY'],['30','expense','USD'],['300','budget','CNY'],['500','budget','CNY']])await saveExpense(app,{title:direction,date:'2026-10-26',amount,direction,currency,category:'Total'});
 const records=await allRecords(app,'expense');assert.equal(records.length,5);
 const summary=expenseSummary(records,'2026-10','CNY');assert.equal(summary.income,100000);assert.equal(summary.expense,8000);assert.equal(summary.budget,50000);assert.equal(summary.records.length,3);assert.equal(summary.months[0].expense,8000);
});

test('photo upload, meal calendar links, event edits and task completion work over HTTP',async t=>{
 const {app,base,post}=await fixture(t);
 assert.equal((await post('/api/domain/photos',{data:Buffer.from('<script>not an image</script>').toString('base64')})).status,400);
 const upload=await post('/api/domain/photos',{data:png});assert.equal(upload.status,201);const photo=await upload.json();
 const image=await fetch(base+photo.url);assert.equal(image.headers.get('Content-Type'),'image/png');assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'),png);
 const meal=await (await post('/api/domain/meals',{title:'Tofu',date:'2026-10-26',time:'12:00',meal_type:'lunch',photo:photo.id,calories:420,sync_calendar:true})).json();assert.equal(meal.calendar_synced,true);
 const event=await app.get('meal-'+meal.record.id);assert.equal(event.record.links[0],meal.record.id);assert.equal(Date.parse(String(event.record.attributes.end_at))-Date.parse(String(event.record.attributes.start_at)),1800000);
 const created=await (await post('/api/domain/calendar',{title:'Read',date:'2026-10-26',time:'09:30',kind:'task'})).json();assert.equal(created.record.attributes.duration_minutes,30);
 const completed=await post('/api/domain/tasks/'+created.record.id,{hash:created.hash,completed:true},'PATCH');assert.equal(completed.status,200);
 const edited=await post('/api/domain/calendar',{id:created.record.id,hash:created.hash,title:'Conflict',date:'2026-10-26',time:'10:00'});assert.equal(edited.status,409);
 const allDay=await (await post('/api/domain/calendar',{title:'Holiday',date:'2026-10-26',all_day:true,end_date:'2026-10-28'})).json();assert.equal(allDay.record.attributes.end_date,'2026-10-28');assert.equal(allDay.record.attributes.start_at,undefined);
 const timed=await (await post('/api/domain/calendar',{id:allDay.record.id,hash:allDay.hash,title:'Timed holiday',date:'2026-10-26',time:'09:00'})).json();assert.equal(timed.record.attributes.all_day,false);assert.equal(timed.record.attributes.start_date,undefined);
 assert.equal((await post('/api/domain/calendar',{title:'Meet',date:'2026-10-26',time:'10:00',kind:'meeting',attendees:'a@example.com,b@example.com'})).status,201);
});

test('health XML preserves sources and units; file previews are reviewable and idempotent',async t=>{
 const {app,post}=await fixture(t);
 const xml=`<?xml version="1.0"?><HealthData><Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" startDate="2026-10-26 09:00:00 +0800" endDate="2026-10-26 09:30:00 +0800" value="1000"/><Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="Watch" unit="kJ" startDate="2026-10-26 09:00:00 +0800" value="418.4"/><Record type="HKQuantityTypeIdentifierStepCount" sourceName="Phone" unit="count" startDate="2026-10-26 09:00:00 +0800" value="900"/><Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" sourceName="Watch" startDate="2026-10-26 09:00:00 +0800" endDate="2026-10-26 09:30:00 +0800"/></HealthData>`;
 const parsed=parseHealthXml(xml,'Asia/Shanghai');assert.equal(parsed.records.length,4);assert.equal(parsed.records[0].attributes.duration_seconds,1800);assert.ok(Math.abs(Number(parsed.records.find(r=>r.attributes.active_energy_kcal)?.attributes.active_energy_kcal)-100)<0.000001);assert.equal(parsed.records[0].date,'2026-10-26');assert.equal(new Set(parsed.records.map(r=>r.attributes.source_name)).size,2);
 assert.throws(()=>parseHealthXml('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><HealthData/>','UTC'));
 const csv='id,date,title,amount,currency,direction\na,2026-10-26,Lunch,35.50,CNY,expense\nb,wrong,Bad,xx,CNY,expense';
 assert.equal(parseDataFile('expense',csv,'bank.csv','UTC').warnings.length,1);
 const preview=await (await post('/api/domain/files/preview',{kind:'expense',content:csv,filename:'bank.csv'})).json();assert.equal(preview.count,1);assert.equal(preview.rejected,1);assert.equal((await allRecords(app,'expense')).length,0);
 for(let i=0;i<2;i++)assert.equal((await (await post('/api/domain/files/apply',{preview_id:preview.preview_id})).json()).saved,1);
 assert.equal((await allRecords(app,'expense')).length,1);
 assert.equal((await post('/api/domain/files/preview',{kind:'expense',content:'[]',filename:'bank.json'})).status,400);
});

test('travel mail extraction leaves unknown dates blank and inbox requires a token',async t=>{
 const {base,post}=await fixture(t);const previous=process.env.OPENLOCI_MAIL_WEBHOOK_TOKEN;process.env.OPENLOCI_MAIL_WEBHOOK_TOKEN='test-local-token';t.after(async()=>{if(previous===undefined)delete process.env.OPENLOCI_MAIL_WEBHOOK_TOKEN;else process.env.OPENLOCI_MAIL_WEBHOOK_TOKEN=previous;});
 assert.equal(parseTravelEmail('Flight: CA1234\n2026-10-26').kind,'flight');assert.equal(parseTravelEmail('Flight: CA1234').date,'');
 const email=await (await post('/api/domain/travel/parse-email',{filename:'reservation.eml',content:'From: bookings@example.com\r\nSubject: Hotel booking\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHotel: Garden Hotel\r\n2026-10-26 to 2026-10-28'})).json();assert.equal(email.kind,'hotel');assert.equal(email.end_date,'2026-10-28');assert.equal(email.needs_review,true);
 assert.equal((await post('/api/inbound/travel-email',{content:'Flight CA1234'})).status,401);
 assert.equal((await post('/api/inbound/travel-email',{content:'Flight CA1234' },'POST',{Authorization:'Bearer test-local-token'})).status,201);
 const inbox=await (await fetch(base+'/api/domain/travel/inbox')).json();assert.equal(inbox.length,1);
 const saved=await (await post('/api/domain/travel',{title:'Museum',date:'2026-10-26',city:'Shanghai',place:'Museum',latitude:31.2,longitude:121.4})).json();
 assert.equal((await post('/api/domain/travel',{id:saved.record.id,hash:saved.hash,title:'Museum',date:'2026-10-26',city:'Shanghai',latitude:31.3,longitude:121.5})).status,201);
});

test('six domain pages render in four languages and calendar slots create half-hour appointments',async t=>{
 const {base}=await fixture(t);const script=await readFile(new URL('../public/domain.js',import.meta.url),'utf8');
 for(const type of ['journal','event','meal','exercise','expense','travel'])for(const lang of ['en','zh-CN','ja','es']){
 const response=await fetch(`${base}/?type=${type}&lang=${lang}&date=2026-10-26`);assert.equal(response.status,200);const html=await response.text();assert.match(html,new RegExp('domain-'+type));assert.doesNotMatch(html, /<nav[^>]*>[\s\S]*?href="\/\?type=(?:profile|memory)&/);assert.match(html,/id="language"/);
 if(type==='travel')assert.equal(response.headers.get('Referrer-Policy'),'strict-origin-when-cross-origin');
 if(['event','meal','exercise','expense'].includes(type)&&lang==='en'){
 const dom=new JSDOM(html,{url:base,runScripts:'outside-only'});const window=dom.window;window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};window.eval(script);
 if(type==='event'){assert.equal(window.document.querySelectorAll('.time-slot').length,336);(window.document.querySelector('.time-slot') as HTMLElement).click();assert.equal((window.document.querySelector('[name=duration]') as HTMLInputElement).value,'30');assert.equal(window.document.querySelector('#calendar-dialog')?.hasAttribute('open'),true);}
 window.close();}
 }
 for(const name of ['domain.js','domain.css','leaflet.js','leaflet.css','exercise-sample.csv'])assert.equal((await fetch(base+'/assets/'+name)).status,200);
});

test('month view renders overnight events on their last day and respects all-day exclusive ends',async t=>{
 const {app,base}=await fixture(t);
 await app.create({type:'event',title:'Overnight',date:'2026-10-26',attributes:{start_at:'2026-10-26T15:00:00Z',end_at:'2026-10-26T18:00:00Z'}});
 await app.create({type:'event',title:'All-day trip',date:'2026-10-26',attributes:{all_day:true,start_date:'2026-10-26',end_date:'2026-10-28'}});
 const html=await (await fetch(base+'/?type=event&view=month&date=2026-10-26')).text(),script=await readFile(new URL('../public/domain.js',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:base,runScripts:'outside-only'});dom.window.eval(script);
 const entries=[...dom.window.document.querySelectorAll('.calendar-entry')];assert.equal(entries.filter(node=>node.textContent==='Overnight').length,2);assert.equal(entries.filter(node=>node.textContent==='All-day trip').length,2);dom.window.close();
});

test('journal tabs, slash todos and revision-based saving persist Markdown; reload does not invent edits',async t=>{
 const {app,base}=await fixture(t);const first=await app.create({type:'journal',title:'First',date:'2026-10-26',body:'Hello'});const second=await app.create({type:'journal',title:'Second',date:'2026-10-25',body:'# Notes'});
 const html=await (await fetch(base+'/?type=journal')).text(), script=await readFile(new URL('../public/domain.js',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:base,runScripts:'outside-only'}),w=dom.window;const pending:Promise<unknown>[]=[];
 w.fetch=((path:string,input:RequestInit)=>{const promise=fetch(base+path,input);pending.push(promise);return promise;}) as any;
 w.eval(script);const document=w.document;const activate=(id:string)=>(document.querySelector(`[data-document="${id}"]`) as HTMLElement).click();activate(first.record.id);
 let text=document.querySelector('[contenteditable]') as HTMLElement;text.textContent='/';text.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal((document.querySelector('#slash-menu') as HTMLElement).hidden,false);
 const todo=[...document.querySelectorAll('#slash-menu button')].find(button=>button.textContent==='To-do') as HTMLElement;todo.click();assert.equal(document.querySelector('.block-todo')!=null,true);
 text=document.querySelector('[contenteditable]') as HTMLElement;text.textContent='Buy tofu';text.dispatchEvent(new w.Event('input',{bubbles:true}));(document.querySelector('#journal-save') as HTMLElement).click();
 await Promise.all(pending);await new Promise(resolve=>setTimeout(resolve,60));assert.equal((await app.get(first.record.id)).record.body,'- [ ] Buy tofu');
 activate(second.record.id);assert.equal(document.querySelectorAll('[role=tab]').length,2);activate(first.record.id);assert.equal((document.querySelector('[contenteditable]') as HTMLElement).textContent,'Buy tofu');
 const unload=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(unload);assert.equal(unload.defaultPrevented,false);dom.window.close();
});

test('Inference Hub adapter uses the exact completion URL and supplied protocol with explicit image input',async t=>{
 const keys=['OPENLOCI_AI_BASE_URL','OPENLOCI_AI_MODEL','OPENLOCI_AI_API_KEY','OPENLOCI_AI_PROTOCOL'];const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let captured:any;
 const server=createServer(async(req,res)=>{assert.equal(req.url,'/v1/chat/completions');let body='';for await(const chunk of req)body+=chunk;captured=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'{"title":"Tofu","items":["Tofu"],"calories":null}'}}]}));}).listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];await new Promise<void>(resolve=>server.close(()=>resolve()));});
 process.env.OPENLOCI_AI_BASE_URL=`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`;process.env.OPENLOCI_AI_MODEL='test/model';process.env.OPENLOCI_AI_PROTOCOL='inference-hub';
 const result=await recognize('Identify food',{data:Buffer.from(png,'base64'),mime:'image/png'}) as {title:string};assert.equal(result.title,'Tofu');assert.equal(typeof captured.system,'string');assert.equal(captured.messages.length,1);assert.equal(captured.messages[0].content[1].type,'image_url');assert.equal(captured.max_tokens,2048);
});
