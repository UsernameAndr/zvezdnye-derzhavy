(function () {
  'use strict';
  const { CARDS, FACTIONS } = window;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
  const cardsWord = (n) => `${n} ${plural(n, 'карту', 'карты', 'карт')}`;

  let token = store.get('sd_token');
  if (!token) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    store.set('sd_token', token);
  }

  const S = {
    ws: null, connected: false, pid: null,
    name: store.get('sd_name') || '',
    room: null, rooms: [], screen: null,
    sel: [], selKey: null,
    side: 'log', sideOpen: false, unread: 0, chatSeen: 0,
    pendingJoin: (new URLSearchParams(location.search).get('room') || '').toUpperCase(),
    prevAuth: {}, wasMyTurn: false, modal: null, sound: store.get('sd_sound') !== '0',
  };
  const isTouch = matchMedia('(hover: none)').matches;
  const PCOLORS = ['#ffb347', '#7fd1ff', '#c59bff', '#7dff9e', '#ff8fb1', '#ffe066'];

  // ───────────────── сеть ─────────────────
  function connect() {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    S.ws = ws;
    ws.onopen = () => { S.connected = true; $('#conn').classList.add('hidden'); send({ t: 'hello', token, name: S.name }); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMsg(m); };
    ws.onclose = () => {
      S.connected = false;
      $('#conn').classList.remove('hidden');
      setTimeout(connect, 1500);
    };
  }
  const send = (o) => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); };
  const act = (a) => send({ t: 'act', a });

  function onMsg(m) {
    switch (m.t) {
      case 'hello':
        S.pid = m.pid;
        if (m.name && !S.name) S.name = m.name;
        if (S.pendingJoin && S.name) { send({ t: 'join', code: S.pendingJoin, name: S.name }); S.pendingJoin = ''; }
        render();
        break;
      case 'rooms': S.rooms = m.list; if (!S.room) render(); break;
      case 'room': {
        const prevGame = S.room && S.room.game;
        S.room = m.room;
        if (S.room.code && history.replaceState) history.replaceState(null, '', '?room=' + S.room.code);
        if (prevGame && !S.room.game) closeModal();
        render();
        break;
      }
      case 'left': case 'kicked':
        S.room = null;
        history.replaceState && history.replaceState(null, '', location.pathname);
        if (m.t === 'kicked') toast('Хост убрал вас из-за стола', 'warn');
        closeModal();
        render();
        break;
      case 'replaced': toast('Игра открыта в другой вкладке', 'warn'); break;
      case 'error': toast(m.msg, 'err'); if (S.room && S.room.game) render(); break;
    }
  }

  // ───────────────── иконки ─────────────────
  const EMB = {
    blob: '<path d="M10 1.5c4.6 0 8 3.3 8 7.6 0 3-1.7 5.2-3.6 6.4l1.4 3.2-3.6-2c-.7.2-1.4.3-2.2.3-4.6 0-8-3.3-8-7.9S5.4 1.5 10 1.5z"/><circle cx="12.6" cy="8" r="2.2" fill="#0a1a0a"/><circle cx="6.8" cy="10.6" r="1.1" fill="#0a1a0a" opacity=".6"/>',
    trade: '<path d="M10 1l8 4.6v8.8L10 19l-8-4.6V5.6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 5l4 5-4 5-4-5z"/>',
    empire: '<path d="M10 1.2l2.5 5.6 6.1.6-4.6 4.1 1.3 6-5.3-3.1-5.3 3.1 1.3-6L1.4 7.4l6.1-.6z"/>',
    machine: '<path d="M8.6 1h2.8l.5 2.4 1.6.7 2.1-1.3 2 2-1.3 2.1.7 1.6 2.4.5v2.8l-2.4.5-.7 1.6 1.3 2.1-2 2-2.1-1.3-1.6.7-.5 2.4H8.6l-.5-2.4-1.6-.7-2.1 1.3-2-2 1.3-2.1-.7-1.6L1 11.4V8.6l2.4-.5.7-1.6-1.3-2.1 2-2 2.1 1.3 1.6-.7z"/><circle cx="10" cy="10" r="3.2" fill="#1a0505"/>',
    none: '<circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="10" r="2.5"/>',
  };
  const emblem = (f, cls = '') => `<svg class="emb ${cls}" viewBox="0 0 20 20" style="color:${FACTIONS[f].color};fill:${FACTIONS[f].color}">${EMB[f]}</svg>`;
  const TRASH = '<svg class="emb" viewBox="0 0 20 20" fill="#c9d1dc"><path d="M7 2h6l1 2h4v2H2V4h4zM4 7h12l-1 11H5z"/><path d="M8 9v7M12 9v7" stroke="#1b2029" stroke-width="1.4"/></svg>';
  const TRASH_SM = '<svg viewBox="0 0 20 20" width="10" height="10" fill="currentColor"><path d="M7 2h6l1 2h4v2H2V4h4zM4 7h12l-1 11H5z"/></svg>';
  const IC = {
    trade: (v) => `<span class="ic ic-trade" title="Торговля"><b>${v}</b></span>`,
    combat: (v) => `<span class="ic ic-combat" title="Урон"><b>${v}</b></span>`,
    auth: (v) => `<span class="ic ic-auth" title="Влияние"><b>+${v}</b></span>`,
  };

  function eff(e) {
    const k = Object.keys(e)[0], v = e[k];
    switch (k) {
      case 'trade': return IC.trade(v);
      case 'combat': return IC.combat(v);
      case 'auth': return IC.auth(v);
      case 'draw': return `<span class="tx">${v > 1 ? `Возьмите ${cardsWord(v)}` : 'Возьмите карту'}</span>`;
      case 'opDiscard': return `<span class="tx">Соперник сбрасывает карту</span>`;
      case 'scrapRow': return `<span class="tx">Можно утилизировать карту из торгового ряда</span>`;
      case 'scrapHD': return `<span class="tx">Можно утилизировать карту из руки или сброса</span>`;
      case 'destroyBase': return `<span class="tx">Можно уничтожить базу</span>`;
      case 'choose': return `<span class="choose">${v.map((o) => `<span class="opt">${o.map(eff).join(' ')}</span>`).join('<i class="or">или</i>')}</span>`;
      case 'topNext': return `<span class="tx">Следующий купленный корабль — на верх колоды</span>`;
      case 'freeShip': return `<span class="tx">Возьмите любой корабль из ряда бесплатно на верх колоды</span>`;
      case 'yacht': return `<span class="tx">Если у вас 2+ базы — возьмите 2 карты</span>`;
      case 'blobDraw': return `<span class="tx">Карта за каждую карту Роя, сыгранную в этот ход</span>`;
      case 'recycle': return `<span class="tx">Сбросьте до 2 карт и возьмите столько же</span>`;
      case 'machineBase': return `<span class="tx">Возьмите карту, затем утилизируйте карту из руки</span>`;
      case 'brain': return `<span class="tx">Утилизируйте до 2 карт из руки/сброса, возьмите столько же</span>`;
      case 'copy': return `<span class="tx">Скопируйте другой ваш корабль, сыгранный в этот ход</span>`;
      default: return '';
    }
  }
  const abil = (list) => {
    const nums = list.filter((e) => ['trade', 'combat', 'auth'].includes(Object.keys(e)[0]));
    const rest = list.filter((e) => !nums.includes(e));
    return (nums.length ? `<span class="nums">${nums.map(eff).join('')}</span>` : '') + rest.map(eff).join('');
  };

  // ───────────────── карты ─────────────────
  function cardHTML(c, o = {}) {
    const cid = c.copied || c.cid;
    const d = CARDS[cid];
    const F = FACTIONS[d.faction];
    const used = c.used || {};
    const typeName = d.type === 'base' ? (d.outpost ? 'Аванпост' : 'База') : 'Корабль';
    const cls = ['card', 'f-' + d.faction, o.size || 'md', d.type === 'base' ? 'is-base' : '', d.outpost ? 'is-outpost' : '', o.cls || ''].join(' ');
    let prim = abil(d.primary);
    if (d.fleetHQ) prim += `<span class="tx">Все ваши корабли получают ${IC.combat(1)}</span>`;
    if (d.allAlly) prim += `<span class="tx">Союзник для карт всех фракций</span>`;
    return `<div class="${cls}" data-cid="${cid}" ${c.uid ? `data-uid="${c.uid}"` : ''} ${o.attrs || ''} style="--fc:${F.color};--fd:${F.dark};--fl:${F.light}">
      <div class="c-top"><span class="c-name">${esc(d.name)}</span>${d.cost ? `<span class="c-cost">${d.cost}</span>` : ''}</div>
      <div class="c-art">${window.cardArt(cid)}${c.copied ? '<span class="c-copy">копия · Мимикр</span>' : ''}</div>
      <div class="c-type">${emblem(d.faction)}<span>${typeName}${d.faction !== 'none' ? ` · ${F.name}` : ''}</span></div>
      <div class="c-body">
        ${prim ? `<div class="ab ab-p ${o.manual && !used.primary ? 'ready' : ''}">${prim}</div>` : ''}
        ${d.ally.length ? `<div class="ab ab-a ${used.ally ? 'done' : ''}"><span class="ab-ic">${emblem(d.faction)}</span><div class="ab-c">${abil(d.ally)}</div></div>` : ''}
        ${d.scrap.length ? `<div class="ab ab-s"><span class="ab-ic">${TRASH}</span><div class="ab-c">${abil(d.scrap)}</div></div>` : ''}
      </div>
      ${d.type === 'base' ? `<div class="c-def ${d.outpost ? 'out' : ''}" title="${d.outpost ? 'Аванпост: защищает владельца' : 'Защита базы'}"><b>${d.defense}</b></div>` : ''}
      ${o.badge || ''}
      ${o.actions ? `<div class="c-actions">${o.actions}</div>` : ''}
    </div>`;
  }

  function backHTML(label, count, size = 'md', extra = '') {
    return `<div class="card back ${size}" ${extra}><div class="back-in"><div class="back-logo">ЗД</div></div>${count !== undefined ? `<div class="pile-count">${count}</div>` : ''}${label ? `<div class="pile-label">${label}</div>` : ''}</div>`;
  }

  // ───────────────── модальные окна / уведомления ─────────────────
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3100);
  }
  function openModal(html, opts = {}) {
    S.modal = opts.kind || 'info';
    $('#modal-root').innerHTML = `<div class="overlay ${opts.locked ? 'locked' : ''}" data-act="${opts.locked ? '' : 'close-modal-bg'}"><div class="modal ${opts.cls || ''}">${opts.locked ? '' : '<button class="x" data-act="close-modal" aria-label="Закрыть">×</button>'}${html}</div></div>`;
  }
  function closeModal() { S.modal = null; $('#modal-root').innerHTML = ''; }
  function confirmBox(text, okLabel, onOk, danger) {
    openModal(`<h3>${text}</h3><div class="m-actions"><button class="btn" data-act="close-modal">Отмена</button><button class="btn ${danger ? 'danger' : 'primary'}" id="m-ok">${okLabel}</button></div>`, { kind: 'confirm' });
    $('#m-ok').onclick = () => { closeModal(); onOk(); };
  }

  function beep() {
    if (!S.sound) return;
    try {
      const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(660, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.15);
      g.gain.setValueAtTime(0.12, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.36);
    } catch {}
  }

  // ───────────────── экраны ─────────────────
  function render() {
    if (!S.pid) return;
    if (!S.room) return renderHome();
    if (!S.room.game) return renderLobby();
    return renderGame();
  }

  // ── главная ──
  function renderHome() {
    const app = $('#app');
    if (S.screen !== 'home') {
      S.screen = 'home';
      const sample = ['b_mother', 't_flagship', 'e_dread', 'm_brain'];
      app.innerHTML = `<div class="home">
        <div class="hero">
          <div class="logo">Звёздные<br>Державы</div>
          <p class="tag">Космическая колодостроительная битва · онлайн · 2–6 игроков</p>
          <div class="hero-cards">${sample.map((cid, i) => cardHTML({ cid }, { size: 'md', cls: 'fan fan' + i })).join('')}</div>
        </div>
        <div class="panel home-panel">
          <label class="fld">Ваше имя<input id="h-name" maxlength="20" autocomplete="nickname" placeholder="Например, Адмирал" value="${esc(S.name)}"></label>
          <button class="btn primary big" data-act="create">Создать стол</button>
          <div class="join-row"><input id="h-code" maxlength="4" placeholder="Код стола" autocapitalize="characters" value="${esc(S.pendingJoin)}"><button class="btn" data-act="join">Войти</button></div>
          <h3>Открытые столы</h3>
          <div id="h-rooms" class="room-list"></div>
          <button class="btn ghost" data-act="rules">Как играть</button>
        </div>
      </div>`;
      $('#h-name').addEventListener('input', (e) => { S.name = e.target.value.trim(); store.set('sd_name', S.name); });
      $('#h-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(e.target.value); });
    }
    const list = $('#h-rooms');
    list.innerHTML = S.rooms.length
      ? S.rooms.map((r) => `<button class="room-item" data-act="join-code" data-code="${r.code}"><b>${esc(r.host)}</b><span>${r.count}/${r.max} игроков · влияние ${r.authority}</span><i>${r.code}</i></button>`).join('')
      : '<div class="empty">Пока никого. Создайте стол и отправьте друзьям ссылку.</div>';
  }

  function needName() {
    const inp = $('#h-name');
    if (inp) S.name = inp.value.trim();
    if (!S.name) { toast('Сначала введите имя', 'warn'); inp && inp.focus(); return true; }
    store.set('sd_name', S.name);
    return false;
  }
  function doJoin(code) {
    if (needName()) return;
    code = String(code || '').trim().toUpperCase();
    if (code.length !== 4) return toast('Код стола — 4 символа', 'warn');
    send({ t: 'join', code, name: S.name });
  }

  // ── лобби ──
  function renderLobby() {
    const r = S.room;
    const host = r.hostId === S.pid;
    const app = $('#app');
    if (S.screen !== 'lobby') {
      S.screen = 'lobby';
      app.innerHTML = `<div class="lobby"><div class="panel lobby-panel">
        <div class="l-head"><div><div class="l-sub">Стол</div><div class="l-code" id="l-code"></div></div>
          <button class="btn" data-act="copy-link">Скопировать приглашение</button></div>
        <div class="l-grid">
          <div><h3 id="l-ptitle">Игроки</h3><div id="l-players" class="l-players"></div></div>
          <div><h3>Настройки партии</h3><div id="l-settings"></div></div>
        </div>
        <div class="l-chat"><div id="l-chatlog" class="chatlog"></div><form id="l-chatform" class="chatform"><input maxlength="200" placeholder="Сообщение…"><button class="btn">→</button></form></div>
        <div class="l-actions"><button class="btn ghost" data-act="leave">Выйти</button><button class="btn ghost" data-act="rules">Правила</button><span id="l-start"></span></div>
      </div></div>`;
      $('#l-chatform').addEventListener('submit', (e) => { e.preventDefault(); const i = e.target.querySelector('input'); if (i.value.trim()) send({ t: 'chat', text: i.value }); i.value = ''; });
    }
    $('#l-code').textContent = r.code;
    $('#l-ptitle').textContent = `Игроки (${r.members.length}/${r.settings.maxPlayers})`;
    $('#l-players').innerHTML = r.members.map((m, i) => `<div class="l-player">
        <span class="avatar" style="--pc:${PCOLORS[i % 6]}">${esc((m.name || '?')[0].toUpperCase())}</span>
        <span class="nm">${esc(m.name)}${m.id === S.pid ? ' <small>(вы)</small>' : ''}</span>
        ${m.id === r.hostId ? '<span class="chip gold">хост</span>' : ''}
        ${!m.connected ? '<span class="chip">не в сети</span>' : ''}
        ${host && m.id !== S.pid ? `<button class="lnk" data-act="kick" data-pid="${m.id}">убрать</button>` : ''}
      </div>`).join('') + (r.members.length < r.settings.maxPlayers ? '<div class="l-player empty-seat">Свободное место…</div>' : '');

    const st = r.settings;
    const chips = (k, vals, cur, fmt = (v) => v) => vals.map((v) => `<button class="chip-btn ${cur === v ? 'on' : ''}" ${host ? `data-act="set" data-k="${k}" data-v="${v}"` : 'disabled'}>${fmt(v)}</button>`).join('');
    const sEl = $('#l-settings');
    // пока хост печатает своё число влияния, поле не трогаем — обновляем только подсветку кнопок
    const typing = document.activeElement && document.activeElement.id === 'l-auth';
    if (typing) {
      sEl.querySelectorAll('.chip-btn[data-k]').forEach((b) => b.classList.toggle('on', String(st[b.dataset.k]) === b.dataset.v));
    } else {
      sEl.innerHTML = `
        <div class="set"><div class="set-l">Стартовое влияние (здоровье)</div>
          <div class="chips">${chips('authority', [20, 30, 40, 50, 75, 100], st.authority)}</div>
          ${host ? `<label class="custom">или своё: <input id="l-auth" type="number" min="1" max="999" value="${st.authority}"></label>` : `<div class="big-val">${st.authority}</div>`}
        </div>
        <div class="set"><div class="set-l">Мест за столом</div><div class="chips">${chips('maxPlayers', [2, 3, 4, 5, 6], st.maxPlayers)}</div></div>
        <div class="set"><div class="set-l">Кто ходит первым</div><div class="chips">${chips('randomOrder', [true, false], st.randomOrder, (v) => (v ? 'Случайно' : 'По порядку входа'))}</div></div>
        ${host ? '' : '<p class="hint">Настройки выбирает хост.</p>'}`;
      const ai = $('#l-auth');
      if (ai) ai.addEventListener('change', () => send({ t: 'settings', settings: { ...S.room.settings, authority: ai.value } }));
    }
    $('#l-start').innerHTML = host
      ? `<button class="btn primary big" data-act="start" ${r.members.length < 2 ? 'disabled' : ''}>${r.members.length < 2 ? 'Ждём игроков…' : 'Начать игру'}</button>`
      : '<span class="hint">Ждём, когда хост начнёт игру…</span>';
    renderChat($('#l-chatlog'));
  }

  function renderChat(el) {
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.innerHTML = S.room.chat.map((c) => (c.sys ? `<div class="msg sys">${esc(c.text)}</div>` : `<div class="msg"><b>${esc(c.name)}:</b> ${esc(c.text)}</div>`)).join('') || '<div class="msg sys">Здесь можно переписываться</div>';
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  // ── игра ──
  function renderGame() {
    const r = S.room, g = r.game;
    const app = $('#app');
    if (S.screen !== 'game') {
      S.screen = 'game';
      S.prevAuth = {};
      app.innerHTML = `<div class="game">
        <div id="board" class="board"></div>
        <aside id="side" class="side">
          <div class="tabs"><button data-act="tab" data-tab="log" class="on">Журнал</button><button data-act="tab" data-tab="chat">Чат <span id="unread" class="unread hidden"></span></button><button class="side-close" data-act="toggle-side">×</button></div>
          <div id="side-log" class="log"></div>
          <div id="side-chat" class="side-chat hidden"><div id="chatlog" class="chatlog"></div><form id="chatform" class="chatform"><input maxlength="200" placeholder="Сообщение…"><button class="btn">→</button></form></div>
        </aside>
      </div>`;
      $('#chatform').addEventListener('submit', (e) => { e.preventDefault(); const i = e.target.querySelector('input'); if (i.value.trim()) send({ t: 'chat', text: i.value }); i.value = ''; });
      S.chatSeenUser = undefined;
    }
    zoom.classList.add('hidden');

    const userMsgs = r.chat.filter((c) => !c.sys).length;
    if (S.chatSeenUser === undefined) S.chatSeenUser = userMsgs;
    if (S.side === 'chat' && (S.sideOpen || matchMedia('(min-width: 1100px)').matches)) S.chatSeenUser = userMsgs;
    S.unread = Math.max(0, userMsgs - S.chatSeenUser);

    const me = g.players.find((p) => p.id === S.pid);
    const cur = g.players.find((p) => p.id === g.turn);
    const myTurn = !!me && g.turn === S.pid && !g.over;
    const colorOf = (pid) => PCOLORS[g.players.findIndex((p) => p.id === pid) % 6];
    const member = (pid) => r.members.find((m) => m.id === pid);
    const host = r.hostId === S.pid;

    // соперники по кругу, начиная со следующего за мной
    let opps = g.players.filter((p) => p.id !== S.pid);
    if (me) { const i = g.players.indexOf(me); opps = [...g.players.slice(i + 1), ...g.players.slice(0, i)]; }

    const outpostsOf = (p) => p.bases.some((b) => CARDS[b.cid].outpost);
    const combat = g.pool.combat, trade = g.pool.trade;
    const blocked = !!g.prompt;

    // уведомление о начале своего хода
    if (myTurn && !S.wasMyTurn) { beep(); flashTurn(); }
    S.wasMyTurn = myTurn;
    document.title = myTurn ? '★ Ваш ход — Звёздные Державы' : 'Звёздные Державы — онлайн';

    const oppHTML = opps.map((p) => {
      const hasOut = outpostsOf(p);
      const m = member(p.id);
      const hit = S.prevAuth[p.id] !== undefined && p.authority < S.prevAuth[p.id];
      const canAtk = myTurn && !blocked && p.alive && combat > 0 && !hasOut;
      const bases = p.bases.map((b) => {
        const d = CARDS[b.cid];
        const allowed = myTurn && !blocked && p.alive && (d.outpost || !hasOut);
        const can = allowed && combat >= d.defense;
        return cardHTML(b, {
          size: 'xs',
          cls: (can ? 'targetable' : '') + (allowed && !can ? ' target-weak' : ''),
          attrs: `data-zone="oppbase" data-owner="${p.id}" ${can ? `data-act="atkbase" data-target="${p.id}"` : ''}`,
        });
      }).join('');
      return `<div class="opp ${p.id === g.turn ? 'turn' : ''} ${p.alive ? '' : 'dead'} ${hit ? 'hit' : ''}" style="--pc:${colorOf(p.id)}">
        <div class="opp-head">
          <span class="avatar">${esc(p.name[0].toUpperCase())}</span>
          <div class="opp-nm"><b>${esc(p.name)}</b>${p.id === r.hostId ? ' <span class="chip gold tiny">хост</span>' : ''}${m && !m.connected ? ' <span class="chip tiny">офлайн</span>' : ''}</div>
          <div class="auth-badge ${p.authority <= 10 ? 'low' : ''}" title="Влияние">${Math.max(0, p.authority)}</div>
        </div>
        ${p.alive ? `<div class="opp-meta">
          <span title="Карт в руке">✋ ${p.handCount}</span>
          <span title="Карт в колоде">🂠 ${p.deckCount}</span>
          <button class="lnk" data-act="view-discard" data-pid="${p.id}" title="Сброс">сброс ${p.discard.length}</button>
          ${p.pendingDiscard ? `<span class="chip warn tiny">сбросит ${p.pendingDiscard}</span>` : ''}
        </div>
        <div class="opp-bases">${bases || '<span class="no-bases">нет баз</span>'}</div>
        ${canAtk ? `<button class="btn atk" data-act="atkplayer" data-target="${p.id}">⚔ Атаковать</button>` : hasOut && myTurn && combat > 0 ? '<div class="hint small">Сначала аванпосты</div>' : ''}
        ${host && m && !m.connected && !g.over ? `<button class="lnk danger" data-act="kick" data-pid="${p.id}">исключить</button>` : ''}`
        : `<div class="dead-lbl">выбыл${p.place ? ` · ${p.place} место` : ''}</div>`}
      </div>`;
    }).join('');

    // рынок
    const rowHTML = g.row.map((c, i) => {
      if (!c) return '<div class="card md slot-empty"></div>';
      const d = CARDS[c.cid];
      const can = myTurn && !blocked && trade >= d.cost;
      return cardHTML(c, { size: 'md', cls: can ? 'can-buy' : '', attrs: `data-zone="row" data-slot="${i}" ${can && !isTouch ? 'data-act="buy"' : ''}` });
    }).join('');
    const canExp = myTurn && !blocked && trade >= 2 && g.explorers > 0;
    const expHTML = g.explorers > 0
      ? cardHTML({ cid: 'explorer' }, { size: 'md', cls: 'pile-card ' + (canExp ? 'can-buy' : ''), attrs: `data-zone="row" data-slot="explorer" ${canExp && !isTouch ? 'data-act="buy"' : ''}`, badge: `<div class="pile-count">${g.explorers}</div>` })
      : '<div class="card md slot-empty"><span>Старатели закончились</span></div>';

    // поле хода
    const isMe = cur && cur.id === S.pid;
    const playHTML = cur ? cur.inPlay.map((c) => {
      const d = CARDS[c.copied || c.cid];
      const acts = isMe && myTurn && !blocked && d.scrap.length ? `<button class="mini-btn scrap" data-act="scrap" data-uid="${c.uid}" title="Утилизировать">${TRASH_SM} Утиль</button>` : '';
      return cardHTML(c, { size: 'sm', actions: acts, attrs: 'data-zone="play"' });
    }).join('') : '';

    // моя зона
    let meHTML = '';
    if (me) {
      const bases = me.bases.map((b) => {
        const d = CARDS[b.cid];
        const used = b.used || {};
        let acts = '';
        if (myTurn && !blocked) {
          if (d.primary.length && !used.primary) acts += `<button class="mini-btn use" data-act="activate" data-uid="${b.uid}">Использовать</button>`;
          if (d.scrap.length) acts += `<button class="mini-btn scrap" data-act="scrap" data-uid="${b.uid}" title="Утилизировать">${TRASH_SM} Утиль</button>`;
        }
        return cardHTML(b, { size: 'sm', actions: acts, manual: true, attrs: 'data-zone="mybase"' });
      }).join('');
      const hand = (me.hand || []).map((c) => cardHTML(c, { size: 'md', cls: myTurn && !blocked ? 'playable' : '', attrs: `data-zone="hand" ${myTurn && !blocked ? 'data-act="play"' : ''}` })).join('');
      const top = me.discard[me.discard.length - 1];
      meHTML = `<section class="me ${myTurn ? 'my-turn' : ''}" style="--pc:${colorOf(me.id)}">
        <div class="me-side">
          <div class="me-auth ${me.authority <= 10 ? 'low' : ''} ${S.prevAuth[me.id] !== undefined && me.authority < S.prevAuth[me.id] ? 'hit' : ''}"><small>Влияние</small><b>${Math.max(0, me.authority)}</b></div>
          <div class="me-piles">
            ${backHTML('Колода', me.deckCount, 'xs')}
            <div class="discard-pile" data-act="view-discard" data-pid="${me.id}">${top ? cardHTML(top, { size: 'xs' }) : '<div class="card xs slot-empty"></div>'}<div class="pile-count">${me.discard.length}</div><div class="pile-label">Сброс</div></div>
          </div>
        </div>
        <div class="me-main">
          <div class="zone-label">${me.alive ? 'Ваши базы' : 'Вы выбыли'}</div>
          <div class="me-bases">${bases || '<span class="no-bases">Базы появятся здесь</span>'}</div>
          <div class="zone-label">Рука ${me.pendingDiscard ? `<span class="chip warn tiny">в начале хода сбросите ${me.pendingDiscard}</span>` : ''}</div>
          <div class="hand">${hand || '<span class="no-bases">Рука пуста</span>'}</div>
        </div>
        <div class="me-actions">
          <div class="pools"><div class="pool"><span class="ic ic-trade big"><b>${myTurn ? trade : 0}</b></span><small>Торговля</small></div><div class="pool"><span class="ic ic-combat big"><b>${myTurn ? combat : 0}</b></span><small>Урон</small></div></div>
          ${myTurn ? `<button class="btn" data-act="playall" ${blocked || !me.hand.length ? 'disabled' : ''}>Сыграть все карты</button>
            <button class="btn primary big" data-act="endturn" ${blocked ? 'disabled' : ''}>Завершить ход</button>`
            : g.over ? '<button class="btn primary" data-act="show-go">Итоги партии</button>'
            : `<div class="wait">Ходит<br><b style="color:${colorOf(g.turn)}">${esc(cur.name)}</b></div>`}
        </div>
      </section>`;
    } else {
      meHTML = '<section class="me"><div class="wait">Вы наблюдаете за партией</div></section>';
    }

    const turnLbl = g.over ? 'Партия окончена' : myTurn ? 'Ваш ход' : `Ходит ${esc(cur.name)}`;
    $('#board').innerHTML = `
      <header class="g-top">
        <div class="g-title">Звёздные Державы <span class="g-code">стол ${r.code}</span></div>
        <div class="g-turn ${myTurn ? 'mine' : ''}" style="--pc:${colorOf(g.turn)}">${turnLbl}</div>
        <div class="g-btns">
          <button class="btn sm ghost" data-act="rules">Правила</button>
          <button class="btn sm ghost" data-act="menu">Меню</button>
          <button class="btn sm ghost side-toggle" data-act="toggle-side">Журнал${S.unread ? ` <span class="unread">${S.unread}</span>` : ''}</button>
        </div>
      </header>
      <section class="opps cnt-${opps.length}">${oppHTML}</section>
      <section class="center">
        <div class="market">
          <div class="market-label">Торговый ряд</div>
          <div class="market-row">
            ${backHTML('Торговая колода', g.tradeDeckCount, 'md', 'data-zone="tradedeck"')}
            <div class="row-cards">${rowHTML}</div>
            ${expHTML}
          </div>
        </div>
        <div class="playzone" style="--pc:${colorOf(g.turn)}">
          <div class="pz-head"><span>${isMe ? 'Вы сыграли' : `Сыграно: <b>${esc(cur.name)}</b>`}</span>
            <span class="pz-pools">${IC.trade(trade)} ${IC.combat(combat)}</span>
            ${g.topNext ? '<span class="chip tiny">следующий корабль → на верх колоды</span>' : ''}</div>
          <div class="pz-cards">${playHTML || '<span class="no-bases">Пока ничего не сыграно</span>'}</div>
        </div>
      </section>
      ${meHTML}
      ${g.prompt && g.prompt.waiting ? `<div class="waiting-banner">${esc(g.prompt.text)}</div>` : ''}
    `;

    S.prevAuth = Object.fromEntries(g.players.map((p) => [p.id, p.authority]));

    // журнал и чат
    const logEl = $('#side-log');
    logEl.innerHTML = g.log.map((l) => `<div class="le ${l.kind || ''}">${esc(l.text)}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
    renderChat($('#chatlog'));
    const ur = $('#unread');
    if (ur) { ur.textContent = S.unread; ur.classList.toggle('hidden', !S.unread); }

    // окна выбора
    if (g.prompt && !g.prompt.waiting && myTurn) renderPrompt(g);
    else if (S.modal === 'prompt') closeModal();

    if (g.over) { if (!S.goShown) { S.goShown = true; renderGameOver(g, host); } }
    else { S.goShown = false; if (S.modal === 'gameover') closeModal(); }
  }

  function flashTurn() {
    const el = document.createElement('div');
    el.className = 'turn-flash';
    el.textContent = 'Ваш ход!';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  // ── выбор ──
  function renderPrompt(g) {
    const pr = g.prompt;
    const key = JSON.stringify([pr.kind, pr.purpose, pr.text, (pr.cards || []).map((c) => c.uid)]);
    if (S.selKey !== key) { S.selKey = key; S.sel = []; }
    let body = '';
    if (pr.kind === 'choose') {
      body = `<div class="choices">${pr.options.map((o, i) => `<button class="choice" data-act="choose" data-i="${i}">${abil(o)}</button>`).join('')}</div>`;
    } else if (pr.kind === 'opponent') {
      body = `<div class="choices">${pr.options.map((id) => { const p = g.players.find((x) => x.id === id); return `<button class="choice" data-act="opp" data-target="${id}"><b>${esc(p.name)}</b><small>✋ ${p.handCount} · влияние ${p.authority}</small></button>`; }).join('')}</div>`;
    } else {
      const zoneName = { hand: 'рука', discard: 'сброс', row: 'ряд', base: 'база', explorer: 'стопка', play: 'в игре' };
      body = `<div class="pick-grid">${pr.cards.map((c) => {
        const owner = c.owner ? g.players.find((p) => p.id === c.owner) : null;
        return `<div class="pick ${S.sel.includes(c.uid) ? 'sel' : ''}" data-act="pick" data-uid="${c.uid}">
          ${cardHTML(c, { size: 'sm' })}<div class="pick-zone">${owner ? esc(owner.name) : zoneName[c.zone] || ''}</div></div>`;
      }).join('')}</div>`;
      const min = Math.min(pr.min, pr.cards.length);
      const ok = S.sel.length >= min && S.sel.length <= pr.max;
      body += `<div class="m-actions">
        ${pr.min === 0 ? '<button class="btn" data-act="pick-skip">Пропустить</button>' : ''}
        <span class="sel-count">Выбрано ${S.sel.length} из ${pr.max}</span>
        <button class="btn primary" data-act="pick-ok" ${ok && S.sel.length ? '' : 'disabled'}>Подтвердить</button></div>`;
    }
    openModal(`<h3>${esc(pr.text)}</h3>${body}`, { kind: 'prompt', locked: true, cls: 'wide' });
  }

  function renderGameOver(g, host) {
    if (S.modal === 'gameover') return;
    const ranked = [...g.players].sort((a, b) => (a.place || 99) - (b.place || 99));
    const win = g.players.find((p) => p.id === g.winner);
    openModal(`<div class="go">
      <div class="go-crown">🏆</div>
      <h2>${win ? (win.id === S.pid ? 'Вы победили!' : `Победил ${esc(win.name)}`) : 'Партия окончена'}</h2>
      <ol class="go-list">${ranked.map((p) => `<li><b>${esc(p.name)}</b> <span>${p.place ? p.place + ' место' : ''}</span></li>`).join('')}</ol>
      <div class="m-actions">${host ? '<button class="btn primary big" data-act="tolobby">Новая партия</button>' : '<span class="hint">Хост может начать новую партию</span>'}
      <button class="btn ghost" data-act="close-modal">Посмотреть стол</button><button class="btn ghost" data-act="leave">Выйти</button></div></div>`, { kind: 'gameover' });
  }

  // ── просмотр карт ──
  function cardModal(el) {
    const g = S.room && S.room.game;
    const cid = el.dataset.cid;
    const zone = el.dataset.zone;
    let actions = '';
    if (g && g.turn === S.pid && !g.prompt && !g.over) {
      if (zone === 'row') {
        const slot = el.dataset.slot;
        const cost = CARDS[cid].cost;
        actions = `<button class="btn primary big" data-act="buy" data-slot="${slot}" ${g.pool.trade >= cost ? '' : 'disabled'}>Купить за ${cost}</button>`;
      }
      if (zone === 'oppbase' && el.dataset.act === 'atkbase') {
        actions = `<button class="btn danger big" data-act="atkbase" data-target="${el.dataset.target}" data-uid="${el.dataset.uid}">Уничтожить (${CARDS[cid].defense} урона)</button>`;
      }
    }
    openModal(`<div class="zoom-modal">${cardHTML({ cid }, { size: 'lg' })}</div>${actions ? `<div class="m-actions center">${actions}</div>` : ''}`, { kind: 'card', cls: 'card-modal' });
  }

  function showDiscard(pid) {
    const g = S.room.game;
    const p = g.players.find((x) => x.id === pid);
    const cards = [...p.discard].reverse();
    openModal(`<h3>Сброс: ${esc(p.name)} (${cards.length})</h3><div class="pick-grid">${cards.map((c) => cardHTML(c, { size: 'sm' })).join('') || '<div class="empty">Пусто</div>'}</div>`, { kind: 'discard', cls: 'wide' });
  }

  function attackModal(target) {
    const g = S.room.game;
    const p = g.players.find((x) => x.id === target);
    const max = g.pool.combat;
    openModal(`<h3>Атаковать ${esc(p.name)}</h3><p class="hint">Влияние соперника: ${p.authority}. Доступно урона: ${max}.</p>
      <div class="stepper"><button class="btn" id="a-minus">−</button><input id="a-val" type="number" min="1" max="${max}" value="${max}"><button class="btn" id="a-plus">+</button></div>
      <div class="m-actions"><button class="btn" data-act="close-modal">Отмена</button><button class="btn danger big" id="a-go">⚔ Нанести урон</button></div>`, { kind: 'attack' });
    const inp = $('#a-val');
    const clamp = () => { inp.value = Math.max(1, Math.min(max, Math.floor(+inp.value || 1))); };
    $('#a-minus').onclick = () => { inp.value = +inp.value - 1; clamp(); };
    $('#a-plus').onclick = () => { inp.value = +inp.value + 1; clamp(); };
    $('#a-go').onclick = () => { clamp(); act({ type: 'attackPlayer', target, amount: +inp.value }); closeModal(); };
  }

  function endTurnCheck() {
    const g = S.room.game;
    const me = g.players.find((p) => p.id === S.pid);
    const warn = [];
    if (me.hand.length) warn.push(`в руке ${cardsWord(me.hand.length)}`);
    const unused = me.bases.filter((b) => CARDS[b.cid].primary.length && !(b.used && b.used.primary));
    if (unused.length) warn.push(`не использованы базы: ${unused.map((b) => '«' + CARDS[b.cid].name + '»').join(', ')}`);
    const targets = g.players.filter((p) => p.alive && p.id !== S.pid);
    if (g.pool.combat > 0 && targets.length) warn.push(`не потрачен урон (${g.pool.combat})`);
    const cheapest = Math.min(...g.row.filter(Boolean).map((c) => CARDS[c.cid].cost), g.explorers ? 2 : 99);
    if (g.pool.trade >= cheapest) warn.push(`осталось ${g.pool.trade} торговли — можно что-то купить`);
    if (!warn.length) return act({ type: 'endTurn' });
    confirmBox(`Завершить ход?<small class="warn-list">${warn.map((w) => '• ' + esc(w)).join('<br>')}</small>`, 'Завершить ход', () => act({ type: 'endTurn' }));
  }

  function showMenu() {
    const g = S.room.game;
    const me = g.players.find((p) => p.id === S.pid);
    openModal(`<h3>Меню</h3><div class="menu-list">
      <button class="btn" data-act="toggle-sound">${S.sound ? '🔔 Звук хода: вкл' : '🔕 Звук хода: выкл'}</button>
      <button class="btn" data-act="copy-link">Скопировать ссылку на стол</button>
      ${me && me.alive && !g.over ? '<button class="btn danger" data-act="forfeit">Сдаться</button>' : ''}
      ${!me || !me.alive || g.over ? '<button class="btn" data-act="leave">Выйти из-за стола</button>' : ''}
    </div>`, { kind: 'menu' });
  }

  function showRules() {
    openModal(`<div class="rules">
      <h2>Как играть</h2>
      <p><b>Цель:</b> довести влияние всех соперников до нуля. Последний оставшийся побеждает.</p>
      <h4>Начало</h4>
      <p>У каждого колода из 10 карт: 8 «Курьеров» (${IC.trade(1)}) и 2 «Перехватчика» (${IC.combat(1)}). Первый игрок берёт 3 карты, второй — 5 (в игре на 3+ игроков: 3, 4, затем по 5). Стартовое влияние задаёт хост.</p>
      <h4>Ход</h4>
      <ol>
        <li><b>Играйте карты из руки</b> — щелчок по карте. Корабли дают ${IC.trade('n')} торговлю, ${IC.combat('n')} урон, ${IC.auth('n')} влияние и другие эффекты.</li>
        <li><b>Покупайте</b> карты из торгового ряда за торговлю. Купленное идёт в ваш сброс. Старатель (2) есть всегда.</li>
        <li><b>Атакуйте</b>: урон тратится на влияние соперников или на их базы. Можно разделить урон между несколькими соперниками.</li>
        <li><b>Завершите ход</b>: сыгранные корабли и оставшиеся карты руки уходят в сброс, вы берёте 5 новых. Неистраченные торговля и урон сгорают.</li>
      </ol>
      <p>Когда колода кончается, сброс перемешивается в новую колоду.</p>
      <h4>Блоки на карте</h4>
      <div class="legend">
        <div><span class="lg-box ab-p">Основная</span> срабатывает, когда карта сыграна.</div>
        <div><span class="lg-box ab-a">${emblem('blob')} Союзная</span> срабатывает, если в этот ход у вас в игре есть другая карта той же фракции (сыгранный корабль или база).</div>
        <div><span class="lg-box ab-s">${TRASH} Утилизация</span> по кнопке «Утилизировать»: карта навсегда убирается из игры, вы получаете эффект.</div>
      </div>
      <h4>Базы и аванпосты</h4>
      <p>Базы остаются на столе и действуют каждый ваш ход. Простые эффекты базы срабатывают сами в начале хода; если нужно выбирать — жмите «Использовать». Чтобы уничтожить базу, нужно потратить урон, равный её защите (число в щите). <b>Аванпост</b> (тёмный щит) защищает владельца: пока он стоит, нельзя атаковать ни самого игрока, ни его обычные базы.</p>
      <h4>Фракции</h4>
      <div class="fac-list">
        <div>${emblem('blob')} <b>Рой</b> — много урона, чистка торгового ряда.</div>
        <div>${emblem('trade')} <b>Торговая Лига</b> — торговля и восстановление влияния.</div>
        <div>${emblem('empire')} <b>Корона</b> — добор карт и сброс карт у соперников.</div>
        <div>${emblem('machine')} <b>Машинный Орден</b> — утилизация слабых карт, сильные аванпосты.</div>
      </div>
      <p class="hint">Наведите курсор на карту (или удерживайте палец на телефоне), чтобы рассмотреть её крупно.</p>
    </div>`, { kind: 'rules', cls: 'wide' });
  }

  function copyLink() {
    const url = location.origin + location.pathname + '?room=' + S.room.code;
    const done = () => toast('Ссылка скопирована — отправьте друзьям');
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Ссылка на стол:', url));
    else prompt('Ссылка на стол:', url);
  }

  // ───────────────── события ─────────────────
  let suppressClick = false;
  document.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
    const el = e.target.closest('[data-act]');
    // на сенсорных экранах нажатие на карту рынка/соперника открывает её крупно с кнопками
    const card = e.target.closest('.card[data-zone]');
    if (isTouch && card && ['row', 'oppbase', 'mybase', 'play'].includes(card.dataset.zone) && (!el || el === card) && !S.modal) {
      cardModal(card);
      return;
    }
    if (!el) return;
    const a = el.dataset.act, d = el.dataset;
    switch (a) {
      case 'create': if (!needName()) send({ t: 'create', name: S.name }); break;
      case 'join': doJoin($('#h-code').value); break;
      case 'join-code': doJoin(d.code); break;
      case 'leave': closeModal(); send({ t: 'leave' }); break;
      case 'set': {
        let v = d.v; if (v === 'true') v = true; else if (v === 'false') v = false; else v = +v;
        send({ t: 'settings', settings: { ...S.room.settings, [d.k]: v } });
        break;
      }
      case 'start': send({ t: 'start' }); break;
      case 'kick': confirmBox('Убрать этого игрока?', 'Убрать', () => send({ t: 'kick', pid: d.pid }), true); break;
      case 'copy-link': copyLink(); break;
      case 'rules': showRules(); break;
      case 'menu': showMenu(); break;
      case 'toggle-sound': S.sound = !S.sound; store.set('sd_sound', S.sound ? '1' : '0'); showMenu(); break;
      case 'forfeit': confirmBox('Сдаться и выйти из партии?', 'Сдаться', () => act({ type: 'forfeit' }), true); break;
      case 'tolobby': closeModal(); send({ t: 'toLobby' }); break;
      case 'show-go': renderGameOver(S.room.game, S.room.hostId === S.pid); break;
      case 'close-modal': if (S.modal !== 'prompt') closeModal(); break;
      case 'close-modal-bg': if (e.target === el) closeModal(); break;
      case 'play': act({ type: 'play', uid: d.uid }); break;
      case 'playall': act({ type: 'playAll' }); break;
      case 'buy': if (S.modal === 'card') closeModal(); act({ type: 'buy', slot: d.slot === 'explorer' ? 'explorer' : +d.slot }); break;
      case 'scrap': e.stopPropagation(); act({ type: 'scrap', uid: d.uid }); break;
      case 'activate': e.stopPropagation(); act({ type: 'activate', uid: d.uid }); break;
      case 'atkbase': if (S.modal === 'card') closeModal(); act({ type: 'attackBase', target: d.target, uid: d.uid }); break;
      case 'atkplayer': attackModal(d.target); break;
      case 'endturn': endTurnCheck(); break;
      case 'view-discard': showDiscard(d.pid); break;
      case 'choose': answered(); act({ type: 'answer', option: +d.i }); break;
      case 'opp': answered(); act({ type: 'answer', target: d.target }); break;
      case 'pick': {
        const pr = S.room.game.prompt;
        const i = S.sel.indexOf(d.uid);
        if (i >= 0) S.sel.splice(i, 1);
        else { if (pr.max === 1) S.sel = []; if (S.sel.length < pr.max) S.sel.push(d.uid); }
        renderPrompt(S.room.game);
        break;
      }
      case 'pick-ok': { const uids = S.sel.slice(); answered(); act({ type: 'answer', uids }); break; }
      case 'pick-skip': answered(); act({ type: 'answer', uids: [] }); break;
      case 'toggle-side': S.sideOpen = !S.sideOpen; $('#side') && $('#side').classList.toggle('open', S.sideOpen); markChatSeen(); break;
      case 'tab':
        S.side = d.tab;
        document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.side));
        $('#side-log').classList.toggle('hidden', S.side !== 'log');
        $('#side-chat').classList.toggle('hidden', S.side !== 'chat');
        markChatSeen();
        break;
    }
  });

  // ответ отправлен — закрываем окно сразу, чтобы двойной щелчок не ушёл в следующий выбор
  function answered() { S.sel = []; S.selKey = null; closeModal(); }

  function markChatSeen() {
    if (S.side === 'chat' && S.room) {
      S.chatSeenUser = S.room.chat.filter((c) => !c.sys).length;
      S.unread = 0;
      const ur = $('#unread'); if (ur) ur.classList.add('hidden');
    }
  }

  // крупный просмотр карты при наведении (компьютер) и долгом нажатии (телефон)
  const zoom = $('#zoom');
  let zoomTimer = null;
  if (!isTouch) {
    document.addEventListener('mouseover', (e) => {
      const card = e.target.closest('.card[data-cid]');
      if (!card || card.closest('.zoom') || card.classList.contains('lg') || card.closest('.hero-cards')) return;
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(() => {
        zoom.innerHTML = cardHTML({ cid: card.dataset.cid, copied: null }, { size: 'lg' });
        const r = card.getBoundingClientRect();
        const W = 300, H = 420;
        let x = r.right + 12;
        if (x + W > innerWidth - 8) x = r.left - W - 12;
        if (x < 8) x = Math.max(8, innerWidth - W - 8);
        let y = Math.min(innerHeight - H - 8, Math.max(8, r.top + r.height / 2 - H / 2));
        zoom.style.left = x + 'px'; zoom.style.top = y + 'px';
        zoom.classList.remove('hidden');
      }, 280);
    });
    document.addEventListener('mouseout', (e) => {
      const card = e.target.closest('.card[data-cid]');
      if (!card) return;
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      clearTimeout(zoomTimer);
      zoom.classList.add('hidden');
    });
    document.addEventListener('mousedown', () => { clearTimeout(zoomTimer); zoom.classList.add('hidden'); });
  } else {
    let lp = null;
    document.addEventListener('touchstart', (e) => {
      const card = e.target.closest('.card[data-cid]');
      if (!card || card.classList.contains('lg')) return;
      lp = setTimeout(() => {
        suppressClick = true;
        openModal(`<div class="zoom-modal">${cardHTML({ cid: card.dataset.cid }, { size: 'lg' })}</div>`, { kind: S.modal === 'prompt' ? 'prompt-zoom' : 'card', cls: 'card-modal' });
        if (S.modal === 'prompt-zoom') setTimeout(() => { closeModal(); render(); }, 1800);
      }, 480);
    }, { passive: true });
    const cancel = () => clearTimeout(lp);
    document.addEventListener('touchend', cancel);
    document.addEventListener('touchmove', cancel, { passive: true });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.modal && S.modal !== 'prompt') closeModal();
  });

  connect();
})();
