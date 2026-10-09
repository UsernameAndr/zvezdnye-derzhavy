'use strict';
// Прогон случайных партий: боты делают случайные допустимые ходы.
// Проверяет, что движок не падает, карты не теряются и партии заканчиваются.
const { Game, GameError } = require('../game/engine');
const { CARDS } = require('../public/cards.js');

const pick = (a) => a[Math.floor(Math.random() * a.length)];

function totalCards(g) {
  let n = g.tradeDeck.length + g.row.filter(Boolean).length;
  for (const p of g.players) n += p.deck.length + p.hand.length + p.discard.length + p.inPlay.length + p.bases.length;
  return n;
}

function botStep(g) {
  const p = g.cur();
  const pr = g.prompt;
  const und = g.undoable();
  if (und.length && Math.random() < 0.08) return { type: 'undo', uid: pick(und) };
  if (pr) {
    if (pr.kind === 'choose') return { type: 'answer', option: Math.floor(Math.random() * pr.options.length) };
    if (pr.kind === 'opponent') return { type: 'answer', target: pick(pr.options) };
    const n = Math.min(pr.cards.length, pr.min + Math.floor(Math.random() * (pr.max - pr.min + 1)));
    const uids = [...pr.cards].sort(() => Math.random() - 0.5).slice(0, Math.max(n, Math.min(pr.min, pr.cards.length))).map((c) => c.uid);
    return { type: 'answer', uids };
  }
  if (p.hand.length) return Math.random() < 0.3 ? { type: 'playAll' } : { type: 'play', uid: pick(p.hand).uid };
  const manual = p.bases.filter((b) => !(b.used && b.used.primary) && CARDS[b.copied || b.cid].primary.length);
  if (manual.length && Math.random() < 0.8) return { type: 'activate', uid: pick(manual).uid };
  const scrappable = [...p.inPlay, ...p.bases].filter((c) => CARDS[c.copied || c.cid].scrap.length);
  if (scrappable.length && Math.random() < 0.15) return { type: 'scrap', uid: pick(scrappable).uid };
  const buyable = g.row.map((c, i) => (c && CARDS[c.cid].cost <= g.pool.trade ? i : -1)).filter((i) => i >= 0);
  if (buyable.length && Math.random() < 0.9) return { type: 'buy', slot: pick(buyable) };
  if (g.pool.trade >= 2 && g.explorers > 0 && Math.random() < 0.5) return { type: 'buy', slot: 'explorer' };
  if (g.pool.combat > 0) {
    const ops = g.players.filter((o) => o.alive && o !== p);
    const t = pick(ops);
    const outposts = t.bases.filter((b) => CARDS[b.cid].outpost);
    const targets = outposts.length ? outposts : t.bases;
    const killable = targets.filter((b) => CARDS[b.cid].defense <= g.pool.combat);
    if (killable.length && Math.random() < 0.7) return { type: 'attackBase', target: t.id, uid: pick(killable).uid };
    if (!outposts.length) return { type: 'attackPlayer', target: t.id, amount: g.pool.combat };
  }
  return { type: 'endTurn' };
}

let games = 0, turnsTotal = 0, errors = 0, illegal = 0;
const N = Number(process.argv[2] || 500);
for (let i = 0; i < N; i++) {
  const n = 2 + (i % 5);
  const players = Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: 'Бот' + k }));
  const g = new Game(players, { authority: [10, 25, 50][i % 3], randomOrder: true });
  const start = totalCards(g);
  let steps = 0;
  while (!g.over && steps < 20000) {
    const a = botStep(g);
    try { g.act(g.cur().id, a); }
    catch (e) {
      if (e instanceof GameError) { illegal++; if (illegal < 10) console.log('illegal:', e.message, JSON.stringify(a)); try { g.act(g.cur().id, { type: 'endTurn' }); } catch {} }
      else { errors++; console.error(e); break; }
    }
    steps++;
    // explorers выдаются из стопки — учитываем их отдельно
    const explorersOut = 10 - g.explorers;
    const now = totalCards(g);
    if (now > start + explorersOut) { console.error('Карты размножились!', now, start, explorersOut); errors++; break; }
    // проверка случайного форфита
    if (Math.random() < 0.0005 && n > 2) g.forfeit(pick(g.players.filter((p) => p.alive)).id);
    JSON.stringify(g.view(g.players[0].id));
  }
  if (!g.over) { console.error('Партия не завершилась', i); errors++; }
  games++;
  turnsTotal += g.turnNo;
}
console.log(`Партий: ${games}, средняя длина: ${(turnsTotal / games).toFixed(1)} ходов, ошибок: ${errors}, отклонённых ходов: ${illegal}`);
process.exit(errors ? 1 : 0);
