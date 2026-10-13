'use strict';
/* Движок правил. Сервер — единственный источник правды: клиенты присылают действия,
 * движок проверяет их и меняет состояние. Каждый игрок получает свою «проекцию»
 * состояния (чужие руки скрыты).
 *
 * Режимы:
 *  - ffa   — каждый сам за себя (команда = сам игрок);
 *  - teams — 2 на 2: у команды общее здоровье и общий урон, деньги у каждого свои
 *            (каждый покупает в свою колоду), напарники ходят одновременно,
 *            союзные способности срабатывают и от карт напарника, аванпост любого защищает всю команду.
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

// Множитель размера торговой колоды
function deckMult(setting, nPlayers) {
  if (setting === 'auto' || setting === undefined) return nPlayers >= 5 ? 2 : nPlayers === 4 ? 1.5 : 1;
  const m = Number(setting);
  return [1, 1.5, 2].includes(m) ? m : 1;
}
// Состав торговой колоды: целые копии набора + для «полуторной» — по половине карт каждой фракции
function buildTradeDeck(mult) {
  const set = [];
  for (const c of Object.values(CARDS)) for (let i = 0; i < c.count; i++) set.push(c.id);
  const out = [];
  for (let k = 0; k < Math.floor(mult); k++) out.push(...set);
  if (mult % 1) {
    const byF = {};
    for (const id of set) (byF[CARDS[id].faction] = byF[CARDS[id].faction] || []).push(id);
    for (const ids of Object.values(byF)) out.push(...shuffle(ids.slice()).slice(0, Math.round(ids.length * (mult % 1))));
  }
  return out;
}
function tradeDeckSize(mult) { return buildTradeDeck(mult).length; }

class Game {
  constructor(players, settings) {
    this.settings = Object.assign({ authority: 50, randomOrder: true, mode: 'ffa', deckSize: 'auto' }, settings);
    this.mode = this.settings.mode === 'teams' ? 'teams' : 'ffa';
    let order = this.settings.randomOrder ? shuffle(players.slice()) : players.slice();
    this.players = order.map((p) => ({
      id: p.id, name: p.name, authority: this.settings.authority,
      team: this.mode === 'teams' ? (p.team === 'B' ? 'B' : 'A') : p.id,
      deck: [], hand: [], discard: [], inPlay: [], bases: [],
      pendingDiscard: 0, alive: true, place: null,
    }));
    // порядок ходов — по командам (в ffa команда = игрок)
    this.teamOrder = [];
    for (const p of this.players) if (!this.teamOrder.includes(p.team)) this.teamOrder.push(p.team);

    const mult = deckMult(this.settings.deckSize, this.players.length);
    this.deckMult = mult;
    this.tradeDeck = [];
    for (const id of buildTradeDeck(mult)) this.tradeDeck.push(mk(id));
    shuffle(this.tradeDeck);
    this.row = [];
    for (let i = 0; i < 5; i++) this.row.push(this.tradeDeck.pop() || null);
    this.explorers = Math.round(10 * mult);
    this.explorersMax = this.explorers;

    this.log = [];
    this.turnIdx = 0;
    this.turnNo = 0;
    this.pool = { trade: 0, combat: 0 };
    this.topNext = 0;
    this.purse = {};     // деньги каждого игрока в этот ход
    this.topNextBy = {}; // «следующий корабль — на верх колоды» у каждого игрока
    this.queue = [];
    this.prompt = null;
    this.promptSrc = null;
    this.over = false;
    this.winner = null;
    this.winners = [];
    this.lastEvent = null;
    this.revealSeq = 0;
    this.undoStack = [];
    this.ready = {};
    this.actorId = null;

    // Стартовые руки. ffa: 2 игрока — 3/5; больше — 3/4/5/5…  Команды: первая команда по 3, вторая по 5.
    const n = this.players.length;
    this.players.forEach((p, i) => {
      for (let k = 0; k < 8; k++) p.deck.push(mk('scout'));
      for (let k = 0; k < 2; k++) p.deck.push(mk('viper'));
      shuffle(p.deck);
      let size;
      if (this.mode === 'teams') size = p.team === this.teamOrder[0] ? 3 : 5;
      else size = n === 2 ? [3, 5][i] : [3, 4, 5, 5, 5, 5][i];
      this.draw(p, size);
    });
    this.revealSeq = 0;
    const first = this.mode === 'teams' ? `команда ${this.teamNames(this.teamOrder[0])}` : this.players[0].name;
    this.addLog(`Партия началась! ${this.mode === 'teams' ? 'Режим 2 на 2, здоровье команды' : 'Стартовое здоровье'}: ${this.settings.authority}. Первым ходит ${first}.`, 'sys');
    this.startTurn();
  }

  // ── утилиты ──
  addLog(text, kind = '') { this.log.push({ text, kind, t: Date.now() }); if (this.log.length > 300) this.log.shift(); }
  pl(id) { return this.players.find((p) => p.id === id); }
  curTeam() { return this.teamOrder[this.turnIdx]; }
  active() { const t = this.curTeam(); return this.players.filter((p) => p.alive && p.team === t); }
  isActive(pid) { return this.active().some((p) => p.id === pid); }
  cur() { return this.pl(this.actorId) || this.active()[0]; } // игрок, чьё действие сейчас выполняется
  teamMembers(team) { return this.players.filter((p) => p.team === team); }
  teamNames(team) { return this.teamMembers(team).map((p) => p.name).join(' и '); }
  teamAlive(team) { return this.players.some((p) => p.team === team && p.alive); }
  opponents(p = this.cur()) { return this.players.filter((o) => o.alive && o.team !== p.team); }
  teamHasOutpost(team) { return this.players.some((o) => o.team === team && o.alive && o.bases.some((b) => def(b).outpost)); }
  inPlayAll() { const r = []; for (const p of this.active()) r.push(...p.inPlay, ...p.bases); return r; }
  ownerOf(card) { return this.active().find((p) => p.inPlay.includes(card) || p.bases.includes(card)); }
  tradeOf(pid) { return this.purse[pid] || 0; }
  addTrade(pid, v) { this.purse[pid] = Math.max(0, (this.purse[pid] || 0) + v); this.syncPool(); }
  syncPool() { this.pool.trade = Object.values(this.purse).reduce((a, b) => a + b, 0); }
  changeHp(p, d) { for (const m of this.teamMembers(p.team)) m.authority += d; }
  who(p) { return this.mode === 'teams' ? `команда ${this.teamNames(p.team)}` : p.name; }

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

  // союзник ищется среди всех карт, сыгранных в этот ход (в режиме команд — и у напарника)
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

  enqueueFront(effects, src, pid = this.actorId) { this.queue.unshift(...effects.map((e) => ({ e, src, pid }))); }

  // Выполняет очередь эффектов; останавливается, если нужен выбор игрока.
  process() {
    let guard = 0;
    while (!this.prompt && !this.over && guard++ < 1000) {
      if (this.queue.length) {
        const it = this.queue.shift();
        if (!this.pl(it.pid) || !this.pl(it.pid).alive) continue;
        this.actorId = it.pid;
        this.resolve(it.e, it.src);
        continue;
      }
      const a = this.findAlly();
      if (!a) break;
      const owner = this.ownerOf(a);
      a.used = a.used || {};
      a.used.ally = true;
      this.addLog(`Союзная способность: «${def(a).name}»${this.mode === 'teams' && owner ? ` (${owner.name})` : ''}`, 'ally');
      this.enqueueFront(def(a).ally, a, owner ? owner.id : this.actorId);
    }
  }

  setPrompt(pr, src) { pr.pid = this.actorId; this.prompt = pr; this.promptSrc = src || null; }

  resolve(e, src) {
    const p = this.cur();
    const k = Object.keys(e)[0];
    const v = e[k];
    const srcName = src ? `«${def(src).name}»` : '';
    switch (k) {
      case 'trade': this.addTrade(p.id, v); break;
      case 'combat': this.pool.combat += v; break;
      case 'auth': this.changeHp(p, v); this.addLog(`${this.who(p)} восстанавливает ${v} здоровья (${p.authority})`, 'auth'); break;
      case 'draw': { const g = this.draw(p, v); if (g) this.addLog(`${p.name} берёт ${cardsWord(g)}`); break; }
      case 'opDiscard': {
        const ops = this.opponents(p);
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
        for (const o of this.opponents(p)) for (const b of o.bases) cards.push({ ...clean(b), zone: 'base', owner: o.id });
        if (cards.length) this.setPrompt({ kind: 'pick', purpose: 'destroyBase', min: 0, max: 1, cards, text: `${srcName}: можете уничтожить любую базу соперника` }, src);
        break;
      }
      case 'choose':
        this.setPrompt({ kind: 'choose', options: v, text: `${srcName}: выберите одно` }, src);
        break;
      case 'topNext':
        this.topNext += 1;
        this.topNextBy[p.id] = (this.topNextBy[p.id] || 0) + 1;
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
    const p = this.pl(pr.pid);
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
          for (const o of this.opponents(p)) {
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
            this.enqueueFront(def(src).primary, src, p.id);
          }
        }
        break;
      default: break;
    }
  }

  // ── ходы ──
  startTurn() {
    const act = this.active();
    this.turnNo++;
    this.pool = { trade: 0, combat: 0 };
    this.topNext = 0;
    this.purse = {};
    this.topNextBy = {};
    this.ready = {};
    this.undoStack = [];
    this.addLog(this.mode === 'teams' ? `Ход команды: ${act.map((p) => p.name).join(' и ')}` : `Ход игрока ${act[0].name}`, 'turn');
    for (const p of act) {
      if (p.pendingDiscard > 0) {
        const n = Math.min(p.pendingDiscard, p.hand.length);
        p.pendingDiscard = 0;
        if (n > 0) this.queue.push({ e: { startDiscard: n }, src: null, pid: p.id });
      }
    }
    for (const p of act) {
      for (const b of p.bases) {
        b.used = {};
        const prim = def(b).primary;
        if (isAuto(prim)) { b.used.primary = true; this.queue.push(...prim.map((e) => ({ e, src: b, pid: p.id }))); }
      }
    }
    this.actorId = act[0] ? act[0].id : null;
    this.process();
  }

  nextTeamIdx() {
    const n = this.teamOrder.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.turnIdx + k) % n;
      if (this.teamAlive(this.teamOrder[i])) return i;
    }
    return this.turnIdx;
  }

  // Игрок нажал «Завершить ход». В режиме команд ход переходит, когда готовы оба напарника.
  endTurn(p) {
    this.ready[p.id] = true;
    const act = this.active();
    if (act.some((x) => !this.ready[x.id])) {
      this.addLog(`${p.name} готов завершить ход`, 'sys');
      return;
    }
    this.finishTurn();
  }

  finishTurn() {
    for (const p of this.active()) {
      p.discard.push(...p.hand.map(clean), ...p.inPlay.map(clean));
      p.hand = [];
      p.inPlay = [];
      for (const b of p.bases) b.used = {};
      this.draw(p, 5);
    }
    this.queue = [];
    this.prompt = null;
    this.promptSrc = null;
    this.turnIdx = this.nextTeamIdx();
    this.startTurn();
  }

  // Команда (в ffa — игрок) выбывает
  eliminateTeam(team, reason) {
    const members = this.teamMembers(team);
    if (!members.some((m) => m.alive) && members.every((m) => m.place)) return;
    const aliveTeamsAfter = this.teamOrder.filter((t) => t !== team && this.teamAlive(t)).length;
    for (const m of members) { m.alive = false; m.place = aliveTeamsAfter + 1; }
    this.addLog(reason, 'dead');
    const left = this.teamOrder.filter((t) => this.teamAlive(t));
    if (left.length <= 1) {
      this.over = true;
      const win = left[0] ? this.players.filter((p) => p.team === left[0]) : [];
      for (const w of win) w.place = 1;
      this.winners = win.map((w) => w.id);
      this.winner = this.winners[0] || null;
      if (win.length) this.addLog(`🏆 ${win.length > 1 ? 'Победила команда' : 'Победитель —'} ${win.map((w) => w.name).join(' и ')}!`, 'win');
    }
  }

  // Игрок сдался / был удалён хостом
  forfeit(pid) {
    const t = this.pl(pid);
    if (!t || !t.alive || this.over) return;
    const wasActive = this.isActive(pid);
    const mates = this.players.filter((p) => p.team === t.team && p.alive && p !== t);
    if (mates.length) {
      // напарник продолжает играть за команду
      t.alive = false;
      t.discard.push(...t.hand.map(clean), ...t.inPlay.map(clean), ...t.bases.map(clean));
      t.hand = []; t.inPlay = []; t.bases = [];
      this.addLog(`${t.name} покидает игру — ${mates.map((m) => m.name).join(', ')} продолжает за команду`, 'dead');
      if (this.prompt && this.prompt.pid === pid) { this.prompt = null; this.promptSrc = null; this.queue = this.queue.filter((q) => q.pid !== pid); this.process(); }
      if (wasActive && this.active().every((x) => this.ready[x.id])) this.finishTurn();
      return;
    }
    this.eliminateTeam(t.team, `${t.name} покидает игру`);
    if (!this.over && wasActive) {
      t.discard.push(...t.hand.map(clean), ...t.inPlay.map(clean));
      t.hand = []; t.inPlay = [];
      this.queue = []; this.prompt = null; this.promptSrc = null;
      this.turnIdx = this.nextTeamIdx();
      this.startTurn();
    }
  }

  // Время хода вышло: закрыть окна выбора вариантом по умолчанию и завершить ход за всех, кто ходит
  timeout() {
    if (this.over) return;
    const turn = this.turnNo;
    this.addLog('⏱ Время хода вышло — ход завершён', 'warn');
    for (let i = 0; i < 50 && !this.over && this.turnNo === turn; i++) {
      const pr = this.prompt;
      if (pr) {
        const pid = pr.pid;
        const a = pr.kind === 'choose' ? { type: 'answer', option: 0 }
          : pr.kind === 'opponent' ? { type: 'answer', target: pr.options[0] }
          : { type: 'answer', uids: pr.cards.slice(0, Math.min(pr.min, pr.cards.length)).map((c) => c.uid) };
        try { this.act(pid, a); } catch { this.prompt = null; this.promptSrc = null; this.queue = []; }
        continue;
      }
      const p = this.active().find((x) => !this.ready[x.id]);
      if (!p) { this.finishTurn(); break; }
      this.act(p.id, { type: 'endTurn' });
    }
  }

  // Тайная правка значений (режим админа)
  adminSet(pid, v) {
    const p = this.pl(pid);
    if (!p) fail('Игрок не найден');
    const num = (x) => { const n = Math.floor(Number(x)); return Number.isFinite(n) ? Math.max(0, Math.min(9999, n)) : null; };
    if (v.hp !== undefined && num(v.hp) !== null && p.alive) for (const m of this.teamMembers(p.team)) m.authority = Math.max(1, num(v.hp));
    if (this.isActive(pid)) {
      if (v.trade !== undefined && num(v.trade) !== null) { this.purse[pid] = num(v.trade); this.syncPool(); }
      if (v.combat !== undefined && num(v.combat) !== null) this.pool.combat = num(v.combat);
    }
    this.undoStack = [];
  }

  act(pid, a) {
    if (this.over) fail('Игра окончена');
    if (!a || typeof a.type !== 'string') fail('Неизвестное действие');
    if (a.type === 'forfeit') { this.forfeit(pid); return; }
    if (!this.isActive(pid)) fail('Сейчас не ваш ход');
    if (this.prompt && this.prompt.pid !== pid) fail('Напарник делает выбор — подождите секунду');
    if (this.prompt && a.type !== 'answer' && a.type !== 'undo') fail('Сначала завершите выбор');
    const p = this.pl(pid);
    this.actorId = pid;
    this.lastEvent = null;
    if (a.type !== 'endTurn') delete this.ready[pid];
    // покупка, атака, утилизация, база, конец хода — дальше отменять розыгрыш нельзя
    if (!['play', 'playAll', 'answer', 'undo'].includes(a.type)) this.undoStack = [];

    switch (a.type) {
      case 'play': this.play(p, a.uid); break;
      case 'playAll': {
        const uids = p.hand.map((c) => c.uid);
        for (const uid of uids) {
          if (this.prompt || this.over) break;
          if (p.hand.some((c) => c.uid === uid)) { this.actorId = pid; this.play(p, uid); }
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
      case 'endTurn': this.endTurn(p); break;
      case 'unready': break;
      default: fail('Неизвестное действие');
    }
  }

  snapshot(uid, pid) {
    return {
      uid, pid, revealSeq: this.revealSeq, logLen: this.log.length,
      data: JSON.parse(JSON.stringify({ players: this.players, row: this.row, tradeDeck: this.tradeDeck, explorers: this.explorers, pool: this.pool, topNext: this.topNext, purse: this.purse, topNextBy: this.topNextBy })),
    };
  }

  // Какие сыгранные карты игрок может сейчас вернуть в руку: после них не открывалось новых карт
  // и не играл напарник
  undoable(pid) {
    const out = [];
    for (let k = this.undoStack.length - 1; k >= 0; k--) {
      const s = this.undoStack[k];
      if (s.pid !== pid || s.revealSeq !== this.revealSeq) break;
      out.unshift(s.uid);
    }
    return out;
  }

  undo(p, uid) {
    if (!this.undoable(p.id).includes(uid)) fail('Эту карту уже нельзя вернуть');
    const k = this.undoStack.findIndex((s) => s.uid === uid);
    const snap = this.undoStack[k];
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
    this.undoStack.push(this.snapshot(uid, p.id));
    const c = p.hand.splice(i, 1)[0];
    const d = def(c);
    c.used = {};
    if (d.type === 'base') {
      c.playedTurn = this.turnNo;
      p.bases.push(c);
      this.addLog(`${p.name} строит ${d.outpost ? 'аванпост' : 'базу'} «${d.name}»`, 'play');
      if (isAuto(d.primary)) { c.used.primary = true; this.enqueueFront(d.primary, c, p.id); }
    } else {
      p.inPlay.push(c);
      c.used.primary = true;
      this.addLog(`${p.name} играет «${d.name}»`, 'play');
      const hq = p.bases.filter((b) => def(b).fleetHQ).length;
      if (hq) this.pool.combat += hq;
      this.enqueueFront(d.primary, c, p.id);
    }
    this.process();
  }

  buy(p, slot) {
    let card, d;
    if (slot === 'explorer') {
      if (this.explorers <= 0) fail('Старатели закончились');
      d = CARDS.explorer;
      if (this.tradeOf(p.id) < d.cost) fail('Не хватает денег');
      this.explorers--;
      card = mk('explorer');
    } else {
      const i = Number(slot);
      card = this.row[i];
      if (!card) fail('Слот пуст');
      d = def(card);
      if (this.tradeOf(p.id) < d.cost) fail('Не хватает денег');
      this.refillRow(i);
    }
    this.addTrade(p.id, -d.cost);
    if (d.type === 'ship' && (this.topNextBy[p.id] || 0) > 0) {
      this.topNextBy[p.id]--;
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
    this.enqueueFront(d.scrap, c, p.id);
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
    this.enqueueFront(d.primary, b, p.id);
    this.process();
  }

  attackBase(p, targetId, uid) {
    const t = this.pl(targetId);
    if (!t || !t.alive || t.team === p.team) fail('Неверная цель');
    const b = t.bases.find((c) => c.uid === uid);
    if (!b) fail('Базы нет');
    const d = def(b);
    if (!d.outpost && this.teamHasOutpost(t.team)) fail(this.mode === 'teams' ? 'Сначала уничтожьте аванпосты этой команды' : 'Сначала уничтожьте аванпосты этого игрока');
    if (this.pool.combat < d.defense) fail(`Нужно ${d.defense} урона`);
    this.pool.combat -= d.defense;
    t.bases.splice(t.bases.indexOf(b), 1);
    t.discard.push(clean(b));
    this.addLog(`${p.name} уничтожает ${d.outpost ? 'аванпост' : 'базу'} «${d.name}» игрока ${t.name}`, 'attack');
    this.lastEvent = { type: 'baseDestroyed', target: t.id, uid };
  }

  attackPlayer(p, targetId, amount) {
    const t = this.pl(targetId);
    if (!t || !t.alive || t.team === p.team) fail('Неверная цель');
    if (this.teamHasOutpost(t.team)) fail(this.mode === 'teams' ? 'Сначала уничтожьте аванпосты этой команды' : 'Сначала уничтожьте аванпосты этого игрока');
    amount = Math.floor(Number(amount));
    if (!(amount >= 1)) fail('Неверный урон');
    if (amount > this.pool.combat) fail('Не хватает урона');
    amount = Math.min(amount, t.authority); // лишний урон не сгорает — остаётся на другие цели
    this.pool.combat -= amount;
    this.changeHp(t, -amount);
    this.addLog(`${p.name} атакует ${this.mode === 'teams' ? `команду ${this.teamNames(t.team)}` : t.name}: −${amount} (осталось ${Math.max(0, t.authority)})`, 'attack');
    this.lastEvent = { type: 'hit', target: t.id, amount };
    if (t.authority <= 0) this.eliminateTeam(t.team, `💥 ${this.mode === 'teams' ? `Команда ${this.teamNames(t.team)} теряет` : `${t.name} теряет`} всё здоровье и выбывает!`);
  }

  answer(p, a) {
    const pr = this.prompt;
    if (!pr) fail('Нечего выбирать');
    if (pr.kind === 'choose') {
      const i = Number(a.option);
      if (!(i >= 0 && i < pr.options.length)) fail('Неверный вариант');
      const src = this.promptSrc;
      this.prompt = null; this.promptSrc = null;
      this.enqueueFront(pr.options[i], src, pr.pid);
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
    const me = this.pl(pid);
    const active = this.active();
    let prompt = null;
    if (this.prompt) {
      const owner = this.pl(this.prompt.pid);
      prompt = this.prompt.pid === pid ? this.prompt : { waiting: true, pid: this.prompt.pid, text: `${owner ? owner.name : 'Игрок'} делает выбор…` };
    }
    const seesHand = (p) => p.id === pid || (this.mode === 'teams' && me && p.team === me.team);
    return {
      mode: this.mode,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, team: p.team, authority: p.authority, alive: p.alive, place: p.place,
        handCount: p.hand.length, deckCount: p.deck.length,
        discard: p.discard.map(pub), bases: p.bases.map(pub), inPlay: p.inPlay.map(pub),
        pendingDiscard: p.pendingDiscard,
        hand: seesHand(p) ? p.hand.map(pub) : null,
        // своя колода — без порядка (отсортирована), чтобы не было спойлера
        deckList: p.id === pid ? p.deck.map((c) => c.cid).sort() : null,
      })),
      row: this.row.map((c) => (c ? pub(c) : null)),
      tradeDeckCount: this.tradeDeck.length,
      tradeDeckTotal: tradeDeckSize(this.deckMult),
      explorers: this.explorers,
      active: active.map((p) => p.id),
      turn: active[0] ? active[0].id : null,
      ready: Object.keys(this.ready).filter((k) => this.ready[k]),
      turnNo: this.turnNo,
      undoable: this.undoable(pid),
      pool: { combat: this.pool.combat, trade: this.isActive(pid) ? this.tradeOf(pid) : 0 },
      purse: Object.fromEntries(active.map((p) => [p.id, this.tradeOf(p.id)])),
      topNext: this.topNextBy[pid] || 0,
      prompt,
      log: this.log.slice(-120),
      over: this.over,
      winner: this.winner,
      winners: this.winners,
      settings: this.settings,
      lastEvent: this.lastEvent,
    };
  }
}

module.exports = { Game, GameError, isAuto, deckMult, tradeDeckSize };
