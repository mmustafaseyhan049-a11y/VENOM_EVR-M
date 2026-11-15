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

// Optional sandbox multiplayer leaderboard/trading store. On Render Free, local filesystem is ephemeral.
const DATA_PATH=process.env.DATA_FILE||path.join(__dirname,'venom_online_data.json');
let db={players:{},trades:[]};
try{db=Object.assign(db,JSON.parse(fs.readFileSync(DATA_PATH,'utf8')))}catch{}
function saveDb(){try{fs.writeFileSync(DATA_PATH+'.tmp',JSON.stringify(db));fs.renameSync(DATA_PATH+'.tmp',DATA_PATH)}catch(e){console.error('Data save failed',e.message)}}
function readJson(req,res,callback){let data='';req.on('data',c=>{data+=c;if(data.length>16000)req.destroy()});req.on('end',()=>{try{callback(JSON.parse(data))}catch{return send(req,res,400,{ok:false,error:'Geçersiz JSON'})}})}
function validPlayer(id,token){return !!(db.players[id]&&db.players[id].token===token)}
function cleanPlayer(p){return {id:p.id,name:p.name,level:p.level,cash:p.cash,rebirth:p.rebirth}}


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

 if(p==='/api/leaderboard'&&req.method==='GET')return send(req,res,200,{ok:true,players:Object.values(db.players).sort((a,b)=>b.cash-a.cash).slice(0,100).map(cleanPlayer)});
 if(p==='/api/players'&&req.method==='POST')return readJson(req,res,v=>{
  const id=String(v.id||''),token=String(v.token||''),name=String(v.name||'').trim();
  if(!/^v_[a-f0-9]{24}$/.test(id)||!/^[a-f0-9]{64}$/.test(token)||!/^.{3,20}$/.test(name))return send(req,res,400,{ok:false,error:'Kimlik veya oyuncu adı geçersiz'});
  if(Object.values(db.players).some(a=>a.name.toLocaleLowerCase('tr')===name.toLocaleLowerCase('tr')&&a.id!==id))return send(req,res,409,{ok:false,error:'Bu oyuncu adı kullanılıyor.'});
  if(db.players[id]&&db.players[id].token!==token)return send(req,res,403,{ok:false,error:'Oyuncu kimliği doğrulanamadı'});
  const cash=Number(v.cash),level=Number(v.level),rebirth=Number(v.rebirth);
  if(![cash,level,rebirth].every(Number.isFinite)||cash<0||level<1||rebirth<0)return send(req,res,400,{ok:false,error:'Geçersiz veriler'});
  db.players[id]={id,token,name,cash,level,rebirth,updatedAt:Date.now()};saveDb();return send(req,res,200,{ok:true,player:cleanPlayer(db.players[id])});
 });
 if(p==='/api/trades'&&req.method==='GET'){
  const id=new URL(req.url,'http://localhost').searchParams.get('player');
  return send(req,res,200,{ok:true,trades:db.trades.filter(t=>t.to===id||t.from===id).slice(-30).map(t=>({id:t.id,from:t.from,to:t.to,fromName:t.fromName,toName:t.toName,pet:t.pet,status:t.status}))});
 }
 if(p==='/api/trades'&&req.method==='POST')return readJson(req,res,v=>{
  const action=String(v.action||''),id=String(v.id||v.playerId||''),token=String(v.token||'');
  if(!validPlayer(id,token))return send(req,res,403,{ok:false,error:'Önce oyuncu adıyla giriş yap.'});
  if(action==='create'){
   const recipient=Object.values(db.players).find(a=>a.name.toLocaleLowerCase('tr')===String(v.toName||'').trim().toLocaleLowerCase('tr'));
   const pet=Number(v.pet),owned=Array.isArray(v.ownedPets)?v.ownedPets:[];
   if(!recipient||recipient.id===id||!Number.isInteger(pet)||pet<1||pet>30||!owned.includes(pet))return send(req,res,400,{ok:false,error:'Alıcı veya pet geçersiz'});
   const t={id:crypto.randomBytes(8).toString('hex'),from:id,to:recipient.id,fromName:db.players[id].name,toName:recipient.name,pet,status:'pending',createdAt:Date.now()};
   db.trades.push(t);db.trades=db.trades.slice(-500);saveDb();return send(req,res,200,{ok:true,trade:t});
  }
  const t=db.trades.find(t=>t.id===String(v.id));if(!t||t.status!=='pending')return send(req,res,404,{ok:false,error:'Aktif takas bulunamadı'});
  if(action==='cancel'){if(t.from!==id)return send(req,res,403,{ok:false,error:'Yalnızca gönderen iptal edebilir'});t.status='cancelled'}
  else if(action==='accept'){if(t.to!==id)return send(req,res,403,{ok:false,error:'Bu teklif sana ait değil'});t.status='accepted'}
  else return send(req,res,400,{ok:false,error:'İşlem geçersiz'});
  saveDb();return send(req,res,200,{ok:true,trade:t});
 });

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
