import fs from 'node:fs/promises';
const types={html:'text/html',css:'text/css',js:'text/javascript',json:'application/json',webmanifest:'application/manifest+json',svg:'image/svg+xml'};
const assets={};
for(const name of ['index.html','style.css','app.js','engine.js','knowledge.json','sw.js','manifest.webmanifest','icon.svg'])assets['/'+name]={body:await fs.readFile('dist/'+name,'utf8'),type:types[name.split('.').at(-1)]+'; charset=utf-8'};
const worker=await fs.readFile('server/worker.mjs','utf8');
await fs.mkdir('dist/server',{recursive:true});
await fs.writeFile('dist/server/index.js','const ASSETS='+JSON.stringify(assets)+';\n'+worker);
console.log('Built Dashboard-only evidence Worker with '+Object.keys(assets).length+' assets');
