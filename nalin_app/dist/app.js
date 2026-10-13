(function(){
  'use strict';
  const $=s=>document.querySelector(s),el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  let knowledge,installPrompt,loading=false,busy=false,requestId=0,controller;
  const parentAddress=new URLSearchParams(location.search).get('streamlitUrl');
  const component=window.parent!==window&&!!parentAddress;
  const componentOrigin=component?new URL(parentAddress).origin:null;
  const pendingComponent=new Map();let componentArgs;
  const postParent=(type,data={})=>window.parent.postMessage({isStreamlitMessage:true,type,...data},componentOrigin);
  function applyDashboardRecord(record,documents,mode='full'){
    if(record?.dashboard?.producer!=='Portfolio Dashboard'||record.dashboard.scope!=='dashboard-viewed-data-only')throw Error('ข้อมูลนี้ไม่ได้มาจาก Portfolio Dashboard');
    Nalin.validate({schema_version:1,site_name:'Portfolio Dashboard',exported_at:record.retrieved,documents:documents||[],stocks:[record]});
    const old=knowledge.stocks.find(s=>s.ticker===record.ticker);
    const merged=record; // The Dashboard store supplies one complete, atomic observation.
    knowledge.stocks=knowledge.stocks.filter(s=>s.ticker!==record.ticker).concat(merged);
    if(documents?.length)knowledge.documents=documents;
    if(![...$('#stock').options].some(o=>o.value===record.ticker)){const o=el('option',null,`${record.ticker} · ${record.name}`);o.value=record.ticker;$('#stock').append(o);}
    return merged;
  }
  // --- Catalog: auto-discover stocks that Dashboard has already loaded ---
  // Seeds the dropdown with whatever the Dashboard bridge has published, so the
  // user never needs to type a ticker unless they want one that isn't there yet.
  function applyCatalogItems(items){
    if(!knowledge||!Array.isArray(items))return;
    for(const item of items){
      if(!item.ticker||!/^[A-Z0-9.^=-]{1,25}$/.test(item.ticker))continue;
      if(!knowledge.stocks.some(s=>s.ticker===item.ticker)){
        knowledge.stocks.push({ticker:item.ticker,name:item.name||item.ticker,prices:[],statements:[],quarterly_statements:[]});
        const o=el('option',null,`${item.ticker} · ${item.name||item.ticker}`);o.value=item.ticker;$('#stock').append(o);
      }
    }
  }
  async function fetchCatalog(){
    if(component)return; // Component mode gets catalog via Streamlit message
    try{
      const resp=await fetch('/api/catalog',{cache:'no-store'});
      if(!resp.ok)return;
      const data=await resp.json();
      if(Array.isArray(data.catalog)){
        applyCatalogItems(data.catalog);
        // Update connection status
        if(data.connected)$('#snapshot-date').textContent=
          knowledge?.stocks?.some(s=>s.quote)?$('#snapshot-date').textContent:
          `Dashboard เชื่อมต่อแล้ว · พบ ${data.catalog.length} หลักทรัพย์ใน Dashboard`;
      }
    }catch{}
  }
  if(component){
    window.addEventListener('message',e=>{
      if(e.source!==window.parent||e.origin!==componentOrigin||e.data?.type!=='streamlit:render')return;
      componentArgs=e.data.args;
      if(knowledge&&Array.isArray(componentArgs.catalog))for(const item of componentArgs.catalog){
        if(!knowledge.stocks.some(s=>s.ticker===item.ticker)){
          knowledge.stocks.push({ticker:item.ticker,name:item.name,prices:[],statements:[],quarterly_statements:[]});
          const option=el('option',null,item.ticker+' · '+item.name);option.value=item.ticker;$('#stock').append(option);
        }
      }
      if(knowledge&&componentArgs.error){$('#load-error').hidden=false;$('#load-error').textContent=componentArgs.error;$('#snapshot-date').textContent='Dashboard ยังไม่มีข้อมูลที่พร้อมใช้';}
      if(knowledge&&!componentArgs.error&&componentArgs.envelope?.stocks?.length){try{const r=componentArgs.envelope.stocks[0];applyDashboardRecord(r,componentArgs.envelope.documents,r.dashboard.mode);if(!busy&&!loading){$('#stock').value=r.ticker;displayStock();$('#snapshot-date').textContent=`Dashboard ตรวจเมื่อ ${localTime(r.quote.retrieved)} · เวลาไทย`;}}catch{}}
      const pending=pendingComponent.get(componentArgs.request_nonce);
      if(pending){pendingComponent.delete(componentArgs.request_nonce);if(componentArgs.error)pending.reject(Error(componentArgs.error));else pending.resolve({record:componentArgs.envelope.stocks[0],documents:componentArgs.envelope.documents});}
      postParent('streamlit:setFrameHeight',{height:1050});
    });
    postParent('streamlit:componentReady',{apiVersion:1});postParent('streamlit:setFrameHeight',{height:1050});
  }
  async function dashboardData(ticker,mode,signal){
    if(component){
      const nonce=crypto.randomUUID();
      return new Promise((resolve,reject)=>{
        pendingComponent.set(nonce,{resolve,reject});
        signal.addEventListener('abort',()=>{pendingComponent.delete(nonce);reject(new DOMException('Cancelled','AbortError'));},{once:true});
        postParent('streamlit:setComponentValue',{value:{ticker,mode,nonce},dataType:'json'});
      });
    }
    const base=`/api/asset?ticker=${encodeURIComponent(ticker)}&mode=${mode}`;
    const request=await fetch(base,{method:'POST',cache:'no-store',signal}),queued=await request.json();
    if(queued.error||!Number.isFinite(queued.revision))throw Error(queued.error||'Dashboard ยังไม่รับคำขอ');
    for(let i=0;i<55;i++){
      const response=await fetch(base+`&revision=${queued.revision}`,{cache:'no-store',signal}),data=await response.json();
      if(data.error)throw Error(data.error);if(data.record)return data;if(!data.pending)throw Error('Dashboard ส่งข้อมูลไม่ครบ');
      await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,1500);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));},{once:true});});
    }
    throw Error('Dashboard ใช้เวลาตรวจข้อมูลนานเกินไป กรุณาลองใหม่');
  }
  const conversation=$('#conversation');
  function details(title,text,url){$('#detail-title').textContent=title;$('#detail-content').replaceChildren(el('div','evidence-text',text));const safe=Nalin.safeUrl(url);if(safe){const a=el('a',null,'เปิดแหล่งข้อมูลต้นทาง');a.href=safe;a.target='_blank';a.rel='noopener noreferrer';$('#detail-content').append(a);}$('#details').showModal();}
  $('#close-details').onclick=()=>$('#details').close();
  $('#details').onclick=e=>{if(e.target===$('#details'))$('#details').close();};
  $('#about').onclick=()=>details('นลินทำงานอย่างไร','นลินอ่านข้อมูลจาก Portfolio Dashboard เท่านั้นค่ะ ไม่เรียกแหล่งข้อมูลตลาดเองและไม่เรียกบริการ AI ภายนอก\n\nDashboard ตรวจราคาใหม่ผ่านข้อมูลร่วมกันทุก 25 วินาที และตรวจงบ/ETF ที่เผยแพร่ทุก 60 วินาทีขณะเปิดหน้าที่เกี่ยวข้อง เมื่อถามหรือกดรีเฟรช จะอ่านเฉพาะข้อมูลที่ Dashboard โหลดไว้แล้ว ไม่สั่งค้นหาตลาด หากไม่มีหุ้นนี้ต้องเปิดข้อมูลใน Dashboard ก่อน\n\nนลินดึงรายชื่อหลักทรัพย์จาก Dashboard อัตโนมัติทุก 60 วินาที หากคุณเปิดข้อมูลหุ้นใน Dashboard ชื่อนั้นจะปรากฏใน dropdown โดยไม่ต้องกรอก Ticker\n\nราคาอาจหน่วงหรือเป็นราคาตลาดปิด งบและรายการถือครองเปลี่ยนตามรอบเผยแพร่ของต้นทาง หาก Dashboard ไม่มีหลักฐานจะไม่เติมตัวเลขและไม่ใช้ชุดข้อมูลเก่าแทนปัจจุบัน\n\nลิงก์ออนไลน์รับเฉพาะข้อมูลบริษัทและตลาดจาก Dashboard คอมพิวเตอร์ที่รัน Dashboard ต้องเปิดและเชื่อมอินเทอร์เน็ต หากปิดเครื่องจะแจ้งว่า Dashboard ไม่เชื่อมต่อ\n\nคำถามอยู่บนอุปกรณ์ ระบบรับเฉพาะ Ticker ไม่มีบัญชี ยอดเงิน ธุรกรรมหรือบันทึกส่วนตัวถูกส่งออก ไม่ต้องล็อกอินค่ะ');
  const localTime=t=>new Date(t).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'medium'});
  function displayStock(){const s=knowledge.stocks.find(s=>s.ticker===$('#stock').value);if(!s)return;$('#company').textContent=`${s.ticker} · ${s.name}`;const q=s.quote;$('#close').textContent=q?`${Nalin.fmt(q.value)} ${q.currency}`:'ยังไม่มีราคาที่ตรวจออนไลน์';$('#price-date').textContent=q?`แหล่งข้อมูล ${localTime(q.as_of)} · เวลาไทย`:'ต้องเชื่อมอินเทอร์เน็ต';$('#period').textContent=s.instrument_type==='ETF'?`ETF · ข้อมูลผู้จัดการกองทุนตามวันเผยแพร่`:[s.statements.length?`งบปี ${s.statements.at(-1).period}`:'ไม่มีงบรายปี',s.quarterly_statements?.length?`ไตรมาส ${s.quarterly_statements.at(-1).period}`:'ไม่มีงบไตรมาส'].join(' · ');}
  function controls(){const blocked=loading||busy;$('#send').disabled=blocked||!knowledge;$('#stock').disabled=busy||!knowledge;$('#refresh').disabled=blocked||!knowledge;$('#question').disabled=busy||!knowledge;$('#ticker-form button').disabled=busy||!knowledge;document.querySelectorAll('[data-question]').forEach(b=>b.disabled=blocked||!knowledge);$('#send').textContent=busy?'กำลังอ่าน Dashboard…':'ส่งคำถาม ↗';}
  async function refreshAsset(ticker,mode='full'){
    if(!navigator.onLine)throw Error('ออฟไลน์ค่ะ ต้องเชื่อมอินเทอร์เน็ตเพื่อดึงข้อมูลล่าสุด');
    const id=++requestId;controller?.abort();const currentController=new AbortController();controller=currentController;const timeout=setTimeout(()=>currentController.abort(),90000);loading=true;controls();
    $('#load-error').hidden=true;$('#snapshot-date').textContent=`กำลังขอข้อมูล ${ticker} จาก Dashboard…`;
    try{
      const data=await dashboardData(ticker,mode,currentController.signal);
      if(id!==requestId)throw Error('เปลี่ยนหลักทรัพย์แล้ว');
      const record=data.record;if(record?.ticker!==ticker)throw Error('Ticker ของข้อมูลไม่ตรงกับคำขอ');
      const merged=applyDashboardRecord(record,data.documents,mode);
      if($('#stock').value===ticker)displayStock();
      $('#snapshot-date').textContent=`Dashboard ตรวจเมื่อ ${localTime(record.quote.retrieved)} · เวลาไทย · ราคาตามเวลาต้นทาง`;
      return merged;
    }catch(e){if(id===requestId){$('#snapshot-date').textContent='ยังตรวจข้อมูลล่าสุดไม่ได้';$('#load-error').hidden=false;$('#load-error').textContent=`${e.name==='AbortError'?'แหล่งข้อมูลใช้เวลานานเกินไป':e.message} · ไม่ใช้ข้อมูลเก่าแทนข้อมูลปัจจุบัน`;}throw e;}
    finally{clearTimeout(timeout);if(id===requestId){loading=false;controls();}}
  }
  async function selectStock(){displayStock();try{await refreshAsset($('#stock').value);}catch{try{await refreshAsset($('#stock').value,'quote');}catch{}}}
  function chart(data){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 700 245');svg.classList.add('chart');svg.setAttribute('role','img');svg.setAttribute('aria-label','กราฟราคาปิดรายวันพร้อมแนวรับและแนวต้าน');
    const values=[...data.bars.map(b=>b.close),...data.levels.map(l=>l.price)],low=Math.min(...values),high=Math.max(...values),range=Math.max(high-low,1),x=i=>28+i/(data.bars.length-1)*555,y=v=>195-(v-low)/range*160;
    const draw=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text)e.textContent=text;svg.append(e);return e;};
    for(let i=0;i<4;i++)draw('line',{x1:28,x2:585,y1:35+i*53.3,y2:35+i*53.3,stroke:'#33443c'});
    draw('polyline',{points:data.bars.map((b,i)=>`${x(i)},${y(b.close)}`).join(' '),fill:'none',stroke:'#bbef9e','stroke-width':2.2});
    for(const l of data.levels){const color=l.type==='low'?'#87d5c0':'#edcd86';draw('line',{x1:28,x2:585,y1:y(l.price),y2:y(l.price),stroke:color,'stroke-dasharray':'5 5'});draw('text',{x:595,y:y(l.price)+4,fill:color},Nalin.fmt(l.price));}
    draw('text',{x:28,y:231,fill:'#b0c1b6'},data.bars[0].date);draw('text',{x:500,y:231,fill:'#b0c1b6'},data.bars.at(-1).date);return svg;
  }
  function showAnswer(result){
    const a=el('article','message assistant');const name=el('div','message-name');name.append(el('span','small-avatar','น'),document.createTextNode('นลิน'));a.append(name,el('h2','answer-heading',result.title));
    if(result.status==='calculation')a.append(el('div','status','ผลคำนวณจากข้อมูลในเว็บ'));
    if(result.status==='insufficient')a.append(el('div','status','ยังยืนยันคำตอบไม่ได้'));
    for(const p of result.paragraphs||[])a.append(el('p',result.status==='excerpt'?'evidence-text':'',p));
    if(result.facts?.length){const f=el('div','facts');for(const fact of result.facts){const b=el('div','fact');b.append(el('span',null,fact.label),el('strong',null,fact.value));f.append(b);}a.append(f);}
    if(result.chart){a.append(chart(result.chart));a.append(el('p','chart-label','เส้นเขียว: ราคาปิด · เส้นฟ้า: แนวรับ · เส้นทอง: แนวต้าน'));}
    if(result.warnings?.length)for(const w of result.warnings)a.append(el('p','status',w));
    if(result.citations?.length){const source=el('div','sources');source.append(el('span','source-label','หลักฐาน · กดเพื่อตรวจตัวเลขและที่มา'));for(const c of result.citations){const b=el('button',null,c.title);b.type='button';b.onclick=()=>details(c.title,c.text,c.url);source.append(b);}a.append(source);}
    conversation.append(a);return result;
  }
  // --- Smart catalog search: when no specific ticker is identified in the query,
  //     refresh every stock that Dashboard already has, then answer from all of them.
  async function refreshAllCatalog(mode,signal){
    const tickers=knowledge.stocks.map(s=>s.ticker).filter(t=>t&&/^[A-Z0-9.^=-]{1,25}$/.test(t));
    // Refresh all in parallel (up to 5 at a time to avoid flooding)
    const batch=5;
    for(let i=0;i<tickers.length;i+=batch){
      await Promise.allSettled(tickers.slice(i,i+batch).map(ticker=>{
        const id=++requestId;
        return dashboardData(ticker,mode,signal).then(data=>{
          if(data?.record?.ticker===ticker)applyDashboardRecord(data.record,data.documents,mode);
        }).catch(()=>{});
      }));
      if(signal.aborted)break;
    }
  }
  async function ask(query){
    if(busy)return;if(!knowledge)throw Error('ยังไม่มีชุดข้อมูลที่ตรวจสอบแล้ว');if(typeof query!=='string'||!query.trim()||query.length>2000)throw Error('กรุณาระบุคำถาม 1–2,000 ตัวอักษร');
    let selected=$('#stock').value;const mentioned=knowledge.stocks.filter(s=>new RegExp(`(^|[^a-z0-9])${s.ticker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}($|[^a-z0-9])`,'i').test(query)||(s.name!==s.ticker&&query.toLowerCase().includes(s.name.split(' ')[0].toLowerCase())));if(mentioned.length===1){selected=mentioned[0].ticker;$('#stock').value=selected;}
    const u=el('article','message user');u.append(el('div','message-name',`คุณ · ${selected||'Dashboard'}`),el('p',null,query));conversation.append(u);busy=true;controls();let result;
    const currentController=new AbortController();controller?.abort();controller=currentController;const timeout=setTimeout(()=>currentController.abort(),120000);
    loading=true;controls();
    // Determine whether the user explicitly named a specific stock in the query
    const specificStock=mentioned.length===1;
    // Whether the selected stock already has live data loaded
    const selectedHasData=!!knowledge.stocks.find(s=>s.ticker===selected&&s.quote);
    try{
      // Quick check: can we answer from already-loaded data (conversation or web docs)?
      const local=Nalin.answer(knowledge,query,selected);
      if(local.status==='conversation'||(local.citations?.length&&local.citations.every(c=>c.id.startsWith('web-')))){
        result=local;
      } else if(specificStock){
        // User explicitly mentioned a stock — refresh just that one
        const mode=/ราคา|price|quote/i.test(query)&&!/แนวรับ|แนวต้าน|support|resistance|nav/i.test(query)?'quote':'full';
        if(component){
          const nonce=crypto.randomUUID();
          await new Promise((resolve,reject)=>{pendingComponent.set(nonce,{resolve,reject});currentController.signal.addEventListener('abort',()=>{pendingComponent.delete(nonce);reject(new DOMException('Cancelled','AbortError'));},{once:true});postParent('streamlit:setComponentValue',{value:{ticker:selected,mode,nonce},dataType:'json'});}).then(data=>{if(data?.record)applyDashboardRecord(data.record,data.documents,mode);}).catch(()=>{});
        } else {
          await refreshAsset(selected,mode);
        }
        result=Nalin.answer(knowledge,query,selected);
      } else if(knowledge.stocks.length>0&&!selectedHasData){
        // No explicit ticker mentioned and selected stock has no data yet →
        // pull all catalog stocks so Nalin can find the right one or give an overview
        $('#snapshot-date').textContent='กำลังดึงข้อมูลหลักทรัพย์ทั้งหมดจาก Dashboard…';
        const mode=/ราคา|price|quote/i.test(query)&&!/แนวรับ|แนวต้าน|support|resistance|nav/i.test(query)?'quote':'full';
        if(component){
          const nonce=crypto.randomUUID();
          const data=await new Promise((resolve,reject)=>{pendingComponent.set(nonce,{resolve,reject});currentController.signal.addEventListener('abort',()=>{pendingComponent.delete(nonce);reject(new DOMException('Cancelled','AbortError'));},{once:true});postParent('streamlit:setComponentValue',{value:{ticker:selected,mode,nonce,scan_catalog:true},dataType:'json'});}).catch(()=>null);
          if(data?.record)applyDashboardRecord(data.record,data.documents,mode);
          if(Array.isArray(data?.envelope?.stocks))for(const r of data.envelope.stocks){try{applyDashboardRecord(r,data.envelope.documents,mode);}catch{}}
        } else {
          await refreshAllCatalog(mode,currentController.signal);
        }
        result=Nalin.answer(knowledge,query,selected);
      } else {
        // Selected stock already has data — just refresh it
        const mode=/ราคา|price|quote/i.test(query)&&!/แนวรับ|แนวต้าน|support|resistance|nav/i.test(query)?'quote':'full';
        if(!component)await refreshAsset(selected,mode).catch(()=>{});
        result=Nalin.answer(knowledge,query,selected);
      }
    }
    catch(e){result={status:'insufficient',title:'Dashboard ยังไม่มีข้อมูลที่พร้อมใช้ค่ะ',paragraphs:[e.name==='AbortError'?'แหล่งข้อมูลใช้เวลานานเกินไป กรุณาลองใหม่ค่ะ':e.message,'ฉันใช้ได้เฉพาะข้อมูลที่ Dashboard โหลดไว้ค่ะ กรุณาเปิดหน้าข้อมูลหุ้นใน Dashboard ก่อน'],facts:[],citations:[]};
    }finally{clearTimeout(timeout);busy=false;loading=false;controls();}
    showAnswer(result);$('#question').value='';$('#chat-form').scrollIntoView({block:'end',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return result;
  }
  $('#chat-form').onsubmit=e=>{e.preventDefault();if($('#question').value.trim())void ask($('#question').value);};
  $('#question').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chat-form').requestSubmit();}};
  document.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>{if(knowledge)ask(b.dataset.question);});
  $('#stock').onchange=selectStock;
  $('#refresh').onclick=selectStock;
  $('#ticker-form').onsubmit=async e=>{e.preventDefault();const ticker=$('#ticker-input').value.trim().toUpperCase();if(!/^[A-Z0-9.^=-]{1,25}$/.test(ticker)){$('#load-error').hidden=false;$('#load-error').textContent='กรุณาระบุ Ticker เช่น AAPL, VOO หรือ PTT.BK';return;}try{await refreshAsset(ticker,'quote');$('#stock').value=ticker;displayStock();$('#ticker-input').value='';}catch{}};
  if(!component)window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#install').hidden=false;});
  $('#install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#install').hidden=true;}};
  async function init(){try{const response=window.NALIN_BOOT?null:await fetch('knowledge.json',{cache:'no-store'});if(response&&!response.ok)throw Error('เปิดรายการหลักทรัพย์ไม่ได้');knowledge=Nalin.validate(window.NALIN_BOOT||await response.json());
    // Seed snapshot supplies a ticker menu and website documents, never current market facts.
    knowledge.stocks=knowledge.stocks.map(s=>({ticker:s.ticker,name:s.name,prices:[],statements:[],quarterly_statements:[]}));
    for(const ticker of ['VOO','IVV','SCHD','QQQ','SPY','PTT.BK'])if(!knowledge.stocks.some(s=>s.ticker===ticker))knowledge.stocks.push({ticker,name:ticker,prices:[],statements:[],quarterly_statements:[]});
    $('#stock').replaceChildren(...knowledge.stocks.map(s=>{const o=el('option',null,`${s.ticker} · ${s.name}`);o.value=s.ticker;return o;}));controls();
    if(component){if(componentArgs?.envelope?.stocks?.length){const r=componentArgs.envelope.stocks[0];applyDashboardRecord(r,componentArgs.envelope.documents);$('#stock').value=r.ticker;displayStock();$('#snapshot-date').textContent=`Dashboard ตรวจเมื่อ ${localTime(r.quote.retrieved)} · เวลาไทย`;}else if(componentArgs?.error){$('#load-error').hidden=false;$('#load-error').textContent=componentArgs.error;}}
    else{
      // Fetch catalog first so the dropdown already reflects Dashboard's known stocks
      await fetchCatalog();
      await selectStock();
    }
    if(document.modelContext?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});Promise.resolve(document.modelContext.registerTool({name:'ask_nalin',title:'ถามนลินจากข้อมูลเว็บ',description:'ถามและแสดงคำตอบที่มีหลักฐานจาก Portfolio Dashboard ในบทสนทนา',inputSchema:{type:'object',properties:{question:{type:'string',minLength:1,maxLength:2000}},required:['question'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute(input){if(!input||Object.keys(input).some(k=>k!=='question'))throw Error('รับเฉพาะ question');return ask(input.question);}},{signal:lifecycle.signal})).catch(()=>{});}
  }catch(error){$('#load-error').hidden=false;$('#load-error').textContent=`ยังตอบคำถามไม่ได้: ${error.message} กรุณาเปิดใหม่เมื่อมีชุดข้อมูลที่สมบูรณ์`;$('#send').disabled=true;$('#question').disabled=true;}}
  if('serviceWorker'in navigator && !window.NALIN_BOOT && !component)navigator.serviceWorker.register('sw.js').catch(()=>{});
  // Periodic quote refresh for the selected stock
  if(!component)setInterval(()=>{if(knowledge&&!busy&&!loading&&!document.hidden&&navigator.onLine)void refreshAsset($('#stock').value,'quote').catch(()=>{});},25000);
  // Periodic catalog refresh to pick up any new stocks Dashboard has loaded
  if(!component)setInterval(()=>{if(knowledge&&!busy&&!loading&&navigator.onLine)void fetchCatalog();},60000);
  window.addEventListener('online',()=>{if(knowledge&&!busy)void selectStock();});
  window.addEventListener('offline',()=>{$('#snapshot-date').textContent='ออฟไลน์ · ต้องเชื่อมต่อก่อนดึงข้อมูลล่าสุด';});
  init();
})();
