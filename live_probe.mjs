const urls=[
['chart','https://query1.finance.yahoo.com/v8/finance/chart/VOO?range=1y&interval=1d'],
['financials',`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL?type=annualTotalRevenue,annualNetIncome,annualOperatingCashFlow&lang=en-US&period1=1577836800&period2=${Math.floor(Date.now()/1000)}`],
['etf','https://query2.finance.yahoo.com/v10/finance/quoteSummary/VOO?modules=fundProfile,topHoldings,summaryDetail,assetProfile'],
['sec','https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json']];
await Promise.all(urls.map(async([name,url])=>{try{const r=await fetch(url,{headers:{'User-Agent':'NalinPortfolioCompanion/2.0 personal-financial-research','Accept':'application/json'},signal:AbortSignal.timeout(20000)});const p=await r.json();console.log(JSON.stringify({name,status:r.status,keys:Object.keys(p),chart:p.chart?.result?.[0]?.meta,timeseries:p.timeseries?.result?.map(x=>({meta:x.meta,keys:Object.keys(x),last:x.annualTotalRevenue?.at(-1)})),error:p.quoteSummary?.error||p.chart?.error,entity:p.entityName}));}catch(e){console.log(JSON.stringify({name,error:e.message}));}}));
