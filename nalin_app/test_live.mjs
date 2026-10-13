import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{validateEvidence} from './server/worker.mjs';
class Bucket{
  store=new Map();
  async get(key){const value=this.store.get(key);return value?{json:async()=>structuredClone(value)}:null;}
  async put(key,value){this.store.set(key,JSON.parse(value));}
  async delete(key){this.store.delete(key);}
  async list({prefix,limit}){return {objects:[...this.store.keys()].filter(k=>k.startsWith(prefix)).slice(0,limit).map(key=>({key}))};}
}
const setup=()=>({BUCKET:new Bucket(),DASHBOARD_BRIDGE_TOKEN:'test-only-secret'});
const request=(path,method='GET',body,authorized=false)=>new Request('https://example.test'+path,{method,headers:authorized?{Authorization:'Bearer test-only-secret','Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
const record=()=>({ticker:'TEST',name:'Test',prices:[],statements:[],dashboard:{producer:'Portfolio Dashboard',scope:'dashboard-viewed-data-only'},quote:{value:100,currency:'USD',as_of:'2026-10-02T20:00:00Z',retrieved:new Date().toISOString(),source:'Portfolio Dashboard'}});
test('only authenticated Dashboard can publish evidence or read jobs',async()=>{const env=setup();for(const path of ['/api/dashboard/jobs','/api/dashboard/publish'])assert.equal((await worker.fetch(request(path,'POST',{ticker:'TEST'}),env)).status,401);assert.equal(env.BUCKET.store.size,0);});
test('unconnected Dashboard is explicit and no market source is contacted',async()=>{const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('no external market fetch allowed')};try{const r=await worker.fetch(request('/api/asset?ticker=TEST','POST'),setup());assert.equal(r.status,503);assert.ok((await r.json()).error.includes('Dashboard'));}finally{globalThis.fetch=original;}});
test('request, Dashboard job, publication and response form a single revision',async()=>{
  const env=setup();await worker.fetch(request('/api/dashboard/jobs','GET',undefined,true),env);
  const queued=await (await worker.fetch(request('/api/asset?ticker=TEST','POST'),env)).json();
  assert.equal((await worker.fetch(request('/api/asset?ticker=TEST&revision='+queued.revision),env)).status,202);
  const jobs=await (await worker.fetch(request('/api/dashboard/jobs','GET',undefined,true),env)).json();assert.equal(jobs.jobs[0].ticker,'TEST');
  const publish=await worker.fetch(request('/api/dashboard/publish','POST',{ticker:'TEST',revision:queued.revision,record:record()},true),env);assert.equal(publish.status,200);
  const data=await (await worker.fetch(request('/api/asset?ticker=TEST&revision='+queued.revision),env)).json();assert.equal(data.record.quote.value,100);assert.equal(data.source,'Portfolio Dashboard');
});
test('provider data or private portfolio fields cannot cross the evidence boundary',()=>{const a=record();a.dashboard.producer='Yahoo';assert.throws(()=>validateEvidence(a));const b=record();b.transactions=['private'];assert.throws(()=>validateEvidence(b));const c=record();c.quote.source='Yahoo';assert.throws(()=>validateEvidence(c));});
test('Dashboard failure supersedes previous successful data instead of falling back',async()=>{
  const env=setup();await env.BUCKET.put('bridge/status.json',JSON.stringify({last_seen:Date.now()}));const q=await(await worker.fetch(request('/api/asset?ticker=TEST','POST'),env)).json();
  await worker.fetch(request('/api/dashboard/publish','POST',{ticker:'TEST',revision:q.revision,error:'source unavailable'},true),env);
  const r=await worker.fetch(request('/api/asset?ticker=TEST&revision='+q.revision),env);assert.equal(r.status,502);assert.equal((await r.json()).record,undefined);
});
test('stale evidence is never described as currently checked',async()=>{const env=setup();await env.BUCKET.put('evidence/TEST.json',JSON.stringify({revision:10,record:record(),received_at:Date.now()-100000}));assert.equal((await worker.fetch(request('/api/asset?ticker=TEST&revision=10'),env)).status,503);});
test('invalid ticker cannot create a request',async()=>{const env=setup();assert.equal((await worker.fetch(request('/api/asset?ticker=..%2Fprivate','POST'),env)).status,400);assert.equal(env.BUCKET.store.size,0);});

test('every AI request is a read-only request for existing Dashboard evidence',async()=>{
  const env=setup();
  await worker.fetch(request('/api/dashboard/jobs','GET',undefined,true),env);
  const queued=await(await worker.fetch(request('/api/asset?ticker=TEST','POST'),env)).json();
  assert.equal(queued.read_only,true);
  const jobs=await(await worker.fetch(request('/api/dashboard/jobs','GET',undefined,true),env)).json();
  assert.equal(jobs.jobs[0].read_only,true);
  const legacy=record();delete legacy.dashboard.scope;
  assert.throws(()=>validateEvidence(legacy));
  await worker.fetch(request('/api/dashboard/publish','POST',{ticker:'TEST',revision:queued.revision,record:record()},true),env);
  const r=await(await worker.fetch(request('/api/asset?ticker=TEST&revision='+queued.revision),env)).json();
  assert.equal(r.read_only,true);
});

test('price-only Dashboard data stays usable after missing full data',async()=>{
  const env=setup();
  await worker.fetch(request('/api/dashboard/jobs','GET',undefined,true),env);
  const full=await(await worker.fetch(request('/api/asset?ticker=TEST','POST'),env)).json();
  await worker.fetch(request('/api/dashboard/publish','POST',{ticker:'TEST',revision:full.revision,error:'Dashboard has no statements'},true),env);
  await new Promise(resolve=>setTimeout(resolve,2));
  await worker.fetch(request('/api/asset?ticker=TEST&mode=quote','POST'),env);
  const jobs=await(await worker.fetch(request('/api/dashboard/jobs','GET',undefined,true),env)).json();
  assert.equal(jobs.jobs[0].mode,'quote');
});
