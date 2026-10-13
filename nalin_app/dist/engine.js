/* Deterministic answers from dated, validated evidence; no generated facts. */
(function(root){
  'use strict';
  const numeric = v => typeof v === 'number' && Number.isFinite(v);
  const dateOK = d => typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  const fmt = (v, d=2) => numeric(v) ? v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : 'ไม่มีข้อมูล';
  const safeUrl = u => {try {const x = new URL(u); return x.protocol==='https:' && !x.username && !x.password && ['finance.yahoo.com','data.sec.gov','www.sec.gov','investor.vanguard.com','www.ishares.com','www.schwabassetmanagement.com','www.ssga.com','www.avantisinvestors.com','res.avantisinvestors.com','www.ark-funds.com','www.vaneck.com','subversiveetfs.com','www.globalxetfs.com','www.ftportfolios.com','ftportfolios.com','am.jpmorgan.com','www.invesco.com','dng-api.invesco.com'].includes(x.hostname) ? x.href : null;}catch{return null;}};
  const refusal = (text='ฉันไม่พบหลักฐานที่เพียงพอสำหรับคำถามนี้ในข้อมูลของเว็บค่ะ ลองระบุหุ้น งวดบัญชี และหัวข้อที่ต้องการตรวจสอบ เช่น รายได้ กำไร FCF หรือแนวรับ–แนวต้านนะคะ') => ({status:'insufficient',title:'ข้อมูลยังไม่พอค่ะ',paragraphs:[text],facts:[],citations:[]});
  function validate(k){
    if(!k || k.schema_version!==1 || k.site_name!=='Portfolio Dashboard' || !Array.isArray(k.stocks) || !Array.isArray(k.documents) || Number.isNaN(Date.parse(k.exported_at))) throw Error('ชุดข้อมูลไม่ใช่รูปแบบของ Portfolio Dashboard');
    if(k.stocks.length>500 || k.documents.length>100) throw Error('ชุดข้อมูลใหญ่เกินขอบเขต');
    const seen=new Set();
    for(const s of k.stocks){
      if(!/^[A-Z0-9.^=-]{1,25}$/.test(s.ticker)||seen.has(s.ticker)||!Array.isArray(s.statements)||!Array.isArray(s.prices)) throw Error('ข้อมูลหุ้นไม่ถูกต้อง');
      seen.add(s.ticker);
      if(s.prices.length>5000 || s.statements.length>50) throw Error('ชุดข้อมูลหุ้นใหญ่เกินขอบเขต');
      let last='';
      for(const p of s.prices){
        if(!dateOK(p.date)||p.date<=last||!['open','high','low','close'].every(f=>numeric(p[f])&&p[f]>0)||p.high<Math.max(p.open,p.close,p.low)||p.low>Math.min(p.open,p.close,p.high)) throw Error('ราคา วันที่ หรือช่วง OHLC ไม่ถูกต้อง');
        last=p.date;
      }
      const periods=new Set();
      if(s.quarterly_statements && (!Array.isArray(s.quarterly_statements)||s.quarterly_statements.length>50))throw Error('งบไตรมาสไม่ถูกต้อง');
      for(const p of [...s.statements,...(s.quarterly_statements||[])]){
        const key=(p.period_type||'12M')+p.period;
        if(!dateOK(p.period)||periods.has(key)||!p.values||typeof p.values!=='object') throw Error('งวดบัญชีไม่ถูกต้อง');
        periods.add(key);
        for(const v of Object.values(p.values)) if(!numeric(v.value)||typeof v.source!=='string'||!safeUrl(v.url)) throw Error('งบไม่มีตัวเลขหรือที่มาที่ตรวจสอบได้');
      }
      if(s.quote&&(!numeric(s.quote.value)||s.quote.value<=0||!s.quote.currency||!safeUrl(s.quote.url)||Number.isNaN(Date.parse(s.quote.as_of))||Number.isNaN(Date.parse(s.quote.retrieved))))throw Error('ราคาล่าสุดไม่มีหลักฐานที่ครบ');
      if(s.fund){
        if(!Array.isArray(s.fund.facts)||!Array.isArray(s.fund.holdings)||s.fund.holdings.length>20000)throw Error('ข้อมูล ETF ไม่ถูกต้อง');
        for(const f of s.fund.facts)if(!safeUrl(f.url)||!(dateOK(f.as_of)||(f.as_of===null&&typeof f.date_note==='string'))||!(numeric(f.value)||typeof f.value==='string'))throw Error('ข้อมูล ETF ไม่มีที่มาและวันที่');
        if(s.fund.holdings.length&&(!dateOK(s.fund.as_of)||!safeUrl(s.fund.holdings_url)||s.fund.holdings.some(h=>!h.name||!numeric(h.weight))))throw Error('รายการถือครอง ETF ไม่มีหลักฐาน');
      }
      if(s.prices.length && (!safeUrl(s.price_url) || !s.price_currency || !s.price_source || !s.price_basis)) throw Error('ราคาไม่มีสกุลเงินหรือแหล่งข้อมูล');
    }
    for(const d of k.documents)if(typeof d.text!=='string'||typeof d.source!=='string'||!Array.isArray(d.keywords))throw Error('เอกสารอ้างอิงไม่ถูกต้อง');
    return k;
  }
  function citation(s,p,field){
    const v=p.values[field];
    return {id:`${s.ticker}:${p.period}:${field}`,title:`${s.ticker} · ${field} · ${p.period}`,source:v.source,url:safeUrl(v.url),
      text:`งวดสิ้นสุดตามแหล่งข้อมูล ${p.period} (${p.period_type||'12M'})\n${field} = ${fmt(v.value)} ${v.unit||'ไม่ระบุหน่วย'}\nดึงข้อมูล: ${s.retrieved}\nแหล่ง: ${v.source}\nไม่ถือว่า SEC ยืนยันค่าทุกช่อง`,value:v.value,period:p.period};
  }
  function financial(s,query){
    const quarter=/quarter|ไตรมาส|q[1-4]\b/i.test(query);
    if(/q[1-4]\b/i.test(query))return refusal('แหล่งข้อมูลระบุวันสิ้นงวด แต่ไม่มีป้าย Q1–Q4 ของปีบัญชีที่ยืนยันได้ค่ะ กรุณาถามไตรมาสล่าสุดหรือระบุปีของวันสิ้นงวด');
    let periods=[...(quarter?s.quarterly_statements||[]:s.statements)].sort((a,b)=>a.period.localeCompare(b.period));
    const kind=quarter?'ไตรมาส':'รายปี';
    const years=[...query.matchAll(/\b(20\d{2}|25\d{2})\b/g)].map(m=>+m[1]>2500?+m[1]-543:+m[1]);
    if(years.length>1)return refusal('กรุณาถามทีละงวดบัญชีค่ะ ฉันจะเทียบงวดนั้นกับงวดรายปีก่อนหน้าที่มีข้อมูลให้');
    let p=years.length ? periods.filter(p=>p.period.startsWith(String(years[0]))).at(-1) : periods.at(-1);
    if(!p)return refusal(`ไม่มีงบ${kind}${years.length?' ปี '+years[0]:''}ของ ${s.ticker} ในข้อมูลที่ดึงครั้งนี้ค่ะ ฉันไม่ใช้รายปีแทนไตรมาส`);
    let at=periods.indexOf(p),prev=quarter?periods.slice(0,at).findLast(v=>{const gap=(Date.parse(p.period)-Date.parse(v.period))/86400000;return gap>=330&&gap<=400;}):periods[at-1];
    if(prev){const gap=(Date.parse(p.period)-Date.parse(prev.period))/86400000;if(gap<330||gap>400)prev=null;}
    const units=new Set(Object.values(p.values).map(v=>v.unit));
    if(units.size!==1||!units.values().next().value)return refusal('หน่วยงบในงวดนี้ไม่ตรงกันหรือไม่ระบุค่ะ จึงไม่รวมตัวเลขต่างหน่วย');
    const currency=[...units][0];
    const result={status:'evidence',title:`${s.ticker} · งบ${kind}สิ้นสุด ${p.period}`,paragraphs:[`ฉันใช้ตัวเลขงบ${kind}ที่แหล่งข้อมูลเผยแพร่แล้วค่ะ หน่วย ${currency} · ดึงเมื่อ ${s.retrieved} วันที่งบเป็นป้ายงวดของผู้ให้บริการ`],facts:[],citations:[],warnings:[]};
    const value=f=>p.values[f]?.value;
    const add=(field,label)=>{if(p.values[field]){result.facts.push({label,value:`${fmt(value(field)/1e6)} ล้าน ${currency}`});result.citations.push(citation(s,p,field));}else result.warnings.push(`ไม่มี ${label} ในงวดนี้`);};
    const cash=/fcf|กระแสเงินสด|cash flow/i.test(query),debt=/หนี้|debt|equity|d\/e/i.test(query);
    const earnings=/รายได้|กำไร|revenue|profit|earnings|เติบโต|growth/i.test(query);
    if(earnings||(!cash&&!debt)){
      add('Total Revenue','รายได้');add('Net Income','กำไรสุทธิ');
      for(const [f,label] of [['Total Revenue','รายได้'],['Net Income','กำไรสุทธิ']]){
        const a=value(f),b=prev?.values[f]?.value;
        if(numeric(a)&&numeric(b)&&b>0&&prev.values[f].unit===currency){const growth=(a/b-1)*100;result.facts.push({label:`${label}เทียบงวด ${prev.period}`,value:`${growth>=0?'+':''}${fmt(growth)}%`});result.citations.push(citation(s,prev,f));result.paragraphs.push(`ผลคำนวณ ${label}เปลี่ยนแปลง ${fmt(growth)}% จาก (${fmt(a)} ÷ ${fmt(b)} − 1) × 100 ค่ะ`);}
        else result.warnings.push(`คำนวณการเติบโตของ${label}ไม่ได้: ไม่มีงวดปีก่อนที่ต่อเนื่อง หรือฐานไม่เป็นบวก`);
      }
      if(numeric(value('Net Income'))&&numeric(value('Total Revenue'))&&value('Total Revenue')>0){result.facts.push({label:'อัตรากำไรสุทธิ · ผลคำนวณ',value:`${fmt(value('Net Income')/value('Total Revenue')*100)}%`});result.paragraphs.push('อัตรากำไรสุทธิ = กำไรสุทธิ ÷ รายได้ × 100 ค่ะ');}
    }
    if(cash||(!earnings&&!debt)){
      add('Operating Cash Flow','กระแสเงินสดจากการดำเนินงาน');add('Capital Expenditure','CapEx · ค่าตามตารางงบ');
      const c=value('Operating Cash Flow'),x=value('Capital Expenditure');
      if(numeric(c)&&numeric(x)){const f=c-Math.abs(x);result.facts.push({label:'FCF · ผลคำนวณ',value:`${fmt(f/1e6)} ล้าน ${currency}`});result.paragraphs.push(`FCF = CFO − |CapEx| = ${fmt(c)} − ${fmt(Math.abs(x))} ค่ะ ผลนี้เป็นการคำนวณตามสูตรของเว็บ ไม่ใช่การคาดการณ์`);}
    }
    if(debt||(!cash&&!earnings)){
      add('Total Debt','หนี้สินที่มีดอกเบี้ย');add('Stockholders Equity','ส่วนผู้ถือหุ้น');
      const d=value('Total Debt'),e=value('Stockholders Equity');
      if(numeric(d)&&d>=0&&numeric(e)&&e>0){result.facts.push({label:'D/E · ผลคำนวณ',value:`${fmt(d/e)} เท่า`});result.paragraphs.push('D/E = หนี้สินที่มีดอกเบี้ย ÷ ส่วนผู้ถือหุ้นค่ะ');}
      else result.warnings.push('คำนวณ D/E ไม่ได้เมื่อข้อมูลขาด หรือส่วนผู้ถือหุ้นไม่เป็นบวก');
    }
    if(/ทั้งหมด|ทุก.*รายการ|full statement/i.test(query))for(const field of Object.keys(p.values))if(!result.citations.some(c=>c.title===`${s.ticker} · ${field} · ${p.period}`))add(field,field);
    result.citations=[...new Map(result.citations.map(c=>[c.id,c])).values()];
    if(!result.facts.length)return refusal(`งบ ${s.ticker} งวด ${p.period} ไม่มีตัวเลขเพียงพอสำหรับหัวข้อนี้ค่ะ`);
    if(s.warnings?.length)result.warnings.push(...s.warnings);
    return result;
  }
  function currentPrice(s){
    const q=s.quote;if(!q)return refusal('ยังไม่มีราคาที่ดึงออนไลน์พร้อมเวลาของผู้ให้บริการค่ะ ฉันไม่ใช้ราคาจากชุดข้อมูลเก่าแทนราคาปัจจุบัน');
    return {status:'evidence',title:`${s.ticker} · ราคาตาม Dashboard`,paragraphs:[`ราคา ${q.market_session||'ตลาดปกติ'} ณ ${q.as_of} · Dashboard ตรวจเมื่อ ${q.retrieved}`,`ราคาจาก ${q.source} อาจล่าช้าหรือเป็นราคาตลาดปิด ${q.delay_minutes==null?'ต้นทางไม่ได้ระบุเวลาหน่วง จึงไม่ยืนยันว่าเป็นราคา real time':`เวลาหน่วงที่ระบุ ${q.delay_minutes} นาที`}`],facts:[{label:'ราคาล่าสุดที่ Dashboard แสดง',value:`${fmt(q.value)} ${q.currency}`}],citations:[{id:`${s.ticker}:quote:${q.as_of}`,title:'ราคาพร้อมเวลา · Dashboard',source:q.source,url:q.url,text:`${s.ticker}\n${fmt(q.value)} ${q.currency}\nเวลาแหล่งข้อมูล ${q.as_of}\nDashboard ตรวจเมื่อ ${q.retrieved}\nตลาด ${q.exchange}\nช่วงราคา ${q.market_session||'ตลาดปกติ'}`} ]};
  }
  function fundAnswer(s,query=''){
    const f=s.fund;if(!f)return refusal('ยังไม่มีข้อมูล ETF ที่ดึงออนไลน์สำหรับหลักทรัพย์นี้ค่ะ');
    if(/dividend yield|อัตรา.*ปันผล|ยีลด์.*ปันผล/i.test(query)&&!f.facts.some(v=>/dividend yield/i.test(v.label)))return refusal('Dashboard ยังไม่มี dividend yield ที่ยืนยันได้ค่ะ ฉันไม่ใช้ SEC yield แทนอัตราปันผล');
    for(const [asked,field] of [[/ค่าธรรมเนียม|expense/i,'ค่าธรรมเนียม'],[/yield|ยีลด์/i,'yield'],[/nav/i,'NAV'],[/สินทรัพย์|aum/i,'สินทรัพย์']])if(asked.test(query)&&!f.facts.some(v=>v.label.toLowerCase().includes(field.toLowerCase())))return refusal(`ไม่มี ${field} ของ ${s.ticker} พร้อมวันที่และหลักฐานในข้อมูลที่ดึงครั้งนี้ค่ะ`);
    if(/ถือครอง|holdings/i.test(query)&&!f.holdings.length)return refusal(`ไม่มีรายการถือครองของ ${s.ticker} พร้อมวันที่ที่อ่านได้จากผู้จัดการกองทุนค่ะ`);
    const r={status:'evidence',title:`${s.ticker} · ข้อมูล ETF ที่เผยแพร่ล่าสุด`,paragraphs:[`ตรวจออนไลน์เมื่อ ${s.retrieved} · วันที่ค่าธรรมเนียม NAV และรายการถือครองอาจต่างกัน ข้อมูลเหล่านี้อัปเดตตามรอบเผยแพร่ของผู้จัดการกองทุนค่ะ`],facts:[],citations:[],warnings:[...(f.warnings||[])]};
    for(const v of f.facts){r.facts.push({label:`${v.label} · ${v.as_of||'ไม่ระบุวันที่มีผล'}`,value:`${numeric(v.value)?fmt(v.value):v.value} ${v.unit}`});r.citations.push({id:`${s.ticker}:fund:${v.label}`,title:v.label,source:v.source,url:v.url,text:`${v.label} = ${v.value} ${v.unit}\nวันที่ข้อมูล ${v.as_of||v.date_note}\nดึงเมื่อ ${s.retrieved}`});}
    if(f.strategy){r.paragraphs.push(`ข้อความกลยุทธ์จาก ${f.provider}: ${f.strategy}`);r.citations.push({id:`${s.ticker}:strategy`,title:'กลยุทธ์ตามข้อความผู้จัดการกองทุน',source:f.provider,url:f.page_url,text:f.strategy});}
    if(f.holdings.length){const top=[...f.holdings].sort((a,b)=>b.weight-a.weight).slice(0,10);r.facts.push(...top.map(h=>({label:`${h.ticker||h.name} · ${f.as_of}`,value:`${fmt(h.weight)}%`})));r.paragraphs.push(`แสดง 10 รายการที่มีน้ำหนักสูงสุดจาก ${f.holdings.length} รายการในไฟล์ ณ ${f.as_of} ไม่ถือว่าเป็นสถานะการถือครองแบบสด`);r.citations.push({id:`${s.ticker}:holdings:${f.as_of}`,title:'รายการถือครองจากผู้จัดการกองทุน',source:f.provider,url:f.holdings_url,text:`วันที่ ${f.as_of}\n${top.map(h=>`${h.ticker} · ${h.name} · ${h.weight}%`).join('\n')}\nดึงเมื่อ ${s.retrieved}`});}
    if(!r.facts.length&&!f.strategy)return refusal(`ดึงข้อมูล ETF ของ ${s.ticker} ไม่สำเร็จค่ะ ${(f.warnings||[]).join(' ')} คุณยังถามราคาหรือแนวรับ–แนวต้านจากราคาได้`);
    return r;
  }
  function technical(s,query,now){
    if(/นาที|ชั่วโมง|intraday|hour|minute|weekly|รายสัปดาห์|รายเดือน/i.test(query))return refusal('ชุดข้อมูลนี้มีแท่งราคารายวันค่ะ ฉันจึงยังวิเคราะห์กรอบเวลาที่ถามไม่ได้');
    const bars=s.prices.slice(-120);
    if(bars.length<30)return refusal(`ราคา ${s.ticker} ต้องมีอย่างน้อย 30 แท่งรายวันและระบุสกุลเงินก่อนวิเคราะห์ค่ะ ตอนนี้มี ${bars.length} แท่ง`);
    if(!s.price_currency)return refusal('ราคาไม่มีสกุลเงินที่ยืนยันได้ค่ะ');
    const latest=bars.at(-1),points=[];
    // Confirmed five-bar swings only: the two most recent bars cannot form pivots.
    for(let i=2;i<bars.length-2;i++){
      const w=bars.slice(i-2,i+3),b=bars[i];
      if(w.every((v,j)=>j===2||b.low<v.low))points.push({price:b.low,date:b.date,type:'low'});
      if(w.every((v,j)=>j===2||b.high>v.high))points.push({price:b.high,date:b.date,type:'high'});
    }
    const choose=type=>{
      const candidates=points.filter(p=>p.type===type&&(type==='low'?p.price<latest.close:p.price>latest.close)).sort((a,b)=>Math.abs(a.price-latest.close)-Math.abs(b.price-latest.close));
      const levels=[];
      for(const p of candidates){if(levels.every(l=>Math.abs(l.price-p.price)/l.price>0.005)){levels.push(p);if(levels.length===2)break;}}
      return levels;
    };
    const support=choose('low'),resistance=choose('high');
    const out={status:'calculation',title:`${s.ticker} · แนวรับและแนวต้านรายวัน`,paragraphs:[`ฉันคำนวณจาก ${bars.length} แท่งรายวัน ตั้งแต่ ${bars[0].date} ถึง ${latest.date} ค่ะ ใช้จุดต่ำ/สูงที่ต่ำ/สูงกว่าแท่งสองข้างฝั่งละ 2 แท่ง แล้วเลือกระดับที่ใกล้ราคาปิดที่สุด แยกระดับที่ห่างกันเกิน 0.5%`],facts:[{label:`ราคาปิด ${latest.date}`,value:`${fmt(latest.close)} ${s.price_currency}`}],citations:[],warnings:['แนวรับและแนวต้านเป็นจุดอ้างอิงจากอดีต ไม่ใช่ราคาที่รับประกันว่าจะหยุดหรือกลับตัว'],chart:{bars,levels:[...support.map(p=>({...p,label:'แนวรับ'})),...resistance.map(p=>({...p,label:'แนวต้าน'}))]}};
    for(const [list,label] of [[support,'แนวรับ'],[resistance,'แนวต้าน']]){
      list.forEach((p,i)=>out.facts.push({label:`${label} ${i+1} · จุดอ้างอิง ${p.date}`,value:`${fmt(p.price)} ${s.price_currency}`}));
      if(!list.length)out.warnings.push(`ไม่พบ${label}ตามวิธีนี้ในช่วงข้อมูล จึงไม่สร้างระดับสมมติค่ะ`);
    }
    if((now-Date.parse(latest.date))/86400000>4)out.warnings.push(`ราคาเก่ากว่า 4 วัน ณ ${new Date(now).toISOString().slice(0,10)} จึงไม่ควรใช้แทนแนวรับ–แนวต้านปัจจุบัน`);
    const selected=[latest,...[...support,...resistance].map(p=>bars.find(b=>b.date===p.date))];
    out.citations.push({id:`${s.ticker}:ohlc:${latest.date}`,title:`${s.ticker} · ราคา OHLC รายวัน`,source:s.price_source,url:safeUrl(s.price_url),text:`ช่วงข้อมูล ${bars[0].date} – ${latest.date}\nดึงข้อมูล ${s.price_retrieved}\nฐานราคา: ${s.price_basis}\n${selected.map(b=>`${b.date}: O ${fmt(b.open)} / H ${fmt(b.high)} / L ${fmt(b.low)} / C ${fmt(b.close)} ${s.price_currency}`).join('\n')}\nสูตร: จุดต่ำ/สูงยืนยันด้วย 2 แท่งก่อนและหลัง; แยกระดับที่ห่างกัน > 0.5%; เลือกใกล้ราคาปิดล่าสุด\nระดับทั้งหมดเป็นผลคำนวณของแอปจากข้อมูลเว็บ ไม่ใช่ข้อเท็จจริงเกี่ยวกับอนาคต`});
    return out;
  }
  function answer(k,query,selected,now=Date.now()){
    if(typeof query!=='string'||query.trim().length<1||query.length>2000)return refusal('กรุณาระบุคำถามไม่เกิน 2,000 ตัวอักษรค่ะ');
    query=query.trim();
    if(/ignore|system prompt|developer|jailbreak|แกล้ง|สมมติ.*(ราคา|รายได้|กำไร)|แต่ง(ข้อมูล|ตัวเลข)|ไม่ต้อง.*(อ้างอิง|หลักฐาน)|ลืม.*คำสั่ง/i.test(query))return refusal('ฉันจะตอบจากหลักฐานในเว็บเท่านั้นค่ะ ไม่แต่งข้อมูลหรือเปลี่ยนแหล่งข้อมูลตามข้อความในคำถาม');
    if(/พรุ่งนี้|อนาคต|จะขึ้น|จะลง|เป้าราคา|target price|forecast|predict|การันตี|รับประกัน|ซื้อดี|ควรซื้อ|ควรขาย|ข่าว|news/i.test(query))return refusal('ข้อมูลที่มีไม่เพียงพอสำหรับข่าว การพยากรณ์ หรือคำแนะนำซื้อขายค่ะ ฉันช่วยตรวจตัวเลขงบและระดับอ้างอิงจากอดีตได้');
    if(/^(สวัสดี|hello|hi|ขอบคุณ|thank you)[ค่ะครับ! .]*$/i.test(query))return {status:'conversation',title:'นลินอยู่ตรงนี้ค่ะ',paragraphs:['ฉันพร้อมช่วยคุณตรวจข้อมูลค่ะ ลองถามเรื่องงบ รายได้ กำไร กระแสเงินสด หรือแนวรับ–แนวต้านของหุ้นที่เลือกได้เลย'],facts:[],citations:[]};
    const mentioned=k.stocks.filter(s=>new RegExp(`(^|[^a-z0-9])${s.ticker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}($|[^a-z0-9])`,'i').test(query)|| (s.name!==s.ticker && query.toLowerCase().includes(s.name.split(' ')[0].toLowerCase())));
    const exempt=new Set(['FCF','CFO','CAPEX','ROE','ROIC','EPS','EBITDA','DCF','SEC','USD','THB','TTM','NAV','TWR','XIRR','OHLC','AI','ETF','PE','PB','GDP','CAGR','D/E','Q1','Q2','Q3','Q4','PRICE','QUOTE','LATEST','CURRENT','NOW','LIVE','REALTIME','REAL','TIME','YIELD','HOLDINGS','HOLDING','FUND','EXPENSE','RATIO','QUARTERLY','QUARTER','FULL','DIVIDEND','AUM','DISTRIBUTION','TRAILING']);
    const words=['WHAT','IS','ARE','THE','OF','AND','FOR','PLEASE','SHOW','ME','MY','ANALYZE','ANALYSIS','SUMMARIZE','SUMMARY','FINANCIAL','FINANCIALS','STATEMENT','STATEMENTS','ANNUAL','REVENUE','PROFIT','EARNINGS','GROWTH','CASH','FLOW','DEBT','EQUITY','SUPPORT','RESISTANCE','COMPANY','BUSINESS','ABOUT','HELLO','HI','THANK','YOU','FORMULA','METHOD','DATA','DASHBOARD','PORTFOLIO'];
    for(const w of words)exempt.add(w);
    for(const stock of k.stocks)exempt.add(stock.name.split(' ')[0].toUpperCase());
    const explicit=[...query.matchAll(/\b[a-z][a-z0-9.^=-]{1,24}\b/gi)].map(m=>m[0].toUpperCase()).filter(t=>!exempt.has(t));
    const unknown=explicit.find(t=>!k.stocks.some(s=>s.ticker===t));
    if(unknown)return refusal(`ไม่มีข้อมูลของ ${unknown} ในชุดข้อมูลเว็บนี้ค่ะ ฉันจะไม่ใช้ข้อมูลหุ้นอื่นมาตอบแทน`);
    if(mentioned.length>1)return refusal('กรุณาถามทีละหุ้นค่ะ เพื่อให้แหล่งอ้างอิงและงวดบัญชีตรงกับหุ้นที่ต้องการ');
    const s=mentioned[0]||k.stocks.find(s=>s.ticker===selected);
    if(/สูตร|คำนวณ.*อย่างไร|roe.*คือ|roic.*คือ|fcf.*คือ|cagr.*คือ|dcf.*คือ|เกณฑ์/i.test(query))return documentAnswer(k,'web-method');
    if(/ข้อจำกัด|ข้อมูลขาด|แหล่งข้อมูล|ล่าช้า|ข้อมูลครบ/i.test(query))return documentAnswer(k,'web-limitations');
    if(/เว็บ.*ทำอะไร|ฟังก์ชัน|ใช้งาน.*เว็บ|dashboard.*ทำอะไร/i.test(query))return documentAnswer(k,'web-features');
    if(!s)return refusal('กรุณาเลือกหุ้นที่มีข้อมูลในเว็บก่อนค่ะ');
    if(s.dashboard?.producer!=='Portfolio Dashboard'||s.dashboard?.scope!=='dashboard-viewed-data-only')return refusal('Dashboard ยังไม่มีข้อมูลหุ้นนี้ค่ะ กรุณาเปิดข้อมูลใน Dashboard ก่อน ฉันจะไม่ค้นหาเพิ่มจากภายนอก');
    if(/แนวรับ|แนวต้าน|support|resistance|เทคนิค/i.test(query))return technical(s,query,now);
    if(/ราคา|price|quote|realtime|real.time/i.test(query)&&!/nav/i.test(query))return currentPrice(s);
    if(s.instrument_type==='ETF'&&/etf|กองทุน|ค่าธรรมเนียม|ถือครอง|yield|ยีลด์|nav|expense|holdings|งบ|aum|สินทรัพย์/i.test(query))return fundAnswer(s,query);
    if(/roe|roic|eps|ebitda|cagr|dcf|p\/e|p\/b|gross margin/i.test(query))return refusal('หัวข้อนี้ยังไม่มีการคำนวณที่ตรวจสอบได้ในผู้ช่วยค่ะ คุณเปิดดูสูตรที่เว็บใช้ได้โดยถาม “สูตรวิเคราะห์งบ”');
    if(/งบ|การเงิน|รายได้|กำไร|หนี้|ทุน|กระแสเงินสด|เติบโต|revenue|earnings|profit|fcf|cash flow|debt|equity|d\/e|financial|growth/i.test(query))return financial(s,query);
    if(/บริษัท.*ทำอะไร|ธุรกิจ|ทำธุรกิจ|business|company/i.test(query)&&s.description)return {status:'excerpt',title:`${s.ticker} · ข้อมูลบริษัทที่เว็บแสดง`,paragraphs:[s.description],facts:[],citations:[{id:`${s.ticker}:description`,title:'ข้อความบริษัทจากเว็บ',source:'Portfolio Dashboard · About the Company',url:`https://finance.yahoo.com/quote/${s.ticker}/profile/`,text:s.description}]};
    return refusal();
  }
  function documentAnswer(k,id){const d=k.documents.find(d=>d.id===id);return d?{status:'excerpt',title:d.title,paragraphs:['ข้อความอ้างอิงจากเว็บค่ะ',d.text],facts:[],citations:[{id:d.id,title:d.title,source:d.source,text:d.text}]}:refusal();}
  const api={validate,answer,technical,financial,currentPrice,fundAnswer,fmt,safeUrl};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Nalin=api;
})(typeof globalThis!=='undefined'?globalThis:this);
