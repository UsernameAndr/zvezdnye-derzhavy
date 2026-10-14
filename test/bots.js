'use strict';
// Турнир ботов: партии только из ботов в обоих режимах + бот против «случайного» игрока.
// Проверяет, что бот никогда не делает недопустимых ходов, не зацикливается и выигрывает у случайной игры.
const { Game, GameError } = require('../game/engine');
const { decide } = require('../game/bot');
const { CARDS } = require('../public/cards.js');

const pick = (a) => a[Math.floor(Math.random() * a.length)];

function randomMove(g, pid) {
  const p = g.pl(pid);
  const pr = g.promptOf(pid);
  if (pr) {
    if (pr.kind === 'choose') return { type: 'answer', option: 0 };
    if (pr.kind === 'opponent') return { type: 'answer', target: pr.options[0] };
    return { type: 'answer', uids: pr.cards.slice(0, pr.min).map((c) => c.uid) };
  }
  if (p.hand.length) return { type: 'playAll' };
  const b = g.row.map((c, i) => (c && CARDS[c.cid].cost <= g.tradeOf(pid) ? i : -1)).filter((i) => i >= 0);
  if (b.length && Math.random() < 0.7) return { type: 'buy', slot: pick(b) };
  if (g.pool.combat > 0) {
    const t = g.opponents(p).find((o) => !g.teamHasOutpost(o.team));
    if (t) return { type: 'attackPlayer', target: t.id, amount: g.pool.combat };
  }
  return { type: 'endTurn' };
}

let illegal = 0, stuck = 0, games = 0, botWins = 0, vsRandom = 0;
function run(n, mode, botIds, opts = {}) {
  const players = Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: 'P' + k, team: k % 2 ? 'B' : 'A' }));
  const g = new Game(players, { authority: 50, mode, randomOrder: true, heroes: Math.random() < 0.5 });
  let steps = 0, idle = 0;
  while (!g.over && steps < 6000) {
    steps++;
    // кто может ходить
    const cands = g.active().map((p) => p.id).sort(() => Math.random() - 0.5);
    let acted = false;
    for (const pid of cands) {
      const isBot = botIds.includes(pid);
      let a;
      if (isBot) {
        const mate = g.players.find((x) => x.team === g.pl(pid).team && x.id !== pid && x.alive);
        const holdShared = mode === 'teams' && mate && !botIds.includes(mate.id) && !g.ready[mate.id];
        a = decide(g, pid, { holdShared });
      } else if (!g.ready[pid] || g.promptOf(pid)) a = randomMove(g, pid);
      if (!a) continue;
      try { g.act(pid, a); acted = true; break; }
      catch (e) {
        if (!(e instanceof GameError)) throw e;
        if (isBot) { illegal++; if (illegal < 8) console.log('бот ошибся:', e.message, JSON.stringify(a)); }
        try { g.act(pid, { type: 'endTurn' }); } catch {}
        acted = true; break;
      }
    }
    if (!acted) { idle++; if (idle > 5) { stuck++; console.log('зависание', mode, JSON.stringify(g.prompt)); break; } } else idle = 0;
  }
  if (!g.over) stuck++;
  games++;
  return g;
}

const N = Number(process.argv[2] || 200);
for (let i = 0; i < N; i++) {
  run(2 + (i % 5), 'ffa', ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
  run(4, 'teams', ['p0', 'p1', 'p2', 'p3']);
  run(4, 'teams', ['p1', 'p2', 'p3']); // живой (случайный) игрок p0 с ботом-напарником p2
  const g = run(2, 'ffa', ['p0']);      // бот против случайной игры
  vsRandom++;
  if (g.winners.includes('p0')) botWins++;
}
console.log(`Партий: ${games}, недопустимых ходов бота: ${illegal}, зависаний: ${stuck}, бот обыграл случайную игру: ${botWins}/${vsRandom}`);
process.exit(illegal || stuck ? 1 : 0);
