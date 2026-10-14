'use strict';
/* Бот: по состоянию партии выбирает одно следующее действие.
 * decide(game, botId, { holdShared }) → действие для game.act(...) или null (сейчас делать нечего).
 * holdShared — в режиме 2 на 2 с живым напарником: пока напарник не нажал «Завершить ход»,
 * бот разыгрывает свои карты и покупает на свои деньги, а общий урон оставляет напарнику.
 */
const { CARDS } = require('../public/cards.js');
// Ценность покупок, выученная на самоигре (test/learn-cards.js): карта → [начало, середина, конец].
// Это прирост шанса победы от покупки карты по сравнению с отказом от покупки в той же ситуации.
let LEARNED = {};
try { LEARNED = require('./card-values.json'); } catch { LEARNED = {}; }
// То же для долгих партий (много здоровья, test/learn-long.js): карта → [ближе к концу, середина, далеко до конца].
// Берём из неё только поправку относительно средней карты: сколько покупать, решает основная таблица.
let LEARNED_LONG = {};
try { LEARNED_LONG = require('./card-values-long.json'); } catch { LEARNED_LONG = {}; }
const LONG_MEAN = [0, 1, 2].map((b) => { const v = Object.values(LEARNED_LONG).map((x) => x[b]); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; });
const W = { synergy: 0, focus: 0, outpostDanger: 0.6, minValue: 0.4, teamMinValue: 0.25, teamPace: 1.4, baseKill: 1, longExp: 1, longW: 0.7 };

const def = (c) => CARDS[c.copied || c.cid];
const val = (e) => {
  const k = Object.keys(e)[0], v = e[k];
  return { trade: v, combat: v, auth: v * 0.6, draw: v * 1.6, opDiscard: 0.8, scrapRow: 0.3, scrapHD: 0.6,
    destroyBase: 1.5, topNext: 0.6, freeShip: 3, yacht: 1, blobDraw: 1.5, recycle: 0.8, machineBase: 1.2, brain: 1.5, copy: 2 }[k] || 0;
};
const effVal = (list) => list.reduce((s, e) => s + (Object.keys(e)[0] === 'choose' ? Math.max(...e.choose.map(effVal)) : val(e)), 0);

// «Мусор» в колоде: стартовые карты в первую очередь
function junkScore(cid) {
  if (cid === 'scout') return 3;
  if (cid === 'viper') return 2;
  if (cid === 'explorer') return 1;
  return 0;
}

function ownFactions(p) {
  const n = {};
  for (const c of [...p.deck, ...p.hand, ...p.discard, ...p.inPlay, ...p.bases]) {
    const f = def(c).faction;
    if (f !== 'none') n[f] = (n[f] || 0) + 1;
  }
  return n;
}

function cardValue(g, p, cid) {
  const d = CARDS[cid];
  const fac = ownFactions(p);
  let v = d.cost * 1.1 + effVal(d.primary) * 0.6 + effVal(d.ally) * 0.35 + effVal(d.scrap) * 0.15;
  if (d.faction !== 'none') v += Math.min(4, (fac[d.faction] || 0)) * 0.6;
  if (d.type === 'base') v += d.defense * 0.25 + (d.outpost ? 1 : 0);
  if (d.fleetHQ || d.allAlly) v += 3;
  return v;
}

function phaseBucket(g) { const t = Math.floor(g.turnNo / Math.max(1, g.teamOrder.length) * (g.mode === 'teams' ? W.teamPace : 1)); return t <= 3 ? 0 : t <= 7 ? 1 : 2; }

// ценность покупки: выученная + синергия фракций + аванпост, когда здоровья мало
function learnedValue(g, p, cid) {
  const L = LEARNED[cid];
  if (!L) return cardValue(g, p, cid) / 10;
  const d = CARDS[cid];
  let v = L[phaseBucket(g)];
  const LL = LEARNED_LONG[cid], lg = longness(g, p);
  if (LL && W.longW && lg >= 0.34) { const b = lg < 0.67 ? 1 : 2; v += W.longW * horizon(g, p) * (LL[b] - LONG_MEAN[b]); }
  if (d.faction !== 'none') {
    const fac = ownFactions(p);
    v += Math.min(5, fac[d.faction] || 0) * W.synergy;
    const ranked = Object.entries(fac).sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((x, y) => x + y[1], 0);
    if (total >= 4 && ranked.length >= 2 && !ranked.slice(0, 2).some((x) => x[0] === d.faction)) v -= W.focus;
  }
  if (d.outpost && p.authority <= (g.settings.authority || 50) * 0.4) v += W.outpostDanger;
  return v;
}

// насколько партия ещё далека от конца: 0 — развязка близко, 1 — впереди долгая игра (много здоровья)
function longness(g, p) {
  const enemyHp = Math.min(...g.opponents(p).map((o) => o.authority));
  return Math.max(0, Math.min(1, (Math.min(enemyHp, p.authority) - 50) / 100));
}
// поправки для очень долгих партий: полностью при стартовом здоровье от 350, не действуют при 150 и меньше;
// к концу партии (здоровья осталось мало) сходят на нет
function horizon(g, p) {
  const start = Math.max(0, Math.min(1, ((g.settings.authority || 50) - 150) / 200));
  return start * longness(g, p);
}

function bestPurchase(g, p, money) {
  const minV = g.mode === 'teams' ? W.teamMinValue : W.minValue;
  const row = g.row.map((c, i) => ({ c, i })).filter((x) => x.c);
  const vals = row.map((x) => learnedValue(g, p, x.c.cid));
  // в долгой партии Старатели только разбавляют колоду
  const expV = g.explorers > 0 ? learnedValue(g, p, 'explorer') - W.longExp * horizon(g, p) : -99;
  let best = { v: 0, first: null };
  for (let mask = 1; mask < (1 << row.length); mask++) {
    let cost = 0, v = 0, first = null, fv = -1e9;
    for (let k = 0; k < row.length; k++) if (mask & (1 << k)) {
      cost += CARDS[row[k].c.cid].cost; v += vals[k] - minV;
      if (vals[k] > fv) { fv = vals[k]; first = row[k].i; }
    }
    if (cost > money) continue;
    const exps = expV - minV > 0 ? Math.min(Math.floor((money - cost) / 2), g.explorers) : 0;
    v += exps * (expV - minV);
    if (v > best.v) best = { v, first };
  }
  if (best.first !== null) return { type: 'buy', slot: best.first };
  if (money >= 2 && g.explorers > 0 && expV - minV > 0) return { type: 'buy', slot: 'explorer' };
  return null;
}

function deckSize(p) { return p.deck.length + p.hand.length + p.discard.length + p.inPlay.length; }

function answerPrompt(g, p, pr) {
  const enemies = g.opponents(p);
  if (pr.kind === 'choose') {
    // оцениваем варианты по ситуации
    const lowHp = p.authority <= 15;
    const canBuy = g.row.some((c) => c && CARDS[c.cid].cost <= g.tradeOf(p.id) + 3);
    let best = 0, bestV = -1;
    pr.options.forEach((o, i) => {
      let v = 0;
      for (const e of o) {
        const k = Object.keys(e)[0], x = e[k];
        if (k === 'trade') v += x * (canBuy ? 1.2 : 0.8);
        else if (k === 'combat') v += x * 1.1;
        else if (k === 'auth') v += x * (lowHp ? 1.4 : 0.5);
        else if (k === 'blobDraw') v += p.inPlay.filter((c) => def(c).faction === 'blob').length * 1.8;
        else v += val(e);
      }
      if (v > bestV) { bestV = v; best = i; }
    });
    return { type: 'answer', option: best };
  }
  if (pr.kind === 'opponent') {
    const t = pr.options.map((id) => g.pl(id)).sort((a, b) => a.authority - b.authority)[0];
    return { type: 'answer', target: t.id };
  }
  // pick
  const cards = pr.cards;
  let pick = [];
  const want = (n) => Math.min(n, pr.max);
  switch (pr.purpose) {
    case 'scrapRow': {
      // убрать из ряда самую ценную карту, которую мы сейчас не купим (чтобы не досталась соперникам)
      const c = cards.slice().sort((a, b) => CARDS[b.cid].cost - CARDS[a.cid].cost)[0];
      if (c && CARDS[c.cid].cost >= 5 && CARDS[c.cid].cost > g.tradeOf(p.id)) pick = [c.uid];
      break;
    }
    case 'scrapHD': case 'brain': {
      const big = deckSize(p) >= 12;
      const junk = cards.filter((c) => junkScore(c.cid) >= (big ? 2 : 3))
        .sort((a, b) => (b.zone === 'discard') - (a.zone === 'discard') || junkScore(b.cid) - junkScore(a.cid));
      pick = junk.slice(0, want(pr.purpose === 'brain' ? 2 : 1)).map((c) => c.uid);
      break;
    }
    case 'scrapHand': case 'discard': case 'recycle': {
      const sorted = cards.slice().sort((a, b) => junkScore(b.cid) - junkScore(a.cid) || CARDS[a.cid].cost - CARDS[b.cid].cost);
      if (pr.purpose === 'recycle') pick = sorted.filter((c) => junkScore(c.cid) >= 2).slice(0, want(2)).map((c) => c.uid);
      else pick = sorted.slice(0, Math.max(pr.min, 1)).slice(0, pr.max).map((c) => c.uid);
      break;
    }
    case 'destroyBase': {
      const c = cards.slice().sort((a, b) => (CARDS[b.cid].outpost - CARDS[a.cid].outpost) || (CARDS[b.cid].defense - CARDS[a.cid].defense))[0];
      if (c) pick = [c.uid];
      break;
    }
    case 'freeShip': {
      const c = cards.slice().sort((a, b) => CARDS[b.cid].cost - CARDS[a.cid].cost)[0];
      if (c) pick = [c.uid];
      break;
    }
    case 'copy': {
      const c = cards.slice().sort((a, b) => effVal(CARDS[b.cid].primary) - effVal(CARDS[a.cid].primary))[0];
      if (c) pick = [c.uid];
      break;
    }
    default:
      pick = cards.slice(0, pr.min).map((c) => c.uid);
  }
  if (pick.length < Math.min(pr.min, cards.length)) pick = cards.slice(0, pr.min).map((c) => c.uid);
  void enemies;
  return { type: 'answer', uids: pick };
}

function decide(g, botId, opts = {}) {
  if (g.over) return null;
  const p = g.pl(botId);
  if (!p || !p.alive) return null;
  // своё окно выбора — ответить; чужие окна (напарника) бота не блокируют
  const own = g.promptOf(botId);
  if (own) return answerPrompt(g, p, own);
  if (!g.isActive(botId)) return null;
  if (g.ready[botId]) return null;

  // 1. сыграть руку
  if (p.hand.length) {
    // базы — первыми, чтобы союзы срабатывали раньше
    const base = p.hand.find((c) => CARDS[c.cid].type === 'base');
    return { type: 'play', uid: (base || p.hand[0]).uid };
  }
  // 2. базы с ручной способностью
  const manual = p.bases.find((b) => def(b).primary.length && !(b.used && b.used.primary));
  if (manual) return { type: 'activate', uid: manual.uid };
  // 2б. герой: ход-другой он помогает союзами, потом бот отправляет его в бой ради эффекта
  const hero = (p.heroes || []).find((h) => h.boughtTurn < g.turnNo);
  if (hero) return { type: 'scrap', uid: hero.uid };

  const enemies = g.opponents(p);
  const combat = g.pool.combat;
  const money = g.tradeOf(botId);

  // 3. покупки на свои деньги: лучший набор карт по выученной ценности
  const buy = bestPurchase(g, p, money);
  if (buy) return buy;

  if (opts.holdShared) return null; // общий урон пусть первым тратит живой напарник

  // 4. можно ли добить кого-то прямо сейчас (с учётом утилизации кораблей ради урона)
  const scrapCombat = [...p.inPlay, ...p.bases].filter((c) => def(c).scrap.some((e) => e.combat))
    .map((c) => ({ c, v: def(c).scrap.reduce((s, e) => s + (e.combat || 0), 0) }));
  const extra = scrapCombat.reduce((s, x) => s + x.v, 0);
  for (const t of enemies.slice().sort((a, b) => a.authority - b.authority)) {
    if (g.teamHasOutpost(t.team)) continue;
    if (combat >= t.authority) return { type: 'attackPlayer', target: t.id, amount: t.authority };
    if (combat + extra >= t.authority && scrapCombat.length) return { type: 'scrap', uid: scrapCombat[0].c.uid };
  }


  // 5. атака: сначала аванпосты, потом самый слабый соперник; сильные базы — если урона с запасом
  if (combat > 0) {
    const outposts = [];
    for (const t of enemies) for (const b of t.bases) if (def(b).outpost) outposts.push({ t, b });
    const killable = outposts.filter((x) => def(x.b).defense <= combat).sort((a, b) => def(b.b).defense - def(a.b).defense);
    if (killable.length) return { type: 'attackBase', target: killable[0].t.id, uid: killable[0].b.uid };
    const open = enemies.filter((t) => !g.teamHasOutpost(t.team)).sort((a, b) => a.authority - b.authority);
    if (open.length) {
      const t = open[0];
      // ценную базу соперника снести: ту, что каждый ход даёт урон/добор или усиливает флот
      const recurring = (b) => effVal(def(b).primary) + (def(b).fleetHQ ? 5 : 0) + (def(b).allAlly ? 3 : 0);
      const bases = g.players.filter((o) => o.team === t.team && o.alive).flatMap((o) => o.bases.map((b) => ({ o, b })))
        .filter((x) => !def(x.b).outpost && def(x.b).defense <= combat && t.authority > combat
          && (def(x.b).defense <= combat - 3 || recurring(x.b) * W.baseKill >= def(x.b).defense))
        .sort((x, y) => recurring(y.b) - recurring(x.b));
      if (bases.length) return { type: 'attackBase', target: bases[0].o.id, uid: bases[0].b.uid };
      return { type: 'attackPlayer', target: t.id, amount: combat };
    }
  }

  // 6. утилизировать Старателей в поздней игре — урон и чистка колоды
  if (deckSize(p) >= 14) {
    const ex = p.inPlay.find((c) => c.cid === 'explorer');
    if (ex) return { type: 'scrap', uid: ex.uid };
  }

  return { type: 'endTurn' };
}

module.exports = { decide, W, longness };
