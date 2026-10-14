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
  const initial = (name) => (String(name || '?').replace(/^Бот\s+/, '')[0] || '?').toUpperCase();

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
    side: 'log', sideOpen: false, sideHidden: store.get('sd_side_hidden') === '1', unread: 0, chatSeenUser: undefined,
    pendingJoin: (new URLSearchParams(location.search).get('room') || '').toUpperCase(),
    prevAuth: {}, wasMyTurn: false, modal: null, sound: store.get('sd_sound') !== '0',
    goShown: false, tutorialShown: false,
    hints: store.get('sd_hints') === '1',
  };
  const isTouch = matchMedia('(hover: none)').matches;
  const mqMobile = matchMedia('(max-width: 760px)');
  const isMobile = () => mqMobile.matches;
  const mqWide = matchMedia('(min-width: 1101px)');
  for (const mq of [mqMobile, mqWide]) mq.addEventListener && mq.addEventListener('change', () => { S.screen = null; render(); });
  const PCOLORS = ['#d9a54a', '#5fa8d3', '#a78bd4', '#6cc28f', '#d4708f', '#c9c25a'];
  const TEAMC = { A: '#d9a54a', B: '#5fa8d3' };

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
        S.deadline = m.room.turnLeft != null ? Date.now() + m.room.turnLeft : null;
        if (S.autoBot && S.room.hostId === S.pid && !S.room.game) { S.autoBot = false; if (S.room.members.length === 1) send({ t: 'addBot' }); }
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
      case 'admin': if (m.ok) { S.adminPending = false; adminPanel(); } break;
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
    diamond: '<path d="M5 2h10l4 5-9 11L1 7z"/><path d="M1 7h18M7 2l3 5 3-5M10 7v11" fill="none" stroke="#0b0e14" stroke-width="1"/>',
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
      brain: `Утилизировать до ${v} карт, взять столько же`,
      copy: 'Повторяет другой ваш корабль',
      combatPerOpBase: `+${v} урона за каждую базу соперников`,
      nextToHand: 'Следующая покупка — сразу в руку',
      allOpDiscard: 'Каждый соперник сбрасывает карту',
      scrapForCombat: `Утилизировать карту из руки/сброса → +${v} урона`,
      destroyBaseMax: `Можно уничтожить базу ценой до ${v}`,
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
      brain: `Утилизируйте до ${cardsWord(v)} из руки или сброса и возьмите столько же новых.`,
      combatPerOpBase: `Дополнительно +${v} урона за каждую базу и аванпост, которые сейчас стоят у ваших соперников.`,
      nextToHand: 'Следующая карта, которую вы купите в этот ход, ляжет сразу в руку — её можно сыграть в этот же ход.',
      allOpDiscard: 'Каждый соперник сбросит одну карту из руки в начале своего хода.',
      scrapForCombat: `Можно навсегда убрать из игры карту из руки или сброса. Если убрали — получите +${v} урона.`,
      destroyBaseMax: `Можно уничтожить одну базу соперника ценой не больше ${v}, даже аванпост, не тратя урон.`,
      copy: 'Выберите другой ваш корабль, сыгранный в этот ход: эта карта повторит его действие и станет той же фракции.',
    }[k] || (k === 'choose' ? 'Выберите одно: ' + v.map((o) => o.map(effPlain).join(', ')).join(' или ') + '.' : '');
  }
  const abil = (list) => list.map(effShort).join('');

  function typeName(d) { return d.type === 'hero' ? 'Герой' : d.type === 'base' ? (d.outpost ? 'Аванпост' : 'База') : 'Корабль'; }
  function typeExplain(d) {
    if (d.id === 'scout' || d.id === 'viper') return 'Стартовая карта. Корабль: действует в тот ход, когда его сыграли, затем уходит в сброс.';
    if (d.id === 'explorer') return 'Старатель всегда доступен для покупки, цена — 2. Корабль: действует в тот ход, когда его сыграли.';
    if (d.type === 'hero') return `Герой. При покупке не идёт в колоду, а сразу встаёт рядом с вами и остаётся там.${d.faction !== 'none' ? ` Пока он рядом, у ваших карт фракции «${FACTIONS[d.faction].name}» срабатывают союзные способности.` : ' Нейтральный — союзником не считается.'} В свой ход его можно отправить в бой: получите эффект, а герой уйдёт из игры.`;
    if (d.type !== 'base') return 'Корабль. Действует в тот ход, когда вы его сыграли, затем уходит в сброс и вернётся с новой колодой.';
    if (d.outpost) return `Аванпост. Остаётся на столе и действует каждый ваш ход. Пока он стоит, соперники не могут атаковать вас и ваши другие базы — сначала им придётся потратить ${d.defense} урона на него.`;
    return `База. Остаётся на столе и действует каждый ваш ход. Соперник может уничтожить её, потратив ${d.defense} урона.`;
  }

  // сводка для мини-карты
  function summary(d) {
    const parts = [];
    const one = (e) => { const k = Object.keys(e)[0], v = e[k]; return I[k] ? `<span>${I[k]}${v}</span>` : ''; };
    for (const e of d.type === 'hero' ? d.scrap : d.primary) {
      const k = Object.keys(e)[0];
      if (k === 'choose') parts.push(`<span>${e.choose.map((o) => o.map(one).join('')).join('/')}</span>`);
      else if (I[k] && k !== 'draw') parts.push(one(e));
      else if (k === 'draw') parts.push(`<span>${I.draw}${e.draw}</span>`);
    }
    if (!parts.length) parts.push('<span class="star">★</span>');
    return parts.join('');
  }

  // ───────────────── карты ─────────────────
  // одинаковые базы одного владельца — одной картой с отметкой «×N»
  function stacks(list) {
    const out = [], by = {};
    for (const b of list) {
      const k = b.copied || b.cid;
      if (!by[k]) { by[k] = { all: [] }; out.push(by[k]); }
      by[k].all.push(b);
    }
    return out;
  }
  const heroesHTML = (list, size, zone, owner) => (list || []).map((h) => cardHTML(h, { size, cls: 'hero-card', attrs: `data-zone="${zone}"`, badge: owner ? `<span class="owner-tag">${esc(owner)}</span>` : '' })).join('');
  const stackBadge = (n) => (n > 1 ? `<span class="stack-n" title="Одинаковых карт: ${n}">×${n}</span>` : '');

  function cardHTML(c, o = {}) {
    const cid = c.copied || c.cid;
    const d = CARDS[cid];
    const F = FACTIONS[d.faction];
    const used = c.used || {};
    const size = o.size || 'md';
    const base = d.type === 'base';
    const style = `--fc:${F.color};--fd:${F.dark};--fl:${F.light}`;
    const attrs = `data-cid="${cid}" ${c.uid ? `data-uid="${c.uid}"` : ''} ${o.attrs || ''}`;
    const art = `<img class="c-art" src="${window.cardArtURL(cid, size === 'mini')}" alt="" draggable="false">`;
    const cls = `card ${size} f-${d.faction} ${d.type === 'hero' ? 'is-hero' : ''} ${base ? 'is-base' : ''} ${d.outpost ? 'is-outpost' : ''} ${o.undo ? 'has-undo' : ''} ${o.cls || ''}`;
    const undoBtn = o.undo ? `<button class="c-undo" data-act="undo" data-uid="${o.undoUid || c.uid}" title="Вернуть карту в руку" aria-label="Вернуть карту в руку">×</button>` : '';
    const defBadge = base ? `<span class="c-def ${d.outpost ? 'out' : ''}" title="${d.outpost ? 'Аванпост — защищает владельца' : 'Защита базы'}">${d.defense}</span>` : '';
    if (size === 'mini') {
      return `<div class="${cls}" ${attrs} style="${style}">${art}
        ${d.cost ? `<span class="c-cost">${d.cost}</span>` : ''}${defBadge}
        <div class="m-foot"><div class="m-sum">${summary(d)}</div><div class="m-name">${esc(d.name)}</div></div>
        ${c.copied ? '<span class="c-copy">копия</span>' : ''}${o.badge || ''}${undoBtn}
        ${o.actions ? `<div class="c-actions">${o.actions}</div>` : ''}</div>`;
    }
    const hero = d.type === 'hero';
    // сколько на карте текста: чем больше, тем меньше картинка и шрифт
    const isText = (e) => { const k = Object.keys(e)[0]; return !NUM.includes(k) && !(k === 'choose' && numericChoose(e)); };
    const textN = [...d.primary, ...d.ally, ...d.scrap].filter(isText).length + (d.fleetHQ || d.allAlly || hero ? 1 : 0) + (d.ally.length && d.scrap.length ? 1 : 0);
    const rows = 1 + (d.ally.length ? 1 : 0) + (d.scrap.length ? 1 : 0);
    const load = textN + (rows === 3 ? 1 : 0);
    const dense = load >= 3 ? 'dense2' : load >= 2 ? 'dense' : '';
    const longWord = Math.max(...d.name.split(/[\s-]+/).map((w) => w.length));
    const nameCls = longWord > 15 ? 'n-x4' : longWord > 13 ? 'n-xxl' : d.name.length > 16 || longWord > 11 ? 'n-xl' : d.name.length > 11 || longWord > 9 ? 'n-l' : '';
    let prim = panel(d.primary);
    if (hero) prim = `<span class="ef tx">${d.faction !== 'none' ? `Пока рядом — союзник: ${F.name}` : 'Нейтральный герой'}</span>`;
    if (d.fleetHQ) prim += `<span class="ef tx">Все ваши корабли получают +1 урона</span>`;
    if (d.allAlly) prim += `<span class="ef tx">${d.rarity === 'diamond' ? 'Союзник любой фракции' : 'Считается союзником для карт любой фракции'}</span>`;
    return `<div class="${cls} ${dense}" ${attrs} style="${style}">
      <div class="c-head">
        <span class="c-badge">${emblem(d.faction)}</span>
        <div class="c-title ${nameCls}"><span class="c-name">${esc(d.name)}</span><span class="c-sub">${subtitle(d)}</span></div>
        ${d.cost ? `<span class="c-cost">${d.cost}</span>` : '<span class="c-cost none"></span>'}
      </div>
      <div class="c-artwrap">${art}${defBadge}${c.copied ? '<span class="c-copy">копия · Мимикр</span>' : ''}</div>
      <div class="c-text">
        ${prim ? `<div class="ab ab-p ${o.manual && base && d.primary.length && !used.primary ? 'ready' : ''}">${prim}</div>` : ''}
        ${d.ally.length ? `<div class="ab ab-a ${used.ally ? 'done' : ''}"><span class="band" title="Союз: срабатывает, если в игре есть ещё карта этой фракции">${emblem(d.faction)}</span><div class="ab-c">${panel(d.ally)}</div></div>` : ''}
        ${d.scrap.length ? `<div class="ab ab-s"><span class="band" title="${hero ? 'Отправить в бой' : 'Утилизация: карта уходит из игры'}">${hero ? '⚔' : TRASH}</span><div class="ab-c">${panel(d.scrap)}</div></div>` : ''}
      </div>
      ${o.badge || ''}${undoBtn}
      ${o.actions ? `<div class="c-actions">${o.actions}</div>` : ''}
    </div>`;
  }

  window.SD_cardHTML = cardHTML; // для страницы-витрины карт при проверке вёрстки

  // свойства карты крупными значками: монета — деньги, красный — урон, зелёный — здоровье, карта — добор
  function tokens(list) {
    return list.map((e) => {
      const k = Object.keys(e)[0], v = e[k];
      if (k === 'trade' || k === 'combat' || k === 'auth' || k === 'draw') return `<span class="tok tok-${k}" title="${esc(effPlain(e))}"><b>${v}</b></span>`;
      if (k === 'choose' && numericChoose(e)) return `<span class="tok-choose">${v.map((o) => tokens(o)).join('<span class="or">или</span>')}</span>`;
      return '';
    }).join('');
  }
  const NUM = ['trade', 'combat', 'auth', 'draw'];
  const numericChoose = (e) => e.choose.every((o) => o.every((x) => NUM.includes(Object.keys(x)[0])));
  function panel(list) {
    const toks = tokens(list);
    const texts = list.filter((e) => { const k = Object.keys(e)[0]; return !NUM.includes(k) && !(k === 'choose' && numericChoose(e)); })
      .map((e) => (Object.keys(e)[0] === 'choose' ? effShort(e) : `<span class="ef tx">${effPlain(e)}</span>`)).join('');
    // подпись под значками: что они значат
    const cap = list.map((e) => { const k = Object.keys(e)[0]; return NUM.includes(k) ? effPlain(e) : k === 'choose' && numericChoose(e) ? e.choose.map((o) => o.map(effPlain).join(', ')).join(' или ') : null; }).filter(Boolean).join(' · ');
    return (toks ? `<div class="toks">${toks}</div><div class="tok-cap">${cap}</div>` : '') + texts;
  }
  const FAC_GEN = { blob: 'Роя', trade: 'Лиги', empire: 'Короны', machine: 'Ордена' };
  function subtitle(d) {
    if (d.rarity === 'diamond') return `💎 ${d.type === 'base' ? (d.outpost ? 'аванпост' : 'база') : 'корабль'}`;
    const t = typeName(d);
    if (d.faction === 'none') return d.type === 'hero' ? 'Нейтральный герой' : t;
    return `${t} ${FAC_GEN[d.faction]}${d.faction2 ? ` и ${FAC_GEN[d.faction2]}` : ''}`;
  }

  function detailHTML(c, actions) {
    const cid = c.copied || c.cid;
    const d = CARDS[cid], F = FACTIONS[d.faction];
    const list = (arr) => `<ul>${arr.map((e) => `<li>${effLong(e)}</li>`).join('')}</ul>`;
    let info = `<div class="d-title">${esc(d.name)}</div>
      <div class="d-sub">${emblem(d.faction)}${d.faction2 ? emblem(d.faction2) : ''} ${typeName(d)}${d.faction !== 'none' ? ' · ' + F.name + (d.faction2 ? ' + ' + FACTIONS[d.faction2].name : '') : ''}${d.cost ? ` · цена ${d.cost}` : ''}${d.type === 'base' ? ` · защита ${d.defense}` : ''}</div>
      <p class="d-type">${typeExplain(d)}</p>`;
    if (d.primary.length) info += `<h5>${d.type === 'base' ? 'Каждый ваш ход' : 'Когда разыграна'}</h5>${list(d.primary)}`;
    if (d.fleetHQ) info += `<h5>Постоянно</h5><ul><li>Каждый корабль, который вы играете, даёт дополнительно +1 урона.</li></ul>`;
    if (d.rarity === 'diamond') info += `<h5>💎 Бриллиантовая карта</h5><p class="muted">Редкая и очень дорогая. Появляется в торговом ряду сама и ненадолго: если её не купят за 3 круга, она исчезнет. Считается союзником для карт любой фракции.</p>`;
    else if (d.allAlly) info += `<h5>Постоянно</h5><ul><li>Пока эта база в игре, у всех ваших карт срабатывают союзные способности.</li></ul>`;
    if (d.faction2) info += `<h5>Две фракции</h5><p class="muted">Карта считается и «${F.name}», и «${FACTIONS[d.faction2].name}»: она союзник для карт обеих фракций.</p>`;
    if (d.ally.length) info += `<h5>${emblem(d.faction)} Союзная способность</h5><p class="muted">Срабатывает, если в этот ход у вас в игре есть ещё одна карта фракции «${F.name}» (корабль или база).</p>${list(d.ally)}`;
    if (d.type === 'hero') info += `<h5>⚔ Отправить в бой</h5><p class="muted">В свой ход, кнопкой «В бой»: герой уходит из игры, а вы получаете эффект.</p>${list(d.scrap)}`;
    else if (d.scrap.length) info += `<h5>${TRASH} Утилизация</h5><p class="muted">Кнопкой «Утилизировать»: карта навсегда уходит из игры, а вы получаете эффект.</p>${list(d.scrap)}`;
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
      <li><b>Завершите ход</b> — вы возьмёте 5 новых карт. Непотраченные деньги и урон сгорают. Если хост ограничил время хода, ход завершится сам, когда время выйдет.</li>
      <li><b>Союз</b> — бонус, если в ход сыграно 2+ карты одной фракции. <b>Утиль</b> — убрать карту из игры ради эффекта.</li>
    </ol>`;
  }
  function showRules() {
    openModal(`<div class="rules"><h2>Правила</h2>${rulesShortHTML()}
      <h4>Подробнее</h4>
      <p>У каждого колода из 10 карт: 8 «Курьеров» (+1 к деньгам) и 2 «Перехватчика» (+1 урона). Первый игрок начинает с 3 картами, второй — с 5 (в игре на троих и больше: 3, 4, затем по 5). Когда колода кончается, сброс перемешивается в новую колоду.</p>
      <p><b>Передумали?</b> На сыгранной карте есть крестик — он возвращает её в руку. Вернуть карту можно, пока вы ничего не купили и не атаковали и пока эта карта не дала взять новые карты (их уже видно).</p>
      <p><b>Корабли</b> действуют один ход и уходят в сброс. <b>Базы</b> остаются на столе и действуют каждый ваш ход; простые эффекты баз срабатывают сами, а если нужно выбирать — нажмите «Использовать». Чтобы уничтожить базу, потратьте урон, равный её защите (число в щите). Тёмный щит — <b>аванпост</b>: он защищает владельца и его остальные базы.</p>
      <p>💎 <b>Бриллиантовые карты</b> (если хост их включил) — редкие и очень дорогие, 12–18. Они не лежат в торговой колоде, а изредка сами появляются в ряду вместо обычной карты; в ряду может быть только одна. Если её не купят за 3 круга, она исчезнет. Бриллиантовые карты — союзники для любой фракции.</p>
      <p><b>Герои</b> (если хост их включил) покупаются из торгового ряда, но не идут в колоду: герой сразу встаёт рядом с вами. Пока он рядом, он союзник своей фракции — у ваших карт этой фракции срабатывают союзные способности. В любой момент своего хода героя можно отправить в бой: получите его эффект, а герой уйдёт из игры.</p>
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
          <button class="btn" data-act="create-bot">Играть с ботом</button>
          <div class="join-row"><input id="h-code" maxlength="4" placeholder="Код стола" autocapitalize="characters" value="${esc(S.pendingJoin)}"><button class="btn" data-act="join">Войти</button></div>
          <div class="sec-title">Открытые столы</div>
          <div id="h-rooms" class="room-list"></div>
          <button class="btn ghost" data-act="rules">Правила игры</button>
          ${isStandalone() ? '' : '<button class="btn ghost" data-act="install">Добавить значок на экран</button>'}
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
    const teamsMode = r.settings.mode === 'teams';
    $('#l-ptitle').textContent = `Игроки — ${r.members.length} из ${r.settings.maxPlayers}`;
    const row = (m, i) => {
      const tm = (r.teams || {})[m.id] || 'A';
      const canMove = teamsMode && (m.id === S.pid || host);
      return `<div class="l-player">
        <span class="avatar" style="--pc:${teamsMode ? TEAMC[tm] : PCOLORS[i % 6]}">${esc(initial(m.name))}</span>
        <span class="nm">${esc(m.name)}${m.id === S.pid ? ' <small>(вы)</small>' : ''}</span>
        ${m.id === r.hostId ? '<span class="tag-s">хост</span>' : ''}
        ${m.bot ? '<span class="tag-s bot">бот</span>' : ''}
        ${!m.connected ? '<span class="tag-s muted">не в сети</span>' : ''}
        ${canMove ? `<button class="lnk" data-act="team" data-pid="${m.id}" data-team="${tm === 'A' ? 'B' : 'A'}">в команду ${tm === 'A' ? 'Б' : 'А'}</button>` : ''}
        ${host && m.id !== S.pid ? `<button class="lnk" data-act="kick" data-pid="${m.id}">убрать</button>` : ''}
      </div>`;
    };
    const free = r.members.length < r.settings.maxPlayers;
    const empty = free ? (host ? '<button class="l-player empty-seat add-bot" data-act="add-bot">+ Добавить бота</button>' : '<div class="l-player empty-seat">Свободное место</div>') : '';
    if (teamsMode) {
      const col = (t) => {
        const ms = r.members.map((m, i) => [m, i]).filter(([m]) => ((r.teams || {})[m.id] || 'A') === t);
        return `<div class="team-col" style="--tc:${TEAMC[t]}"><div class="team-h">Команда ${t === 'A' ? 'А' : 'Б'} <span class="muted">${ms.length}/2</span></div>${ms.map(([m, i]) => row(m, i)).join('') || '<div class="l-player empty-seat">Пусто</div>'}</div>`;
      };
      $('#l-players').innerHTML = `<div class="team-cols">${col('A')}${col('B')}</div>` + (host && free ? '<button class="l-player empty-seat add-bot" data-act="add-bot">+ Добавить бота</button>' : '');
    } else {
      $('#l-players').innerHTML = r.members.map(row).join('') + empty;
    }

    const st = r.settings;
    const chips = (k, vals, cur, fmt = (v) => v) => vals.map((v) => `<button class="seg ${cur === v ? 'on' : ''}" ${host ? `data-act="set" data-k="${k}" data-v="${v}"` : 'disabled'}>${fmt(v)}</button>`).join('');
    const sEl = $('#l-settings');
    const typing = document.activeElement && document.activeElement.id === 'l-auth';
    if (typing) {
      $$('.seg[data-k]', sEl).forEach((b) => b.classList.toggle('on', String(st[b.dataset.k] === undefined ? '' : st[b.dataset.k]) === b.dataset.v));
    } else {
      const deckLbl = { auto: 'Авто', 1: '80', 1.5: '120', 2: '160' };
      sEl.innerHTML = `
        <div class="set"><div class="set-l">Режим</div><div class="segs">${chips('mode', ['ffa', 'teams'], st.mode || 'ffa', (v) => (v === 'ffa' ? 'Каждый сам за себя' : '2 на 2'))}</div>
          ${teamsMode ? '<p class="muted small set-note">У команды одно здоровье и общий урон, аванпост любого защищает обоих. Деньги у каждого свои — покупки идут в свою колоду. Напарники ходят одновременно, союзы срабатывают и от карт напарника.</p>' : ''}</div>
        <div class="set"><div class="set-l">${teamsMode ? 'Здоровье команды' : 'Стартовое здоровье'}</div>
          <div class="segs">${chips('authority', [20, 30, 40, 50, 75, 100], st.authority)}</div>
          ${host ? `<label class="custom">Своё значение <input id="l-auth" type="number" min="1" max="999" value="${st.authority}"></label>` : ''}
        </div>
        ${teamsMode ? '' : `<div class="set"><div class="set-l">Мест за столом</div><div class="segs">${chips('maxPlayers', [2, 3, 4, 5, 6], st.maxPlayers)}</div></div>`}
        <div class="set"><div class="set-l">Новые карты</div><div class="segs">${chips('newCards', [true, false], st.newCards !== false, (v) => (v ? 'Добавить 16 карт' : 'Только базовые'))}</div></div>
        <div class="set"><div class="set-l">Бриллиантовые карты</div><div class="segs">${chips('diamonds', [true, false], st.diamonds !== false, (v) => (v ? 'Есть' : 'Нет'))}</div>
          ${st.diamonds !== false ? '<p class="muted small set-note">Очень дорогие (12–18) и сильные карты. Изредка сами появляются в торговом ряду — не больше одной сразу — и исчезают, если их не купят за 3 круга.</p>' : ''}</div>
        <div class="set"><div class="set-l">Дополнение «Герои»</div><div class="segs">${chips('heroes', [true, false], st.heroes !== false, (v) => (v ? 'С героями' : 'Без героев'))}</div>
          ${st.heroes !== false ? '<p class="muted small set-note">В торговую колоду добавляются 10 героев. Купленный герой встаёт рядом с игроком, считается союзником своей фракции, а в нужный момент его можно отправить в бой ради разового эффекта.</p>' : ''}</div>
        <div class="set"><div class="set-l">Торговая колода</div><div class="segs">${chips('deckSize', ['auto', '1', '1.5', '2'], String(st.deckSize || 'auto'), (v) => deckLbl[v])}</div>
          <p class="muted small set-note">${String(st.deckSize || 'auto') === 'auto' ? 'Авто: 80 карт на 2–3 игроков, 120 на 4, 160 на 5–6.' : 'Карт в торговой колоде на всю партию.'}</p></div>
        <div class="set"><div class="set-l">Время на ход</div><div class="segs">${chips('turnTime', ['off', '60', '120'], String(st.turnTime || 'off'), (v) => ({ off: 'Без ограничения', 60: '1 минута', 120: '2 минуты' })[v])}</div>
          ${String(st.turnTime || 'off') !== 'off' ? '<p class="muted small set-note">Когда время выйдет, ход завершится сам.</p>' : ''}</div>
        <div class="set"><div class="set-l">Первый ход</div><div class="segs">${chips('randomOrder', [true, false], st.randomOrder, (v) => (v ? 'Случайно' : 'По порядку входа'))}</div></div>
        ${host ? '' : '<p class="muted">Настройки выбирает хост.</p>'}`;
      const ai = $('#l-auth');
      if (ai) ai.addEventListener('change', () => send({ t: 'settings', settings: { ...S.room.settings, authority: ai.value } }));
    }
    let startOk = r.members.length >= 2, startLbl = startOk ? 'Начать игру' : 'Ждём игроков…';
    if (teamsMode) {
      const a = r.members.filter((m) => ((r.teams || {})[m.id] || 'A') === 'A').length;
      startOk = r.members.length === 4 && a === 2;
      startLbl = r.members.length < 4 ? `Нужно 4 игрока (${r.members.length}/4)` : startOk ? 'Начать игру' : 'Нужно по 2 в команде';
    }
    $('#l-start').innerHTML = host
      ? `<button class="btn primary big" data-act="start" ${startOk ? '' : 'disabled'}>${startLbl}</button>`
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
    const teams = g.mode === 'teams';
    const me = g.players.find((p) => p.id === S.pid);
    const active = g.active || [g.turn];
    const actives = g.players.filter((p) => active.includes(p.id));
    const cur = actives[0] || g.players[0];
    const myTurn = !!me && me.alive && active.includes(S.pid) && !g.over;
    // блокирует только своё окно выбора; пока выбирает напарник, можно ходить дальше
    const blocked = !!(g.prompt && !g.prompt.waiting);
    const ready = (g.ready || []).includes(S.pid);
    const mate = teams && me ? g.players.find((p) => p.team === me.team && p.id !== me.id) : null;
    const colorOf = (pid) => { const p = g.players.find((x) => x.id === pid); return teams && p ? TEAMC[p.team] : PCOLORS[g.players.findIndex((x) => x.id === pid) % 6]; };
    const hasOutpost = (p) => g.players.some((o) => o.team === p.team && o.bases.some((b) => CARDS[b.cid].outpost));
    const isEnemy = (p) => !me || p.team !== me.team;
    const curName = teams ? actives.map((p) => esc(p.name)).join(' и ') : esc(cur.name);
    return { r, g, me, cur, actives, myTurn, blocked, ready, mate, teams, colorOf, hasOutpost, isEnemy, curName, host: r.hostId === S.pid };
  }

  // Короткая сводка ходов соперников с момента вашего прошлого хода
  function turnNews(C) {
    const { g, me } = C;
    const hist = g.history || [];
    const list = [];
    for (let i = hist.length - 1; i >= 0 && list.length < 5; i--) {
      if (me && hist[i].team === me.team) break;
      list.unshift(hist[i]);
      if (!me) break;
    }
    if (!list.length) return '';
    const P = (id) => g.players.find((x) => x.id === id);
    const nm = (id) => esc((P(id) || {}).name || '?');
    const cards = (arr) => {
      const n = {}; arr.forEach((c) => { n[c] = (n[c] || 0) + 1; });
      return Object.entries(n).map(([c, k]) => `${esc(CARDS[c].name)}${k > 1 ? ` ×${k}` : ''}`).join(', ');
    };
    const mine = (id) => me && P(id) && P(id).team === me.team;
    const lines = list.map((h) => {
      const own = h.actors.map((id) => {
        const p = [];
        if ((h.buys[id] || []).length) p.push(`покупки: ${cards(h.buys[id])}`);
        if ((h.built[id] || []).length) p.push(`базы: ${cards(h.built[id])}`);
        return { id, text: p.join('; ') };
      });
      const tail = [];
      const byTeam = {};
      for (const [id, n] of Object.entries(h.dmg || {})) { const t = P(id); if (t) { byTeam[t.team] = byTeam[t.team] || { n: 0, id }; byTeam[t.team].n += n; } }
      for (const { n, id } of Object.values(byTeam)) {
        const tgt = mine(id) ? (C.teams ? 'вашей команде' : 'вам') : C.teams ? `команде ${esc(g.players.filter((x) => x.team === P(id).team).map((x) => x.name).join(' и '))}` : nm(id);
        tail.push(`<span class="nd">урон ${n} ${tgt}</span>`);
      }
      const lostMine = (h.killed || []).filter((k) => mine(k.owner)).map((k) => k.cid);
      if (lostMine.length) tail.push(`<span class="nd">${lostMine.length > 1 ? `уничтожены ваши базы: ${cards(lostMine)}` : `уничтожена ваша база «${esc(CARDS[lostMine[0]].name)}»`}</span>`);
      const lostOther = {};
      for (const k of (h.killed || []).filter((x) => !mine(x.owner))) (lostOther[k.owner] = lostOther[k.owner] || []).push(k.cid);
      for (const [o, list] of Object.entries(lostOther)) tail.push(list.length > 1 ? `уничтожены базы (${nm(o)}): ${cards(list)}` : `уничтожена база «${esc(CARDS[list[0]].name)}» (${nm(o)})`);
      if (h.actors.length > 1) {
        const segs = own.map((o) => `<b>${nm(o.id)}</b>: ${o.text || 'без покупок'}`);
        return `<div class="nl">${[...segs, ...tail].join(' · ')}</div>`;
      }
      const parts = [own[0] && own[0].text, ...tail].filter(Boolean);
      return `<div class="nl"><b>${nm(h.actors[0])}</b>: ${parts.join(' · ') || 'без покупок и атак'}</div>`;
    });
    return `<div class="news">${lines.join('')}</div>`;
  }

  const teamOf = (C, p) => C.g.players.filter((x) => x.team === p.team);
  const teamTitle = (C, p) => teamOf(C, p).map((x) => esc(x.name)).join(' и ');

  function canAttackBase(C, owner, b) {
    const d = CARDS[b.cid];
    if (!C.myTurn || C.blocked || !owner.alive || !C.isEnemy(owner)) return false;
    if (!d.outpost && C.hasOutpost(owner)) return false;
    return C.g.pool.combat >= d.defense;
  }

  // подсказка «что делать сейчас»
  function coach(C) {
    const { g, me, myTurn } = C;
    if (g.over) return { text: 'Партия окончена.', cue: '' };
    if (!me || !me.alive) return { text: 'Вы наблюдаете за партией.', cue: '' };
    if (!myTurn) return { text: `Сейчас ${C.teams ? 'ходит команда' : 'ходит'} ${C.curName}. ${isTouch ? 'Нажмите на карту, чтобы прочитать её описание.' : 'Наведите курсор на карту, чтобы прочитать описание.'}`, cue: '' };
    if (C.blocked) return { text: 'Сделайте выбор в открытом окне.', cue: '' };
    if (C.ready) return { text: `Вы готовы завершить ход. Ждём, когда ${esc(C.mate ? C.mate.name : 'напарник')} тоже нажмёт «Завершить ход».`, cue: '' };
    if (me.hand.length) return { text: `<b>Шаг 1.</b> Сыграйте карты из руки — ${isTouch ? 'нажмите на карту' : 'щёлкните по карте'} или «Сыграть все».`, cue: 'hand' };
    const manual = me.bases.filter((b) => CARDS[b.cid].primary.length && !(b.used && b.used.primary));
    if (manual.length) return { text: `Используйте базу «${esc(CARDS[manual[0].cid].name)}» — кнопка «Использовать» на карте.`, cue: 'bases' };
    const affordable = g.row.some((c) => c && CARDS[c.cid].cost <= g.pool.trade) || (g.explorers > 0 && g.pool.trade >= 2);
    if (affordable) return { text: `<b>Шаг 2.</b> Денег: ${g.pool.trade} — купите карту из ряда (подсвечены). Купленное попадёт в ваш сброс.`, cue: 'market' };
    if (g.pool.combat > 0) {
      const ops = g.players.filter((p) => p.alive && C.isEnemy(p));
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
    const { r, g, me, cur, myTurn, blocked, colorOf, host, teams, mate } = C;
    const mobile = isMobile();
    const app = $('#app');
    if (S.screen !== 'game') {
      S.screen = 'game';
      S.prevAuth = {};
      S.chatSeenUser = undefined;
      app.innerHTML = `<div class="game">
        <div id="board" class="board"></div>
        <aside id="side" class="side">
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
    if (S.side === 'chat' && (S.sideOpen || (mqWide.matches && !S.sideHidden))) S.chatSeenUser = userMsgs;
    S.unread = Math.max(0, userMsgs - S.chatSeenUser);

    if (myTurn && !S.wasMyTurn) { beep(); flashTurn(); }
    S.wasMyTurn = myTurn;
    document.title = myTurn ? '● Ваш ход — Звёздные Державы' : 'Звёздные Державы';

    let opps = g.players.filter((p) => p.id !== S.pid);
    if (me) { const i = g.players.indexOf(me); opps = [...g.players.slice(i + 1), ...g.players.slice(0, i)]; }
    opps = opps.filter((p) => C.isEnemy(p));
    const tip = coach(C);
    if (myTurn && !blocked && (g.undoable || []).length && !me.hand.length) tip.text += ' <span class="muted">Ошиблись с картой? Крестик на ней вернёт её в руку.</span>';
    if (teams && myTurn && !blocked && !C.ready && tip.cue) tip.text += ' <span class="muted">Урон общий с напарником, деньги у каждого свои.</span>';
    const waitNote = myTurn && g.prompt && g.prompt.waiting ? `${esc(g.prompt.text)} Вы можете ходить дальше.` : '';
    if (waitNote) tip.text += ` <span class="muted">${waitNote}</span>`;
    if (!S.hints) tip.cue = '';
    const news = turnNews(C);
    const infoHTML = S.hints ? `<div class="hint ${myTurn ? 'mine' : ''}">${tip.text}</div>${news}`
      : `${news}${waitNote ? `<div class="news"><div class="nl">${waitNote}</div></div>` : ''}`;
    const combat = g.pool.combat, trade = g.pool.trade;

    // соперники
    let enemyList = opps;
    if (teams) { const seen = new Set(); enemyList = opps.filter((p) => !seen.has(p.team) && seen.add(p.team)); }
    const oppHTML = enemyList.map((p) => {
      if (teams) return teamCardHTML(C, p, mobile);
      const m = r.members.find((x) => x.id === p.id);
      const hit = S.prevAuth[p.id] !== undefined && p.authority < S.prevAuth[p.id];
      const canAtk = myTurn && !blocked && p.alive && combat > 0 && !C.hasOutpost(p);
      const anyBaseTarget = p.bases.some((b) => canAttackBase(C, p, b));
      const offline = m && !m.connected;
      if (mobile) {
        return `<button class="opp-chip ${(g.active || []).includes(p.id) ? 'turn' : ''} ${p.alive ? '' : 'dead'} ${hit ? 'hit' : ''} ${canAtk || anyBaseTarget ? 'target' : ''}" style="--pc:${colorOf(p.id)}" data-act="opp-sheet" data-pid="${p.id}">
          <span class="avatar">${esc(initial(p.name))}</span>
          <span class="oc-body"><span class="oc-name">${esc(p.name)}${offline ? ' · офлайн' : ''}</span>
          <span class="oc-meta">${p.alive ? `<span class="hp ${p.authority <= 10 ? 'low' : ''}">${I.auth}${Math.max(0, p.authority)}</span><span>баз ${p.bases.length}${C.hasOutpost(p) ? ' 🛡' : ''}</span><span>✋${p.handCount}</span>` : 'выбыл'}</span></span>
          ${canAtk || anyBaseTarget ? '<span class="oc-atk">⚔</span>' : ''}
        </button>`;
      }
      const bases = stacks(p.bases).map(({ all }) => {
        const b = all[0];
        const can = canAttackBase(C, p, b);
        return cardHTML(b, { size: 'mini', cls: can ? 'targetable' : '', attrs: `data-zone="oppbase" data-owner="${p.id}" ${can ? `data-act="atkbase" data-target="${p.id}"` : ''}`, badge: stackBadge(all.length) });
      }).join('') + heroesHTML(p.heroes, 'mini', 'opphero');
      const atk = canAtk ? `<span class="atk-hint">⚔ атаковать</span>` : '';
      return `<div class="opp ${(g.active || []).includes(p.id) ? 'turn' : ''} ${p.alive ? '' : 'dead'} ${hit ? 'hit' : ''} ${canAtk ? 'atk-target' : ''}" style="--pc:${colorOf(p.id)}" ${canAtk ? `data-act="atkplayer" data-target="${p.id}" title="Нажмите, чтобы атаковать"` : ''}>
        <div class="opp-head g2"><span class="avatar">${esc(initial(p.name))}</span>
          <div class="nm-line"><b>${esc(p.name)}</b>${m && m.bot ? ' <span class="tag-s bot">бот</span>' : ''}${p.id === r.hostId ? ' <span class="tag-s">хост</span>' : ''}${offline ? ' <span class="tag-s muted">офлайн</span>' : ''}</div>
          <div class="hp-badge ${p.authority <= 10 ? 'low' : ''}" title="Здоровье">${Math.max(0, p.authority)}</div>
          ${p.alive ? `<div class="opp-meta"><span title="Карт в руке">рука ${p.handCount}</span><span title="Карт в колоде">колода ${p.deckCount}</span><button class="lnk" data-act="view-discard" data-pid="${p.id}">сброс ${p.discard.length}</button>${p.pendingDiscard ? `<span class="tag-s warn">сбросит ${p.pendingDiscard}</span>` : ''}</div>`
            : `<div class="opp-meta">выбыл${p.place ? ` · ${p.place} место` : ''}</div>`}
          ${atk ? `<div class="atk">${atk}</div>` : ''}</div>
        ${p.alive ? `${bases ? `<div class="opp-bases">${bases}</div>` : ''}
          ${!canAtk && C.hasOutpost(p) && myTurn && combat > 0 ? '<div class="muted small">🛡 Защищён аванпостом — сначала уничтожьте его</div>' : ''}
          ${host && offline && !g.over ? `<button class="lnk danger" data-act="kick" data-pid="${p.id}">исключить</button>` : ''}` : ''}
      </div>`;
    }).join('');

    // напарник
    let mateHTML = '';
    if (mate) {
      const mm = r.members.find((x) => x.id === mate.id);
      const offline = mm && !mm.connected;
      const rdy = (g.ready || []).includes(mate.id);
      if (mobile) {
        mateHTML = `<button class="opp-chip mate ${(g.active || []).includes(mate.id) ? 'turn' : ''} ${mate.alive ? '' : 'dead'}" style="--pc:${colorOf(mate.id)}" data-act="mate-sheet">
          <span class="avatar">${esc(initial(mate.name))}</span>
          <span class="oc-body"><span class="oc-name">${esc(mate.name)} · напарник</span>
          <span class="oc-meta">${mate.alive ? `<span>✋${mate.handCount}</span>${(g.active || []).includes(mate.id) ? `<span>${I.trade}${(g.purse || {})[mate.id] || 0}</span>` : ''}${rdy ? '<span class="ok">готов</span>' : ''}${offline ? '<span>офлайн</span>' : ''}` : 'вышел'}</span></span></button>`;
      } else {
        const mhand = (mate.hand || []).map((c) => cardHTML(c, { size: 'mini', attrs: 'data-zone="matehand"' })).join('');
        mateHTML = `<div class="opp mate ${(g.active || []).includes(mate.id) ? 'turn' : ''} ${mate.alive ? '' : 'dead'}" style="--pc:${colorOf(mate.id)}">
          <div class="opp-head"><span class="avatar">${esc(initial(mate.name))}</span>
            <div class="opp-nm"><b>${esc(mate.name)}</b> <span class="tag-s">напарник</span>${rdy ? ' <span class="tag-s ok">готов</span>' : ''}${offline ? ' <span class="tag-s muted">офлайн</span>' : ''}</div></div>
          ${mate.alive ? `<div class="opp-meta">${(g.active || []).includes(mate.id) ? `<span>${I.trade}деньги ${(g.purse || {})[mate.id] || 0}</span>` : ''}<span>колода ${mate.deckCount}</span><button class="lnk" data-act="view-discard" data-pid="${mate.id}">сброс ${mate.discard.length}</button></div>
          <div class="zl">Рука</div><div class="opp-bases">${mhand || '<span class="none">пусто</span>'}</div>` : '<div class="muted">вышел из игры</div>'}
        </div>`;
      }
    }

    // торговый ряд
    const cs = mobile ? 'mini' : 'md';
    const rowHTML = g.row.map((c, i) => {
      if (!c) return `<div class="card ${cs} slot-empty"></div>`;
      const can = myTurn && !blocked && trade >= CARDS[c.cid].cost;
      const left = c.expires ? Math.max(1, Math.ceil((c.expires - g.turnNo) / Math.max(1, g.players.filter((x) => x.alive).map((x) => x.team).filter((t, k, a) => a.indexOf(t) === k).length))) : 0;
      return cardHTML(c, { size: cs, cls: can ? 'can-buy' : '', attrs: `data-zone="row" data-slot="${i}" ${can && !isTouch ? 'data-act="buy"' : ''}`, badge: c.expires ? `<span class="dia-left" title="Исчезнет, если не купить">💎 ${left} ${plural(left, 'круг', 'круга', 'кругов')}</span>` : '' });
    }).join('');
    const canExp = myTurn && !blocked && trade >= 2 && g.explorers > 0;
    const expHTML = g.explorers > 0
      ? cardHTML({ cid: 'explorer' }, { size: cs, cls: 'pile-card ' + (canExp ? 'can-buy' : ''), attrs: `data-zone="row" data-slot="explorer" ${canExp && !isTouch ? 'data-act="buy"' : ''}`, badge: `<span class="pile-count">×${g.explorers}</span>` })
      : '';

    // сыгранное
    const isMe = myTurn;
    const ps = mobile ? 'mini' : 'sm';
    // одинаковые сыгранные карты — одной картой «×N»; крестик возвращает последнюю из них
    const playHTML = C.actives.map((pp) => stacks(pp.inPlay).map(({ all }) => {
      const c = all[0];
      const d = CARDS[c.copied || c.cid];
      const mine = pp.id === S.pid;
      const undoUid = mine && myTurn ? [...all].reverse().map((x) => x.uid).find((u) => (g.undoable || []).includes(u)) : null;
      const acts = mine && myTurn && !blocked && d.scrap.length ? `<button class="mini-btn" data-act="scrap" data-uid="${c.uid}">${mobile ? 'Утиль' : 'Утилизировать'}</button>` : '';
      return cardHTML(c, { size: ps, actions: acts, attrs: `data-zone="${mine ? 'play' : 'mateplay'}"`, undo: !!undoUid, undoUid, badge: (teams && !mine ? `<span class="owner-tag">${esc(pp.name)}</span>` : '') + stackBadge(all.length) });
    }).join('')).join('');

    // моя зона
    let mineHTML = '', basesZone = '';
    if (me) {
      const bases = stacks(me.bases).map(({ all }) => {
        const d = CARDS[all[0].cid];
        // способность каждой из одинаковых баз — отдельным нажатием, пока есть неиспользованные
        const ready = all.filter((b) => d.primary.length && !(b.used && b.used.primary));
        const b = ready[0] || all[0];
        const undoUid = [...all].reverse().map((x) => x.uid).find((u) => (g.undoable || []).includes(u));
        let acts = '';
        if (myTurn && !blocked) {
          if (ready.length) acts += `<button class="mini-btn use" data-act="activate" data-uid="${b.uid}">${mobile ? 'Исп.' : 'Использовать'}${all.length > 1 ? ` (${ready.length})` : ''}</button>`;
          if (d.scrap.length) acts += `<button class="mini-btn" data-act="scrap" data-uid="${b.uid}">${mobile ? 'Утиль' : 'Утилизировать'}</button>`;
        }
        return cardHTML(b, { size: ps, actions: acts, manual: true, attrs: 'data-zone="mybase"', undo: myTurn && !!undoUid, undoUid, badge: (teams ? '<span class="owner-tag">ваша</span>' : '') + stackBadge(all.length) });
      }).join('') + (teams && mate && mate.alive ? stacks(mate.bases).map(({ all }) => cardHTML(all[0], { size: ps, attrs: 'data-zone="matebase"', badge: `<span class="owner-tag">${esc(mate.name)}</span>` + stackBadge(all.length) })).join('') : '')
        + (me.heroes || []).map((h) => cardHTML(h, { size: ps, cls: 'hero-card', attrs: 'data-zone="myhero"', actions: myTurn && !blocked ? `<button class="mini-btn use" data-act="scrap" data-uid="${h.uid}">${mobile ? '⚔ В бой' : '⚔ Отправить в бой'}</button>` : '', badge: teams ? '<span class="owner-tag">ваш герой</span>' : '' })).join('')
        + (teams && mate && mate.alive ? heroesHTML(mate.heroes, ps, 'matehero', mate.name) : '');
      const hasHeroes = (me.heroes || []).length || (teams && mate && (mate.heroes || []).length);
      const hand = (me.hand || []).map((c) => cardHTML(c, { size: mobile ? 'mini' : 'md', cls: myTurn && !blocked ? 'playable' : '', attrs: `data-zone="hand" ${myTurn && !blocked ? 'data-act="play"' : ''}` })).join('');
      const top = me.discard[me.discard.length - 1];
      basesZone = `<section class="zone bases-zone ${tip.cue === 'bases' ? 'cue' : ''} ${bases ? '' : 'empty'}"><div class="zl">${hasHeroes ? (teams ? 'Базы и герои команды' : 'Ваши базы и герои') : teams ? `Базы команды${g.players.some((x) => x.team === me.team && x.alive && x.bases.some((b) => CARDS[b.cid].outpost)) ? ' · 🛡 аванпост защищает вас обоих' : ''}` : 'Ваши базы'}</div><div class="strip">${bases || '<span class="none">Здесь будут ваши базы</span>'}</div></section>`;
      mineHTML = `
        <div class="spacer"></div>${infoHTML}
        <section class="zone hand-zone ${tip.cue === 'hand' ? 'cue' : ''} ${hand ? '' : 'empty'}"><div class="zl">Рука${me.pendingDiscard ? ` <span class="tag-s warn">в начале хода сбросите ${me.pendingDiscard}</span>` : ''}</div><div class="strip hand">${hand || '<span class="none">Рука пуста</span>'}</div></section>
        <section class="actionbar ${myTurn ? 'my-turn' : ''}" style="--pc:${colorOf(me.id)}">
          <div class="stats">
            <div class="stat hp ${me.authority <= 10 ? 'low' : ''} ${S.prevAuth[me.id] !== undefined && me.authority < S.prevAuth[me.id] ? 'hit' : ''}" title="${teams ? 'Здоровье команды' : 'Ваше здоровье'}">${I.auth}<b>${Math.max(0, me.authority)}</b><small>${teams && !mobile ? 'команда' : 'здоровье'}</small></div>
            <div class="stat" title="${teams ? 'Ваши деньги — покупки идут в вашу колоду' : 'Деньги на этот ход'}">${I.trade}<b>${myTurn ? trade : 0}</b><small>${teams && !mobile ? 'ваши деньги' : 'деньги'}</small></div>
            <div class="stat" title="${teams ? 'Урон общий с напарником' : 'Урон на этот ход'}">${I.combat}<b>${myTurn ? combat : 0}</b><small>${teams && !mobile ? 'урон команды' : 'урон'}</small></div>
            <button class="stat pile" data-act="view-deck" title="Колода">${I.draw}<b>${me.deckCount}</b><small>колода</small></button>
            <button class="stat pile" data-act="view-discard" data-pid="${me.id}" title="Сброс">${top ? '▤' : '▢'}<b>${me.discard.length}</b><small>сброс</small></button>
          </div>
          <div class="acts">
            ${myTurn && C.ready ? `<span class="wait">Ждём напарника${mate ? ` (${esc(mate.name)})` : ''}…</span><button class="btn" data-act="unready">Ещё не готов</button>`
              : myTurn ? `<button class="btn" data-act="playall" ${blocked || !me.hand.length ? 'disabled' : ''}>Сыграть все</button>
              <button class="btn primary ${tip.cue === 'end' ? 'cue-btn' : ''}" data-act="endturn" ${blocked ? 'disabled' : ''}>Завершить ход</button>`
              : g.over ? '<button class="btn primary" data-act="show-go">Итоги партии</button>'
              : `<span class="wait">Ходит <b style="color:${colorOf(cur.id)}">${C.curName}</b></span>`}
          </div>
        </section>`;
    } else {
      mineHTML = `<div class="spacer"></div>${news}<div class="hint">Вы наблюдаете за партией.</div>`;
    }

    const turnLbl = g.over ? 'Партия окончена' : myTurn ? (teams && mate && mate.alive && !mobile ? `Ваш ход · напарник: ${esc(mate.name)}` : 'Ваш ход') : mobile && teams ? `Ходят ${esc(C.actives.map((x) => x.name).join(', '))}` : `Ходит ${C.curName}`;
    $('#board').innerHTML = `
      <header class="topbar">
        <div class="brand">Звёздные Державы <span>стол ${r.code}</span></div>
        <div class="turn-pill ${myTurn ? 'mine' : ''}" style="--pc:${colorOf(cur.id)}">${turnLbl}${g.over ? '' : ' <span class="turn-timer" aria-label="Осталось времени на ход"></span>'}</div>
        <div class="tb-btns">
          <button class="btn sm ghost" data-act="rules">Правила</button>
          <button class="btn sm ghost" data-act="menu">Меню</button>
          <button class="btn sm ghost side-toggle" data-act="toggle-side">Журнал${S.unread ? ` <span class="unread">${S.unread}</span>` : ''}</button>
          <button class="btn sm ghost side-hide" data-act="hide-side" title="${S.sideHidden ? 'Показать журнал и чат' : 'Скрыть журнал и чат, чтобы освободить место на столе'}">${S.sideHidden ? `Журнал и чат${S.unread ? ` <span class="unread">${S.unread}</span>` : ''}` : 'Скрыть панель'}</button>
        </div>
      </header>
      ${mqWide.matches ? '' : `<section class="opps ${tip.cue === 'opps' ? 'cue' : ''}">${mateHTML}${oppHTML}</section>`}
      <div class="top-row">
      <section class="zone market ${tip.cue === 'market' ? 'cue' : ''}">
        <div class="zl">Торговый ряд <span class="muted">· в колоде ${g.tradeDeckCount}</span></div>
        <div class="strip">${rowHTML}${expHTML}</div>
      </section>
      ${mqWide.matches ? `<section class="opps-area"><div class="opps ${tip.cue === 'opps' ? 'cue' : ''}">${oppHTML}${mateHTML}</div></section>` : ''}
      </div>
      <div class="table-row"><section class="zone play-zone" style="--pc:${colorOf(cur.id)}">
        <div class="zl">${isMe ? (teams ? 'Сыграно вашей командой' : 'Вы сыграли') : `Сыграно: ${C.curName}`} ${!isMe ? `<span class="muted">· деньги ${trade} · урон ${combat}</span>` : ''}${g.topNext ? ' <span class="tag-s">следующий корабль — на верх колоды</span>' : ''}${g.toHand ? ' <span class="tag-s">следующая покупка — в руку</span>' : ''}</div>
        <div class="strip">${playHTML || '<span class="none">Пока ничего</span>'}</div>
      </section>${basesZone}</div>
      ${mineHTML}`;

    S.prevAuth = Object.fromEntries(g.players.map((p) => [p.id, p.authority]));
    tickTimer();
    $('.game').classList.toggle('side-hidden', !!S.sideHidden);

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
    if (S.modal === 'mate') mateSheet(true);
    if (S.modal === 'admin') adminPanel(true);
  }

  // Команда соперников одной плашкой: общее здоровье, все базы обоих, одна кнопка атаки
  function teamCardHTML(C, p, mobile) {
    const { g, r, myTurn, blocked, colorOf } = C;
    const members = teamOf(C, p);
    const alive = members.filter((m) => m.alive);
    const target = alive[0] || p;
    const hp = Math.max(0, p.authority);
    const hit = S.prevAuth[p.id] !== undefined && p.authority < S.prevAuth[p.id];
    const isTurn = members.some((m) => (g.active || []).includes(m.id));
    const combat = g.pool.combat;
    const canAtk = myTurn && !blocked && alive.length && combat > 0 && !C.hasOutpost(p);
    const bases = [];
    for (const m of alive) for (const b of m.bases) bases.push({ m, b });
    const anyBaseTarget = bases.some(({ m, b }) => canAttackBase(C, m, b));
    const memberLine = (m) => {
      const mm = r.members.find((x) => x.id === m.id);
      return `<span class="tm-mem ${m.alive ? '' : 'out'}"><span class="avatar xs" style="--pc:${colorOf(m.id)}">${esc(initial(m.name))}</span>${esc(m.name)}${mm && mm.bot ? ' <span class="tag-s bot">бот</span>' : ''}${mm && !mm.connected ? ' <span class="tag-s muted">офлайн</span>' : ''}
        ${m.alive ? `<span class="muted small">рука ${m.handCount} · <button class="lnk" data-act="view-discard" data-pid="${m.id}">сброс ${m.discard.length}</button></span>${m.pendingDiscard ? ` <span class="tag-s warn">сбросит ${m.pendingDiscard}</span>` : ''}` : '<span class="muted small">вышел</span>'}</span>`;
    };
    if (mobile) {
      return `<button class="opp-chip team ${isTurn ? 'turn' : ''} ${alive.length ? '' : 'dead'} ${hit ? 'hit' : ''} ${canAtk || anyBaseTarget ? 'target' : ''}" style="--pc:${colorOf(p.id)}" data-act="opp-sheet" data-pid="${target.id}">
        <span class="oc-body"><span class="oc-name">Команда: ${teamTitle(C, p)}</span>
        <span class="oc-meta">${alive.length ? `<span class="hp ${hp <= 10 ? 'low' : ''}">${I.auth}${hp}</span><span>баз ${bases.length}${C.hasOutpost(p) ? ' 🛡' : ''}</span>` : 'выбыла'}</span></span>
        ${canAtk || anyBaseTarget ? '<span class="oc-atk">⚔</span>' : ''}</button>`;
    }
    const bHTML = alive.flatMap((m) => stacks(m.bases).map(({ all }) => {
      const b = all[0];
      const can = canAttackBase(C, m, b);
      return cardHTML(b, { size: 'mini', cls: can ? 'targetable' : '', attrs: `data-zone="oppbase" data-owner="${m.id}" ${can ? `data-act="atkbase" data-target="${m.id}"` : ''}`, badge: `<span class="owner-tag">${esc(m.name)}</span>` + stackBadge(all.length) });
    })).join('') + alive.map((m) => heroesHTML(m.heroes, 'mini', 'opphero', m.name)).join('');
    return `<div class="opp team-card ${isTurn ? 'turn' : ''} ${alive.length ? '' : 'dead'} ${hit ? 'hit' : ''} ${canAtk ? 'atk-target' : ''}" style="--pc:${colorOf(p.id)}" ${canAtk ? `data-act="atkplayer" data-target="${target.id}" title="Нажмите, чтобы атаковать команду"` : ''}>
      <div class="opp-head g2 noav"><div class="nm-line"><b>Соперники</b></div>
        <div class="hp-badge ${hp <= 10 ? 'low' : ''}" title="Здоровье команды">${hp}</div>
        <div class="opp-meta">${alive.length ? `баз ${bases.length}${C.hasOutpost(p) ? ' · 🛡' : ''}` : 'выбыла'}</div>
        ${alive.length && canAtk ? `<div class="atk"><span class="atk-hint">⚔ атаковать</span></div>` : ''}</div>
      <div class="tm-list">${members.map(memberLine).join('')}</div>
      ${alive.length ? `${bHTML ? `<div class="zl">Базы команды${C.hasOutpost(p) ? ' · <span class="tag-s">🛡 аванпост защищает команду</span>' : ''}</div>
        <div class="opp-bases">${bHTML}</div>` : ''}
        ${!canAtk && C.hasOutpost(p) && myTurn && combat > 0 ? '<div class="muted small">Сначала уничтожьте аванпост</div>' : ''}`
      : `<div class="muted">команда выбыла${p.place ? ` · ${p.place} место` : ''}</div>`}
    </div>`;
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
    const und = g.undoable || [];
    if (und.length && pr.purpose !== 'discard') {
      const last = und[und.length - 1];
      body += `<div class="m-actions undo-row"><button class="btn ghost" data-act="undo" data-uid="${last}">Отменить — вернуть карту в руку</button></div>`;
    }
    openModal(`<h3>${esc(pr.text)}</h3>${body}`, { kind: 'prompt', locked: true, cls: 'wide', sheet: isMobile() });
  }

  function renderGameOver(g, host) {
    const ranked = [...g.players].sort((a, b) => (a.place || 99) - (b.place || 99));
    const win = g.players.find((p) => p.id === g.winner);
    const ws = (g.winners || []).map((id) => g.players.find((p) => p.id === id)).filter(Boolean);
    let title = win ? (win.id === S.pid ? 'Вы победили' : `Победил ${esc(win.name)}`) : 'Ничья';
    if (g.mode === 'teams' && ws.length) title = ws.some((p) => p.id === S.pid) ? 'Ваша команда победила' : `Победила команда ${ws.map((p) => esc(p.name)).join(' и ')}`;
    openModal(`<div class="go"><div class="sec-title">Партия окончена</div>
      <h2>${title}</h2>
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
    if (zone === 'myhero') return `<button class="btn primary" data-act="scrap" data-uid="${uid}">⚔ Отправить в бой</button>`;
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
    const members = C.teams ? teamOf(C, p).filter((m) => m.alive) : [p];
    const target = members[0] || p;
    const canAtk = C.myTurn && !C.blocked && target.alive && C.g.pool.combat > 0 && !C.hasOutpost(p);
    const bases = members.flatMap((m) => stacks(m.bases).map(({ all }) => {
      const b = all[0];
      const can = canAttackBase(C, m, b);
      return `<div class="ob">${cardHTML(b, { size: 'sm', attrs: `data-zone="oppbase" data-owner="${m.id}"`, badge: (C.teams ? `<span class="owner-tag">${esc(m.name)}</span>` : '') + stackBadge(all.length) })}${can ? `<button class="btn danger sm" data-act="atkbase" data-target="${m.id}" data-uid="${b.uid}">Уничтожить (${CARDS[b.cid].defense})</button>` : ''}</div>`;
    })).join('');
    const stats = members.map((m) => `<span>${C.teams ? `<b>${esc(m.name)}</b>: ` : ''}в руке ${m.handCount} · в колоде ${m.deckCount} · <button class="lnk" data-act="view-discard" data-pid="${m.id}">сброс ${m.discard.length}</button></span>`).join('');
    const html = `<h3>${C.teams ? 'Команда: ' + teamTitle(C, p) : esc(p.name)}</h3>
      <div class="os-stats"><span>${I.auth} здоровье${C.teams ? ' команды' : ''} <b>${Math.max(0, p.authority)}</b></span>${stats}</div>
      ${C.hasOutpost(p) ? `<p class="muted">Защищён аванпостом${C.teams ? ' команды' : ''}: сначала уничтожьте аванпост, потом можно атаковать ${C.teams ? 'команду' : 'игрока'} и другие базы.</p>` : ''}
      <div class="sec-title">Базы</div><div class="ob-grid">${bases || '<span class="none">Нет баз</span>'}</div>
      ${members.some((m) => (m.heroes || []).length) ? `<div class="sec-title">Герои</div><div class="ob-grid">${members.map((m) => heroesHTML(m.heroes, 'sm', 'opphero', C.teams ? m.name : null)).join('')}</div>` : ''}
      ${canAtk ? `<div class="m-actions"><button class="btn danger big" data-act="atkplayer" data-target="${target.id}">Атаковать${C.teams ? ' команду' : ''} (${Math.min(C.g.pool.combat, target.authority)} урона)</button></div>` : ''}`;
    if (refresh && $('.modal.opp-modal')) { $('.modal.opp-modal').innerHTML = '<button class="x" data-act="close-modal">×</button>' + html; return; }
    openModal(html, { kind: 'opp', cls: 'opp-modal', sheet: true });
  }

  function showDeck() {
    const me = S.room.game.players.find((p) => p.id === S.pid);
    const list = me.deckList || [];
    const counts = {};
    for (const cid of list) counts[cid] = (counts[cid] || 0) + 1;
    const ids = Object.keys(counts).sort((a, b) => (CARDS[b].cost - CARDS[a].cost) || CARDS[a].name.localeCompare(CARDS[b].name));
    openModal(`<h3>Ваша колода — ${cardsWord(list.length)}</h3>
      <p class="muted">Показан состав колоды без порядка — какая карта придёт следующей, не видно. Сыгранные и купленные в этот ход карты лежат в сбросе.</p>
      <div class="pick-grid">${ids.map((cid) => `<div class="pick">${cardHTML({ cid }, { size: 'sm', badge: counts[cid] > 1 ? `<span class="count-badge">×${counts[cid]}</span>` : '' })}</div>`).join('') || '<div class="empty">Колода пуста — при следующем доборе перемешается сброс.</div>'}</div>`, { kind: 'deck', cls: 'wide', sheet: isMobile() });
  }

  function mateSheet(refresh) {
    const C = ctx();
    const p = C.mate;
    if (!p) return;
    const hand = (p.hand || []).map((c) => cardHTML(c, { size: 'sm', attrs: 'data-zone="matehand"' })).join('');
    const bases = stacks(p.bases).map(({ all }) => cardHTML(all[0], { size: 'sm', attrs: 'data-zone="matebase"', badge: stackBadge(all.length) })).join('') + heroesHTML(p.heroes, 'sm', 'matehero');
    const html = `<h3>${esc(p.name)} — напарник</h3>
      <div class="os-stats"><span>в колоде ${p.deckCount}</span><button class="lnk" data-act="view-discard" data-pid="${p.id}">сброс ${p.discard.length}</button>${(C.g.ready || []).includes(p.id) ? '<span class="ok">готов завершить ход</span>' : ''}</div>
      <div class="sec-title">Рука</div><div class="ob-grid">${hand || '<span class="none">Пусто</span>'}</div>
      <div class="sec-title">Базы</div><div class="ob-grid">${bases || '<span class="none">Нет баз</span>'}</div>`;
    if (refresh && $('.modal.opp-modal')) { $('.modal.opp-modal').innerHTML = '<button class="x" data-act="close-modal">×</button>' + html; return; }
    openModal(html, { kind: 'mate', cls: 'opp-modal', sheet: true });
  }

  function adminLogin() {
    openModal(`<h3>Режим админа</h3><p class="muted">Для проверок: меняет здоровье, деньги и урон — свои и других игроков.</p>
      <form id="adm-form" class="adm-form"><input id="adm-pass" type="password" autocomplete="current-password" placeholder="Пароль"><button class="btn primary">Войти</button></form>`, { kind: 'admin-login' });
    const f = $('#adm-form');
    f.addEventListener('submit', (e) => { e.preventDefault(); send({ t: 'adminLogin', password: $('#adm-pass').value }); });
    setTimeout(() => $('#adm-pass') && $('#adm-pass').focus(), 50);
  }

  function adminPanel(refresh) {
    const g = S.room && S.room.game;
    if (!g) { closeModal(); toast('Режим админа включён — значения можно менять во время партии'); return; }
    const C = ctx();
    if (!S.admTarget || !g.players.some((p) => p.id === S.admTarget)) S.admTarget = C.me ? C.me.id : g.players[0].id;
    const t = g.players.find((p) => p.id === S.admTarget);
    const active = (g.active || []).includes(t.id) && !g.over;
    // при обновлении стола окно не перерисовываем, чтобы не сбить ввод — только если сменилось, чей ход
    if (refresh) { if (S.admActive !== active) adminPanel(); return; }
    S.admActive = active;
    const teams = g.mode === 'teams';
    const who = (p) => (p.id === S.pid ? 'Вы' : p.name);
    const num = (id, label, val, dis) => `<label class="adm-row"><span>${label}</span><span class="stepper sm"><button type="button" class="btn" data-adm="${id}" data-d="-1" ${dis ? 'disabled' : ''}>−</button><input id="${id}" type="number" min="0" max="9999" value="${val}" ${dis ? 'disabled' : ''}><button type="button" class="btn" data-adm="${id}" data-d="1" ${dis ? 'disabled' : ''}>+</button></span></label>`;
    const tabs = [...g.players].sort((a, b) => (b.id === S.pid) - (a.id === S.pid)).map((p) => `<button type="button" class="seg ${p.id === t.id ? 'on' : ''}" data-adm-target="${p.id}" ${p.alive ? '' : 'disabled'}>${esc(who(p))}</button>`).join('');
    openModal(`<h3>Режим админа</h3>
      <form id="adm-set" class="adm-set">
        <div class="adm-row adm-who"><span>Игрок</span></div>
        <div class="segs adm-targets">${tabs}</div>
        ${num('adm-hp', teams ? `Здоровье команды (${esc(g.players.filter((p) => p.team === t.team).map(who).join(' и '))})` : 'Здоровье', Math.max(0, t.authority), !t.alive)}
        ${num('adm-trade', 'Деньги', active ? (g.purse || {})[t.id] || 0 : 0, !active)}
        ${num('adm-combat', teams ? 'Урон команды' : 'Урон', active ? g.pool.combat : 0, !active)}
        <p class="muted small" id="adm-turn">${active ? '' : `Деньги и урон можно менять, только когда ${t.id === S.pid ? 'ваш ход' : `ходит ${esc(t.name)}`}.`}</p>
        <div class="m-actions"><button type="button" class="btn" data-act="close-modal">Закрыть</button><button class="btn primary">Применить</button></div>
      </form>`, { kind: 'admin' });
    $('#adm-set').addEventListener('click', (e) => {
      const tg = e.target.closest('[data-adm-target]');
      if (tg) { S.admTarget = tg.dataset.admTarget; adminPanel(); return; }
      const b = e.target.closest('[data-adm]'); if (!b) return;
      const inp = $('#' + b.dataset.adm); inp.value = Math.max(0, (+inp.value || 0) + (+b.dataset.d));
    });
    $('#adm-set').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = {};
      if (!$('#adm-hp').disabled) v.hp = +$('#adm-hp').value;
      if (!$('#adm-trade').disabled) { v.trade = +$('#adm-trade').value; v.combat = +$('#adm-combat').value; }
      send({ t: 'adminSet', target: t.id, values: v });
      toast(t.id === S.pid ? 'Значения изменены' : `Значения изменены: ${t.name}`);
    });
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
    const max = Math.min(g.pool.combat, Math.max(1, p.authority));
    const teamName = g.mode === 'teams' ? 'команду ' + g.players.filter((x) => x.team === p.team).map((x) => esc(x.name)).join(' и ') : esc(p.name);
    const left = g.pool.combat - max;
    openModal(`<h3>Атаковать ${teamName}</h3><p class="muted">Здоровье ${g.mode === 'teams' ? 'команды' : 'соперника'} — ${p.authority}. У вас ${g.pool.combat} урона${left > 0 ? `; чтобы добить, хватит ${max}, остальное (${left}) останется у вас` : ''}.</p>
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
    const C = ctx();
    if (g.pool.combat > 0 && g.players.some((p) => p.alive && C.isEnemy(p))) warn.push(`не потрачен урон (${g.pool.combat})`);
    if (C.teams && C.mate && C.mate.alive) warn.push(`ход перейдёт, когда ${C.mate.name} тоже нажмёт «Завершить ход»`);
    const cheapest = Math.min(...g.row.filter(Boolean).map((c) => CARDS[c.cid].cost), g.explorers ? 2 : 99);
    if (g.pool.trade >= cheapest) warn.push(`остались деньги (${g.pool.trade}) — можно купить карту`);
    if (!warn.length || (warn.length === 1 && C.teams && C.mate && C.mate.alive)) return act({ type: 'endTurn' });
    confirmBox(`Завершить ход?<small class="warn-list">${warn.map((w) => '• ' + esc(w)).join('<br>')}</small>`, 'Завершить ход', () => act({ type: 'endTurn' }));
  }

  function showMenu() {
    const g = S.room.game;
    const me = g.players.find((p) => p.id === S.pid);
    openModal(`<h3>Меню</h3><div class="menu-list">
      <button class="btn" data-act="toggle-hints">${S.hints ? 'Подсказки: включены' : 'Подсказки: выключены'}</button>
      <button class="btn" data-act="toggle-sound">${S.sound ? 'Звук начала хода: включён' : 'Звук начала хода: выключен'}</button>
      <button class="btn" data-act="copy-link">Скопировать ссылку на стол</button>
      <button class="btn" data-act="tutorial">Как сделать ход</button>
      ${isStandalone() ? '' : '<button class="btn" data-act="install">Добавить значок на экран</button>'}
      <button class="btn ghost" data-act="admin">${S.room.admin ? 'Режим админа (включён)' : 'Режим админа'}</button>
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
    if (card && !card.closest('.modal') && (!el || el === card || (el.contains(card) && el.dataset.act === 'atkplayer'))) {
      const zone = card.dataset.zone;
      const direct = el === card && (zone === 'hand' || (!isTouch && (zone === 'row' || zone === 'oppbase')));
      if (!direct) { cardModal(card); return; }
    }
    if (!el) return;
    const a = el.dataset.act, d = el.dataset;
    switch (a) {
      case 'create': if (!needName()) send({ t: 'create', name: S.name }); break;
      case 'create-bot': if (!needName()) { S.autoBot = true; send({ t: 'create', name: S.name }); } break;
      case 'add-bot': send({ t: 'addBot' }); break;
      case 'join': doJoin($('#h-code').value); break;
      case 'join-code': doJoin(d.code); break;
      case 'leave': closeModal(); send({ t: 'leave' }); break;
      case 'set': {
        let v = d.v; if (v === 'true') v = true; else if (v === 'false') v = false; else if (/^\d+$/.test(v) && d.k !== 'deckSize' && d.k !== 'turnTime') v = +v;
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
      case 'install': installApp(); break;
      case 'toggle-hints': S.hints = !S.hints; store.set('sd_hints', S.hints ? '1' : '0'); closeModal(); render(); toast(S.hints ? 'Подсказки включены' : 'Подсказки выключены — включить можно в меню'); break;
      case 'toggle-sound': S.sound = !S.sound; store.set('sd_sound', S.sound ? '1' : '0'); showMenu(); break;
      case 'forfeit': confirmBox('Сдаться и выйти из партии?', 'Сдаться', () => act({ type: 'forfeit' }), true); break;
      case 'tolobby': closeModal(); send({ t: 'toLobby' }); break;
      case 'show-go': renderGameOver(S.room.game, S.room.hostId === S.pid); break;
      case 'close-modal': if (S.modal !== 'prompt') { closeModal(); S.oppSheet = null; } break;
      case 'close-modal-bg': if (e.target === el) { closeModal(); S.oppSheet = null; } break;
      case 'play': if (S.modal === 'card') closeModal(); act({ type: 'play', uid: d.uid }); break;
      case 'playall': act({ type: 'playAll' }); break;
      case 'undo': e.stopPropagation(); if (S.modal === 'prompt') answered(); else if (S.modal === 'card') closeModal(); act({ type: 'undo', uid: d.uid }); break;
      case 'buy': if (S.modal === 'card') closeModal(); act({ type: 'buy', slot: d.slot === 'explorer' ? 'explorer' : +d.slot }); break;
      case 'scrap': e.stopPropagation(); if (S.modal === 'card') closeModal(); act({ type: 'scrap', uid: d.uid }); break;
      case 'activate': e.stopPropagation(); if (S.modal === 'card') closeModal(); act({ type: 'activate', uid: d.uid }); break;
      case 'atkbase': if (S.modal === 'card') closeModal(); act({ type: 'attackBase', target: d.target, uid: d.uid }); break;
      case 'atkplayer': {
        S.oppSheet = null;
        const g = S.room.game, t = g.players.find((x) => x.id === d.target);
        const enemyTeams = new Set(g.players.filter((x) => x.alive && x.team !== (g.players.find((m) => m.id === S.pid) || {}).team).map((x) => x.team));
        // один соперник (или одна команда) — бьём сразу всем нужным уроном; несколько — спросим, сколько
        if (t && enemyTeams.size === 1) { if (S.modal) closeModal(); act({ type: 'attackPlayer', target: t.id, amount: Math.min(g.pool.combat, Math.max(1, t.authority)) }); }
        else attackModal(d.target);
        break;
      }
      case 'opp-sheet': oppSheet(d.pid); break;
      case 'endturn': endTurnCheck(); break;
      case 'view-discard': showDiscard(d.pid); break;
      case 'view-deck': showDeck(); break;
      case 'mate-sheet': mateSheet(); break;
      case 'unready': act({ type: 'unready' }); break;
      case 'team': send({ t: 'team', pid: d.pid, team: d.team }); break;
      case 'admin': if (S.room.admin) adminPanel(); else adminLogin(); break;
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
      case 'hide-side': S.sideHidden = !S.sideHidden; store.set('sd_side_hidden', S.sideHidden ? '1' : ''); if (!S.sideHidden) markChatSeen(); render(); break;
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

  // обратный отсчёт времени хода
  function tickTimer() {
    const els = $$('.turn-timer');
    if (!els.length) return;
    const left = S.deadline ? Math.max(0, Math.ceil((S.deadline - Date.now()) / 1000)) : null;
    const txt = left == null ? '' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    for (const el of els) { el.textContent = txt; el.classList.toggle('low', left != null && left <= 10); }
  }
  setInterval(tickTimer, 500);

  // бесплатный сервер засыпает через 15 минут без запросов — пока вы за столом, страница его будит
  setInterval(() => { if (S.room) fetch('/health', { cache: 'no-store' }).catch(() => {}); }, 4 * 60 * 1000);

  // ── значок на экране (приложение) ──
  function isStandalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });
  window.addEventListener('appinstalled', () => { S.installEvt = null; toast('Значок добавлен — игру можно открывать с экрана'); });
  function installApp() {
    if (S.installEvt) { const e = S.installEvt; S.installEvt = null; closeModal(); e.prompt(); return; }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    openModal(`<h3>Значок на экране</h3>
      <p>Игра откроется как приложение — во весь экран, без адресной строки.</p>
      <ul class="inst">
        ${ios ? '<li><b>iPhone / iPad (Safari):</b> кнопка «Поделиться» внизу → «На экран „Домой“» → «Добавить».</li>' : ''}
        <li><b>Android (Chrome):</b> меню ⋮ справа вверху → «Добавить на главный экран» или «Установить приложение».</li>
        ${ios ? '' : '<li><b>iPhone (Safari):</b> «Поделиться» → «На экран „Домой“».</li>'}
        <li><b>Ноутбук (Chrome, Edge, Яндекс):</b> значок установки справа в адресной строке или меню ⋮ → «Установить Звёздные Державы».</li>
      </ul>`, { kind: 'install', sheet: isMobile() });
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  connect();
})();
