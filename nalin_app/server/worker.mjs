// Reads ONLY evidence published by Portfolio Dashboard. No market-provider fetch.
export const SYMBOL=/^[A-Z0-9.^=-]{1,25}$/;
const key=(kind,ticker)=>`${kind}/${encodeURIComponent(ticker)}.json`;
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(data,status=200)=>Response.json(data,{status,headers});
const read=async(bucket,path)=>{const object=await bucket.get(path);return object?object.json():null;};
const put=(bucket,path,value)=>bucket.put(path,JSON.stringify(value),{httpMetadata:{contentType:'application/json'}});
const tokenOK=(request,env)=>env.DASHBOARD_BRIDGE_TOKEN&&request.headers.get('Authorization')==='Bearer '+env.DASHBOARD_BRIDGE_TOKEN;
const allowed=new Set(['ticker','name','instrument_type','currency','price_currency','prices','statements','quarterly_statements','retrieved','financial_retrieved','price_retrieved','price_source','price_url','price_basis','warnings','quote','fund','description','dashboard']);
export function validateEvidence(record){
  if(!record||!SYMBOL.test(record.ticker)||record.dashboard?.producer!=='Portfolio Dashboard'||record.dashboard?.scope!=='dashboard-viewed-data-only'||Object.keys(record).some(k=>!allowed.has(k)))throw Error('รับเฉพาะข้อมูลตลาดสาธารณะจาก Dashboard');
  if(!Array.isArray(record.prices)||!Array.isArray(record.statements)||record.prices.length>5000||record.statements.length>50)throw Error('ชุดข้อมูล Dashboard ไม่ถูกต้อง');
  if(!record.quote||!Number.isFinite(record.quote.value)||record.quote.value<=0||!record.quote.currency||!record.quote.as_of||!record.quote.retrieved||!record.quote.source?.startsWith('Portfolio Dashboard'))throw Error('Dashboard ไม่มีราคาที่มีหลักฐาน');
  for(const p of record.statements)for(const v of Object.values(p.values||{}))if(!Number.isFinite(v.value)||!v.source?.startsWith('Portfolio Dashboard'))throw Error('งบไม่ได้มาจาก Dashboard');
  return record;
}
export default {
  async fetch(request,env={}){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')){
      try{
        if(!env.BUCKET)return reply({error:'ระบบรับข้อมูล Dashboard ยังไม่พร้อม'},503);
        const bucket=env.BUCKET;
        if(url.pathname==='/api/dashboard/jobs'){
          if(!tokenOK(request,env))return reply({error:'Unauthorized'},401);
          const status=await read(bucket,'bridge/status.json');if(!status||Date.now()-status.last_seen>10000)await put(bucket,'bridge/status.json',{last_seen:Date.now(),producer:'Portfolio Dashboard'});
          const list=await bucket.list({prefix:'requests/',limit:21}),jobs=[];
          for(const object of list.objects){const job=await read(bucket,object.key);if(!job||Date.now()-job.revision>120000){await bucket.delete(object.key);continue;}const feed=await read(bucket,key('evidence',job.ticker));if(!feed||feed.revision<job.revision)jobs.push(job);}
          return reply({jobs:jobs.slice(0,20)});
        }
        if(url.pathname==='/api/dashboard/publish'&&request.method==='POST'){
          if(!tokenOK(request,env))return reply({error:'Unauthorized'},401);
          if(Number(request.headers.get('Content-Length'))>2000000)return reply({error:'ข้อมูลใหญ่เกินขอบเขต'},413);
          const text=await request.text();if(text.length>2000000)return reply({error:'ข้อมูลใหญ่เกินขอบเขต'},413);const body=JSON.parse(text);
          if(!SYMBOL.test(body.ticker)||!Number.isFinite(body.revision)||body.revision>Date.now()+30000)return reply({error:'คำขอ Dashboard ไม่ถูกต้อง'},400);
          const job=await read(bucket,key('requests',body.ticker));if(!job)return reply({error:'ไม่มีคำขอสำหรับ Ticker นี้'},409);
          if(body.record){validateEvidence(body.record);if(body.record.ticker!==body.ticker)return reply({error:'Ticker ไม่ตรงกัน'},400);}else if(typeof body.error!=='string')return reply({error:'ไม่มีข้อมูลหรือสถานะข้อผิดพลาด'},400);
          const previous=await read(bucket,key('evidence',body.ticker));if(!previous||previous.revision<=body.revision)await put(bucket,key('evidence',body.ticker),{ticker:body.ticker,revision:body.revision,record:body.record||null,documents:body.documents||[],error:body.error||null,received_at:Date.now()});
          return reply({ok:true});
        }
        if(url.pathname==='/api/catalog'){
          // Public endpoint: return only tickers that already have validated evidence published by Dashboard.
          // No token required – this exposes only ticker symbols and names, never price/financial data.
          const status=await read(bucket,'bridge/status.json');
          const connected=!!(status&&Date.now()-status.last_seen<=45000);
          const list=await bucket.list({prefix:'evidence/',limit:200});
          const items=[];
          for(const object of list.objects){
            const feed=await read(bucket,object.key);
            if(!feed||feed.error||!feed.record||Date.now()-feed.received_at>300000)continue;
            try{validateEvidence(feed.record);}catch{continue;}
            items.push({ticker:feed.record.ticker,name:feed.record.name||feed.record.ticker,
              full:!!(feed.record.statements?.length||feed.record.fund),
              instrument_type:feed.record.instrument_type||'UNKNOWN',
              received_at:feed.received_at});
          }
          // Sort by most recently received first so newest data leads
          items.sort((a,b)=>b.received_at-a.received_at);
          return reply({connected,catalog:items,source:'Portfolio Dashboard',read_only:true});
        }
        if(url.pathname==='/api/asset'){
          const ticker=(url.searchParams.get('ticker')||'').trim().toUpperCase(),mode=url.searchParams.get('mode')==='quote'?'quote':'full';
          if(!SYMBOL.test(ticker))return reply({error:'กรุณาระบุ Ticker เช่น AAPL หรือ VOO'},400);
          if(request.method==='POST'){
            const status=await read(bucket,'bridge/status.json');if(!status||Date.now()-status.last_seen>45000)return reply({error:'Dashboard ยังไม่เชื่อมต่อค่ะ กรุณาเปิดคอมพิวเตอร์ที่รัน Portfolio Dashboard และเชื่อมอินเทอร์เน็ต'},503);
            const old=await read(bucket,key('requests',ticker)),revision=Math.max(Date.now(),(old?.revision||0)+1);
            if(!old){const list=await bucket.list({prefix:'requests/',limit:21});if(list.objects.length>=20)return reply({error:'Dashboard กำลังตรวจหลายหลักทรัพย์ กรุณารอสักครู่'},429);}
            const previous=await read(bucket,key('evidence',ticker));
            const unfinished=old&&(!previous||previous.revision<old.revision);
            const effective=unfinished&&old.mode==='full'&&revision-old.revision<45000?'full':mode;
            await put(bucket,key('requests',ticker),{ticker,mode:effective,revision,read_only:true});return reply({ticker,revision,pending:true,read_only:true},202);
          }
          if(request.method!=='GET')return reply({error:'Method not allowed'},405);
          const revision=Number(url.searchParams.get('revision')),feed=await read(bucket,key('evidence',ticker));
          if(!revision||!feed||feed.revision<revision)return reply({pending:true},202);
          if(feed.error)return reply({error:'Dashboard อ่านข้อมูลไม่สำเร็จ: '+feed.error},502);
          if(Date.now()-feed.received_at>90000)return reply({error:'ข้อมูล Dashboard เก่าเกิน 90 วินาที กรุณาดึงใหม่'},503);
          validateEvidence(feed.record);
          return reply({record:feed.record,documents:feed.documents,revision:feed.revision,source:'Portfolio Dashboard',read_only:true});
        }
        return reply({error:'Not found'},404);
      }catch{return reply({error:'เชื่อมข้อมูล Dashboard ไม่สำเร็จ กรุณาลองใหม่'},503);}
    }
    if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
    const path=url.pathname==='/'?'/index.html':url.pathname,asset=ASSETS[path];if(!asset)return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
  }
};
