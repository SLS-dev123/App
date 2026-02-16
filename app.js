#!/usr/bin/env node
/**
 * ███████╗██╗     ███████╗
 * ██╔════╝██║     ██╔════╝
 * ███████╗██║     ███████╗
 * ╚════██║██║     ╚════██║
 * ███████║███████╗███████║
 * ╚══════╝╚══════╝╚══════╝
 *
 * Secure Local Social — Unified App
 * Backend + Frontend in a single file
 * Run: node sls.js  →  open http://localhost:3000
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────
//  SERVER SETUP
// ─────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST','PUT','DELETE'] } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/\s/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─────────────────────────────────────────────
//  IN-MEMORY DATABASE
// ─────────────────────────────────────────────
const db = {
  users:    new Map(),  // phone → user
  sessions: new Map(),  // token → phone
  messages: new Map(),  // convId → [msg]
  stories:  [],
  calls:    new Map(),
};

// Seed demo users
[
  { phone: '+237677001122', name: 'Alice Mbeki',    status: '📚 Student @ University of Yaounde I', online: true  },
  { phone: '+237699334455', name: 'Bruno Tchoupo',  status: '🎵 Music producer · Douala',           online: false },
  { phone: '+237651778899', name: 'Clara Nkomo',    status: '💼 Available anytime',                 online: true  },
  { phone: '+237622445566', name: 'David Essama',   status: '🌍 Yaoundé, Cameroon',                 online: false },
  { phone: '+237677889900', name: 'Esther Biya',    status: '🌺 Good vibes only',                   online: true  },
  { phone: '+237655123456', name: 'Francois Ateba', status: '🏥 Doctor | CHUY',                     online: false },
].forEach(u => db.users.set(u.phone, { ...u, lastSeen: Date.now() - Math.random()*3.6e6, createdAt: Date.now() }));

// Seed demo messages
const seedConv = (p1, p2, msgs) => {
  const cid = [p1,p2].sort().join('_');
  db.messages.set(cid, msgs.map((m,i) => ({
    id: 'seed_'+i, from: m.f, to: m.t, text: m.txt,
    type:'text', read:true, delivered:true,
    createdAt: Date.now() - (msgs.length-i)*600000
  })));
};
seedConv('+237677001122','+237699334455',[
  {f:'+237677001122',t:'+237699334455',txt:'Hey Bruno! How are you?'},
  {f:'+237699334455',t:'+237677001122',txt:'Am great! Working on a new beat 🎵'},
  {f:'+237677001122',t:'+237699334455',txt:'That sounds amazing! Can\'t wait to hear it 🔥'},
]);
seedConv('+237677001122','+237651778899',[
  {f:'+237651778899',t:'+237677001122',txt:'Are you coming to the meeting tomorrow?'},
  {f:'+237677001122',t:'+237651778899',txt:'Yes! I\'ll be there at 9am 👍'},
]);

// Seed a story
db.stories.push({
  id:'story_seed1', authorPhone:'+237651778899',
  type:'text', media:null, caption:'Good morning Cameroon! 🇨🇲',
  bgColor:'#0f3460', views:[],
  createdAt: Date.now()-2*3.6e6, expiresAt: Date.now()+22*3.6e6
});

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
const genToken  = () => Math.random().toString(36).substr(2) + Date.now().toString(36);
const convId    = (a,b) => [a,b].sort().join('_');
const normalize = phone => {
  let p = String(phone).replace(/[\s\-]/g,'');
  if (!p.startsWith('+237')) p = p.startsWith('237') ? '+'+p : '+237'+p;
  return p;
};
const auth = (req,res,next) => {
  const token = req.headers.authorization?.replace('Bearer ','');
  if (!token || !db.sessions.has(token)) return res.status(401).json({error:'Unauthorized'});
  req.me = db.sessions.get(token);
  next();
};
const cleanStories = () => { const now=Date.now(); db.stories=db.stories.filter(s=>now<s.expiresAt); };

// ─────────────────────────────────────────────
//  AUTH ROUTES
// ─────────────────────────────────────────────
app.post('/api/auth/register', (req,res) => {
  const { name, phone } = req.body;
  const p = normalize(phone||'');
  if (!/^\+237[6-9]\d{8}$/.test(p))
    return res.status(400).json({error:'Enter a valid Cameroonian number (6XXXXXXXX)'});
  if (db.users.has(p))
    return res.status(400).json({error:'Phone already registered'});
  const user = { phone:p, name:name||'User '+p.slice(-4), status:'Hey there! I am using SLS',
                 avatar:null, online:true, lastSeen:Date.now(), createdAt:Date.now() };
  db.users.set(p, user);
  const token = genToken();
  db.sessions.set(token, p);
  res.json({ token, user });
});

app.post('/api/auth/login', (req,res) => {
  const p = normalize(req.body.phone||'');
  const user = db.users.get(p);
  if (!user) return res.status(404).json({error:'Phone not found — please register first'});
  user.online=true; user.lastSeen=Date.now();
  const token = genToken();
  db.sessions.set(token, p);
  res.json({ token, user });
});

app.post('/api/auth/logout', auth, (req,res) => {
  const token = req.headers.authorization?.replace('Bearer ','');
  const u = db.users.get(req.me);
  if (u) { u.online=false; u.lastSeen=Date.now(); }
  db.sessions.delete(token);
  res.json({ok:true});
});

// ─────────────────────────────────────────────
//  USER ROUTES
// ─────────────────────────────────────────────
app.get('/api/users/me', auth, (req,res) => res.json(db.users.get(req.me)));

app.put('/api/users/me', auth, (req,res) => {
  const u = db.users.get(req.me);
  const { name, status, avatar } = req.body;
  if (name)              u.name   = name;
  if (status!==undefined) u.status = status;
  if (avatar!==undefined) u.avatar = avatar;
  io.emit('user:updated', u);
  res.json(u);
});

app.get('/api/users', auth, (req,res) => {
  const list=[];
  db.users.forEach((u,p) => { if(p!==req.me) list.push(u); });
  res.json(list);
});

app.get('/api/users/search', auth, (req,res) => {
  const q=(req.query.q||'').toLowerCase();
  if (q.length<1) return res.json([]);
  const out=[];
  db.users.forEach((u,p) => {
    if (p!==req.me && (p.includes(q)||u.name.toLowerCase().includes(q))) out.push(u);
  });
  res.json(out.slice(0,20));
});

app.get('/api/users/:phone', auth, (req,res) => {
  const u = db.users.get(decodeURIComponent(req.params.phone));
  if (!u) return res.status(404).json({error:'Not found'});
  res.json(u);
});

// ─────────────────────────────────────────────
//  CONVERSATION & MESSAGE ROUTES
// ─────────────────────────────────────────────
app.get('/api/conversations', auth, (req,res) => {
  const me=req.me, list=[];
  db.messages.forEach((msgs, cid) => {
    if (!cid.includes(me)) return;
    const otherPhone = cid.split('_').find(p=>p!==me);
    const other = db.users.get(otherPhone);
    if (!other) return;
    const last = msgs[msgs.length-1];
    list.push({ id:cid, with:other, lastMessage:last,
                unread:msgs.filter(m=>m.to===me&&!m.read).length,
                updatedAt:last?.createdAt||0 });
  });
  res.json(list.sort((a,b)=>b.updatedAt-a.updatedAt));
});

app.get('/api/messages/:phone', auth, (req,res) => {
  const other = decodeURIComponent(req.params.phone);
  const cid = convId(req.me, other);
  const msgs = db.messages.get(cid)||[];
  msgs.forEach(m => { if(m.to===req.me&&!m.read){ m.read=true; m.readAt=Date.now(); } });
  res.json(msgs);
});

app.post('/api/messages/:phone', auth, (req,res) => {
  const toPhone = decodeURIComponent(req.params.phone);
  const toUser = db.users.get(toPhone);
  if (!toUser) return res.status(404).json({error:'User not found'});
  const { text, type='text', media=null, replyTo=null, replyToText='' } = req.body;
  const cid = convId(req.me, toPhone);
  const msg = { id:genToken(), from:req.me, to:toPhone, text, type, media,
                replyTo, replyToText, read:false, delivered:toUser.online, createdAt:Date.now() };
  if (!db.messages.has(cid)) db.messages.set(cid,[]);
  db.messages.get(cid).push(msg);
  io.to(`u:${toPhone}`).emit('msg:new', { cid, msg });
  io.to(`u:${req.me}`).emit('msg:sent', { cid, msg });
  res.json(msg);
});

app.delete('/api/messages/:phone/:msgId', auth, (req,res) => {
  const other = decodeURIComponent(req.params.phone);
  const cid = convId(req.me, other);
  const msgs = db.messages.get(cid);
  if (!msgs) return res.status(404).json({error:'Not found'});
  const m = msgs.find(x=>x.id===req.params.msgId && x.from===req.me);
  if (!m) return res.status(403).json({error:'Forbidden'});
  m.deleted=true; m.text='This message was deleted';
  io.to(`u:${other}`).emit('msg:deleted', { cid, msgId:m.id });
  res.json({ok:true});
});

app.post('/api/upload', auth, upload.single('file'), (req,res) => {
  if (!req.file) return res.status(400).json({error:'No file'});
  res.json({ url:`/uploads/${req.file.filename}` });
});

// ─────────────────────────────────────────────
//  STORY ROUTES
// ─────────────────────────────────────────────
app.get('/api/stories', auth, (req,res) => {
  cleanStories();
  const map = new Map();
  db.stories.forEach(s => {
    if (!map.has(s.authorPhone)) map.set(s.authorPhone,{user:db.users.get(s.authorPhone),stories:[]});
    map.get(s.authorPhone).stories.push(s);
  });
  const me=req.me;
  res.json([...map.values()].filter(x=>x.user).sort((a,b)=>{
    if (a.user.phone===me) return -1;
    if (b.user.phone===me) return 1;
    return 0;
  }));
});

app.post('/api/stories', auth, (req,res) => {
  const { media, type='image', caption='', bgColor='#1a1a2e' } = req.body;
  const s = { id:genToken(), authorPhone:req.me, media, type, caption, bgColor,
               views:[], createdAt:Date.now(), expiresAt:Date.now()+24*3.6e6 };
  db.stories.push(s);
  io.emit('story:new', { story:s, user:db.users.get(req.me) });
  res.json(s);
});

app.post('/api/stories/:id/view', auth, (req,res) => {
  const s = db.stories.find(x=>x.id===req.params.id);
  if (!s) return res.status(404).json({error:'Not found'});
  if (!s.views.includes(req.me)) {
    s.views.push(req.me);
    io.to(`u:${s.authorPhone}`).emit('story:viewed',{ storyId:s.id, viewer:db.users.get(req.me) });
  }
  res.json({ok:true});
});

// ─────────────────────────────────────────────
//  CALL ROUTES
// ─────────────────────────────────────────────
app.post('/api/calls/start', auth, (req,res) => {
  const { toPhone, type='voice' } = req.body;
  const toUser = db.users.get(toPhone);
  if (!toUser) return res.status(404).json({error:'User not found'});
  const callId = genToken();
  db.calls.set(callId,{ id:callId, from:req.me, to:toPhone, type, status:'ringing', createdAt:Date.now() });
  io.to(`u:${toPhone}`).emit('call:incoming',{ callId, caller:db.users.get(req.me), type });
  res.json({ callId });
});

app.post('/api/calls/:id/answer', auth, (req,res) => {
  const c=db.calls.get(req.params.id);
  if (!c) return res.status(404).json({error:'Not found'});
  c.status='active'; c.startedAt=Date.now();
  io.to(`u:${c.from}`).emit('call:answered',{ callId:c.id });
  res.json({ok:true});
});

app.post('/api/calls/:id/end', auth, (req,res) => {
  const c=db.calls.get(req.params.id);
  if (!c) return res.status(404).json({error:'Not found'});
  c.status='ended'; c.endedAt=Date.now();
  const other = c.from===req.me ? c.to : c.from;
  io.to(`u:${other}`).emit('call:ended',{ callId:c.id });
  res.json({ok:true});
});

// ─────────────────────────────────────────────
//  SOCKET.IO — real-time layer
// ─────────────────────────────────────────────
const socketMap = new Map(); // socketId → phone

io.on('connection', socket => {
  socket.on('auth', token => {
    const phone = db.sessions.get(token);
    if (!phone) return;
    socketMap.set(socket.id, phone);
    socket.join(`u:${phone}`);
    const u = db.users.get(phone);
    if (u) { u.online=true; u.lastSeen=Date.now(); }
    io.emit('user:status', { phone, online:true });
    socket.emit('auth:ok', { phone });
  });

  socket.on('typing:start', ({ to }) => {
    const from = socketMap.get(socket.id);
    if (from) io.to(`u:${to}`).emit('typing:start', { from });
  });
  socket.on('typing:stop', ({ to }) => {
    const from = socketMap.get(socket.id);
    if (from) io.to(`u:${to}`).emit('typing:stop', { from });
  });

  // WebRTC signaling for real peer-to-peer calls
  socket.on('rtc:offer',  ({ to, offer,     callId }) => io.to(`u:${to}`).emit('rtc:offer',  { from:socketMap.get(socket.id), offer,     callId }));
  socket.on('rtc:answer', ({ to, answer,    callId }) => io.to(`u:${to}`).emit('rtc:answer', { answer,    callId }));
  socket.on('rtc:ice',    ({ to, candidate         }) => io.to(`u:${to}`).emit('rtc:ice',    { candidate }));

  socket.on('disconnect', () => {
    const phone = socketMap.get(socket.id);
    if (phone) {
      const u = db.users.get(phone);
      if (u) { u.online=false; u.lastSeen=Date.now(); }
      io.emit('user:status', { phone, online:false, lastSeen:u?.lastSeen });
      socketMap.delete(socket.id);
    }
  });
});

// ─────────────────────────────────────────────
//  FRONTEND HTML  (inline — zero external files)
// ─────────────────────────────────────────────
const FRONTEND = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>SLS — Secure Local Social</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ac:#00C2A8;--ac2:#0088CC;--glow:rgba(0,194,168,.28);
  --red:#FF4757;--warn:#FFA502;--grn:#2ED573;
  --bg0:#0D1117;--bg1:#161B22;--bg2:#21262D;--bgh:#2D333B;--bgi:#1C2128;
  --bdr:#30363D;--t0:#E6EDF3;--t1:#8B949E;--t2:#484F58;
  --bo:#1a4a3a;--bi:#21262D;--bot:#E6EDF3;--bit:#E6EDF3;
  --sh:rgba(0,0,0,.45);--mb:rgba(0,0,0,.65);
}
[data-theme=light]{
  --bg0:#EEF3F9;--bg1:#FFFFFF;--bg2:#E8EFF7;--bgh:#DCE7F2;--bgi:#F5F8FC;
  --bdr:#C8D8E8;--t0:#192637;--t1:#4E6A85;--t2:#8AAAC4;
  --bo:#00C2A8;--bi:#FFFFFF;--bot:#FFF;--bit:#192637;
  --sh:rgba(0,0,0,.1);--mb:rgba(0,0,0,.4);
}
html,body{height:100%;font-family:'Outfit',sans-serif;background:var(--bg0);color:var(--t0);overflow:hidden}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--bdr);border-radius:2px}
/* ── AUTH ── */
#auth{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg0);z-index:1000;transition:opacity .4s,transform .4s}
#auth.gone{opacity:0;pointer-events:none;transform:scale(.97)}
.acard{background:var(--bg1);border:1px solid var(--bdr);border-radius:22px;padding:40px;width:100%;max-width:430px;box-shadow:0 24px 64px var(--sh)}
.alogo{text-align:center;margin-bottom:32px}
.alogo .mark{font-size:52px;font-weight:800;background:linear-gradient(135deg,var(--ac),var(--ac2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1}
.alogo .sub{font-size:11px;color:var(--t1);letter-spacing:5px;text-transform:uppercase;margin-top:5px}
.atabs{display:flex;gap:4px;background:var(--bg2);border-radius:12px;padding:4px;margin-bottom:26px}
.atab{flex:1;padding:10px;border:none;border-radius:8px;background:transparent;cursor:pointer;font-family:'Outfit',sans-serif;font-size:14px;font-weight:500;color:var(--t1);transition:all .2s}
.atab.on{background:var(--ac);color:#fff;box-shadow:0 4px 14px var(--glow)}
.fg{margin-bottom:16px}
.fg label{display:block;font-size:11px;font-weight:600;color:var(--t1);margin-bottom:6px;letter-spacing:.8px;text-transform:uppercase}
.fg input{width:100%;padding:12px 16px;background:var(--bgi);border:1px solid var(--bdr);border-radius:10px;color:var(--t0);font-family:'Outfit',sans-serif;font-size:15px;outline:none;transition:border-color .2s,box-shadow .2s}
.fg input:focus{border-color:var(--ac);box-shadow:0 0 0 3px var(--glow)}
.pfx{display:flex;gap:8px}
.pfxlabel{padding:12px 14px;background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;color:var(--t1);font-size:14px;white-space:nowrap;display:flex;align-items:center;gap:6px}
.btnp{width:100%;padding:14px;background:linear-gradient(135deg,var(--ac),var(--ac2));border:none;border-radius:10px;cursor:pointer;color:#fff;font-family:'Outfit',sans-serif;font-size:15px;font-weight:700;box-shadow:0 4px 20px var(--glow);transition:transform .15s,box-shadow .15s}
.btnp:hover{transform:translateY(-1px);box-shadow:0 6px 28px var(--glow)}
.btnp:active{transform:translateY(0)}
.aerr{background:rgba(255,71,87,.1);border:1px solid rgba(255,71,87,.3);border-radius:8px;padding:10px 14px;color:var(--red);font-size:13px;margin-bottom:14px;display:none}
.aerr.on{display:block}
/* ── APP SHELL ── */
#app{display:grid;grid-template-columns:320px 1fr;height:100vh;opacity:0;transition:opacity .4s}
#app.vis{opacity:1}
/* ── SIDEBAR ── */
.sb{background:var(--bg1);border-right:1px solid var(--bdr);display:flex;flex-direction:column;overflow:hidden}
.sbh{padding:14px 18px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px}
.sblogo{font-size:22px;font-weight:800;background:linear-gradient(135deg,var(--ac),var(--ac2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;flex:1}
.ibtn{width:36px;height:36px;border:none;cursor:pointer;background:var(--bg2);border-radius:8px;color:var(--t1);font-size:15px;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
.ibtn:hover{background:var(--bgh);color:var(--ac)}
.navtabs{display:flex;border-bottom:1px solid var(--bdr)}
.navtab{flex:1;padding:12px 6px;background:none;border:none;cursor:pointer;color:var(--t1);font-size:18px;transition:all .2s;position:relative}
.navtab.on{color:var(--ac)}
.navtab.on::after{content:'';position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:22px;height:2px;background:var(--ac);border-radius:1px}
.navtab .bdg{position:absolute;top:6px;right:50%;transform:translateX(10px);background:var(--red);color:#fff;font-size:9px;font-weight:700;font-family:'Outfit',sans-serif;min-width:16px;height:16px;border-radius:8px;display:none;align-items:center;justify-content:center;padding:0 3px}
.navtab .bdg.on{display:flex}
.sbsearch{padding:11px 15px;border-bottom:1px solid var(--bdr)}
.sbox{position:relative}
.sbox input{width:100%;padding:9px 12px 9px 34px;background:var(--bg2);border:1px solid var(--bdr);border-radius:20px;color:var(--t0);font-family:'Outfit',sans-serif;font-size:13px;outline:none;transition:border-color .2s}
.sbox input:focus{border-color:var(--ac)}
.sbox .si{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--t2);font-size:13px}
.sbody{flex:1;overflow-y:auto}
/* ── CONTACT ROW ── */
.crow{display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;transition:background .15s;position:relative}
.crow:hover{background:var(--bgh)}
.crow.on{background:var(--bg2)}
.avw{position:relative;flex-shrink:0}
.av{width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,var(--ac),var(--ac2));display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;color:#fff;overflow:hidden;user-select:none;flex-shrink:0}
.av img{width:100%;height:100%;object-fit:cover}
.av.sm{width:36px;height:36px;font-size:13px}
.av.lg{width:64px;height:64px;font-size:24px}
.av.xl{width:80px;height:80px;font-size:30px}
.dot{position:absolute;bottom:2px;right:2px;width:10px;height:10px;border-radius:50%;background:var(--grn);border:2px solid var(--bg1)}
.dot.off{background:var(--t2)}
.cinfo{flex:1;min-width:0}
.cname{font-size:14px;font-weight:600;color:var(--t0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cprev{font-size:12px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.cmeta{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.ctime{font-size:11px;color:var(--t2)}
.ubdg{background:var(--ac);color:#fff;font-size:10px;font-weight:700;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px}
/* ── STORIES PANEL ── */
.stpanel{padding:14px 14px 8px}
.strow{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none}
.strow::-webkit-scrollbar{display:none}
.stbub{flex-shrink:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px}
.string{width:58px;height:58px;border-radius:50%;padding:2.5px;background:linear-gradient(135deg,var(--ac),var(--ac2));transition:transform .2s}
.string.unseen{background:linear-gradient(135deg,#FFA502,#FF6348,#FF4757)}
.string:hover{transform:scale(1.08)}
.string.add{background:var(--bg2);border:2px dashed var(--bdr);padding:0;display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--t1)}
.string .av{width:100%;height:100%;border-radius:50%;border:2px solid var(--bg1)}
.stname{font-size:11px;color:var(--t1);max-width:62px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* ── MAIN AREA ── */
.main{display:flex;flex-direction:column;background:var(--bg0);overflow:hidden}
.empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--t2);gap:10px}
.empty .ei{font-size:64px;opacity:.35}
/* ── CHAT HEADER ── */
.chdr{padding:12px 18px;background:var(--bg1);border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:12px}
.chdrinfo{flex:1;min-width:0}
.chdrname{font-size:15px;font-weight:700;color:var(--t0)}
.chdrst{font-size:12px;color:var(--ac)}
.chdrst.off{color:var(--t2)}
.cacts{display:flex;gap:8px}
/* ── MESSAGES ── */
.mwrap{flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:3px}
.ddiv{text-align:center;margin:10px 0}
.ddiv span{background:var(--bg2);color:var(--t1);font-size:11px;padding:4px 12px;border-radius:20px}
.mrow{display:flex;gap:8px;animation:mIn .2s ease-out}
@keyframes mIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.mrow.out{flex-direction:row-reverse}
.bub{max-width:68%;padding:9px 13px;border-radius:18px;position:relative;word-break:break-word;cursor:context-menu}
.mrow.in .bub{background:var(--bi);color:var(--bit);border-bottom-left-radius:4px}
.mrow.out .bub{background:var(--bo);color:var(--bot);border-bottom-right-radius:4px}
.bub.del{opacity:.5}
.btxt{font-size:14px;line-height:1.5}
.btime{font-size:10px;color:var(--t2);text-align:right;margin-top:4px;display:flex;align-items:center;justify-content:flex-end;gap:3px}
.mrow.out .btime{color:rgba(255,255,255,.45)}
.rtick{font-size:11px}.rtick.read{color:var(--ac)}
.bmedia{max-width:280px;border-radius:12px;overflow:hidden;margin-bottom:5px}
.bmedia img{width:100%;display:block;cursor:zoom-in}
.rply{border-left:3px solid var(--ac);padding:5px 9px;background:rgba(0,194,168,.08);border-radius:6px;margin-bottom:7px;cursor:pointer}
.rply .rf{font-size:11px;color:var(--ac);font-weight:700}
.rply .rt{font-size:12px;color:var(--t1)}
.typi{display:none;padding:8px 13px;background:var(--bi);border-radius:18px;border-bottom-left-radius:4px;width:fit-content;gap:4px;align-items:center}
.typi.on{display:flex}
.tdot{width:6px;height:6px;border-radius:50%;background:var(--t2);animation:tb 1.2s infinite}
.tdot:nth-child(2){animation-delay:.2s}.tdot:nth-child(3){animation-delay:.4s}
@keyframes tb{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
/* ── INPUT ── */
.cinput{padding:11px 15px;background:var(--bg1);border-top:1px solid var(--bdr)}
.rbar{display:none;align-items:center;gap:10px;padding:7px 12px;background:var(--bg2);border-radius:10px;margin-bottom:9px;border-left:3px solid var(--ac)}
.rbar.on{display:flex}
.rbinfo{flex:1;min-width:0}
.rbn{font-size:11px;color:var(--ac);font-weight:700}
.rbt{font-size:12px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rbx{background:none;border:none;cursor:pointer;color:var(--t2);font-size:16px;padding:2px}
.irow{display:flex;gap:9px;align-items:flex-end}
.ifield{width:100%;padding:10px 15px;background:var(--bgi);border:1px solid var(--bdr);border-radius:22px;color:var(--t0);font-family:'Outfit',sans-serif;font-size:14px;outline:none;resize:none;max-height:120px;transition:border-color .2s;line-height:1.4}
.ifield:focus{border-color:var(--ac)}
.sbtn{width:44px;height:44px;border:none;cursor:pointer;background:linear-gradient(135deg,var(--ac),var(--ac2));border-radius:50%;color:#fff;font-size:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px var(--glow);transition:transform .15s;flex-shrink:0}
.sbtn:hover{transform:scale(1.08)}
/* ── STORY VIEWER ── */
#sv{position:fixed;inset:0;z-index:900;background:#000;display:none;flex-direction:column;align-items:center;justify-content:center}
#sv.on{display:flex}
.sprog{position:absolute;top:0;left:0;right:0;display:flex;gap:4px;padding:12px 14px 0;z-index:10}
.sbar{flex:1;height:3px;background:rgba(255,255,255,.25);border-radius:2px;overflow:hidden}
.sfill{height:100%;background:#fff;border-radius:2px;transition:width .1s linear}
.shdr{position:absolute;top:26px;left:0;right:0;display:flex;align-items:center;gap:12px;padding:10px 14px;z-index:10}
.sinfo{flex:1}
.sname{font-size:14px;font-weight:700;color:#fff}
.stime{font-size:11px;color:rgba(255,255,255,.6)}
.sclose{background:rgba(255,255,255,.18);border:none;cursor:pointer;color:#fff;font-size:20px;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.smedia{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.smedia img{max-width:100%;max-height:100%;object-fit:contain}
.stxt{width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:60px 32px}
.stxt p{font-size:28px;font-weight:700;color:#fff;text-align:center;line-height:1.4;text-shadow:0 2px 10px rgba(0,0,0,.5)}
.scap{position:absolute;bottom:80px;left:14px;right:14px;text-align:center;font-size:15px;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.8)}
.snl{position:absolute;top:0;bottom:0;width:35%;cursor:pointer;left:0}
.snr{position:absolute;top:0;bottom:0;width:35%;cursor:pointer;right:0}
/* ── ADD STORY MODAL ── */
#asm{position:fixed;inset:0;z-index:950;background:var(--mb);display:none;align-items:center;justify-content:center}
#asm.on{display:flex}
.mcard{background:var(--bg1);border:1px solid var(--bdr);border-radius:22px;padding:28px;width:100%;max-width:410px;box-shadow:0 24px 64px var(--sh)}
.mtitle{font-size:17px;font-weight:700;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between}
.mclose{background:none;border:none;cursor:pointer;font-size:20px;color:var(--t2)}
.sttabs{display:flex;gap:8px;margin-bottom:14px}
.sttab{flex:1;padding:9px;background:var(--bg2);border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;color:var(--t1)}
.sttab.on{background:var(--ac);color:#fff}
.spbox{width:100%;height:200px;border-radius:12px;overflow:hidden;border:2px dashed var(--bdr);display:flex;align-items:center;justify-content:center;cursor:pointer;margin-bottom:12px;position:relative;transition:border-color .2s}
.spbox:hover{border-color:var(--ac)}
.spbox img{width:100%;height:100%;object-fit:cover}
.spbox .ph{color:var(--t2);text-align:center}.spbox .ph span{font-size:36px;display:block;margin-bottom:8px}.spbox .ph p{font-size:13px}
.sttxt{width:100%;height:120px;padding:12px;background:var(--bgi);border:1px solid var(--bdr);border-radius:10px;color:var(--t0);font-family:'Outfit',sans-serif;font-size:16px;resize:none;outline:none;margin-bottom:12px}
.sttxt:focus{border-color:var(--ac)}
.bgsrow{display:flex;gap:8px;margin-bottom:12px;align-items:center}
.bgsrow span{font-size:12px;color:var(--t1)}
.cs{width:28px;height:28px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:transform .2s}
.cs:hover{transform:scale(1.2)}
.cs.on{border-color:rgba(255,255,255,.8);transform:scale(1.1)}
.capin{width:100%;padding:10px 14px;background:var(--bgi);border:1px solid var(--bdr);border-radius:8px;color:var(--t0);font-family:'Outfit',sans-serif;font-size:13px;outline:none;margin-bottom:16px}
.capin:focus{border-color:var(--ac)}
/* ── CALL OVERLAY ── */
#cov{position:fixed;inset:0;z-index:980;background:#0D1117;display:none;flex-direction:column;align-items:center;justify-content:center}
#cov.on{display:flex}
.covbg{position:absolute;inset:0;overflow:hidden}
.covbg::before{content:'';position:absolute;width:420px;height:420px;border-radius:50%;top:50%;left:50%;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(0,194,168,.15) 0%,transparent 70%);animation:cpulse 2s ease-in-out infinite}
@keyframes cpulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:1}50%{transform:translate(-50%,-50%) scale(1.2);opacity:.55}}
.ccon{position:relative;z-index:1;text-align:center}
.cring{width:120px;height:120px;border-radius:50%;border:3px solid rgba(0,194,168,.38);padding:4px;margin:0 auto 20px;animation:cring 2s ease-in-out infinite}
@keyframes cring{0%,100%{box-shadow:0 0 0 0 rgba(0,194,168,.4)}50%{box-shadow:0 0 0 18px rgba(0,194,168,0)}}
.cname{font-size:26px;font-weight:800;color:#fff;margin-bottom:6px}
.cst{font-size:14px;color:rgba(255,255,255,.55);margin-bottom:50px}
.ctimer{font-family:'JetBrains Mono',monospace;font-size:20px;color:var(--ac);margin-bottom:50px;display:none}
.cbtns{display:flex;gap:24px;justify-content:center}
.cbtn{width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;font-size:22px;display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s}
.cbtn:hover{transform:scale(1.1)}
.cbtn.end{background:var(--red);color:#fff;box-shadow:0 4px 20px rgba(255,71,87,.4)}
.cbtn.mute,.cbtn.spkr{background:var(--bg2);color:var(--t0)}
.cbtn.mute.on,.cbtn.spkr.on{background:var(--warn);color:#fff}
.cbtn.ans{background:var(--grn);color:#fff;box-shadow:0 4px 20px rgba(46,213,115,.4)}
/* ── INCOMING TOAST ── */
#inct{position:fixed;bottom:20px;right:20px;z-index:999;background:var(--bg1);border:1px solid var(--bdr);border-radius:16px;padding:14px 18px;display:none;align-items:center;gap:14px;box-shadow:0 8px 32px var(--sh);animation:slin .3s ease-out}
@keyframes slin{from{transform:translateX(100px);opacity:0}to{transform:translateX(0);opacity:1}}
#inct.on{display:flex}
.inci{flex:1}
.incname{font-size:14px;font-weight:700;color:var(--t0)}
.inctype{font-size:12px;color:var(--t1)}
.incacts{display:flex;gap:8px}
.incacts button{width:40px;height:40px;border-radius:50%;border:none;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}
.incacc{background:var(--grn);color:#fff}.increj{background:var(--red);color:#fff}
/* ── PROFILE ── */
#prof{position:fixed;inset:0;z-index:800;background:var(--mb);display:none;align-items:center;justify-content:center}
#prof.on{display:flex}
.pcard{background:var(--bg1);border:1px solid var(--bdr);border-radius:22px;padding:32px;width:100%;max-width:380px;text-align:center}
.pavw{position:relative;width:fit-content;margin:0 auto 16px}
.paedit{position:absolute;bottom:0;right:0;width:28px;height:28px;border-radius:50%;background:var(--ac);border:none;cursor:pointer;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center}
.pni,.psi{background:none;border:none;outline:none;font-family:'Outfit',sans-serif;color:var(--t0);text-align:center;width:100%}
.pni{font-size:22px;font-weight:700;border-bottom:2px solid var(--bdr);padding:4px 0;margin-bottom:8px}
.pni:focus{border-color:var(--ac)}
.psi{font-size:13px;color:var(--t1);margin-bottom:4px}
.pph{font-size:13px;color:var(--t2);font-family:'JetBrains Mono',monospace;margin-bottom:20px}
/* ── NEW CHAT ── */
#nch{position:fixed;inset:0;z-index:850;background:var(--mb);display:none;align-items:center;justify-content:center}
#nch.on{display:flex}
/* ── SETTINGS ── */
#stg{position:fixed;inset:0;z-index:850;background:var(--mb);display:none;align-items:center;justify-content:center}
#stg.on{display:flex}
.scard{background:var(--bg1);border:1px solid var(--bdr);border-radius:22px;padding:28px;width:100%;max-width:390px}
.si2{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--bdr)}
.si2:last-child{border-bottom:none}
.slbl{font-size:14px;font-weight:500;color:var(--t0)}
.ssub{font-size:12px;color:var(--t1);margin-top:2px}
.tog{width:44px;height:24px;background:var(--bg2);border-radius:12px;cursor:pointer;position:relative;border:none;transition:background .2s}
.tog.on{background:var(--ac)}
.tog::after{content:'';position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:3px;left:3px;transition:transform .2s}
.tog.on::after{transform:translateX(20px)}
/* ── IMAGE VIEWER ── */
#imgv{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.95);display:none;align-items:center;justify-content:center}
#imgv.on{display:flex}
#imgv img{max-width:90vw;max-height:90vh;border-radius:8px}
#imgvcl{position:absolute;top:18px;right:18px;background:rgba(255,255,255,.18);border:none;cursor:pointer;color:#fff;font-size:22px;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center}
/* ── CONTEXT MENU ── */
#ctx{position:fixed;z-index:9999;background:var(--bg1);border:1px solid var(--bdr);border-radius:10px;padding:4px;box-shadow:0 8px 32px var(--sh);display:none;min-width:155px}
#ctx.on{display:block}
.ci{padding:9px 14px;cursor:pointer;font-size:13px;color:var(--t0);border-radius:6px;display:flex;align-items:center;gap:9px;transition:background .1s}
.ci:hover{background:var(--bgh)}
.ci.d{color:var(--red)}
/* ── NOTIF ── */
.notif{position:fixed;top:18px;right:18px;z-index:99999;background:var(--bg1);border:1px solid var(--bdr);border-radius:12px;padding:13px 17px;box-shadow:0 8px 32px var(--sh);font-size:13px;color:var(--t0);animation:slin .3s ease-out;max-width:280px;white-space:pre-line}
/* ── MOBILE ── */
@media(max-width:768px){
  #app{grid-template-columns:1fr}
  .sb{display:flex}
  .main{display:none}
  #app.chat .sb{display:none}
  #app.chat .main{display:flex}
  .backbtn{display:flex!important}
}
.backbtn{display:none}
</style>
</head>
<body>

<!-- AUTH -->
<div id="auth">
  <div class="acard">
    <div class="alogo"><div class="mark">SLS</div><div class="sub">Secure Local Social</div></div>
    <div class="atabs">
      <button class="atab on" onclick="authTab('login')">Sign In</button>
      <button class="atab" onclick="authTab('register')">Register</button>
    </div>
    <div id="aerr" class="aerr"></div>
    <div id="lform">
      <div class="fg"><label>Cameroonian Phone</label>
        <div class="pfx"><div class="pfxlabel">🇨🇲 +237</div>
          <input type="tel" id="lphone" placeholder="6XX XXX XXX" maxlength="9"/></div>
      </div>
      <button class="btnp" onclick="doLogin()">Sign In</button>
    </div>
    <div id="rform" style="display:none">
      <div class="fg"><label>Full Name</label><input type="text" id="rname" placeholder="Your name"/></div>
      <div class="fg"><label>Cameroonian Phone</label>
        <div class="pfx"><div class="pfxlabel">🇨🇲 +237</div>
          <input type="tel" id="rphone" placeholder="6XX XXX XXX" maxlength="9"/></div>
      </div>
      <button class="btnp" onclick="doRegister()">Create Account</button>
    </div>
    <p style="text-align:center;font-size:12px;color:var(--t2);margin-top:18px">
      Demo: sign in as <b style="color:var(--ac)">677001122</b> or <b style="color:var(--ac)">699334455</b>
    </p>
  </div>
</div>

<!-- APP -->
<div id="app">
  <!-- SIDEBAR -->
  <div class="sb">
    <div class="sbh">
      <div class="sblogo">SLS</div>
      <button class="ibtn" onclick="openNch()" title="New Chat">✏️</button>
      <button class="ibtn" onclick="openStg()" title="Settings">⚙️</button>
      <button class="ibtn" onclick="openProf()" title="Profile">👤</button>
    </div>
    <div class="navtabs">
      <button class="navtab on" id="nt0" onclick="tab('chats')"    title="Chats">💬<span class="bdg" id="bdg0"></span></button>
      <button class="navtab"    id="nt1" onclick="tab('stories')"  title="Stories">📸</button>
      <button class="navtab"    id="nt2" onclick="tab('contacts')" title="Contacts">👥</button>
      <button class="navtab"    id="nt3" onclick="tab('calls')"    title="Calls">📞</button>
    </div>
    <div class="sbsearch" id="ssearch">
      <div class="sbox"><span class="si">🔍</span>
        <input type="text" placeholder="Search..." id="sinput" oninput="doSearch(this.value)"/>
      </div>
    </div>
    <div class="sbody" id="sbody"></div>
  </div>

  <!-- MAIN -->
  <div class="main" id="main">
    <div class="empty" id="empty">
      <div class="ei">💬</div>
      <p style="font-size:16px">Select a conversation</p>
      <small style="font-size:13px;opacity:.6">or start one with ✏️</small>
    </div>
    <div id="chatwin" style="display:none;flex-direction:column;height:100%">
      <div class="chdr">
        <button class="ibtn backbtn" onclick="closeChat()">←</button>
        <div class="avw" onclick="viewCProf()" style="cursor:pointer">
          <div class="av" id="chavt"></div>
          <div class="dot" id="chdot"></div>
        </div>
        <div class="chdrinfo">
          <div class="chdrname" id="chname"></div>
          <div class="chdrst" id="chst"></div>
        </div>
        <div class="cacts">
          <button class="ibtn" onclick="call('voice')" title="Voice Call">📞</button>
          <button class="ibtn" onclick="call('video')" title="Video Call">📹</button>
          <button class="ibtn" onclick="chatMenu(event)" title="More">⋮</button>
        </div>
      </div>
      <div class="mwrap" id="mwrap">
        <div class="typi" id="typi">
          <div class="tdot"></div><div class="tdot"></div><div class="tdot"></div>
        </div>
      </div>
      <div class="cinput">
        <div class="rbar" id="rbar">
          <div class="rbinfo"><div class="rbn" id="rbn"></div><div class="rbt" id="rbt"></div></div>
          <button class="rbx" onclick="clrReply()">✕</button>
        </div>
        <div class="irow">
          <button class="ibtn" onclick="pickImg()" title="Photo">🖼️</button>
          <input type="file" id="imgpick" accept="image/*" style="display:none" onchange="sendImg(this)"/>
          <textarea class="ifield" id="minput" placeholder="Message..." rows="1"
            onkeydown="msgKey(event)" oninput="onType(this)"></textarea>
          <button class="sbtn" onclick="sendMsg()">➤</button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- STORY VIEWER -->
<div id="sv">
  <div class="sprog" id="sprog"></div>
  <div class="shdr">
    <div class="av sm" id="svav"></div>
    <div class="sinfo"><div class="sname" id="svname"></div><div class="stime" id="svtime"></div></div>
    <button class="sclose" onclick="closeSV()">✕</button>
  </div>
  <div class="smedia" id="svmedia"></div>
  <div class="scap" id="svcap"></div>
  <div class="snl" onclick="prevSt()"></div>
  <div class="snr" onclick="nextSt()"></div>
</div>

<!-- ADD STORY -->
<div id="asm">
  <div class="mcard">
    <div class="mtitle">New Story <button class="mclose" onclick="closeAsm()">✕</button></div>
    <div class="sttabs">
      <button class="sttab on" onclick="stType('image')">📷 Photo</button>
      <button class="sttab" onclick="stType('text')">✏️ Text</button>
    </div>
    <div id="stimgsec">
      <div class="spbox" onclick="document.getElementById('stimginp').click()" id="spbox">
        <div class="ph"><span>📷</span><p>Tap to select from gallery</p></div>
      </div>
      <input type="file" id="stimginp" accept="image/*" style="display:none" onchange="pickStImg(this)"/>
    </div>
    <div id="sttxtsec" style="display:none">
      <textarea class="sttxt" id="sttxtinp" placeholder="Type your story..."></textarea>
      <div class="bgsrow">
        <span>Background</span>
        <div class="cs on"  style="background:#1a1a2e" data-c="#1a1a2e" onclick="bgc(this)"></div>
        <div class="cs"     style="background:#0f3460" data-c="#0f3460" onclick="bgc(this)"></div>
        <div class="cs"     style="background:#533483" data-c="#533483" onclick="bgc(this)"></div>
        <div class="cs"     style="background:#1B5E20" data-c="#1B5E20" onclick="bgc(this)"></div>
        <div class="cs"     style="background:#B71C1C" data-c="#B71C1C" onclick="bgc(this)"></div>
        <div class="cs"     style="background:#E65100" data-c="#E65100" onclick="bgc(this)"></div>
      </div>
    </div>
    <input type="text" class="capin" id="capinp" placeholder="Caption (optional)"/>
    <button class="btnp" onclick="postStory()">Share Story</button>
  </div>
</div>

<!-- CALL OVERLAY -->
<div id="cov">
  <div class="covbg"></div>
  <div class="ccon">
    <div class="cring"><div class="av lg" id="cav" style="width:100%;height:100%;border-radius:50%"></div></div>
    <div class="cname" id="cname2"></div>
    <div class="cst"   id="cst2"></div>
    <div class="ctimer" id="ctimer"></div>
    <div class="cbtns">
      <button class="cbtn mute" id="mbtn" onclick="togMute()"   title="Mute">🎤</button>
      <button class="cbtn end"  onclick="endCall()"             title="End">📵</button>
      <button class="cbtn spkr" id="sbtn2" onclick="togSpkr()"  title="Speaker">🔊</button>
    </div>
  </div>
</div>

<!-- INCOMING CALL TOAST -->
<div id="inct">
  <div class="av sm" id="incav"></div>
  <div class="inci"><div class="incname" id="incname"></div><div class="inctype" id="inctype"></div></div>
  <div class="incacts">
    <button class="incacc" onclick="acceptCall()">📞</button>
    <button class="increj" onclick="rejectCall()">📵</button>
  </div>
</div>

<!-- IMAGE VIEWER -->
<div id="imgv">
  <button id="imgvcl" onclick="document.getElementById('imgv').classList.remove('on')">✕</button>
  <img id="imgvsrc" src="" alt=""/>
</div>

<!-- PROFILE PANEL -->
<div id="prof">
  <div class="pcard">
    <div class="mtitle">My Profile <button class="mclose" onclick="closeProf()">✕</button></div>
    <div class="pavw">
      <div class="av xl" id="pavt" style="margin:0 auto"></div>
      <button class="paedit" onclick="document.getElementById('ppinp').click()">✏️</button>
      <input type="file" id="ppinp" accept="image/*" style="display:none" onchange="setPP(this)"/>
    </div>
    <input class="pni" id="pni" type="text"/>
    <input class="psi" id="psi" type="text" placeholder="Status..."/>
    <div class="pph" id="pph"></div>
    <button class="btnp" onclick="saveProf()">Save Changes</button>
    <button style="width:100%;padding:12px;margin-top:10px;background:rgba(255,71,87,.1);border:1px solid rgba(255,71,87,.3);border-radius:10px;color:var(--red);cursor:pointer;font-family:'Outfit',sans-serif;font-size:14px;font-weight:500" onclick="doLogout()">Sign Out</button>
  </div>
</div>

<!-- NEW CHAT -->
<div id="nch">
  <div class="mcard">
    <div class="mtitle">New Conversation <button class="mclose" onclick="document.getElementById('nch').classList.remove('on')">✕</button></div>
    <div class="fg"><label>Search by name or phone</label>
      <input type="text" id="nchsrch" oninput="nchSearch(this.value)"
        style="width:100%;padding:12px 16px;background:var(--bgi);border:1px solid var(--bdr);border-radius:10px;color:var(--t0);font-family:'Outfit',sans-serif;font-size:14px;outline:none"
        placeholder="Name or phone..."/>
    </div>
    <div id="nchres"></div>
  </div>
</div>

<!-- SETTINGS -->
<div id="stg">
  <div class="scard">
    <div class="mtitle">Settings <button class="mclose" onclick="closeStg()">✕</button></div>
    <div class="si2">
      <div><div class="slbl">Dark Theme</div><div class="ssub">Toggle light / dark</div></div>
      <button class="tog on" id="thtog" onclick="togTheme(this)"></button>
    </div>
    <div class="si2">
      <div><div class="slbl">Notifications</div><div class="ssub">Message & call alerts</div></div>
      <button class="tog on" onclick="this.classList.toggle('on')"></button>
    </div>
    <div class="si2">
      <div><div class="slbl">Read Receipts</div><div class="ssub">Let others see when you read</div></div>
      <button class="tog on" onclick="this.classList.toggle('on')"></button>
    </div>
    <div class="si2">
      <div><div class="slbl">Version</div><div class="ssub">SLS v1.0.0 — Douala Edition</div></div>
      <span style="font-size:12px;color:var(--ac)">✓ Current</span>
    </div>
  </div>
</div>

<!-- CONTEXT MENU -->
<div id="ctx">
  <div class="ci" onclick="ctxReply()">↩️ Reply</div>
  <div class="ci" onclick="ctxCopy()">📋 Copy text</div>
  <div class="ci d" onclick="ctxDel()">🗑️ Delete</div>
</div>

<script>
// ══════════════════════════════════════════════
//  API + SOCKET CLIENT
// ══════════════════════════════════════════════
const API = {
  token: null,
  h() { return { 'Content-Type':'application/json', Authorization:'Bearer '+this.token }; },
  async req(method, path, body) {
    const r = await fetch(path,{ method, headers:this.h(), body:body?JSON.stringify(body):undefined });
    return r.json();
  },
  post: (p,b)  => API.req('POST',  p, b),
  get:  (p)    => API.req('GET',   p),
  put:  (p,b)  => API.req('PUT',   p, b),
  del:  (p)    => API.req('DELETE',p),
};

const socket = io({ transports:['websocket','polling'] });
socket.on('connect', () => { if (API.token) socket.emit('auth', API.token); });
socket.on('auth:ok', () => {});

socket.on('msg:new',     ({ cid, msg }) => {
  if (S.activeChat === msg.from) { appendMsg(msg); scrollBot(); }
  renderConvos();
  if (S.activeChat !== msg.from) toast(uname(msg.from) + ': ' + (msg.text||'📷').substring(0,40));
});
socket.on('msg:sent',    ({ cid, msg }) => { renderConvos(); });
socket.on('msg:deleted', ({ cid, msgId }) => { if (S.activeChat) loadMsgs(S.activeChat); });
socket.on('typing:start',({ from }) => { if (S.activeChat===from) { document.getElementById('typi').classList.add('on'); scrollBot(); } });
socket.on('typing:stop', ({ from }) => { if (S.activeChat===from) document.getElementById('typi').classList.remove('on'); });
socket.on('user:status', ({ phone, online, lastSeen }) => {
  const u = db.users.get(phone);
  if (u) { u.online=online; if(lastSeen) u.lastSeen=lastSeen; }
  if (S.activeChat===phone) updateChatHeader(phone);
  renderConvos();
});
socket.on('user:updated', u => { db.users.set(u.phone, u); renderConvos(); });
socket.on('call:incoming',({ callId, caller, type }) => { showIncoming(callId, caller, type); });
socket.on('call:answered',({ callId }) => { onCallAnswered(); });
socket.on('call:ended',   ({ callId }) => { closeCallOv(); });
socket.on('story:new',    () => { if(S.tab==='stories') renderStoriesTab(); });

// Client-side user cache
const db = { users: new Map() };

// ══════════════════════════════════════════════
//  APP STATE
// ══════════════════════════════════════════════
const S = {
  me: null, tab:'chats', activeChat:null,
  replyTo:null, replyToText:'',
  stGroup:null, stIdx:0, stInt:null,
  stType:'image', stBg:'#1a1a2e', stImg:null,
  activeCall:null, callSecs:0, callInt:null,
  ctxTarget:null,
  theme: localStorage.getItem('sls_theme')||'dark',
};

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme();
  const token = localStorage.getItem('sls_token');
  if (token) {
    API.token = token;
    const me = await API.get('/api/users/me');
    if (me && !me.error) { S.me = me; showApp(); }
    else { API.token=null; localStorage.removeItem('sls_token'); }
  }
  document.addEventListener('click', ()=>document.getElementById('ctx').classList.remove('on'));
});

async function showApp() {
  document.getElementById('auth').classList.add('gone');
  document.getElementById('app').classList.add('vis');
  socket.emit('auth', API.token);
  await refreshUsers();
  renderTab();
}

async function refreshUsers() {
  const users = await API.get('/api/users');
  (users||[]).forEach(u => db.users.set(u.phone, u));
}

// ══════════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════════
function applyTheme() {
  document.documentElement.setAttribute('data-theme', S.theme==='light'?'light':'dark');
  const t = document.getElementById('thtog');
  if(t) t.classList.toggle('on', S.theme==='dark');
}
function togTheme(btn) {
  S.theme = S.theme==='dark'?'light':'dark';
  localStorage.setItem('sls_theme', S.theme);
  btn.classList.toggle('on', S.theme==='dark');
  applyTheme();
}

// ══════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════
function authTab(t) {
  document.querySelectorAll('.atab').forEach((el,i)=>el.classList.toggle('on',['login','register'][i]===t));
  document.getElementById('lform').style.display = t==='login'?'block':'none';
  document.getElementById('rform').style.display = t==='register'?'block':'none';
  document.getElementById('aerr').classList.remove('on');
}
function aErr(m){ const e=document.getElementById('aerr'); e.textContent=m; e.classList.add('on'); }

async function doLogin() {
  const phone = document.getElementById('lphone').value.trim();
  if(!phone) return aErr('Enter your phone number');
  const r = await API.post('/api/auth/login',{ phone });
  if(r.error) return aErr(r.error);
  API.token=r.token; S.me=r.user;
  localStorage.setItem('sls_token', r.token);
  showApp();
}
async function doRegister() {
  const name=document.getElementById('rname').value.trim();
  const phone=document.getElementById('rphone').value.trim();
  if(!name) return aErr('Enter your name');
  if(!phone) return aErr('Enter your phone number');
  const r = await API.post('/api/auth/register',{ name, phone });
  if(r.error) return aErr(r.error);
  API.token=r.token; S.me=r.user;
  localStorage.setItem('sls_token', r.token);
  showApp();
}
async function doLogout() {
  await API.post('/api/auth/logout');
  API.token=null; S.me=null;
  localStorage.removeItem('sls_token');
  closeProf();
  document.getElementById('app').classList.remove('vis');
  document.getElementById('auth').classList.remove('gone');
  document.getElementById('chatwin').style.display='none';
  document.getElementById('empty').style.display='flex';
  S.activeChat=null;
}

// ══════════════════════════════════════════════
//  TABS
// ══════════════════════════════════════════════
function tab(t) {
  S.tab=t;
  ['chats','stories','contacts','calls'].forEach((x,i)=>{
    document.getElementById('nt'+i).classList.toggle('on',x===t);
  });
  document.getElementById('ssearch').style.display = ['chats','contacts'].includes(t)?'block':'none';
  renderTab();
}
function renderTab() {
  switch(S.tab){
    case 'chats':    renderConvos(); break;
    case 'stories':  renderStoriesTab(); break;
    case 'contacts': renderContacts(); break;
    case 'calls':    renderCalls(); break;
  }
}

// ══════════════════════════════════════════════
//  AVATAR HELPERS
// ══════════════════════════════════════════════
const PAL=['#00C2A8','#0088CC','#FF6348','#FFA502','#7bed9f','#70a1ff','#ff6b81','#eccc68'];
function avColor(phone){ return PAL[phone.charCodeAt(phone.length-1)%PAL.length]; }
function avInit(name){ return name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase(); }
function setAv(el, u, cls=''){
  if(!u){el.className='av '+(cls||''); el.innerHTML='?'; return;}
  el.className='av '+(cls||'');
  if(u.avatar){ el.style.background='none'; el.innerHTML=\`<img src="\${u.avatar}" alt=""/>\`; }
  else{ el.style.background=avColor(u.phone); el.innerHTML=avInit(u.name); }
}

// ══════════════════════════════════════════════
//  CONVERSATIONS
// ══════════════════════════════════════════════
async function renderConvos() {
  const convos = await API.get('/api/conversations');
  const body = document.getElementById('sbody');
  if(!convos||convos.length===0){
    body.innerHTML=\`<div style="padding:32px 16px;text-align:center;color:var(--t2)"><div style="font-size:40px;margin-bottom:12px">💬</div><p style="font-size:14px">No conversations yet</p><small style="font-size:12px">Tap ✏️ to start one</small></div>\`;
    return;
  }
  let unread=0;
  body.innerHTML = convos.map(c=>{
    unread+=c.unread;
    const u=c.with;
    const init=avInit(u.name);
    const col=avColor(u.phone);
    const avHtml = u.avatar?\`<img src="\${u.avatar}" alt=""/>\`:init;
    const avBg = u.avatar?'none':col;
    const preview = c.lastMessage?(c.lastMessage.deleted?'🚫 Deleted':c.lastMessage.type==='image'?'📷 Photo':(c.lastMessage.text||'').substring(0,38)):'Say hi!';
    return \`<div class="crow \${S.activeChat===u.phone?'on':''}" onclick="openChat('\${u.phone}')">
      <div class="avw">
        <div class="av" style="background:\${avBg}">\${avHtml}</div>
        <div class="dot \${u.online?'':'off'}"></div>
      </div>
      <div class="cinfo">
        <div class="cname">\${esc(u.name)}</div>
        <div class="cprev">\${esc(preview)}</div>
      </div>
      <div class="cmeta">
        <div class="ctime">\${fmtTime(c.lastMessage?.createdAt)}</div>
        \${c.unread>0?\`<div class="ubdg">\${c.unread}</div>\`:''}
      </div>
    </div>\`;
  }).join('');
  const bdg=document.getElementById('bdg0');
  bdg.textContent=unread>99?'99+':unread;
  bdg.classList.toggle('on',unread>0);
}

// ══════════════════════════════════════════════
//  STORIES TAB
// ══════════════════════════════════════════════
async function renderStoriesTab() {
  const groups = await API.get('/api/stories');
  const body = document.getElementById('sbody');
  body.innerHTML=\`<div class="stpanel">
    <p style="font-size:11px;color:var(--t2);margin-bottom:12px;font-weight:600;letter-spacing:1.2px">STORIES</p>
    <div class="strow">
      <div class="stbub" onclick="openAsm()">
        <div class="string add">➕</div>
        <div class="stname">My Story</div>
      </div>
      \${(groups||[]).map(g=>{
        const u=g.user;
        const isMe=u.phone===S.me?.phone;
        const init=avInit(u.name);
        const avHtml = u.avatar?\`<img src="\${u.avatar}" alt=""/>\`:init;
        const avBg = u.avatar?'none':avColor(u.phone);
        return \`<div class="stbub" onclick="viewStories('\${u.phone}')">
          <div class="string unseen">
            <div class="av" style="background:\${avBg};width:100%;height:100%;border-radius:50%;border:2px solid var(--bg1)">\${avHtml}</div>
          </div>
          <div class="stname">\${isMe?'You':esc(u.name.split(' ')[0])}</div>
        </div>\`;
      }).join('')}
    </div>
    \${(!groups||groups.length===0)?\`<div style="padding:32px;text-align:center;color:var(--t2)"><div style="font-size:40px;margin-bottom:12px">📸</div><p>No stories yet. Be the first!</p></div>\`:''}
  </div>\`;
}

// ══════════════════════════════════════════════
//  CONTACTS
// ══════════════════════════════════════════════
async function renderContacts() {
  const users = await API.get('/api/users');
  const body = document.getElementById('sbody');
  body.innerHTML=\`<div style="padding:8px 16px 4px;font-size:11px;color:var(--t2);letter-spacing:1px;font-weight:600">ALL CONTACTS</div>\`+
    (users||[]).map(u=>{
      const avHtml=u.avatar?\`<img src="\${u.avatar}" alt=""/>\`:avInit(u.name);
      const avBg=u.avatar?'none':avColor(u.phone);
      return \`<div class="crow" onclick="openChat('\${u.phone}');tab('chats')">
        <div class="avw">
          <div class="av" style="background:\${avBg}">\${avHtml}</div>
          <div class="dot \${u.online?'':'off'}"></div>
        </div>
        <div class="cinfo">
          <div class="cname">\${esc(u.name)}</div>
          <div class="cprev">\${esc(u.status||u.phone)}</div>
        </div>
        <button class="ibtn" onclick="event.stopPropagation();callTo('\${u.phone}','voice')" title="Call">📞</button>
      </div>\`;
    }).join('');
}

function renderCalls() {
  document.getElementById('sbody').innerHTML=\`<div style="padding:60px 20px;text-align:center;color:var(--t2)"><div style="font-size:48px;margin-bottom:16px">📞</div><p style="font-size:15px;margin-bottom:8px">Recent Calls</p><p style="font-size:12px;opacity:.6">Your call history will appear here</p></div>\`;
}

// ══════════════════════════════════════════════
//  CHAT
// ══════════════════════════════════════════════
async function openChat(phone) {
  S.activeChat=phone;
  await refreshUsers();
  const u = db.users.get(phone);
  if(!u) return;
  document.getElementById('empty').style.display='none';
  const cw=document.getElementById('chatwin');
  cw.style.display='flex';
  document.getElementById('app').classList.add('chat');
  updateChatHeader(phone);
  await loadMsgs(phone);
  renderConvos();
}

function updateChatHeader(phone) {
  const u=db.users.get(phone);
  if(!u) return;
  const cavt=document.getElementById('chavt');
  setAv(cavt, u);
  document.getElementById('chname').textContent=u.name;
  const st=document.getElementById('chst');
  const dot=document.getElementById('chdot');
  if(u.online){ st.textContent='online'; st.className='chdrst'; dot.className='dot'; }
  else{ st.textContent='last seen '+fmtTime(u.lastSeen); st.className='chdrst off'; dot.className='dot off'; }
}

function closeChat() {
  document.getElementById('app').classList.remove('chat');
  S.activeChat=null;
}

async function loadMsgs(phone) {
  const msgs = await API.get(\`/api/messages/\${encodeURIComponent(phone)}\`);
  const wrap=document.getElementById('mwrap');
  const typi=document.getElementById('typi');
  wrap.innerHTML='';
  if(!msgs||msgs.length===0){
    wrap.innerHTML=\`<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--t2);font-size:13px">Send a message to start the conversation</div>\`;
  } else {
    let lastDate='';
    (msgs||[]).forEach(m=>{
      const d=new Date(m.createdAt).toLocaleDateString();
      if(d!==lastDate){ lastDate=d; wrap.insertAdjacentHTML('beforeend',\`<div class="ddiv"><span>\${fmtDate(m.createdAt)}</span></div>\`); }
      wrap.insertAdjacentHTML('beforeend', buildMsgHTML(m));
    });
  }
  wrap.appendChild(typi);
  bindMsgEvents(wrap);
  scrollBot();
}

function buildMsgHTML(m) {
  const isOut=m.from===S.me?.phone;
  const cls=isOut?'out':'in';
  let body='';
  if(m.replyTo) body+=\`<div class="rply"><div class="rf">Reply</div><div class="rt">\${esc((m.replyToText||'').substring(0,60))}</div></div>\`;
  if(m.media&&m.type==='image') body+=\`<div class="bmedia"><img src="\${m.media}" onclick="viewImg('\${m.media}')"/></div>\`;
  if(m.text&&!m.deleted) body+=\`<div class="btxt">\${esc(m.text)}</div>\`;
  if(m.deleted) body+=\`<div class="btxt" style="opacity:.55;font-style:italic">🚫 This message was deleted</div>\`;
  const ticks=isOut?\`<span class="rtick \${m.read?'read':''}">✓✓</span>\`:'';
  return \`<div class="mrow \${cls}" data-id="\${m.id}" data-phone="\${m.from}">
    <div class="bub\${m.deleted?' del':''}" data-id="\${m.id}" data-txt="\${esc(m.text||'')}">
      \${body}
      <div class="btime">\${fmtTime(m.createdAt)} \${ticks}</div>
    </div>
  </div>\`;
}

function bindMsgEvents(wrap) {
  wrap.querySelectorAll('.bub').forEach(b=>{
    b.addEventListener('contextmenu', e=>{ e.preventDefault(); showCtx(e,b); });
  });
}

function appendMsg(m) {
  const wrap=document.getElementById('mwrap');
  const typi=document.getElementById('typi');
  typi.classList.remove('on');
  wrap.insertAdjacentHTML('beforeend', buildMsgHTML(m));
  wrap.appendChild(typi);
  bindMsgEvents(wrap);
  scrollBot();
}

async function sendMsg() {
  const inp=document.getElementById('minput');
  const txt=inp.value.trim();
  if(!txt||!S.activeChat) return;
  inp.value=''; inp.style.height='auto';
  const body={ text:txt };
  if(S.replyTo){ body.replyTo=S.replyTo; body.replyToText=S.replyToText; }
  clrReply();
  const msg=await API.post(\`/api/messages/\${encodeURIComponent(S.activeChat)}\`,body);
  if(!msg||msg.error) return;
  appendMsg(msg);
  socket.emit('typing:stop',{ to:S.activeChat });
}

function msgKey(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMsg(); } }

let typTimeout;
function onType(ta){
  ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,120)+'px';
  if(!S.activeChat) return;
  socket.emit('typing:start',{ to:S.activeChat });
  clearTimeout(typTimeout);
  typTimeout=setTimeout(()=>socket.emit('typing:stop',{ to:S.activeChat }), 1500);
}

function scrollBot(){ const w=document.getElementById('mwrap'); setTimeout(()=>w.scrollTop=w.scrollHeight,50); }

function pickImg(){ document.getElementById('imgpick').click(); }
async function sendImg(inp) {
  const file=inp.files[0]; if(!file) return;
  const fr=new FileReader();
  fr.onload=async e=>{
    const msg=await API.post(\`/api/messages/\${encodeURIComponent(S.activeChat)}\`,{ text:'', type:'image', media:e.target.result });
    if(msg&&!msg.error){ appendMsg(msg); renderConvos(); }
  };
  fr.readAsDataURL(file);
  inp.value='';
}

// ══════════════════════════════════════════════
//  REPLY
// ══════════════════════════════════════════════
function setReply(id, txt, phone) {
  S.replyTo=id; S.replyToText=txt;
  const u=db.users.get(phone);
  document.getElementById('rbn').textContent=phone===S.me?.phone?'You':(u?.name||phone);
  document.getElementById('rbt').textContent=txt;
  document.getElementById('rbar').classList.add('on');
  document.getElementById('minput').focus();
}
function clrReply(){ S.replyTo=null; S.replyToText=''; document.getElementById('rbar').classList.remove('on'); }

// ══════════════════════════════════════════════
//  CONTEXT MENU
// ══════════════════════════════════════════════
function showCtx(e,bub){
  S.ctxTarget=bub;
  const m=document.getElementById('ctx');
  m.style.left=Math.min(e.clientX,window.innerWidth-170)+'px';
  m.style.top=Math.min(e.clientY,window.innerHeight-120)+'px';
  m.classList.add('on');
  e.stopPropagation();
}
function ctxReply(){
  if(!S.ctxTarget) return;
  const row=S.ctxTarget.closest('.mrow');
  setReply(S.ctxTarget.dataset.id, S.ctxTarget.dataset.txt, row?.dataset.phone||'');
}
function ctxCopy(){ if(S.ctxTarget) navigator.clipboard?.writeText(S.ctxTarget.dataset.txt||''); toast('Copied'); }
async function ctxDel(){
  if(!S.ctxTarget) return;
  const row=S.ctxTarget.closest('.mrow');
  if(!row?.classList.contains('out')){ toast('You can only delete your own messages'); return; }
  await API.del(\`/api/messages/\${encodeURIComponent(S.activeChat)}/\${S.ctxTarget.dataset.id}\`);
  loadMsgs(S.activeChat);
}
function chatMenu(e){ const u=db.users.get(S.activeChat); if(u) toast(\`\${u.name}\\n\${u.phone}\\n\${u.status||''}\`); }

// ══════════════════════════════════════════════
//  STORIES
// ══════════════════════════════════════════════
function openAsm(){ document.getElementById('asm').classList.add('on'); }
function closeAsm(){
  document.getElementById('asm').classList.remove('on');
  S.stImg=null;
  document.getElementById('spbox').innerHTML=\`<div class="ph"><span>📷</span><p>Tap to select from gallery</p></div>\`;
  document.getElementById('sttxtinp').value='';
  document.getElementById('capinp').value='';
}
function stType(t){
  S.stType=t;
  document.querySelectorAll('.sttab').forEach((el,i)=>el.classList.toggle('on',['image','text'][i]===t));
  document.getElementById('stimgsec').style.display=t==='image'?'block':'none';
  document.getElementById('sttxtsec').style.display=t==='text'?'block':'none';
}
function pickStImg(inp){
  const f=inp.files[0]; if(!f) return;
  const fr=new FileReader();
  fr.onload=e=>{ S.stImg=e.target.result; document.getElementById('spbox').innerHTML=\`<img src="\${e.target.result}" alt=""/>\`; };
  fr.readAsDataURL(f); inp.value='';
}
function bgc(el){
  document.querySelectorAll('.cs').forEach(x=>x.classList.remove('on'));
  el.classList.add('on'); S.stBg=el.dataset.c;
}
async function postStory(){
  const cap=document.getElementById('capinp').value.trim();
  let data;
  if(S.stType==='image'){
    if(!S.stImg){ toast('Please select a photo'); return; }
    data={ type:'image', media:S.stImg, caption:cap };
  } else {
    const txt=document.getElementById('sttxtinp').value.trim();
    if(!txt){ toast('Please enter some text'); return; }
    data={ type:'text', media:null, caption:txt, bgColor:S.stBg };
  }
  await API.post('/api/stories', data);
  closeAsm(); tab('stories'); toast('Story shared! 🎉');
}

async function viewStories(phone) {
  const groups = await API.get('/api/stories');
  const g = (groups||[]).find(x=>x.user.phone===phone);
  if(!g) return;
  S.stGroup=g; S.stIdx=0; openSV();
}

function openSV(){
  const g=S.stGroup, i=S.stIdx;
  if(!g||i>=g.stories.length){ closeSV(); return; }
  const s=g.stories[i], u=g.user;
  setAv(document.getElementById('svav'), u, 'sm');
  document.getElementById('svname').textContent=u.name;
  document.getElementById('svtime').textContent=ago(s.createdAt);
  document.getElementById('svcap').textContent=s.type!=='text'?s.caption:'';
  const progEl=document.getElementById('sprog');
  progEl.innerHTML=g.stories.map((_,idx)=>\`<div class="sbar"><div class="sfill" style="width:\${idx<i?100:0}%"></div></div>\`).join('');
  const med=document.getElementById('svmedia');
  if(s.type==='image'&&s.media) med.innerHTML=\`<img src="\${s.media}" alt=""/>\`;
  else{ med.innerHTML=\`<div class="stxt" style="background:\${s.bgColor||'#1a1a2e'}"><p>\${esc(s.caption)}</p></div>\`; document.getElementById('svcap').textContent=''; }
  document.getElementById('sv').classList.add('on');
  API.post(\`/api/stories/\${s.id}/view\`);
  clearInterval(S.stInt);
  let prog=0;
  const bar=progEl.querySelectorAll('.sfill')[i];
  S.stInt=setInterval(()=>{ prog+=.5; if(bar) bar.style.width=Math.min(prog,100)+'%'; if(prog>=100) nextSt(); },25);
}
function nextSt(){ clearInterval(S.stInt); if(S.stIdx<(S.stGroup?.stories.length||0)-1){ S.stIdx++; openSV(); } else closeSV(); }
function prevSt(){ clearInterval(S.stInt); if(S.stIdx>0){ S.stIdx--; openSV(); } }
function closeSV(){ clearInterval(S.stInt); S.stGroup=null; document.getElementById('sv').classList.remove('on'); }

// ══════════════════════════════════════════════
//  CALLS
// ══════════════════════════════════════════════
function call(type){ if(S.activeChat) callTo(S.activeChat, type); }
async function callTo(phone, type){
  const u=db.users.get(phone)||await API.get(\`/api/users/\${encodeURIComponent(phone)}\`);
  if(!u) return;
  const r=await API.post('/api/calls/start',{ toPhone:phone, type });
  if(r.error) return;
  S.activeCall=r.callId;
  openCallOv(u, type, 'outgoing');
  // Simulate answer/decline since WebRTC not in demo
  setTimeout(()=>{
    if(S.activeCall){
      if(u.online&&Math.random()>.3){ onCallAnswered(); }
      else{ document.getElementById('cst2').textContent='No answer'; setTimeout(closeCallOv,2000); }
    }
  }, 3000+Math.random()*4000);
}
function openCallOv(u, type, dir){
  setAv(document.getElementById('cav'), u, 'lg');
  document.getElementById('cname2').textContent=u.name;
  document.getElementById('cst2').textContent=dir==='outgoing'?\`\${type==='video'?'📹':'📞'} Calling...\`:'Incoming...';
  document.getElementById('cst2').style.display='block';
  document.getElementById('ctimer').style.display='none';
  document.getElementById('cov').classList.add('on');
}
function onCallAnswered(){
  document.getElementById('cst2').style.display='none';
  const t=document.getElementById('ctimer');
  t.style.display='block'; t.textContent='00:00';
  S.callSecs=0;
  S.callInt=setInterval(()=>{
    S.callSecs++;
    const m=Math.floor(S.callSecs/60), s=S.callSecs%60;
    t.textContent=\`\${String(m).padStart(2,'0')}:\${String(s).padStart(2,'0')}\`;
  },1000);
}
async function endCall(){
  clearInterval(S.callInt);
  if(S.activeCall) await API.post(\`/api/calls/\${S.activeCall}/end\`);
  closeCallOv();
}
function closeCallOv(){ clearInterval(S.callInt); document.getElementById('cov').classList.remove('on'); S.activeCall=null; }
function togMute(){ document.getElementById('mbtn').classList.toggle('on'); }
function togSpkr(){ document.getElementById('sbtn2').classList.toggle('on'); }
function showIncoming(callId, caller, type){
  setAv(document.getElementById('incav'), caller, 'sm');
  document.getElementById('incname').textContent=caller.name;
  document.getElementById('inctype').textContent=type==='video'?'📹 Video Call':'📞 Voice Call';
  S.activeCall=callId;
  document.getElementById('inct').classList.add('on');
}
function acceptCall(){ document.getElementById('inct').classList.remove('on'); openCallOv(db.users.get(S.activeChat)||{name:'Unknown'}, 'voice','incoming'); onCallAnswered(); }
function rejectCall(){ document.getElementById('inct').classList.remove('on'); S.activeCall=null; }

// ══════════════════════════════════════════════
//  PROFILE
// ══════════════════════════════════════════════
function openProf(){
  const u=S.me; if(!u) return;
  setAv(document.getElementById('pavt'), u, 'xl');
  document.getElementById('pni').value=u.name;
  document.getElementById('psi').value=u.status||'';
  document.getElementById('pph').textContent=u.phone;
  document.getElementById('prof').classList.add('on');
}
function closeProf(){ document.getElementById('prof').classList.remove('on'); }
async function saveProf(){
  const name=document.getElementById('pni').value.trim();
  const status=document.getElementById('psi').value.trim();
  if(!name){ toast('Name cannot be empty'); return; }
  const updated=await API.put('/api/users/me',{ name, status });
  if(updated&&!updated.error){ S.me=updated; toast('Profile updated ✓'); closeProf(); renderConvos(); }
}
function setPP(inp){
  const f=inp.files[0]; if(!f) return;
  const fr=new FileReader();
  fr.onload=async e=>{
    const u=await API.put('/api/users/me',{ avatar:e.target.result });
    if(u&&!u.error){ S.me=u; openProf(); toast('Photo updated ✓'); renderConvos(); }
  };
  fr.readAsDataURL(f); inp.value='';
}
function viewCProf(){
  const u=db.users.get(S.activeChat); if(!u) return;
  toast(\`\${u.name}\\n📱 \${u.phone}\\n💬 \${u.status||'—'}\`);
}

// ══════════════════════════════════════════════
//  NEW CHAT / SETTINGS / SEARCH
// ══════════════════════════════════════════════
function openNch(){ document.getElementById('nchsrch').value=''; document.getElementById('nchres').innerHTML=''; document.getElementById('nch').classList.add('on'); }
async function nchSearch(q){
  if(!q||q.length<1){ document.getElementById('nchres').innerHTML=''; return; }
  const r=await API.get('/api/users/search?q='+encodeURIComponent(q));
  const box=document.getElementById('nchres');
  if(!r||r.length===0){ box.innerHTML=\`<p style="text-align:center;color:var(--t2);font-size:13px;padding:18px">No users found</p>\`; return; }
  box.innerHTML=(r||[]).map(u=>\`<div class="crow" onclick="startWith('\${u.phone}')">
    <div class="av" style="background:\${avColor(u.phone)}">\${avInit(u.name)}</div>
    <div class="cinfo"><div class="cname">\${esc(u.name)}</div><div class="cprev">\${u.phone}</div></div>
    \${u.online?\`<span style="font-size:10px;color:var(--grn)">● online</span>\`:''}
  </div>\`).join('');
}
function startWith(phone){ document.getElementById('nch').classList.remove('on'); tab('chats'); openChat(phone); }

function openStg(){ document.getElementById('stg').classList.add('on'); }
function closeStg(){ document.getElementById('stg').classList.remove('on'); }

async function doSearch(q){
  if(!q){ renderConvos(); return; }
  const convos=await API.get('/api/conversations');
  const f=(convos||[]).filter(c=>c.with.name.toLowerCase().includes(q.toLowerCase())||c.with.phone.includes(q));
  const body=document.getElementById('sbody');
  if(!f.length){ body.innerHTML=\`<p style="padding:20px;text-align:center;color:var(--t2);font-size:13px">No results for "\${esc(q)}"</p>\`; return; }
  body.innerHTML=f.map(c=>{
    const u=c.with;
    return \`<div class="crow" onclick="openChat('\${u.phone}')">
      <div class="av" style="background:\${avColor(u.phone)}">\${avInit(u.name)}</div>
      <div class="cinfo"><div class="cname">\${esc(u.name)}</div><div class="cprev">\${u.phone}</div></div>
    </div>\`;
  }).join('');
}

// ══════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════
function viewImg(src){ document.getElementById('imgvsrc').src=src; document.getElementById('imgv').classList.add('on'); }

function toast(msg){
  const n=document.createElement('div');
  n.className='notif'; n.textContent=msg;
  document.body.appendChild(n);
  setTimeout(()=>n.remove(),3400);
}

function uname(phone){
  const u=db.users.get(phone); return u?u.name:phone;
}

function esc(s){
  if(!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtTime(ts){
  if(!ts) return '';
  const d=new Date(ts), now=new Date();
  if(d.toDateString()===now.toDateString()) return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  if(d.toDateString()===new Date(+now-864e5).toDateString()) return 'Yesterday';
  return d.toLocaleDateString([],{day:'numeric',month:'short'});
}

function fmtDate(ts){
  const d=new Date(ts), now=new Date();
  if(d.toDateString()===now.toDateString()) return 'Today';
  if(d.toDateString()===new Date(+now-864e5).toDateString()) return 'Yesterday';
  return d.toLocaleDateString([],{weekday:'long',day:'numeric',month:'long'});
}

function ago(ts){
  const d=Date.now()-ts;
  if(d<6e4) return 'just now';
  if(d<3.6e6) return Math.floor(d/6e4)+'m ago';
  if(d<864e5) return Math.floor(d/3.6e6)+'h ago';
  return Math.floor(d/864e5)+'d ago';
}
</script>
</body>
</html>`;

// Serve the frontend for all non-API routes
app.get('*', (req, res) => res.send(FRONTEND));

// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n' + '═'.repeat(50));
  console.log('  ███████╗██╗     ███████╗');
  console.log('  ██╔════╝██║     ██╔════╝');
  console.log('  ███████╗██║     ███████╗');
  console.log('  ╚════██║██║     ╚════██║');
  console.log('  ███████║███████╗███████║');
  console.log('  ╚══════╝╚══════╝╚══════╝');
  console.log('  Secure Local Social — v1.0.0');
  console.log('═'.repeat(50));
  console.log(\`\n  🌐  http://localhost:\${PORT}\n\`);
  console.log('  Demo users:');
  console.log('    📱  677001122  (Alice Mbeki)');
  console.log('    📱  699334455  (Bruno Tchoupo)');
  console.log('    📱  651778899  (Clara Nkomo)');
  console.log('    📱  622445566  (David Essama)');
  console.log('    📱  677889900  (Esther Biya)');
  console.log('    📱  655123456  (Francois Ateba)\n');
  console.log('  Run: node sls.js');
  console.log('═'.repeat(50) + '\n');
});
