'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, GameError } = require('./game/engine');
const { decide: botDecide } = require('./game/bot');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

// ── статика ──
const server = http.createServer((req, res) => {
  let u;
  try { u = decodeURIComponent(req.url.split('?')[0]); } catch { u = '/'; }
  if (u === '/') u = '/index.html';
  if (u === '/health') { res.writeHead(200); res.end('ok'); return; }
  const f = path.normalize(path.join(PUB, u));
  if (!f.startsWith(PUB)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// Сжатие сообщений: трафик меньше примерно в 7 раз
const wss = new WebSocketServer({ server, perMessageDeflate: { threshold: 512, zlibDeflateOptions: { level: 6 }, serverNoContextTakeover: false, clientNoContextTakeover: true } });

// Режим админа. ВРЕМЕННО: пароль по умолчанию прописан в коде — потом убрать и задавать
// только переменной окружения ADMIN_PASSWORD на Render (она, если задана, важнее).
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1357';
function passwordOk(p) {
  if (!ADMIN_PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(p)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// token -> session {token, pid, name, ws, room}
const sessions = new Map();
const byPid = new Map();
// code -> room
const rooms = new Map();

const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(c));
  return c;
}
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);

function roomView(room, pid) {
  return {
    code: room.code,
    hostId: room.hostId,
    settings: room.settings,
    teams: room.teams,
    members: room.members.map((id) => {
      const s = byPid.get(id);
      return { id, name: s ? s.name : '???', connected: !!(s && (s.ws || s.isBot)), bot: !!(s && s.isBot) };
    }),
    admin: !!(byPid.get(pid) || {}).admin,
    chat: room.chat.slice(-60),
    game: room.game ? room.game.view(pid) : null,
    turnLeft: room.game && !room.game.over && room.deadline ? Math.max(0, room.deadline - Date.now()) : null,
    turnLimit: turnMs(room),
    you: pid,
  };
}

// ── таймер хода: хост выбирает «без ограничения» (по умолчанию), 1 или 2 минуты ──
const turnMs = (room) => {
  const v = room.settings && room.settings.turnTime;
  return v === '60' || v === '120' ? Number(v) * 1000 : null;
};
function ensureTurnTimer(room) {
  const g = room.game;
  if (!g || g.over || !turnMs(room)) { clearTimeout(room.turnTimer); room.turnTimer = null; room.deadline = null; room.timerTurn = null; return; }
  if (room.timerTurn === g.turnNo) return;
  clearTimeout(room.turnTimer);
  room.timerTurn = g.turnNo;
  const limit = turnMs(room);
  room.deadline = Date.now() + limit;
  const turn = g.turnNo;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    if (!rooms.has(room.code) || room.game !== g || g.over || g.turnNo !== turn) return;
    // ход ботов не ограничиваем — они ходят сами; если людей нет онлайн, партия на паузе
    const anyoneOnline = room.members.some((id) => { const x = byPid.get(id); return x && x.ws; });
    const humansActive = g.active().some((p) => !isBotId(p.id));
    if (!anyoneOnline || !humansActive) { room.timerTurn = null; return; }
    g.timeout();
    broadcastRoom(room);
  }, limit + 300);
}

function broadcastRoom(room) {
  room.lastActive = Date.now();
  ensureTurnTimer(room);
  for (const pid of room.members) {
    const s = byPid.get(pid);
    if (s && s.ws) send(s.ws, { t: 'room', room: roomView(room, pid) });
  }
  scheduleBots(room);
}

// ── боты ──
const BOT_NAMES = ['Вега', 'Орион', 'Сириус', 'Альтаир', 'Лира', 'Денеб', 'Антарес', 'Полярис'];
const isBotId = (id) => { const s = byPid.get(id); return !!(s && s.isBot); };
const humans = (room) => room.members.filter((id) => !isBotId(id));

function addBot(room) {
  const used = new Set(room.members.map((id) => (byPid.get(id) || {}).name));
  const name = 'Бот ' + (BOT_NAMES.find((n) => !used.has('Бот ' + n)) || (room.members.length + 1));
  const pid = 'bot-' + rid(4);
  byPid.set(pid, { pid, name, isBot: true, ws: null, room: room.code });
  room.members.push(pid);
  room.teams[pid] = smallerTeam(room);
  room.chat.push({ sys: true, text: `${name} садится за стол` });
}
function removeBot(room, pid) {
  room.members = room.members.filter((id) => id !== pid);
  delete room.teams[pid];
  byPid.delete(pid);
}

// Боты ходят с паузами, чтобы люди успевали следить за ходом
function scheduleBots(room) {
  if (room.botTimer || !room.game || room.game.over) return;
  if (!room.members.some((id) => { const x = byPid.get(id); return x && x.ws; })) return;
  const g = room.game;
  const who = g.active().map((p) => p.id).filter(isBotId);
  if (!who.length) return;
  room.botTimer = setTimeout(() => { room.botTimer = null; botTick(room); }, who.some((id) => g.promptOf(id)) ? 650 : 800);
}
function botTick(room) {
  const g = room.game;
  if (!g || g.over || !rooms.has(room.code)) return;
  const who = g.active().map((p) => p.id);
  for (const pid of who) {
    if (!isBotId(pid)) continue;
    const me = g.pl(pid);
    const mate = g.players.find((x) => x.team === me.team && x.id !== pid && x.alive);
    // в 2 на 2 с живым напарником бот тратит общие деньги и урон только после того, как напарник нажал «Завершить ход»
    const holdShared = g.mode === 'teams' && mate && !isBotId(mate.id) && !g.ready[mate.id];
    const a = botDecide(g, pid, { holdShared });
    if (!a) continue;
    try { g.act(pid, a); }
    catch (e) {
      if (!(e instanceof GameError)) { console.error(e); }
      try { g.act(pid, { type: 'endTurn' }); } catch {}
    }
    broadcastRoom(room);
    return;
  }
}

function roomList() {
  return [...rooms.values()]
    .filter((r) => !r.game && r.members.length < r.settings.maxPlayers)
    .map((r) => ({
      code: r.code,
      host: (byPid.get(r.hostId) || {}).name || '?',
      count: r.members.length,
      max: r.settings.maxPlayers,
      authority: r.settings.authority,
      mode: r.settings.mode,
    }));
}
function broadcastList() {
  const list = roomList();
  for (const s of sessions.values()) if (s.ws && !s.room) send(s.ws, { t: 'rooms', list });
}

function leaveRoom(s) {
  const room = rooms.get(s.room);
  s.room = null;
  if (!room) return;
  if (room.game && !room.game.over) room.game.forfeit(s.pid);
  room.members = room.members.filter((id) => id !== s.pid);
  delete room.teams[s.pid];
  if (!humans(room).length) { for (const id of room.members) byPid.delete(id); clearTimeout(room.botTimer); rooms.delete(room.code); broadcastList(); return; }
  if (room.hostId === s.pid) room.hostId = humans(room)[0];
  broadcastRoom(room);
  broadcastList();
}

function smallerTeam(room) {
  const a = room.members.filter((id) => room.teams[id] === 'A').length;
  const b = room.members.filter((id) => room.teams[id] === 'B').length;
  return a <= b ? 'A' : 'B';
}
const clampInt = (v, lo, hi, d) => { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };

const handlers = {
  hello(s, m, ws) {
    // уже обработано при привязке сессии
  },
  setName(s, m) {
    const n = cleanName(m.name);
    if (!n) throw new GameError('Введите имя');
    s.name = n;
    const room = rooms.get(s.room);
    if (room) {
      if (room.game) { const p = room.game.pl(s.pid); if (p) p.name = n; }
      broadcastRoom(room);
    }
  },
  listRooms(s, m, ws) { send(ws, { t: 'rooms', list: roomList() }); },
  create(s, m) {
    const n = cleanName(m.name);
    if (n) s.name = n;
    if (!s.name) throw new GameError('Введите имя');
    if (s.room) leaveRoom(s);
    const code = newCode();
    const room = {
      code, hostId: s.pid, members: [s.pid], game: null, chat: [], teams: { [s.pid]: 'A' },
      settings: { authority: 50, maxPlayers: 4, randomOrder: true, mode: 'ffa', deckSize: 'auto', turnTime: 'off', heroes: true },
      lastActive: Date.now(),
    };
    rooms.set(code, room);
    s.room = code;
    broadcastRoom(room);
    broadcastList();
  },
  join(s, m) {
    const n = cleanName(m.name);
    if (n) s.name = n;
    if (!s.name) throw new GameError('Введите имя');
    const code = String(m.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) throw new GameError('Стол с таким кодом не найден');
    if (room.members.includes(s.pid)) { s.room = code; broadcastRoom(room); return; }
    if (room.game) throw new GameError('За этим столом уже идёт игра');
    if (room.members.length >= room.settings.maxPlayers) throw new GameError('Стол заполнен');
    if (s.room && s.room !== code) leaveRoom(s);
    room.members.push(s.pid);
    room.teams[s.pid] = smallerTeam(room);
    s.room = code;
    room.chat.push({ sys: true, text: `${s.name} садится за стол` });
    broadcastRoom(room);
    broadcastList();
  },
  leave(s, m, ws) {
    if (!s.room) return;
    leaveRoom(s);
    send(ws, { t: 'left' });
    send(ws, { t: 'rooms', list: roomList() });
  },
  settings(s, m) {
    const room = rooms.get(s.room);
    if (!room) return;
    if (room.hostId !== s.pid) throw new GameError('Настройки меняет только хост');
    if (room.game) throw new GameError('Игра уже идёт');
    const st = m.settings || {};
    const mode = st.mode === 'teams' || st.mode === 'ffa' ? st.mode : room.settings.mode;
    if (mode === 'teams' && room.members.length > 4) throw new GameError('Для режима 2 на 2 за столом должно быть не больше 4 игроков');
    room.settings = {
      authority: clampInt(st.authority, 1, 999, room.settings.authority),
      maxPlayers: mode === 'teams' ? 4 : Math.max(room.members.length, clampInt(st.maxPlayers, 2, 6, room.settings.maxPlayers)),
      randomOrder: st.randomOrder === undefined ? room.settings.randomOrder : !!st.randomOrder,
      mode,
      deckSize: ['auto', '1', '1.5', '2'].includes(String(st.deckSize)) ? String(st.deckSize) : room.settings.deckSize,
      turnTime: ['off', '60', '120'].includes(String(st.turnTime)) ? String(st.turnTime) : (room.settings.turnTime || 'off'),
      heroes: st.heroes === undefined ? room.settings.heroes !== false : !!st.heroes,
    };
    broadcastRoom(room);
    broadcastList();
  },
  start(s) {
    const room = rooms.get(s.room);
    if (!room) return;
    if (room.hostId !== s.pid) throw new GameError('Начать игру может только хост');
    if (room.game && !room.game.over) throw new GameError('Игра уже идёт');
    if (room.members.length < 2) throw new GameError('Нужно минимум 2 игрока');
    if (room.members.length > 6) throw new GameError('Максимум 6 игроков');
    if (room.settings.mode === 'teams') {
      const a = room.members.filter((id) => room.teams[id] === 'A').length;
      if (room.members.length !== 4 || a !== 2) throw new GameError('Для режима 2 на 2 нужно 4 игрока: по двое в каждой команде');
    }
    room.game = new Game(room.members.map((id) => ({ id, name: byPid.get(id).name, team: room.teams[id] })), room.settings);
    broadcastRoom(room);
    broadcastList();
  },
  act(s, m) {
    const room = rooms.get(s.room);
    if (!room || !room.game) throw new GameError('Игра не идёт');
    room.game.act(s.pid, m.a);
    broadcastRoom(room);
  },
  kick(s, m) {
    const room = rooms.get(s.room);
    if (!room) return;
    if (room.hostId !== s.pid) throw new GameError('Только хост может это сделать');
    if (m.pid === s.pid) return;
    const t = byPid.get(m.pid);
    if (!t || !room.members.includes(m.pid)) return;
    if (t.isBot && !(room.game && !room.game.over)) { removeBot(room, m.pid); broadcastRoom(room); broadcastList(); return; }
    if (room.game && !room.game.over) {
      room.game.forfeit(m.pid);
      room.chat.push({ sys: true, text: `Хост исключил ${t.name} из партии` });
    } else {
      room.members = room.members.filter((id) => id !== m.pid);
      t.room = null;
      send(t.ws, { t: 'kicked' });
      send(t.ws, { t: 'rooms', list: roomList() });
    }
    broadcastRoom(room);
    broadcastList();
  },
  toLobby(s) {
    const room = rooms.get(s.room);
    if (!room) return;
    if (room.hostId !== s.pid) throw new GameError('Только хост может это сделать');
    if (room.game && !room.game.over) throw new GameError('Партия ещё идёт');
    room.game = null;
    // отключившиеся игроки освобождают места
    room.members = room.members.filter((id) => { const x = byPid.get(id); return x && (x.ws || x.isBot); });
    if (!room.members.includes(room.hostId)) room.hostId = humans(room)[0];
    broadcastRoom(room);
    broadcastList();
  },
  addBot(s) {
    const room = rooms.get(s.room);
    if (!room) return;
    if (room.hostId !== s.pid) throw new GameError('Ботов добавляет хост');
    if (room.game && !room.game.over) throw new GameError('Игра уже идёт');
    if (room.members.length >= room.settings.maxPlayers) throw new GameError('Нет свободных мест');
    addBot(room);
    broadcastRoom(room);
    broadcastList();
  },
  team(s, m) {
    const room = rooms.get(s.room);
    if (!room || room.game) return;
    const pid = m.pid && room.hostId === s.pid ? m.pid : s.pid;
    if (!room.members.includes(pid)) return;
    room.teams[pid] = m.team === 'B' ? 'B' : 'A';
    broadcastRoom(room);
  },
  adminLogin(s, m, ws) {
    const now = Date.now();
    s.adminTries = (s.adminTries || []).filter((t) => now - t < 60_000);
    if (s.adminTries.length >= 5) throw new GameError('Слишком много попыток — подождите минуту');
    s.adminTries.push(now);
    if (!ADMIN_PASSWORD) throw new GameError('Режим админа не настроен на сервере');
    if (!passwordOk(m.password)) throw new GameError('Неверный пароль');
    s.admin = true;
    send(ws, { t: 'admin', ok: true });
    const room = rooms.get(s.room);
    if (room) broadcastRoom(room);
  },
  adminSet(s, m) {
    if (!s.admin) throw new GameError('Нет доступа');
    const room = rooms.get(s.room);
    if (!room || !room.game || room.game.over) throw new GameError('Игра не идёт');
    // можно менять и себя, и любого другого игрока за столом
    const target = m.target && room.game.pl(String(m.target)) ? String(m.target) : s.pid;
    room.game.adminSet(target, m.values || {});
    broadcastRoom(room);
  },
  chat(s, m) {
    const room = rooms.get(s.room);
    if (!room) return;
    const text = String(m.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    if (!text) return;
    room.chat.push({ name: s.name, pid: s.pid, text });
    if (room.chat.length > 200) room.chat.shift();
    broadcastRoom(room);
  },
};

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let s = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'hello') {
      const token = typeof m.token === 'string' && m.token.length >= 8 ? m.token.slice(0, 64) : rid();
      s = sessions.get(token);
      if (!s) {
        s = { token, pid: rid(6), name: cleanName(m.name), ws: null, room: null };
        sessions.set(token, s);
        byPid.set(s.pid, s);
      }
      if (s.ws && s.ws !== ws) { send(s.ws, { t: 'replaced' }); try { s.ws.close(); } catch {} }
      s.ws = ws;
      if (!s.name && m.name) s.name = cleanName(m.name);
      send(ws, { t: 'hello', pid: s.pid, name: s.name });
      const room = rooms.get(s.room);
      if (room && room.members.includes(s.pid)) broadcastRoom(room);
      else { s.room = null; send(ws, { t: 'rooms', list: roomList() }); }
      return;
    }
    if (!s) return;
    const h = handlers[m.t];
    if (!h) return;
    try {
      h(s, m, ws);
    } catch (e) {
      if (e instanceof GameError) send(ws, { t: 'error', msg: e.message });
      else { console.error(e); send(ws, { t: 'error', msg: 'Ошибка сервера' }); }
    }
  });

  ws.on('close', () => {
    if (!s || s.ws !== ws) return;
    s.ws = null;
    const room = rooms.get(s.room);
    if (room) {
      // в лобби (без игры) отключившийся освобождает место через минуту
      broadcastRoom(room);
      const sess = s;
      setTimeout(() => {
        const r = rooms.get(sess.room);
        if (r && !sess.ws && !r.game) leaveRoom(sess);
      }, 60_000);
    }
  });
});

// keepalive + уборка заброшенных столов
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyone = r.members.some((id) => { const x = byPid.get(id); return x && x.ws; });
    // если люди ушли, боты не играют сами с собой бесконечно
    if (!anyone && r.botTimer) { clearTimeout(r.botTimer); r.botTimer = null; }
    if (!anyone && now - (r.humanSeen || r.lastActive) > 60 * 60_000) {
      for (const id of r.members) { const x = byPid.get(id); if (x && x.isBot) byPid.delete(id); else if (x && x.room === code) x.room = null; }
      rooms.delete(code);
    }
    if (anyone) r.humanSeen = now;
  }
}, 30_000);

server.listen(PORT, () => console.log(`Звёздные Державы: http://localhost:${PORT}`));
