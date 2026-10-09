'use strict';
/* Движок правил. Сервер — единственный источник правды: клиенты присылают действия,
 * движок проверяет их и меняет состояние. Каждый игрок получает свою «проекцию»
 * состояния (чужие руки скрыты).
 */
const { CARDS } = require('../public/cards.js');

let UID = 1;
const mk = (cid) => ({ uid: 'c' + (UID++).toString(36), cid });
const clean = (c) => ({ uid: c.uid, cid: c.cid });
const def = (c) => CARDS[c.copied || c.cid];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

// Эффекты, которые база выполняет сама в начале хода владельца (не требуют решений о моменте)
const AUTO_KEYS = new Set(['trade', 'combat', 'auth', 'draw', 'topNext', 'opDiscard']);
const isAuto = (effects) => effects.every((e) => AUTO_KEYS.has(Object.keys(e)[0]));

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
const cardsWord = (n) => `${n} ${plural(n, 'карту', 'карты', 'карт')}`;

class Game {
  constructor(players, settings) {
    this.settings = Object.assign({ authority: 50, randomOrder: true }, settings);
    const order = this.settings.randomOrder ? shuffle(players.slice()) : players.slice();
    this.players = order.map((p) => ({
      id: p.id, name: p.name, authority: this.settings.authority,
      deck: [], hand: [], discard: [], inPlay: [], bases: [],
      pendingDiscard: 0, alive: true, place: null,
    }));

    this.tradeDeck = [];
    for (const c of Object.values(CARDS)) for (let i = 0; i < c.count; i++) this.tradeDeck.push(mk(c.id));
    shuffle(this.tradeDeck);
    this.row = [];
    for (let i = 0; i < 5; i++) this.row.push(this.tradeDeck.pop() || null);
    this.explorers = 10;

    this.log = [];
    this.turnIdx = 0;
    this.turnNo = 0;
    this.pool = { trade: 0, combat: 0 };
    this.topNext = 0;
    this.queue = [];
    this.prompt = null;
    this.promptSrc = null;
    this.over = false;
    this.winner = null;
    this.lastEvent = null;
    this.revealSeq = 0;
    this.undoStack = [];

    // Размер стартовой руки: 2 игрока — 3/5; больше — 3/4/5/5…
    const n = this.players.length;
    this.players.forEach((p, i) => {
      for (let k = 0; k < 8; k++) p.deck.push(mk('scout'));
      for (let k = 0; k < 2; k++) p.deck.push(mk('viper'));
      shuffle(p.deck);
      const size = n === 2 ? [3, 5][i] : [3, 4, 5, 5, 5, 5][i];
      this.draw(p, size);
    });
    this.addLog(`Партия началась! Стартовое здоровье: ${this.settings.authority}. Первым ходит ${this.players[0].name}.`, 'sys');
    this.startTurn();
  }

  // ── утилиты ──
  addLog(text, kind = '') { this.log.push({ text, kind, t: Date.now() }); if (this.log.length > 300) this.log.shift(); }
  cur() { return this.players[this.turnIdx]; }
  pl(id) { return this.players.find((p) => p.id === id); }
  opponents() { const me = this.cur(); return this.players.filter((p) => p.alive && p !== me); }
  inPlayAll(p = this.cur()) { return [...p.inPlay, ...p.bases]; }

  factions(c) {
    const s = new Set([def(c).faction]);
    if (c.copied) s.add(CARDS[c.cid].faction);
    s.delete('none');
    return s;
  }

  draw(p, n) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (!p.deck.length) {
        if (!p.discard.length) break;
        p.deck = shuffle(p.discard.map(clean));
        p.discard = [];
      }
      p.hand.push(p.deck.pop());
      got++;
    }
    if (got) this.revealSeq++;
    return got;
  }

  hasAlly(c) {
    const others = this.inPlayAll().filter((o) => o !== c);
    if (others.some((o) => def(o).allAlly)) return true;
    for (const f of this.factions(c)) if (others.some((o) => this.factions(o).has(f))) return true;
    return false;
  }

  findAlly() {
    for (const c of this.inPlayAll()) {
      if (def(c).ally.length && !(c.used && c.used.ally) && this.hasAlly(c)) return c;
    }
    return null;
  }

  enqueueFront(effects, src) { this.queue.unshift(...effects.map((e) => ({ e, src }))); }

  // Выполняет очередь эффектов; останавливается, если нужен выбор игрока.
  process() {
    let guard = 0;
    while (!this.prompt && !this.over && guard++ < 1000) {
      if (this.queue.length) {
        const it = this.queue.shift();
        this.resolve(it.e, it.src);
        continue;
      }
      const a = this.findAlly();
      if (!a) break;
      a.used = a.used || {};
      a.used.ally = true;
      this.addLog(`Союзная способность: «${def(a).name}»`, 'ally');
      this.enqueueFront(def(a).ally, a);
    }
  }

  setPrompt(pr, src) { this.prompt = pr; this.promptSrc = src || null; }

  resolve(e, src) {
    const p = this.cur();
    const k = Object.keys(e)[0];
    const v = e[k];
    const srcName = src ? `«${def(src).name}»` : '';
    switch (k) {
      case 'trade': this.pool.trade += v; break;
      case 'combat': this.pool.combat += v; break;
      case 'auth': p.authority += v; this.addLog(`${p.name} восстанавливает ${v} здоровья (${p.authority})`, 'auth'); break;
      case 'draw': { const g = this.draw(p, v); if (g) this.addLog(`${p.name} берёт ${cardsWord(g)}`); break; }
      case 'opDiscard': {
        const ops = this.opponents();
        if (ops.length === 1) { ops[0].pendingDiscard += v; this.addLog(`${ops[0].name} сбросит карту в начале своего хода`, 'warn'); }
        else if (ops.length > 1) this.setPrompt({ kind: 'opponent', purpose: 'discard', n: v, text: `${srcName}: выберите соперника — он сбросит карту в начале своего хода`, options: ops.map((o) => o.id) }, src);
        break;
      }
      case 'scrapRow': {
        const cards = this.row.filter(Boolean).map((c) => ({ ...clean(c), zone: 'row' }));
        if (cards.length) this.setPrompt({ kind: 'pick', purpose: 'scrapRow', min: 0, max: v, cards, text: `${srcName}: можете утилизировать карту из торгового ряда` }, src);
        break;
      }
      case 'scrapHD': {
        const cards = [...p.hand.map((c) => ({ ...clean(c), zone: 'hand' })), ...p.discard.map((c) => ({ ...clean(c), zone: 'discard' }))];
        if (cards.length) this.setPrompt({ kind: 'pick', purpose: 'scrapHD', min: 0, max: v, cards, text: `${srcName}: можете утилизировать карту из руки или сброса` }, src);
        break;
      }
      case 'destroyBase': {
        const cards = [];
        for (const o of this.opponents()) for (const b of o.bases) cards.push({ ...clean(b), zone: 'base', owner: o.id });
        if (cards.length) this.setPrompt({ kind: 'pick', purpose: 'destroyBase', min: 0, max: 1, cards, text: `${srcName}: можете уничтожить любую базу соперника` }, src);
        break;
      }
      case 'choose':
        this.setPrompt({ kind: 'choose', options: v, text: `${srcName}: выберите одно` }, src);
        break;
      case 'topNext':
        this.topNext += 1;
        this.addLog(`Следующий купленный в этот ход корабль ляжет на верх колоды`);
        break;
      case 'freeShip': {
        const cards = this.row.filter((c) => c && def(c).type === 'ship').map((c) => ({ ...clean(c), zone: 'row' }));
        if (this.explorers > 0) cards.push({ uid: 'explorer', cid: 'explorer', zone: 'explorer' });
        if (cards.length) this.setPrompt({ kind: 'pick', purpose: 'freeShip', min: 0, max: 1, cards, text: `${srcName}: возьмите любой корабль бесплатно — он ляжет на верх колоды` }, src);
        break;
      }
      case 'yacht':
        if (p.bases.length >= 2) { const g = this.draw(p, 2); this.addLog(`${p.name} берёт ${cardsWord(g)} (2+ базы)`); }
        break;
      case 'blobDraw': {
        const n = p.inPlay.filter((c) => this.factions(c).has('blob')).length +
          p.bases.filter((c) => c.playedTurn === this.turnNo && this.factions(c).has('blob')).length;
        const g = this.draw(p, n);
        this.addLog(`${p.name} берёт ${cardsWord(g)} за карты Роя`);
        break;
      }
      case 'recycle':
        if (p.hand.length) this.setPrompt({ kind: 'pick', purpose: 'recycle', min: 0, max: v, cards: p.hand.map((c) => ({ ...clean(c), zone: 'hand' })), text: `${srcName}: сбросьте до ${cardsWord(v)} — затем возьмёте столько же` }, src);
        break;
      case 'machineBase':
        this.draw(p, 1);
        if (p.hand.length) this.setPrompt({ kind: 'pick', purpose: 'scrapHand', min: 1, max: 1, cards: p.hand.map((c) => ({ ...clean(c), zone: 'hand' })), text: `${srcName}: вы взяли карту — теперь утилизируйте одну карту из руки` }, src);
        break;
      case 'brain': {
        const cards = [...p.hand.map((c) => ({ ...clean(c), zone: 'hand' })), ...p.discard.map((c) => ({ ...clean(c), zone: 'discard' }))];
        if (cards.length) this.setPrompt({ kind: 'pick', purpose: 'brain', min: 0, max: v, cards, text: `${srcName}: утилизируйте до ${cardsWord(v)} из руки или сброса — возьмёте столько же` }, src);
        break;
      }
      case 'copy': {
        const cards = p.inPlay.filter((c) => c !== src && !(c.cid === 'm_needle' && !c.copied)).map((c) => ({ uid: c.uid, cid: c.copied || c.cid, zone: 'play' }));
        if (cards.length) this.setPrompt({ kind: 'pick', purpose: 'copy', min: 0, max: 1, cards, text: `${srcName}: выберите корабль для копирования` }, src);
        else this.addLog(`«Мимикр»: нечего копировать`);
        break;
      }
      case 'startDiscard':
        this.setPrompt({ kind: 'pick', purpose: 'discard', min: v, max: v, cards: p.hand.map((c) => ({ ...clean(c), zone: 'hand' })), text: `Соперник заставил вас сбросить ${cardsWord(v)}. Выберите, что сбросить` }, null);
        break;
      default:
        break;
    }
  }

  removeFromHandOrDiscard(p, uid) {
    let i = p.hand.findIndex((c) => c.uid === uid);
    if (i >= 0) return { card: p.hand.splice(i, 1)[0], zone: 'руки' };
    i = p.discard.findIndex((c) => c.uid === uid);
    if (i >= 0) return { card: p.discard.splice(i, 1)[0], zone: 'сброса' };
    return null;
  }

  refillRow(i) { this.row[i] = this.tradeDeck.pop() || null; this.revealSeq++; }

  handlePick(pr, uids) {
    const p = this.cur();
    const src = this.promptSrc;
    switch (pr.purpose) {
      case 'scrapRow':
        for (const uid of uids) {
          const i = this.row.findIndex((c) => c && c.uid === uid);
          if (i < 0) continue;
          this.addLog(`${p.name} утилизирует «${def(this.row[i]).name}» из торгового ряда`, 'scrap');
          this.refillRow(i);
        }
        break;
      case 'scrapHD': case 'scrapHand': case 'brain': {
        let n = 0;
        for (const uid of uids) {
          const r = this.removeFromHandOrDiscard(p, uid);
          if (!r) continue;
          n++;
          if (r.card.cid === 'explorer') this.explorers++;
          this.addLog(`${p.name} утилизирует «${def(r.card).name}» из ${r.zone}`, 'scrap');
        }
        if (pr.purpose === 'brain' && n) { const g = this.draw(p, n); this.addLog(`${p.name} берёт ${cardsWord(g)}`); }
        break;
      }
      case 'destroyBase':
        for (const uid of uids) {
          for (const o of this.opponents()) {
            const i = o.bases.findIndex((b) => b.uid === uid);
            if (i < 0) continue;
            const b = o.bases.splice(i, 1)[0];
            o.discard.push(clean(b));
            this.addLog(`${p.name} уничтожает базу «${def(b).name}» игрока ${o.name}`, 'attack');
            this.lastEvent = { type: 'baseDestroyed', target: o.id, uid };
          }
        }
        break;
      case 'freeShip':
        for (const uid of uids) {
          let card;
          if (uid === 'explorer') { this.explorers--; card = mk('explorer'); }
          else {
            const i = this.row.findIndex((c) => c && c.uid === uid);
            if (i < 0) continue;
            card = this.row[i];
            this.refillRow(i);
          }
          p.deck.push(clean(card));
          this.addLog(`${p.name} бесплатно получает «${def(card).name}» на верх колоды`, 'buy');
        }
        break;
      case 'recycle': case 'discard': {
        let n = 0;
        for (const uid of uids) {
          const i = p.hand.findIndex((c) => c.uid === uid);
          if (i < 0) continue;
          const c = p.hand.splice(i, 1)[0];
          p.discard.push(c);
          n++;
          this.addLog(`${p.name} сбрасывает «${def(c).name}»`);
        }
        if (pr.purpose === 'recycle' && n) { const g = this.draw(p, n); this.addLog(`${p.name} берёт ${cardsWord(g)}`); }
        break;
      }
      case 'copy':
        if (uids.length && src) {
          const t = p.inPlay.find((c) => c.uid === uids[0]);
          if (t) {
            src.copied = t.copied || t.cid;
            src.used = { primary: true };
            this.addLog(`«Мимикр» копирует «${CARDS[src.copied].name}»`);
            this.enqueueFront(def(src).primary, src);
          }
        }
        break;
      default: break;
    }
  }

  // ── ходы ──
  startTurn() {
    const p = this.cur();
    this.turnNo++;
    this.pool = { trade: 0, combat: 0 };
    this.topNext = 0;
    this.addLog(`Ход игрока ${p.name}`, 'turn');
    if (p.pendingDiscard > 0) {
      const n = Math.min(p.pendingDiscard, p.hand.length);
      p.pendingDiscard = 0;
      if (n > 0) this.queue.push({ e: { startDiscard: n }, src: null });
    }
    for (const b of p.bases) {
      b.used = {};
      const prim = def(b).primary;
      if (isAuto(prim)) { b.used.primary = true; this.queue.push(...prim.map((e) => ({ e, src: b }))); }
    }
    this.process();
  }

  nextAlive() {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.turnIdx + k) % n;
      if (this.players[i].alive) return i;
    }
    return this.turnIdx;
  }

  endTurn() {
    const p = this.cur();
    p.discard.push(...p.hand.map(clean), ...p.inPlay.map(clean));
    p.hand = [];
    p.inPlay = [];
    for (const b of p.bases) b.used = {};
    this.draw(p, 5);
    this.queue = [];
    this.prompt = null;
    this.promptSrc = null;
    this.turnIdx = this.nextAlive();
    this.startTurn();
  }

  eliminate(t, reason) {
    if (!t.alive) return;
    t.alive = false;
    t.place = this.players.filter((p) => p.alive).length + 1;
    this.addLog(reason || `${t.name} выбывает из игры!`, 'dead');
    const alive = this.players.filter((p) => p.alive);
    if (alive.length <= 1) {
      this.over = true;
      this.winner = alive[0] ? alive[0].id : null;
      if (alive[0]) { alive[0].place = 1; this.addLog(`🏆 Победитель — ${alive[0].name}!`, 'win'); }
    }
  }

  // Игрок сдался / был удалён хостом
  forfeit(pid) {
    const t = this.pl(pid);
    if (!t || !t.alive || this.over) return;
    const wasTurn = this.cur() === t;
    this.eliminate(t, `${t.name} покидает игру`);
    if (!this.over && wasTurn) {
      t.discard.push(...t.hand.map(clean), ...t.inPlay.map(clean));
      t.hand = []; t.inPlay = [];
      this.queue = []; this.prompt = null; this.promptSrc = null;
      this.turnIdx = this.nextAlive();
      this.startTurn();
    }
  }

  act(pid, a) {
    if (this.over) fail('Игра окончена');
    if (!a || typeof a.type !== 'string') fail('Неизвестное действие');
    if (a.type === 'forfeit') { this.forfeit(pid); return; }
    const p = this.cur();
    if (p.id !== pid) fail('Сейчас не ваш ход');
    if (this.prompt && a.type !== 'answer' && a.type !== 'undo') fail('Сначала завершите выбор');
    this.lastEvent = null;
    // покупка, атака, утилизация, база, конец хода — дальше отменять розыгрыш нельзя
    if (!['play', 'playAll', 'answer', 'undo'].includes(a.type)) this.undoStack = [];

    switch (a.type) {
      case 'play': this.play(p, a.uid); break;
      case 'playAll': {
        const uids = p.hand.map((c) => c.uid);
        for (const uid of uids) {
          if (this.prompt || this.over) break;
          if (p.hand.some((c) => c.uid === uid)) this.play(p, uid);
        }
        break;
      }
      case 'buy': this.buy(p, a.slot); break;
      case 'scrap': this.scrapAbility(p, a.uid); break;
      case 'activate': this.activate(p, a.uid); break;
      case 'attackBase': this.attackBase(p, a.target, a.uid); break;
      case 'attackPlayer': this.attackPlayer(p, a.target, a.amount); break;
      case 'answer': this.answer(p, a); break;
      case 'undo': this.undo(p, a.uid); break;
      case 'endTurn': this.endTurn(); break;
      default: fail('Неизвестное действие');
    }
  }

  snapshot(uid) {
    return {
      uid, revealSeq: this.revealSeq, logLen: this.log.length,
      data: JSON.parse(JSON.stringify({ players: this.players, row: this.row, tradeDeck: this.tradeDeck, explorers: this.explorers, pool: this.pool, topNext: this.topNext })),
    };
  }

  // Какие сыгранные карты сейчас можно вернуть в руку
  undoable() { return this.undoStack.filter((s) => s.revealSeq === this.revealSeq).map((s) => s.uid); }

  undo(p, uid) {
    const k = this.undoStack.findIndex((s) => s.uid === uid);
    if (k < 0) fail('Эту карту уже нельзя вернуть');
    const snap = this.undoStack[k];
    if (snap.revealSeq !== this.revealSeq) fail('Карту нельзя вернуть: после неё открылись новые карты');
    const returned = this.undoStack.slice(k).map((s) => s.uid);
    const names = returned.map((u) => { const c = [...p.inPlay, ...p.bases].find((x) => x.uid === u); return c ? `«${CARDS[c.cid].name}»` : null; }).filter(Boolean);
    Object.assign(this, snap.data);
    this.queue = []; this.prompt = null; this.promptSrc = null;
    this.log.length = Math.min(this.log.length, snap.logLen);
    this.undoStack = this.undoStack.slice(0, k);
    this.addLog(`${p.name} возвращает в руку ${names.join(', ')}`, 'sys');
  }

  play(p, uid) {
    const i = p.hand.findIndex((c) => c.uid === uid);
    if (i < 0) fail('Карты нет в руке');
    this.undoStack.push(this.snapshot(uid));
    const c = p.hand.splice(i, 1)[0];
    const d = def(c);
    c.used = {};
    if (d.type === 'base') {
      c.playedTurn = this.turnNo;
      p.bases.push(c);
      this.addLog(`${p.name} строит ${d.outpost ? 'аванпост' : 'базу'} «${d.name}»`, 'play');
      if (isAuto(d.primary)) { c.used.primary = true; this.enqueueFront(d.primary, c); }
    } else {
      p.inPlay.push(c);
      c.used.primary = true;
      this.addLog(`${p.name} играет «${d.name}»`, 'play');
      const hq = p.bases.filter((b) => def(b).fleetHQ).length;
      if (hq) this.pool.combat += hq;
      this.enqueueFront(d.primary, c);
    }
    this.process();
  }

  buy(p, slot) {
    let card, d;
    if (slot === 'explorer') {
      if (this.explorers <= 0) fail('Старатели закончились');
      d = CARDS.explorer;
      if (this.pool.trade < d.cost) fail('Не хватает денег');
      this.explorers--;
      card = mk('explorer');
    } else {
      const i = Number(slot);
      card = this.row[i];
      if (!card) fail('Слот пуст');
      d = def(card);
      if (this.pool.trade < d.cost) fail('Не хватает денег');
      this.refillRow(i);
    }
    this.pool.trade -= d.cost;
    if (d.type === 'ship' && this.topNext > 0) {
      this.topNext--;
      p.deck.push(clean(card));
      this.addLog(`${p.name} покупает «${d.name}» → на верх колоды`, 'buy');
    } else {
      p.discard.push(clean(card));
      this.addLog(`${p.name} покупает «${d.name}»`, 'buy');
    }
    this.process();
  }

  scrapAbility(p, uid) {
    let zone = p.inPlay, i = p.inPlay.findIndex((c) => c.uid === uid);
    if (i < 0) { zone = p.bases; i = p.bases.findIndex((c) => c.uid === uid); }
    if (i < 0) fail('Карта не в игре');
    const c = zone[i];
    const d = def(c);
    if (!d.scrap.length) fail('У карты нет способности утилизации');
    zone.splice(i, 1);
    if (c.cid === 'explorer') this.explorers++;
    this.addLog(`${p.name} утилизирует «${d.name}»`, 'scrap');
    this.enqueueFront(d.scrap, c);
    this.process();
  }

  activate(p, uid) {
    const b = p.bases.find((c) => c.uid === uid);
    if (!b) fail('Базы нет в игре');
    const d = def(b);
    if (!d.primary.length) fail('У базы нет такой способности');
    b.used = b.used || {};
    if (b.used.primary) fail('Способность уже использована в этот ход');
    b.used.primary = true;
    this.enqueueFront(d.primary, b);
    this.process();
  }

  attackBase(p, targetId, uid) {
    const t = this.pl(targetId);
    if (!t || !t.alive || t === p) fail('Неверная цель');
    const b = t.bases.find((c) => c.uid === uid);
    if (!b) fail('Базы нет');
    const d = def(b);
    if (!d.outpost && t.bases.some((x) => def(x).outpost)) fail('Сначала уничтожьте аванпосты этого игрока');
    if (this.pool.combat < d.defense) fail(`Нужно ${d.defense} урона`);
    this.pool.combat -= d.defense;
    t.bases.splice(t.bases.indexOf(b), 1);
    t.discard.push(clean(b));
    this.addLog(`${p.name} уничтожает ${d.outpost ? 'аванпост' : 'базу'} «${d.name}» игрока ${t.name}`, 'attack');
    this.lastEvent = { type: 'baseDestroyed', target: t.id, uid };
  }

  attackPlayer(p, targetId, amount) {
    const t = this.pl(targetId);
    if (!t || !t.alive || t === p) fail('Неверная цель');
    if (t.bases.some((x) => def(x).outpost)) fail('Сначала уничтожьте аванпосты этого игрока');
    amount = Math.floor(Number(amount));
    if (!(amount >= 1)) fail('Неверный урон');
    if (amount > this.pool.combat) fail('Не хватает урона');
    this.pool.combat -= amount;
    t.authority -= amount;
    this.addLog(`${p.name} атакует ${t.name}: −${amount} (осталось ${Math.max(0, t.authority)})`, 'attack');
    this.lastEvent = { type: 'hit', target: t.id, amount };
    if (t.authority <= 0) this.eliminate(t, `💥 ${t.name} теряет всё здоровье и выбывает!`);
  }

  answer(p, a) {
    const pr = this.prompt;
    if (!pr) fail('Нечего выбирать');
    if (pr.kind === 'choose') {
      const i = Number(a.option);
      if (!(i >= 0 && i < pr.options.length)) fail('Неверный вариант');
      const src = this.promptSrc;
      this.prompt = null; this.promptSrc = null;
      this.enqueueFront(pr.options[i], src);
    } else if (pr.kind === 'opponent') {
      if (!pr.options.includes(a.target)) fail('Неверный соперник');
      const t = this.pl(a.target);
      t.pendingDiscard += pr.n;
      this.addLog(`${t.name} сбросит карту в начале своего хода`, 'warn');
      this.prompt = null; this.promptSrc = null;
    } else if (pr.kind === 'pick') {
      const uids = Array.isArray(a.uids) ? [...new Set(a.uids)] : [];
      const allowed = new Set(pr.cards.map((c) => c.uid));
      if (uids.some((u) => !allowed.has(u))) fail('Эту карту выбрать нельзя');
      const min = Math.min(pr.min, pr.cards.length);
      if (uids.length < min || uids.length > pr.max) fail(pr.min === pr.max ? `Выберите ${cardsWord(pr.min)}` : `Выберите от ${min} до ${pr.max}`);
      this.prompt = null;
      this.handlePick(pr, uids);
      this.promptSrc = null;
    }
    this.process();
  }

  // ── проекция для клиента ──
  view(pid) {
    const pub = (c) => {
      const o = { uid: c.uid, cid: c.cid };
      if (c.copied) o.copied = c.copied;
      if (c.used) o.used = c.used;
      return o;
    };
    const cur = this.cur();
    let prompt = null;
    if (this.prompt) {
      prompt = cur.id === pid ? this.prompt : { waiting: true, text: `${cur.name} делает выбор…` };
    }
    return {
      players: this.players.map((p) => ({
        id: p.id, name: p.name, authority: p.authority, alive: p.alive, place: p.place,
        handCount: p.hand.length, deckCount: p.deck.length,
        discard: p.discard.map(pub), bases: p.bases.map(pub), inPlay: p.inPlay.map(pub),
        pendingDiscard: p.pendingDiscard,
        hand: p.id === pid ? p.hand.map(pub) : null,
      })),
      row: this.row.map((c) => (c ? pub(c) : null)),
      tradeDeckCount: this.tradeDeck.length,
      explorers: this.explorers,
      turn: cur.id,
      turnNo: this.turnNo,
      undoable: cur.id === pid ? this.undoable() : [],
      pool: this.pool,
      topNext: this.topNext,
      prompt,
      log: this.log.slice(-120),
      over: this.over,
      winner: this.winner,
      settings: this.settings,
      lastEvent: this.lastEvent,
    };
  }
}

module.exports = { Game, GameError, isAuto };
