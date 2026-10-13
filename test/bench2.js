'use strict';
// Новый бот (game/bot.js) против предыдущей версии (test/bot_prev.js) на заданном здоровье.
// node test/bench2.js [партий] [здоровье,...]
const { Game } = require('../game/engine');
const nb = require('../game/bot');
const ob = require('./bot_prev');
if (process.env.W) Object.assign(nb.W, JSON.parse(process.env.W));

function play(n, mode, who, hp) {
  const players = Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: 'P' + k, team: k % 2 ? 'B' : 'A' }));
  const g = new Game(players, { authority: hp, mode, randomOrder: false });
  let s = 0;
  while (!g.over && s++ < 40000) {
    let acted = false;
    for (const p of g.active()) {
      const a = (who[p.id] === 'new' ? nb : ob).decide(g, p.id, {});
      if (!a) continue;
      try { g.act(p.id, a); } catch (e) { try { g.act(p.id, { type: 'endTurn' }); } catch {} }
      acted = true; break;
    }
    if (!acted) break;
  }
  return g;
}
function bench(N, hp) {
  let d = 0, t = 0;
  for (let i = 0; i < N; i++) {
    const f = i % 2 === 0;
    let who = f ? { p0: 'new', p1: 'old' } : { p0: 'old', p1: 'new' };
    let g = play(2, 'ffa', who, hp);
    if (g.winners.some((id) => who[id] === 'new')) d++;
    who = f ? { p0: 'new', p2: 'new', p1: 'old', p3: 'old' } : { p0: 'old', p2: 'old', p1: 'new', p3: 'new' };
    g = play(4, 'teams', who, hp);
    if (g.winners.some((id) => who[id] === 'new')) t++;
  }
  return { duel: d / N, teams: t / N };
}
if (require.main === module) {
  const N = Number(process.argv[2] || 300);
  for (const hp of String(process.argv[3] || '50,150,350').split(',').map(Number)) {
    const r = bench(N, hp);
    console.log(`здоровье ${hp}: 1×1 ${(r.duel * 100).toFixed(1)}%, 2×2 ${(r.teams * 100).toFixed(1)}%`);
  }
}
module.exports = { bench, play };
