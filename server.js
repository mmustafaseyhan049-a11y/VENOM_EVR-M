// Venom Evrim live global-event API + the full game, deploy as Render Web Service.
// Node >=18, no npm dependencies. Set ADMIN_PASSWORD in Render environment variables.
'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const PORT=Number(process.env.PORT)||3000;
const PASSWORD=process.env.ADMIN_PASSWORD;
const INDEX=path.join(__dirname,'index.html');
let event={num:0,startedAt:0,endsAt:0,revision:0};
const attempts=new Map();

const sessions=new Map();
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.includes('=')).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)]}));}
function hasAdminSession(req){const token=cookies(req).venom_admin;const expires=token&&sessions.get(token);if(!expires)return false;if(expires<Date.now()){sessions.delete(token);return false;}return true;}
const newLogin="async function adminLogin(){const p=$('adminPassword').value;try{const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p}),credentials:'same-origin'});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Giriş başarısız');adminUnlocked=true;$('adminPassword').value='';$('adminLogin').hidden=true;$('adminControls').hidden=false;$('adminMessage').textContent='✓ Admin girişi doğrulandı.';$('adminMoney').focus();}catch(e){adminUnlocked=false;$('adminMessage').textContent=e.message;$('adminPassword').value='';}}";
function patchedHtml(source){
 let html=source;
 const begin=html.indexOf('function adminLogin(){');
 const finish=html.indexOf('function adminAdd(value)',begin);
 if(begin>=0 && finish>begin)html=html.slice(0,begin)+newLogin+'\n'+html.slice(finish);
 html=html.replace("headers:{'Content-Type':'application/json','X-Admin-Password':$('adminPassword').dataset.sessionPassword||''}","headers:{'Content-Type':'application/json'},credentials:'same-origin'");
 html=html.replace("function eventApiBase(){\n if(globalApi)return globalApi;\n // Same-origin mode for a Render Web Service serving the HTML plus /api/event.\n if(location.protocol==='http:'||location.protocol==='https:')return location.origin;\n return '';\n}","function eventApiBase(){return location.origin;}");
 html=html.replace('id="adminVisible"','id="adminVisible" style="display:none"');
 html=html.replace('🔐 Admin paneli: <b>Ü</b> tuşu','Oyuncu modu • Etkinlikleri otomatik takip eder');
 return html;
}

const origins=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim().replace(/\/$/,'')).filter(Boolean);
function allowOrigin(req){const origin=req.headers.origin||''; if(!origin)return '*';if(origins.length===0)return origin;return origins.includes(origin)?origin:'';}
function send(req,res,status,obj){const o=allowOrigin(req);if(o)res.setHeader('Access-Control-Allow-Origin',o);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Admin-Password');res.setHeader('Cache-Control','no-store');res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));}
function current(){if(event.num&&Date.now()>=event.endsAt){event={num:0,startedAt:0,endsAt:0,revision:event.revision+1};}return event;}
function safeEqual(a,b){const x=crypto.createHash('sha256').update(a).digest(),y=crypto.createHash('sha256').update(b).digest();return crypto.timingSafeEqual(x,y);}
http.createServer((req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 if(p==='/api/admin/login' && req.method==='POST'){
  if(!PASSWORD)return send(req,res,503,{ok:false,error:'Admin parolası sunucuda ayarlanmadı.'});
  const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  const a=attempts.get(ip)||{count:0,until:0},now=Date.now();
  if(a.until>now)return send(req,res,429,{ok:false,error:'Çok fazla deneme. Daha sonra tekrar deneyin.'});
  let raw='';req.on('data',b=>{raw+=b;if(raw.length>1024)req.destroy()});
  req.on('end',()=>{
    let password='';try{password=String(JSON.parse(raw).password||'')}catch{}
    if(!safeEqual(password,PASSWORD)){a.count++;if(a.count>=8){a.until=now+60000;a.count=0;}attempts.set(ip,a);return send(req,res,403,{ok:false,error:'Admin şifresi yanlış.'});}
    attempts.delete(ip);
    const token=crypto.randomBytes(32).toString('hex');
    sessions.set(token,Date.now()+12*3600*1000);
    res.setHeader('Set-Cookie','venom_admin='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200');
    return send(req,res,200,{ok:true});
  });return;
 }
 if(p==='/api/event'){
  if(req.method==='OPTIONS'){const o=allowOrigin(req);if(!o){res.writeHead(403);return res.end();}res.setHeader('Access-Control-Allow-Origin',o);res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Admin-Password');res.writeHead(204);return res.end();}
  if(!allowOrigin(req))return send(req,res,403,{ok:false,error:'Bu sitenin erişimine izin verilmedi.'});
  if(req.method==='GET')return send(req,res,200,{ok:true,event:current()});
  if(req.method!=='POST')return send(req,res,405,{ok:false,error:'Yöntem desteklenmiyor'});
  if(!PASSWORD)return send(req,res,503,{ok:false,error:'Sunucuda ADMIN_PASSWORD ayarlanmalı.'});
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  const a=attempts.get(ip)||{count:0,until:0};const now=Date.now();if(a.until>now)return send(req,res,429,{ok:false,error:'Çok fazla yanlış deneme, sonra tekrar dene.'});
  const received=hasAdminSession(req);
  if(!received){
   a.count++;if(a.count>=8){a.until=now+60000;a.count=0;}attempts.set(ip,a);
   return send(req,res,403,{ok:false,error:'Admin şifresi yanlış.'});
  }
  attempts.delete(ip);let raw='';req.on('data',chunk=>{raw+=chunk;if(raw.length>4096)req.destroy();});
  req.on('end',()=>{
   let d;try{d=JSON.parse(raw);}catch{return send(req,res,400,{ok:false,error:'Geçersiz veri'});}
   const num=Number(d.num),minutes=Number(d.minutes);
   if(!Number.isInteger(num)||num<0||num>4)return send(req,res,400,{ok:false,error:'Event 0–4 olmalı.'});
   if(!Number.isInteger(minutes)||minutes<1||minutes>120)return send(req,res,400,{ok:false,error:'Süre 1–120 dakika olmalı.'});
   const now=Date.now();event={num,startedAt:num?now:0,endsAt:num?now+minutes*60000:0,revision:event.revision+1};
   return send(req,res,200,{ok:true,event});
  });
  return;
 }
 if(p==='/'||p==='/index.html'){
  fs.readFile(INDEX,'utf8',(err,source)=>{if(err){res.writeHead(404);res.end('index.html missing');return;}const html=patchedHtml(source);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);});return;
 }
 if(p==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});res.end('OK');return;}
 res.writeHead(404);res.end('Not Found');
}).listen(PORT,'0.0.0.0',()=>console.log('Venom global events on port '+PORT));
