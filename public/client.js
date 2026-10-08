(function () {
  'use strict';
  const { CARDS, FACTIONS } = window;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
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
    side: 'log', sideOpen: false, unread: 0, chatSeenUser: undefined,
    pendingJoin: (new URLSearchParams(location.search).get('room') || '').toUpperCase(),
    prevAuth: {}, wasMyTurn: false, modal: null, sound: store.get('sd_sound') !== '0',
    goShown: false, tutorialShown: false,
  };
  const isTouch = matchMedia('(hover: none)').matches;
  const mqMobile = matchMedia('(max-width: 760px)');
  const isMobile = () => mqMobile.matches;
  const mqWide = matchMedia('(min-width: 1101px)');
  for (const mq of [mqMobile, mqWide]) mq.addEventListener && mq.addEventListener('change', () => { S.screen = null; render(); });
  const PCOLORS = ['#d9a54a', '#5fa8d3', '#a78bd4', '#6cc28f', '#d4708f', '#c9c25a'];

  // ───────────────── сеть ─────────────────
  function connect() {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    S.ws = ws;
    ws.onopen = () => { S.connected = true; $('#conn').classList.add('hidden'); send({ t: 'hello', token, name: S.name }); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMsg(m); };
    ws.onclose = () => { S.connected = false; $('#conn').classList.remove('hidden'); setTimeout(connect, 1500); };
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

  // ───────────────── значки и тексты ─────────────────
  const EMB = {
    blob: '<path d="M10 1.5c4.6 0 8 3.3 8 7.6 0 3-1.7 5.2-3.6 6.4l1.4 3.2-3.6-2c-.7.2-1.4.3-2.2.3-4.6 0-8-3.3-8-7.9S5.4 1.5 10 1.5z"/><circle cx="12.6" cy="8" r="2.2" fill="#0b0e14"/>',
    trade: '<path d="M10 1l8 4.6v8.8L10 19l-8-4.6V5.6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 5l4 5-4 5-4-5z"/>',
    empire: '<path d="M10 1.2l2.5 5.6 6.1.6-4.6 4.1 1.3 6-5.3-3.1-5.3 3.1 1.3-6L1.4 7.4l6.1-.6z"/>',
    machine: '<path d="M8.6 1h2.8l.5 2.4 1.6.7 2.1-1.3 2 2-1.3 2.1.7 1.6 2.4.5v2.8l-2.4.5-.7 1.6 1.3 2.1-2 2-2.1-1.3-1.6.7-.5 2.4H8.6l-.5-2.4-1.6-.7-2.1 1.3-2-2 1.3-2.1-.7-1.6L1 11.4V8.6l2.4-.5.7-1.6-1.3-2.1 2-2 2.1 1.3 1.6-.7z"/><circle cx="10" cy="10" r="3.2" fill="#0b0e14"/>',
    none: '<circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="10" r="2.5"/>',
  };
  const emblem = (f) => `<svg class="emb" viewBox="0 0 20 20" style="color:${FACTIONS[f].color};fill:${FACTIONS[f].color}">${EMB[f]}</svg>`;
  const TRASH = '<svg class="emb" viewBox="0 0 20 20" fill="currentColor"><path d="M7 2h6l1 2h4v2H2V4h4zM4 7h12l-1 11H5z"/></svg>';
  const I = { trade: '<i class="i i-trade"></i>', combat: '<i class="i i-combat"></i>', auth: '<i class="i i-auth"></i>', draw: '<i class="i i-draw"></i>' };

  // короткая надпись на карте
  function effShort(e) {
    const k = Object.keys(e)[0], v = e[k];
    switch (k) {
      case 'trade': return `<span class="ef">${I.trade}+${v} к деньгам</span>`;
      case 'combat': return `<span class="ef">${I.combat}+${v} урона</span>`;
      case 'auth': return `<span class="ef">${I.auth}+${v} к здоровью</span>`;
      case 'draw': return `<span class="ef">${I.draw}${v > 1 ? `Взять ${v} карты` : 'Взять карту'}</span>`;
      case 'choose': return `<span class="ef choose">${v.map((o) => o.map(effPlain).join(', ')).join(' <b>или</b> ')}</span>`;
      default: return `<span class="ef tx">${effPlain(e)}</span>`;
    }
  }
  function effPlain(e) {
    const k = Object.keys(e)[0], v = e[k];
    return {
      trade: `+${v} к деньгам`, combat: `+${v} урона`, auth: `+${v} к здоровью`,
      draw: v > 1 ? `взять ${v} карты` : 'взять карту',
      opDiscard: 'Соперник сбрасывает карту',
      scrapRow: 'Можно убрать карту из ряда',
      scrapHD: 'Можно утилизировать карту из руки/сброса',
      destroyBase: 'Можно уничтожить базу',
      topNext: 'След. корабль — на верх колоды',
      freeShip: 'Бесплатный корабль из ряда',
      yacht: 'Если 2+ базы — взять 2 карты',
      blobDraw: 'Карта за каждую карту Роя',
      recycle: 'Сбросить до 2 карт и взять столько же',
      machineBase: 'Взять карту, затем утилизировать карту из руки',
      brain: 'Утилизировать до 2 карт, взять столько же',
      copy: 'Повторяет другой ваш корабль',
      choose: '',
    }[k] || (k === 'choose' ? v.map((o) => o.map(effPlain).join(', ')).join(' или ') : '');
  }
  // подробное объяснение
  function effLong(e) {
    const k = Object.keys(e)[0], v = e[k];
    return {
      trade: `+${v} к деньгам. Деньгами оплачиваются покупки в торговом ряду.`,
      combat: `+${v} урона. Уроном атакуют соперников и их базы.`,
      auth: `+${v} к здоровью.`,
      draw: v > 1 ? `Возьмите ${cardsWord(v)} из своей колоды.` : 'Возьмите карту из своей колоды.',
      opDiscard: 'Выбранный соперник сбросит одну карту из руки в начале своего хода.',
      scrapRow: 'Можно убрать из игры любую карту торгового ряда — на её место выложится новая.',
      scrapHD: 'Можно навсегда убрать из игры одну карту из руки или сброса. Так колода избавляется от слабых карт.',
      destroyBase: 'Можно уничтожить любую базу соперника, даже аванпост, не тратя урон.',
      choose: '',
      topNext: 'Следующий корабль, купленный в этот ход, ляжет на верх колоды — вы возьмёте его уже в следующем ходу.',
      freeShip: 'Возьмите любой корабль из торгового ряда бесплатно. Он ляжет на верх колоды.',
      yacht: 'Если у вас в игре две базы или больше, возьмите 2 карты.',
      blobDraw: 'Возьмите по карте за каждую карту Роя, сыгранную в этот ход.',
      recycle: 'Сбросьте до двух карт из руки и возьмите столько же новых.',
      machineBase: 'Возьмите карту, затем обязательно утилизируйте одну карту из руки.',
      brain: 'Утилизируйте до двух карт из руки или сброса и возьмите столько же новых.',
      copy: 'Выберите другой ваш корабль, сыгранный в этот ход: эта карта повторит его действие и станет той же фракции.',
    }[k] || (k === 'choose' ? 'Выберите одно: ' + v.map((o) => o.map(effPlain).join(', ')).join(' или ') + '.' : '');
  }
  const abil = (list) => list.map(effShort).join('');

  function typeName(d) { return d.type === 'base' ? (d.outpost ? 'Аванпост' : 'База') : 'Корабль'; }
  function typeExplain(d) {
    if (d.id === 'scout' || d.id === 'viper') return 'Стартовая карта. Корабль: действует в тот ход, когда его сыграли, затем уходит в сброс.';
    if (d.id === 'explorer') return 'Старатель всегда доступен для покупки, цена — 2. Корабль: действует в тот ход, когда его сыграли.';
    if (d.type !== 'base') return 'Корабль. Действует в тот ход, когда вы его сыграли, затем уходит в сброс и вернётся с новой колодой.';
    if (d.outpost) return `Аванпост. Остаётся на столе и действует каждый ваш ход. Пока он стоит, соперники не могут атаковать вас и ваши другие базы — сначала им придётся потратить ${d.defense} урона на него.`;
    return `База. Остаётся на столе и действует каждый ваш ход. Соперник может уничтожить её, потратив ${d.defense} урона.`;
  }

  // сводка для мини-карты
  function summary(d) {
    const parts = [];
    const one = (e) => { const k = Object.keys(e)[0], v = e[k]; return I[k] ? `<span>${I[k]}${v}</span>` : ''; };
    for (const e of d.primary) {
      const k = Object.keys(e)[0];
      if (k === 'choose') parts.push(`<span>${e.choose.map((o) => o.map(one).join('')).join('/')}</span>`);
      else if (I[k] && k !== 'draw') parts.push(one(e));
      else if (k === 'draw') parts.push(`<span>${I.draw}${e.draw}</span>`);
    }
    if (!parts.length) parts.push('<span class="star">★</span>');
    return parts.join('');
  }

  // ───────────────── карты ─────────────────
  function cardHTML(c, o = {}) {
    const cid = c.copied || c.cid;
    const d = CARDS[cid];
    const F = FACTIONS[d.faction];
    const used = c.used || {};
    const size = o.size || 'md';
    const base = d.type === 'base';
    const style = `--fc:${F.color};--fd:${F.dark};--fl:${F.light}`;
    const attrs = `data-cid="${cid}" ${c.uid ? `data-uid="${c.uid}"` : ''} ${o.attrs || ''}`;
    const art = `<img class="c-art" src="${window.cardArtURL(cid)}" alt="" draggable="false">`;
    const cls = `card ${size} f-${d.faction} ${base ? 'is-base' : ''} ${d.outpost ? 'is-outpost' : ''} ${o.cls || ''}`;
    const defBadge = base ? `<span class="c-def ${d.outpost ? 'out' : ''}" title="${d.outpost ? 'Аванпост — защищает владельца' : 'Защита базы'}">${d.defense}</span>` : '';
    if (size === 'mini') {
      return `<div class="${cls}" ${attrs} style="${style}">${art}
        ${d.cost ? `<span class="c-cost">${d.cost}</span>` : ''}${defBadge}
        <div class="m-foot"><div class="m-sum">${summary(d)}</div><div class="m-name">${esc(d.name)}</div></div>
        ${c.copied ? '<span class="c-copy">копия</span>' : ''}${o.badge || ''}
        ${o.actions ? `<div class="c-actions">${o.actions}</div>` : ''}</div>`;
    }
    let prim = abil(d.primary);
    if (d.fleetHQ) prim += `<span class="ef tx">Все ваши корабли получают +1 урона</span>`;
    if (d.allAlly) prim += `<span class="ef tx">Считается союзником для карт любой фракции</span>`;
    return `<div class="${cls}" ${attrs} style="${style}">
      <div class="c-head"><span class="c-name">${esc(d.name)}</span>${d.cost ? `<span class="c-cost">${d.cost}</span>` : ''}</div>
      <div class="c-artwrap">${art}${c.copied ? '<span class="c-copy">копия · Мимикр</span>' : ''}</div>
      <div class="c-type">${emblem(d.faction)}<span class="tn">${typeName(d)}${d.faction !== 'none' ? ` · ${F.name}` : ''}</span>${defBadge}</div>
      <div class="c-text">
        ${prim ? `<div class="ab ab-p ${o.manual && base && d.primary.length && !used.primary ? 'ready' : ''}">${prim}</div>` : ''}
        ${d.ally.length ? `<div class="ab ab-a ${used.ally ? 'done' : ''}"><span class="lbl">${emblem(d.faction)}Союз</span>${abil(d.ally)}</div>` : ''}
        ${d.scrap.length ? `<div class="ab ab-s"><span class="lbl">${TRASH}Утиль</span>${abil(d.scrap)}</div>` : ''}
      </div>
      ${o.badge || ''}
      ${o.actions ? `<div class="c-actions">${o.actions}</div>` : ''}
    </div>`;
  }

  function detailHTML(c, actions) {
    const cid = c.copied || c.cid;
    const d = CARDS[cid], F = FACTIONS[d.faction];
    const list = (arr) => `<ul>${arr.map((e) => `<li>${effLong(e)}</li>`).join('')}</ul>`;
    let info = `<div class="d-title">${esc(d.name)}</div>
      <div class="d-sub">${emblem(d.faction)} ${typeName(d)}${d.faction !== 'none' ? ' · ' + F.name : ''}${d.cost ? ` · цена ${d.cost}` : ''}${d.type === 'base' ? ` · защита ${d.defense}` : ''}</div>
      <p class="d-type">${typeExplain(d)}</p>`;
    if (d.primary.length) info += `<h5>${d.type === 'base' ? 'Каждый ваш ход' : 'Когда разыграна'}</h5>${list(d.primary)}`;
    if (d.fleetHQ) info += `<h5>Постоянно</h5><ul><li>Каждый корабль, который вы играете, даёт дополнительно +1 урона.</li></ul>`;
    if (d.allAlly) info += `<h5>Постоянно</h5><ul><li>Пока эта база в игре, у всех ваших карт срабатывают союзные способности.</li></ul>`;
    if (d.ally.length) info += `<h5>${emblem(d.faction)} Союзная способность</h5><p class="muted">Срабатывает, если в этот ход у вас в игре есть ещё одна карта фракции «${F.name}» (корабль или база).</p>${list(d.ally)}`;
    if (d.scrap.length) info += `<h5>${TRASH} Утилизация</h5><p class="muted">Кнопкой «Утилизировать»: карта навсегда уходит из игры, а вы получаете эффект.</p>${list(d.scrap)}`;
    return `<div class="detail"><div class="d-card">${cardHTML({ cid, copied: null }, { size: 'lg' })}</div><div class="d-info">${info}${actions ? `<div class="d-actions">${actions}</div>` : ''}</div></div>`;
  }

  // ───────────────── окна и уведомления ─────────────────
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
    $('#modal-root').innerHTML = `<div class="overlay ${opts.locked ? 'locked' : ''} ${opts.sheet ? 'sheet' : ''}" ${opts.locked ? '' : 'data-act="close-modal-bg"'}><div class="modal ${opts.cls || ''}">${opts.locked ? '' : '<button class="x" data-act="close-modal" aria-label="Закрыть">×</button>'}${html}</div></div>`;
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
      o.type = 'sine'; o.frequency.setValueAtTime(620, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
      g.gain.setValueAtTime(0.08, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.31);
    } catch {}
  }

  // ───────────────── правила ─────────────────
  function rulesShortHTML() {
    return `<ol class="short-rules">
      <li><b>Цель</b> — довести здоровье всех соперников до нуля.</li>
      <li><b>Сыграйте карты из руки.</b> Они дают ${I.trade} деньги, ${I.combat} урон и ${I.auth} здоровье.</li>
      <li><b>Купите карты</b> из торгового ряда за деньги. Покупки уходят в ваш сброс и попадут в руку позже.</li>
      <li><b>Атакуйте</b> уроном соперника или его базы. Пока у соперника есть <b>аванпост</b>, сначала бейте его.</li>
      <li><b>Завершите ход</b> — вы возьмёте 5 новых карт. Непотраченные деньги и урон сгорают.</li>
      <li><b>Союз</b> — бонус, если в ход сыграно 2+ карты одной фракции. <b>Утиль</b> — убрать карту из игры ради эффекта.</li>
    </ol>`;
  }
  function showRules() {
    openModal(`<div class="rules"><h2>Правила</h2>${rulesShortHTML()}
      <h4>Подробнее</h4>
      <p>У каждого колода из 10 карт: 8 «Курьеров» (+1 к деньгам) и 2 «Перехватчика» (+1 урона). Первый игрок начинает с 3 картами, второй — с 5 (в игре на троих и больше: 3, 4, затем по 5). Когда колода кончается, сброс перемешивается в новую колоду.</p>
      <p><b>Корабли</b> действуют один ход и уходят в сброс. <b>Базы</b> остаются на столе и действуют каждый ваш ход; простые эффекты баз срабатывают сами, а если нужно выбирать — нажмите «Использовать». Чтобы уничтожить базу, потратьте урон, равный её защите (число в щите). Тёмный щит — <b>аванпост</b>: он защищает владельца и его остальные базы.</p>
      <h4>Фракции</h4>
      <div class="fac-list">
        <div>${emblem('blob')} <b>Рой</b> — много урона, чистит торговый ряд.</div>
        <div>${emblem('trade')} <b>Торговая Лига</b> — деньги и восстановление здоровья.</div>
        <div>${emblem('empire')} <b>Корона</b> — добор карт и сброс карт у соперников.</div>
        <div>${emblem('machine')} <b>Машинный Орден</b> — утилизация слабых карт, прочные аванпосты.</div>
      </div>
      <p class="muted">${isTouch ? 'Нажмите на любую карту, чтобы прочитать, что она делает.' : 'Наведите курсор на карту, чтобы прочитать, что она делает.'}</p></div>`, { kind: 'rules', cls: 'wide' });
  }
  function showTutorial() {
    openModal(`<div class="rules"><h2>Как сделать ход</h2>${rulesShortHTML()}
      <p class="muted">Внизу экрана всегда есть подсказка, что делать дальше. ${isTouch ? 'Нажмите карту в руке — она сыграется. Нажмите любую другую карту — откроется её описание.' : 'Щелчок по карте в руке — сыграть её, по карте в ряду — купить. Наведите курсор на карту, чтобы прочитать описание.'}</p>
      <div class="m-actions"><button class="btn primary" data-act="tutorial-ok">Понятно, играем</button></div></div>`, { kind: 'tutorial', cls: 'wide' });
  }

  // ───────────────── экраны ─────────────────
  function render() {
    if (!S.pid) return;
    if (!S.room) return renderHome();
    if (!S.room.game) return renderLobby();
    return renderGame();
  }

  function renderHome() {
    const app = $('#app');
    if (S.screen !== 'home') {
      S.screen = 'home';
      const sample = ['t_flagship', 'e_dread', 'b_mother'];
      app.innerHTML = `<div class="home">
        <div class="hero">
          <div class="logo">Звёздные Державы</div>
          <p class="tag">Колодостроительная космическая стратегия для 2–6 игроков. Играйте с друзьями прямо в браузере — достаточно отправить ссылку.</p>
          <div class="hero-cards">${sample.map((cid) => cardHTML({ cid }, { size: 'md' })).join('')}</div>
        </div>
        <div class="panel home-panel">
          <label class="fld">Ваше имя<input id="h-name" maxlength="20" autocomplete="nickname" placeholder="Например, Адмирал" value="${esc(S.name)}"></label>
          <button class="btn primary big" data-act="create">Создать стол</button>
          <div class="join-row"><input id="h-code" maxlength="4" placeholder="Код стола" autocapitalize="characters" value="${esc(S.pendingJoin)}"><button class="btn" data-act="join">Войти</button></div>
          <div class="sec-title">Открытые столы</div>
          <div id="h-rooms" class="room-list"></div>
          <button class="btn ghost" data-act="rules">Правила игры</button>
        </div>
      </div>`;
      $('#h-name').addEventListener('input', (e) => { S.name = e.target.value.trim(); store.set('sd_name', S.name); });
      $('#h-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(e.target.value); });
    }
    $('#h-rooms').innerHTML = S.rooms.length
      ? S.rooms.map((r) => `<button class="room-item" data-act="join-code" data-code="${r.code}"><b>${esc(r.host)}</b><span>${r.count}/${r.max} игроков · здоровье ${r.authority}</span><i>${r.code}</i></button>`).join('')
      : '<div class="empty">Открытых столов нет. Создайте свой и отправьте друзьям ссылку.</div>';
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

  function renderLobby() {
    const r = S.room;
    const host = r.hostId === S.pid;
    const app = $('#app');
    if (S.screen !== 'lobby') {
      S.screen = 'lobby';
      app.innerHTML = `<div class="lobby"><div class="lobby-grid">
        <div class="panel">
          <div class="l-head"><div><div class="sec-title">Стол</div><div class="l-code" id="l-code"></div></div>
            <button class="btn" data-act="copy-link">Скопировать приглашение</button></div>
          <div class="sec-title" id="l-ptitle">Игроки</div><div id="l-players" class="l-players"></div>
          <div class="sec-title">Настройки партии</div><div id="l-settings"></div>
          <div class="l-actions"><button class="btn ghost" data-act="leave">Выйти</button><span id="l-start"></span></div>
        </div>
        <div class="panel">
          <div class="sec-title">Коротко о правилах</div>${rulesShortHTML()}
          <button class="btn ghost sm" data-act="rules">Подробные правила</button>
          <div class="sec-title">Чат стола</div>
          <div id="l-chatlog" class="chatlog"></div><form id="l-chatform" class="chatform"><input maxlength="200" placeholder="Сообщение…"><button class="btn">Отправить</button></form>
        </div>
      </div></div>`;
      $('#l-chatform').addEventListener('submit', (e) => { e.preventDefault(); const i = e.target.querySelector('input'); if (i.value.trim()) send({ t: 'chat', text: i.value }); i.value = ''; });
    }
    $('#l-code').textContent = r.code;
    $('#l-ptitle').textContent = `Игроки — ${r.members.length} из ${r.settings.maxPlayers}`;
    $('#l-players').innerHTML = r.members.map((m, i) => `<div class="l-player">
        <span class="avatar" style="--pc:${PCOLORS[i % 6]}">${esc((m.name || '?')[0].toUpperCase())}</span>
        <span class="nm">${esc(m.name)}${m.id === S.pid ? ' <small>(вы)</small>' : ''}</span>
        ${m.id === r.hostId ? '<span class="tag-s">хост</span>' : ''}
        ${!m.connected ? '<span class="tag-s muted">не в сети</span>' : ''}
        ${host && m.id !== S.pid ? `<button class="lnk" data-act="kick" data-pid="${m.id}">убрать</button>` : ''}
      </div>`).join('') + (r.members.length < r.settings.maxPlayers ? '<div class="l-player empty-seat">Свободное место</div>' : '');

    const st = r.settings;
    const chips = (k, vals, cur, fmt = (v) => v) => vals.map((v) => `<button class="seg ${cur === v ? 'on' : ''}" ${host ? `data-act="set" data-k="${k}" data-v="${v}"` : 'disabled'}>${fmt(v)}</button>`).join('');
    const sEl = $('#l-settings');
    const typing = document.activeElement && document.activeElement.id === 'l-auth';
    if (typing) {
      $$('.seg[data-k]', sEl).forEach((b) => b.classList.toggle('on', String(st[b.dataset.k]) === b.dataset.v));
    } else {
      sEl.innerHTML = `
        <div class="set"><div class="set-l">Стартовое здоровье</div>
          <div class="segs">${chips('authority', [20, 30, 40, 50, 75, 100], st.authority)}</div>
          ${host ? `<label class="custom">Своё значение <input id="l-auth" type="number" min="1" max="999" value="${st.authority}"></label>` : ''}
        </div>
        <div class="set"><div class="set-l">Мест за столом</div><div class="segs">${chips('maxPlayers', [2, 3, 4, 5, 6], st.maxPlayers)}</div></div>
        <div class="set"><div class="set-l">Первый ход</div><div class="segs">${chips('randomOrder', [true, false], st.randomOrder, (v) => (v ? 'Случайно' : 'По порядку входа'))}</div></div>
        ${host ? '' : '<p class="muted">Настройки выбирает хост.</p>'}`;
      const ai = $('#l-auth');
      if (ai) ai.addEventListener('change', () => send({ t: 'settings', settings: { ...S.room.settings, authority: ai.value } }));
    }
    $('#l-start').innerHTML = host
      ? `<button class="btn primary big" data-act="start" ${r.members.length < 2 ? 'disabled' : ''}>${r.members.length < 2 ? 'Ждём игроков…' : 'Начать игру'}</button>`
      : '<span class="muted">Ждём, когда хост начнёт игру…</span>';
    renderChat($('#l-chatlog'));
  }

  function renderChat(el) {
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.innerHTML = S.room.chat.map((c) => (c.sys ? `<div class="msg sys">${esc(c.text)}</div>` : `<div class="msg"><b>${esc(c.name)}:</b> ${esc(c.text)}</div>`)).join('') || '<div class="msg sys">Сообщений пока нет</div>';
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  // ───────────────── игра ─────────────────
  function ctx() {
    const r = S.room, g = r.game;
    const me = g.players.find((p) => p.id === S.pid);
    const cur = g.players.find((p) => p.id === g.turn);
    const myTurn = !!me && g.turn === S.pid && !g.over;
    const blocked = !!g.prompt;
    const colorOf = (pid) => PCOLORS[g.players.findIndex((p) => p.id === pid) % 6];
    const hasOutpost = (p) => p.bases.some((b) => CARDS[b.cid].outpost);
    return { r, g, me, cur, myTurn, blocked, colorOf, hasOutpost, host: r.hostId === S.pid };
  }

  function canAttackBase(C, owner, b) {
    const d = CARDS[b.cid];
    if (!C.myTurn || C.blocked || !owner.alive || owner.id === S.pid) return false;
    if (!d.outpost && C.hasOutpost(owner)) return false;
    return C.g.pool.combat >= d.defense;
  }

  // подсказка «что делать сейчас»
  function coach(C) {
    const { g, me, cur, myTurn } = C;
    if (g.over) return { text: 'Партия окончена.', cue: '' };
    if (!me || !me.alive) return { text: 'Вы наблюдаете за партией.', cue: '' };
    if (!myTurn) return { text: `Сейчас ходит ${esc(cur.name)}. ${isTouch ? 'Нажмите на карту, чтобы прочитать её описание.' : 'Наведите курсор на карту, чтобы прочитать описание.'}`, cue: '' };
    if (g.prompt) return { text: 'Сделайте выбор в открытом окне.', cue: '' };
    if (me.hand.length) return { text: `<b>Шаг 1.</b> Сыграйте карты из руки — ${isTouch ? 'нажмите на карту' : 'щёлкните по карте'} или «Сыграть все».`, cue: 'hand' };
    const manual = me.bases.filter((b) => CARDS[b.cid].primary.length && !(b.used && b.used.primary));
    if (manual.length) return { text: `Используйте базу «${esc(CARDS[manual[0].cid].name)}» — кнопка «Использовать» на карте.`, cue: 'bases' };
    const affordable = g.row.some((c) => c && CARDS[c.cid].cost <= g.pool.trade) || (g.explorers > 0 && g.pool.trade >= 2);
    if (affordable) return { text: `<b>Шаг 2.</b> Денег: ${g.pool.trade} — купите карту из ряда (подсвечены). Купленное попадёт в ваш сброс.`, cue: 'market' };
    if (g.pool.combat > 0) {
      const ops = g.players.filter((p) => p.alive && p.id !== S.pid);
      const blockedByOut = ops.length && ops.every((p) => C.hasOutpost(p));
      if (blockedByOut) {
        const can = ops.some((p) => p.bases.some((b) => canAttackBase(C, p, b)));
        if (can) return { text: `<b>Шаг 3.</b> У вас ${g.pool.combat} урона. Соперников защищают аванпосты — сначала уничтожьте аванпост${isMobile() ? ' (нажмите на соперника вверху)' : ' (он подсвечен красным)'}.`, cue: 'opps' };
      } else return { text: `<b>Шаг 3.</b> У вас ${g.pool.combat} урона — ${isMobile() ? 'нажмите на соперника вверху и «Атаковать»' : 'нажмите «Атаковать» у соперника'}${ops.length > 1 ? ' (урон можно разделить)' : ''}.`, cue: 'opps' };
    }
    return { text: '<b>Шаг 4.</b> Больше делать нечего — нажмите «Завершить ход».', cue: 'end' };
  }

  function renderGame() {
    const C = ctx();
    const { r, g, me, cur, myTurn, blocked, colorOf, host } = C;
    const mobile = isMobile();
    const app = $('#app');
    if (S.screen !== 'game') {
      S.screen = 'game';
      S.prevAuth = {};
      S.chatSeenUser = undefined;
      app.innerHTML = `<div class="game">
        <div id="board" class="board"></div>
        <aside id="side" class="side">
          <div id="side-opps" class="side-opps"></div>
          <div class="tabs"><button data-act="tab" data-tab="log" class="on">Журнал</button><button data-act="tab" data-tab="chat">Чат <span id="unread" class="unread hidden"></span></button><button class="side-close" data-act="toggle-side" aria-label="Закрыть">×</button></div>
          <div id="side-log" class="log"></div>
          <div id="side-chat" class="side-chat hidden"><div id="chatlog" class="chatlog"></div><form id="chatform" class="chatform"><input maxlength="200" placeholder="Сообщение…"><button class="btn">→</button></form></div>
        </aside>
      </div>`;
      $('#chatform').addEventListener('submit', (e) => { e.preventDefault(); const i = e.target.querySelector('input'); if (i.value.trim()) send({ t: 'chat', text: i.value }); i.value = ''; });
    }
    zoom.classList.add('hidden');

    const userMsgs = r.chat.filter((c) => !c.sys).length;
    if (S.chatSeenUser === undefined) S.chatSeenUser = userMsgs;
    if (S.side === 'chat' && (S.sideOpen || matchMedia('(min-width: 1100px)').matches)) S.chatSeenUser = userMsgs;
    S.unread = Math.max(0, userMsgs - S.chatSeenUser);

    if (myTurn && !S.wasMyTurn) { beep(); flashTurn(); }
    S.wasMyTurn = myTurn;
    document.title = myTurn ? '● Ваш ход — Звёздные Державы' : 'Звёздные Державы';

    let opps = g.players.filter((p) => p.id !== S.pid);
    if (me) { const i = g.players.indexOf(me); opps = [...g.players.slice(i + 1), ...g.players.slice(0, i)]; }
    const tip = coach(C);
    const combat = g.pool.combat, trade = g.pool.trade;

    // соперники
    const oppHTML = opps.map((p) => {
      const m = r.members.find((x) => x.id === p.id);
      const hit = S.prevAuth[p.id] !== undefined && p.authority < S.prevAuth[p.id];
      const canAtk = myTurn && !blocked && p.alive && combat > 0 && !C.hasOutpost(p);
      const anyBaseTarget = p.bases.some((b) => canAttackBase(C, p, b));
      const offline = m && !m.connected;
      if (mobile) {
        return `<button class="opp-chip ${p.id === g.turn ? 'turn' : ''} ${p.alive ? '' : 'dead'} ${hit ? 'hit' : ''} ${canAtk || anyBaseTarget ? 'target' : ''}" style="--pc:${colorOf(p.id)}" data-act="opp-sheet" data-pid="${p.id}">
          <span class="avatar">${esc(p.name[0].toUpperCase())}</span>
          <span class="oc-body"><span class="oc-name">${esc(p.name)}${offline ? ' · офлайн' : ''}</span>
          <span class="oc-meta">${p.alive ? `<span class="hp ${p.authority <= 10 ? 'low' : ''}">${I.auth}${Math.max(0, p.authority)}</span><span>баз ${p.bases.length}${C.hasOutpost(p) ? ' 🛡' : ''}</span><span>✋${p.handCount}</span>` : 'выбыл'}</span></span>
          ${canAtk || anyBaseTarget ? '<span class="oc-atk">⚔</span>' : ''}
        </button>`;
      }
      const bases = p.bases.map((b) => {
        const can = canAttackBase(C, p, b);
        return cardHTML(b, { size: 'mini', cls: can ? 'targetable' : '', attrs: `data-zone="oppbase" data-owner="${p.id}" ${can ? `data-act="atkbase" data-target="${p.id}"` : ''}` });
      }).join('');
      return `<div class="opp ${p.id === g.turn ? 'turn' : ''} ${p.alive ? '' : 'dead'} ${hit ? 'hit' : ''}" style="--pc:${colorOf(p.id)}">
        <div class="opp-head"><span class="avatar">${esc(p.name[0].toUpperCase())}</span>
          <div class="opp-nm"><b>${esc(p.name)}</b>${p.id === r.hostId ? ' <span class="tag-s">хост</span>' : ''}${offline ? ' <span class="tag-s muted">офлайн</span>' : ''}</div>
          <div class="hp-badge ${p.authority <= 10 ? 'low' : ''}" title="Здоровье">${Math.max(0, p.authority)}</div></div>
        ${p.alive ? `<div class="opp-meta"><span title="Карт в руке">рука ${p.handCount}</span><span title="Карт в колоде">колода ${p.deckCount}</span>
          <button class="lnk" data-act="view-discard" data-pid="${p.id}">сброс ${p.discard.length}</button>
          ${p.pendingDiscard ? `<span class="tag-s warn">сбросит ${p.pendingDiscard}</span>` : ''}</div>
          <div class="opp-bases">${bases || '<span class="none">нет баз</span>'}</div>
          ${canAtk ? `<button class="btn danger sm" data-act="atkplayer" data-target="${p.id}">Атаковать</button>` : C.hasOutpost(p) && myTurn && combat > 0 ? '<div class="muted small">Защищён аванпостом</div>' : ''}
          ${host && offline && !g.over ? `<button class="lnk danger" data-act="kick" data-pid="${p.id}">исключить</button>` : ''}`
        : `<div class="muted">выбыл${p.place ? ` · ${p.place} место` : ''}</div>`}
      </div>`;
    }).join('');

    // торговый ряд
    const cs = mobile ? 'mini' : 'md';
    const rowHTML = g.row.map((c, i) => {
      if (!c) return `<div class="card ${cs} slot-empty"></div>`;
      const can = myTurn && !blocked && trade >= CARDS[c.cid].cost;
      return cardHTML(c, { size: cs, cls: can ? 'can-buy' : '', attrs: `data-zone="row" data-slot="${i}" ${can && !isTouch ? 'data-act="buy"' : ''}` });
    }).join('');
    const canExp = myTurn && !blocked && trade >= 2 && g.explorers > 0;
    const expHTML = g.explorers > 0
      ? cardHTML({ cid: 'explorer' }, { size: cs, cls: 'pile-card ' + (canExp ? 'can-buy' : ''), attrs: `data-zone="row" data-slot="explorer" ${canExp && !isTouch ? 'data-act="buy"' : ''}`, badge: `<span class="pile-count">×${g.explorers}</span>` })
      : '';

    // сыгранное
    const isMe = cur && cur.id === S.pid;
    const ps = mobile ? 'mini' : 'sm';
    const playHTML = cur.inPlay.map((c) => {
      const d = CARDS[c.copied || c.cid];
      const acts = isMe && myTurn && !blocked && d.scrap.length ? `<button class="mini-btn" data-act="scrap" data-uid="${c.uid}">Утилизировать</button>` : '';
      return cardHTML(c, { size: ps, actions: acts, attrs: 'data-zone="play"' });
    }).join('');

    // моя зона
    let mineHTML = '', basesZone = '';
    if (me) {
      const bases = me.bases.map((b) => {
        const d = CARDS[b.cid]; const used = b.used || {};
        let acts = '';
        if (myTurn && !blocked) {
          if (d.primary.length && !used.primary) acts += `<button class="mini-btn use" data-act="activate" data-uid="${b.uid}">Использовать</button>`;
          if (d.scrap.length) acts += `<button class="mini-btn" data-act="scrap" data-uid="${b.uid}">Утилизировать</button>`;
        }
        return cardHTML(b, { size: ps, actions: acts, manual: true, attrs: 'data-zone="mybase"' });
      }).join('');
      const hand = (me.hand || []).map((c) => cardHTML(c, { size: mobile ? 'mini' : 'md', cls: myTurn && !blocked ? 'playable' : '', attrs: `data-zone="hand" ${myTurn && !blocked ? 'data-act="play"' : ''}` })).join('');
      const top = me.discard[me.discard.length - 1];
      basesZone = `<section class="zone bases-zone ${tip.cue === 'bases' ? 'cue' : ''}"><div class="zl">Ваши базы</div><div class="strip">${bases || '<span class="none">Здесь будут ваши базы</span>'}</div></section>`;
      mineHTML = `
        <div class="hint ${myTurn ? 'mine' : ''}">${tip.text}</div>
        <section class="zone hand-zone ${tip.cue === 'hand' ? 'cue' : ''}"><div class="zl">Рука${me.pendingDiscard ? ` <span class="tag-s warn">в начале хода сбросите ${me.pendingDiscard}</span>` : ''}</div><div class="strip hand">${hand || '<span class="none">Рука пуста</span>'}</div></section>
        <section class="actionbar ${myTurn ? 'my-turn' : ''}" style="--pc:${colorOf(me.id)}">
          <div class="stats">
            <div class="stat hp ${me.authority <= 10 ? 'low' : ''} ${S.prevAuth[me.id] !== undefined && me.authority < S.prevAuth[me.id] ? 'hit' : ''}" title="Ваше здоровье">${I.auth}<b>${Math.max(0, me.authority)}</b><small>здоровье</small></div>
            <div class="stat" title="Деньги на этот ход">${I.trade}<b>${myTurn ? trade : 0}</b><small>деньги</small></div>
            <div class="stat" title="Урон на этот ход">${I.combat}<b>${myTurn ? combat : 0}</b><small>урон</small></div>
            <button class="stat pile" data-act="view-deck" title="Колода">${I.draw}<b>${me.deckCount}</b><small>колода</small></button>
            <button class="stat pile" data-act="view-discard" data-pid="${me.id}" title="Сброс">${top ? '▤' : '▢'}<b>${me.discard.length}</b><small>сброс</small></button>
          </div>
          <div class="acts">
            ${myTurn ? `<button class="btn" data-act="playall" ${blocked || !me.hand.length ? 'disabled' : ''}>Сыграть все</button>
              <button class="btn primary ${tip.cue === 'end' ? 'cue-btn' : ''}" data-act="endturn" ${blocked ? 'disabled' : ''}>Завершить ход</button>`
              : g.over ? '<button class="btn primary" data-act="show-go">Итоги партии</button>'
              : `<span class="wait">Ходит <b style="color:${colorOf(g.turn)}">${esc(cur.name)}</b></span>`}
          </div>
        </section>`;
    } else {
      mineHTML = '<div class="hint">Вы наблюдаете за партией.</div>';
    }

    const turnLbl = g.over ? 'Партия окончена' : myTurn ? 'Ваш ход' : `Ходит ${esc(cur.name)}`;
    $('#board').innerHTML = `
      <header class="topbar">
        <div class="brand">Звёздные Державы <span>стол ${r.code}</span></div>
        <div class="turn-pill ${myTurn ? 'mine' : ''}" style="--pc:${colorOf(g.turn)}">${turnLbl}</div>
        <div class="tb-btns">
          <button class="btn sm ghost" data-act="rules">Правила</button>
          <button class="btn sm ghost" data-act="menu">Меню</button>
          <button class="btn sm ghost side-toggle" data-act="toggle-side">Журнал${S.unread ? ` <span class="unread">${S.unread}</span>` : ''}</button>
        </div>
      </header>
      ${mqWide.matches ? '' : `<section class="opps ${tip.cue === 'opps' ? 'cue' : ''}">${oppHTML}</section>`}
      <section class="zone market ${tip.cue === 'market' ? 'cue' : ''}">
        <div class="zl">Торговый ряд <span class="muted">· в колоде ${g.tradeDeckCount}</span></div>
        <div class="strip">${rowHTML}${expHTML}</div>
      </section>
      <div class="table-row"><section class="zone play-zone" style="--pc:${colorOf(g.turn)}">
        <div class="zl">${isMe ? 'Вы сыграли' : `Сыграно: ${esc(cur.name)}`} ${!isMe ? `<span class="muted">· деньги ${trade} · урон ${combat}</span>` : ''}${g.topNext ? ' <span class="tag-s">следующий корабль — на верх колоды</span>' : ''}</div>
        <div class="strip">${playHTML || '<span class="none">Пока ничего</span>'}</div>
      </section>${basesZone}</div>
      ${mineHTML}
      ${g.prompt && g.prompt.waiting ? `<div class="waiting-banner">${esc(g.prompt.text)}</div>` : ''}`;

    S.prevAuth = Object.fromEntries(g.players.map((p) => [p.id, p.authority]));
    $('#side-opps').innerHTML = mqWide.matches ? `<div class="zl">Соперники</div><div class="opps ${tip.cue === 'opps' ? 'cue' : ''}">${oppHTML}</div>` : '';

    const logEl = $('#side-log');
    logEl.innerHTML = g.log.map((l) => `<div class="le ${l.kind || ''}">${esc(l.text)}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
    renderChat($('#chatlog'));
    const ur = $('#unread');
    if (ur) { ur.textContent = S.unread; ur.classList.toggle('hidden', !S.unread); }

    // окна
    if (g.prompt && !g.prompt.waiting && myTurn) renderPrompt(g);
    else if (S.modal === 'prompt') closeModal();

    if (!g.over && me && !S.tutorialShown && store.get('sd_tutorial') !== '1' && !S.modal) { S.tutorialShown = true; showTutorial(); }

    if (g.over) { if (!S.goShown) { S.goShown = true; renderGameOver(g, host); } }
    else { S.goShown = false; if (S.modal === 'gameover') closeModal(); }

    // если открыт лист соперника — обновить
    if (S.modal === 'opp' && S.oppSheet) oppSheet(S.oppSheet, true);
  }

  function flashTurn() {
    const el = document.createElement('div');
    el.className = 'turn-flash';
    el.textContent = 'Ваш ход';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  // ── выбор ──
  function renderPrompt(g) {
    const pr = g.prompt;
    const key = JSON.stringify([pr.kind, pr.purpose, pr.text, (pr.cards || []).map((c) => c.uid)]);
    if (S.selKey !== key) { S.selKey = key; S.sel = []; }
    let body = '';
    if (pr.kind === 'choose') {
      body = `<div class="choices">${pr.options.map((o, i) => `<button class="choice" data-act="choose" data-i="${i}">${o.map(effShort).join('')}</button>`).join('')}</div>`;
    } else if (pr.kind === 'opponent') {
      body = `<div class="choices">${pr.options.map((id) => { const p = g.players.find((x) => x.id === id); return `<button class="choice" data-act="opp" data-target="${id}"><b>${esc(p.name)}</b><small>карт в руке ${p.handCount} · здоровье ${p.authority}</small></button>`; }).join('')}</div>`;
    } else {
      const zoneName = { hand: 'из руки', discard: 'из сброса', row: 'из ряда', base: 'база', explorer: 'стопка', play: 'в игре' };
      body = `<div class="pick-grid">${pr.cards.map((c) => {
        const owner = c.owner ? g.players.find((p) => p.id === c.owner) : null;
        return `<div class="pick ${S.sel.includes(c.uid) ? 'sel' : ''}" data-act="pick" data-uid="${c.uid}">${cardHTML(c, { size: 'sm' })}<div class="pick-zone">${owner ? esc(owner.name) : zoneName[c.zone] || ''}</div></div>`;
      }).join('')}</div>`;
      const min = Math.min(pr.min, pr.cards.length);
      const ok = S.sel.length >= min && S.sel.length <= pr.max && S.sel.length > 0;
      body += `<div class="m-actions">${pr.min === 0 ? '<button class="btn" data-act="pick-skip">Пропустить</button>' : ''}
        <span class="sel-count">Выбрано ${S.sel.length} из ${pr.max}</span>
        <button class="btn primary" data-act="pick-ok" ${ok ? '' : 'disabled'}>Подтвердить</button></div>`;
    }
    openModal(`<h3>${esc(pr.text)}</h3>${body}`, { kind: 'prompt', locked: true, cls: 'wide', sheet: isMobile() });
  }

  function renderGameOver(g, host) {
    const ranked = [...g.players].sort((a, b) => (a.place || 99) - (b.place || 99));
    const win = g.players.find((p) => p.id === g.winner);
    openModal(`<div class="go"><div class="sec-title">Партия окончена</div>
      <h2>${win ? (win.id === S.pid ? 'Вы победили' : `Победил ${esc(win.name)}`) : 'Ничья'}</h2>
      <ol class="go-list">${ranked.map((p) => `<li><b>${esc(p.name)}</b><span>${p.place ? p.place + ' место' : ''}</span></li>`).join('')}</ol>
      <div class="m-actions center">${host ? '<button class="btn primary big" data-act="tolobby">Новая партия</button>' : '<span class="muted">Новую партию начинает хост</span>'}
      <button class="btn ghost" data-act="close-modal">Посмотреть стол</button><button class="btn ghost" data-act="leave">Выйти</button></div></div>`, { kind: 'gameover' });
  }

  // ── описание карты с действиями ──
  function cardActions(el) {
    const C = S.room && S.room.game ? ctx() : null;
    if (!C || !C.myTurn || C.blocked) return '';
    const zone = el.dataset.zone, uid = el.dataset.uid, cid = el.dataset.cid, d = CARDS[cid];
    if (zone === 'hand') return `<button class="btn primary" data-act="play" data-uid="${uid}">Сыграть карту</button>`;
    if (zone === 'row') {
      const slot = el.dataset.slot;
      return `<button class="btn primary" data-act="buy" data-slot="${slot}" ${C.g.pool.trade >= d.cost ? '' : 'disabled'}>Купить за ${d.cost}</button>${C.g.pool.trade < d.cost ? `<span class="muted small">Денег: ${C.g.pool.trade}</span>` : ''}`;
    }
    if (zone === 'oppbase') {
      const owner = C.g.players.find((p) => p.id === el.dataset.owner);
      const b = owner && owner.bases.find((x) => x.uid === uid);
      if (b && canAttackBase(C, owner, b)) return `<button class="btn danger" data-act="atkbase" data-target="${owner.id}" data-uid="${uid}">Уничтожить за ${d.defense} урона</button>`;
      return '';
    }
    if (zone === 'mybase') {
      const b = C.me.bases.find((x) => x.uid === uid);
      let a = '';
      if (b && d.primary.length && !(b.used && b.used.primary)) a += `<button class="btn primary" data-act="activate" data-uid="${uid}">Использовать</button>`;
      if (d.scrap.length) a += `<button class="btn" data-act="scrap" data-uid="${uid}">Утилизировать</button>`;
      return a;
    }
    if (zone === 'play' && d.scrap.length && C.cur.id === S.pid) return `<button class="btn" data-act="scrap" data-uid="${uid}">Утилизировать</button>`;
    return '';
  }
  function cardModal(el) {
    const c = { cid: el.dataset.cid, uid: el.dataset.uid };
    openModal(detailHTML(c, cardActions(el)), { kind: 'card', cls: 'detail-modal', sheet: isMobile() });
  }

  function oppSheet(pid, refresh) {
    const C = ctx();
    const p = C.g.players.find((x) => x.id === pid);
    if (!p) return;
    S.oppSheet = pid;
    const canAtk = C.myTurn && !C.blocked && p.alive && C.g.pool.combat > 0 && !C.hasOutpost(p);
    const bases = p.bases.map((b) => {
      const can = canAttackBase(C, p, b);
      return `<div class="ob">${cardHTML(b, { size: 'sm', attrs: `data-zone="oppbase" data-owner="${p.id}"` })}${can ? `<button class="btn danger sm" data-act="atkbase" data-target="${p.id}" data-uid="${b.uid}">Уничтожить (${CARDS[b.cid].defense})</button>` : ''}</div>`;
    }).join('');
    const html = `<h3>${esc(p.name)}</h3>
      <div class="os-stats"><span>${I.auth} здоровье <b>${Math.max(0, p.authority)}</b></span><span>в руке ${p.handCount}</span><span>в колоде ${p.deckCount}</span><button class="lnk" data-act="view-discard" data-pid="${p.id}">сброс ${p.discard.length}</button></div>
      ${C.hasOutpost(p) ? '<p class="muted">Защищён аванпостом: сначала уничтожьте аванпост, потом можно атаковать игрока и другие базы.</p>' : ''}
      <div class="sec-title">Базы</div><div class="ob-grid">${bases || '<span class="none">Нет баз</span>'}</div>
      ${canAtk ? `<div class="m-actions"><button class="btn danger big" data-act="atkplayer" data-target="${p.id}">Атаковать (${C.g.pool.combat} урона)</button></div>` : ''}`;
    if (refresh && $('.modal.opp-modal')) { $('.modal.opp-modal').innerHTML = '<button class="x" data-act="close-modal">×</button>' + html; return; }
    openModal(html, { kind: 'opp', cls: 'opp-modal', sheet: true });
  }

  function showDiscard(pid) {
    const g = S.room.game;
    const p = g.players.find((x) => x.id === pid);
    const cards = [...p.discard].reverse();
    openModal(`<h3>Сброс: ${esc(p.name)} — ${cards.length}</h3><div class="pick-grid">${cards.map((c) => cardHTML(c, { size: 'sm' })).join('') || '<div class="empty">Пусто</div>'}</div>`, { kind: 'discard', cls: 'wide', sheet: isMobile() });
  }

  function attackModal(target) {
    const g = S.room.game;
    const p = g.players.find((x) => x.id === target);
    const max = g.pool.combat;
    openModal(`<h3>Атаковать: ${esc(p.name)}</h3><p class="muted">Здоровье соперника — ${p.authority}. У вас ${max} урона${g.players.filter((x) => x.alive).length > 2 ? '; урон можно разделить между соперниками' : ''}.</p>
      <div class="stepper"><button class="btn" id="a-minus">−</button><input id="a-val" type="number" min="1" max="${max}" value="${max}"><button class="btn" id="a-plus">+</button></div>
      <div class="m-actions"><button class="btn" data-act="close-modal">Отмена</button><button class="btn danger" id="a-go">Нанести урон</button></div>`, { kind: 'attack' });
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
    if (me.hand.length) warn.push(`в руке осталось ${cardsWord(me.hand.length)}`);
    const unused = me.bases.filter((b) => CARDS[b.cid].primary.length && !(b.used && b.used.primary));
    if (unused.length) warn.push(`не использованы базы: ${unused.map((b) => '«' + CARDS[b.cid].name + '»').join(', ')}`);
    if (g.pool.combat > 0 && g.players.some((p) => p.alive && p.id !== S.pid)) warn.push(`не потрачен урон (${g.pool.combat})`);
    const cheapest = Math.min(...g.row.filter(Boolean).map((c) => CARDS[c.cid].cost), g.explorers ? 2 : 99);
    if (g.pool.trade >= cheapest) warn.push(`остались деньги (${g.pool.trade}) — можно купить карту`);
    if (!warn.length) return act({ type: 'endTurn' });
    confirmBox(`Завершить ход?<small class="warn-list">${warn.map((w) => '• ' + esc(w)).join('<br>')}</small>`, 'Завершить ход', () => act({ type: 'endTurn' }));
  }

  function showMenu() {
    const g = S.room.game;
    const me = g.players.find((p) => p.id === S.pid);
    openModal(`<h3>Меню</h3><div class="menu-list">
      <button class="btn" data-act="toggle-sound">${S.sound ? 'Звук начала хода: включён' : 'Звук начала хода: выключен'}</button>
      <button class="btn" data-act="copy-link">Скопировать ссылку на стол</button>
      <button class="btn" data-act="tutorial">Как сделать ход</button>
      ${me && me.alive && !g.over ? '<button class="btn danger" data-act="forfeit">Сдаться</button>' : ''}
      ${!me || !me.alive || g.over ? '<button class="btn" data-act="leave">Выйти из-за стола</button>' : ''}
    </div>`, { kind: 'menu' });
  }

  function copyLink() {
    const url = location.origin + location.pathname + '?room=' + S.room.code;
    const done = () => toast('Ссылка скопирована — отправьте её друзьям');
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Ссылка на стол:', url));
    else prompt('Ссылка на стол:', url);
  }
  function answered() { S.sel = []; S.selKey = null; closeModal(); }
  function markChatSeen() {
    if (S.side === 'chat' && S.room) {
      S.chatSeenUser = S.room.chat.filter((c) => !c.sys).length;
      S.unread = 0;
      const ur = $('#unread'); if (ur) ur.classList.add('hidden');
    }
  }

  // ───────────────── события ─────────────────
  let suppressClick = false;
  document.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
    const el = e.target.closest('[data-act]');
    const card = e.target.closest('.card[data-cid]');
    // нажатие на карту без своего действия — открыть описание
    if (card && !card.closest('.modal') && (!el || el === card)) {
      const zone = card.dataset.zone;
      const direct = el === card && (zone === 'hand' || (!isTouch && (zone === 'row' || zone === 'oppbase')));
      if (!direct) { cardModal(card); return; }
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
      case 'tutorial': showTutorial(); break;
      case 'tutorial-ok': store.set('sd_tutorial', '1'); closeModal(); render(); break;
      case 'menu': showMenu(); break;
      case 'toggle-sound': S.sound = !S.sound; store.set('sd_sound', S.sound ? '1' : '0'); showMenu(); break;
      case 'forfeit': confirmBox('Сдаться и выйти из партии?', 'Сдаться', () => act({ type: 'forfeit' }), true); break;
      case 'tolobby': closeModal(); send({ t: 'toLobby' }); break;
      case 'show-go': renderGameOver(S.room.game, S.room.hostId === S.pid); break;
      case 'close-modal': if (S.modal !== 'prompt') { closeModal(); S.oppSheet = null; } break;
      case 'close-modal-bg': if (e.target === el) { closeModal(); S.oppSheet = null; } break;
      case 'play': if (S.modal === 'card') closeModal(); act({ type: 'play', uid: d.uid }); break;
      case 'playall': act({ type: 'playAll' }); break;
      case 'buy': if (S.modal === 'card') closeModal(); act({ type: 'buy', slot: d.slot === 'explorer' ? 'explorer' : +d.slot }); break;
      case 'scrap': e.stopPropagation(); if (S.modal === 'card') closeModal(); act({ type: 'scrap', uid: d.uid }); break;
      case 'activate': e.stopPropagation(); if (S.modal === 'card') closeModal(); act({ type: 'activate', uid: d.uid }); break;
      case 'atkbase': if (S.modal === 'card') closeModal(); act({ type: 'attackBase', target: d.target, uid: d.uid }); break;
      case 'atkplayer': S.oppSheet = null; attackModal(d.target); break;
      case 'opp-sheet': oppSheet(d.pid); break;
      case 'endturn': endTurnCheck(); break;
      case 'view-discard': showDiscard(d.pid); break;
      case 'view-deck': toast(`В колоде ${cardsWord(S.room.game.players.find((p) => p.id === S.pid).deckCount)}. Порядок карт скрыт.`); break;
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
        $$('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.side));
        $('#side-log').classList.toggle('hidden', S.side !== 'log');
        $('#side-chat').classList.toggle('hidden', S.side !== 'chat');
        markChatSeen();
        break;
    }
  });

  // описание при наведении (компьютер) и долгом нажатии (телефон)
  const zoom = $('#zoom');
  let zoomTimer = null;
  if (!isTouch) {
    document.addEventListener('mouseover', (e) => {
      const card = e.target.closest('.card[data-cid]');
      if (!card || card.closest('.zoom') || card.closest('.modal') || card.closest('.hero-cards')) return;
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(() => {
        zoom.innerHTML = detailHTML({ cid: card.dataset.cid }, '');
        zoom.classList.remove('hidden');
        const r = card.getBoundingClientRect();
        const Wd = zoom.offsetWidth, Ht = zoom.offsetHeight;
        let x = r.right + 12;
        if (x + Wd > innerWidth - 8) x = r.left - Wd - 12;
        if (x < 8) x = Math.max(8, innerWidth - Wd - 8);
        const y = Math.min(innerHeight - Ht - 8, Math.max(8, r.top + r.height / 2 - Ht / 2));
        zoom.style.left = x + 'px'; zoom.style.top = y + 'px';
      }, 350);
    });
    document.addEventListener('mouseout', (e) => {
      const card = e.target.closest('.card[data-cid]');
      if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;
      clearTimeout(zoomTimer);
      zoom.classList.add('hidden');
    });
    document.addEventListener('mousedown', () => { clearTimeout(zoomTimer); zoom.classList.add('hidden'); });
  } else {
    let lp = null;
    document.addEventListener('touchstart', (e) => {
      const card = e.target.closest('.card[data-cid]');
      if (!card || card.closest('.modal')) return;
      lp = setTimeout(() => { suppressClick = true; cardModal(card); }, 450);
    }, { passive: true });
    const cancel = () => clearTimeout(lp);
    document.addEventListener('touchend', cancel);
    document.addEventListener('touchmove', cancel, { passive: true });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.modal && S.modal !== 'prompt') closeModal(); });

  connect();
})();
