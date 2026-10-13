const headers={'User-Agent':'NalinPortfolioCompanion/2.0 personal-financial-research'};
const r=await fetch('https://fc.yahoo.com',{headers,signal:AbortSignal.timeout(12000)});
const cookie=(r.headers.getSetCookie?.()||[r.headers.get('set-cookie')]).filter(Boolean).map(x=>x.split(';')[0]).join('; ');
const cr=await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb',{headers:{...headers,Cookie:cookie},signal:AbortSignal.timeout(12000)});const crumb=await cr.text();
if(cr.ok){const q=await fetch('https://query2.finance.yahoo.com/v10/finance/quoteSummary/VOO?modules=fundProfile,topHoldings,summaryDetail,summaryProfile,quoteType&crumb='+encodeURIComponent(crumb),{headers:{...headers,Cookie:cookie},signal:AbortSignal.timeout(12000)});const p=await q.json();console.log(JSON.stringify({status:q.status,result:p.quoteSummary?.result?.[0],error:p.finance?.error||p.quoteSummary?.error}));}else console.log(JSON.stringify({crumbStatus:cr.status}));
const v=await fetch('https://investor.vanguard.com/irr/funds/profile/VOO-AdditionalFundData',{signal:AbortSignal.timeout(12000)});console.log(JSON.stringify({vanguard:v.status,keys:v.ok?Object.keys(await v.json()):[]}));
