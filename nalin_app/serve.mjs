import http from 'node:http';
import fs from 'node:fs/promises';
const code=await fs.readFile('dist/server/index.js','utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).default;
http.createServer(async(req,res)=>{
  try{const response=await worker.fetch(new Request('http://127.0.0.1:8765'+req.url,{method:req.method}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}
  catch{res.writeHead(500);res.end('Preview failed');}
}).listen(8765,'127.0.0.1',()=>console.log('Nalin live preview http://127.0.0.1:8765'));
