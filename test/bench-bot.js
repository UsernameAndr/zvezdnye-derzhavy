'use strict';
// Сравнение ботов: новый (game/bot.js) против прошлой версии (test/bot_v1.js).
// node test/bench-bot.js [партий] — дуэли 1×1 с чередованием первого хода, плюс 2×2.
const { Game } = require('../game/engine');
const nb = require('../game/bot');
const ob = require('./bot_v1');

function play(nPlayers, mode, who) {
  const players = Array.from({ length: nPlayers }, (_, k) => ({ id: 'p' + k, name: 'P' + k, team: k % 2 ? 'B' : 'A' }));
  const g = new Game(players, { authority: 50, mode, randomOrder: false });
  let s = 0;
  while (!g.over && s++ < 8000) {
    const cands = g.prompt ? [g.prompt.pid] : g.active().map((p) => p.id);
    let acted = false;
    for (const pid of cands) {
      const a = (who[pid] === 'new' ? nb : ob).decide(g, pid, {});
      if (!a) continue;
      try { g.act(pid, a); } catch (e) { try { g.act(pid, { type: 'endTurn' }); } catch {} }
      acted = true; break;
    }
    if (!acted) break;
  }
  return g;
}

function duel(N) {
  let w = 0;
  for (let i = 0; i < N; i++) {
    const newFirst = i % 2 === 0;
    const who = newFirst ? { p0: 'new', p1: 'old' } : { p0: 'old', p1: 'new' };
    const g = play(2, 'ffa', who);
    if (g.winners.some((id) => who[id] === 'new')) w++;
  }
  return w / N;
}
function teams(N) {
  let w = 0;
  for (let i = 0; i < N; i++) {
    const newA = i % 2 === 0;
    const who = newA ? { p0: 'new', p2: 'new', p1: 'old', p3: 'old' } : { p0: 'old', p2: 'old', p1: 'new', p3: 'new' };
    const g = play(4, 'teams', who);
    if (g.winners.some((id) => who[id] === 'new')) w++;
  }
  return w / N;
}

if (require.main === module) {
  const N = Number(process.argv[2] || 400);
  console.log(`новый бот против старого, 1×1: ${(duel(N) * 100).toFixed(1)}% побед`);
  console.log(`новые боты против старых, 2×2: ${(teams(Math.floor(N / 2)) * 100).toFixed(1)}% побед`);
}
module.exports = { duel, teams };
