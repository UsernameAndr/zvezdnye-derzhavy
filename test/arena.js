'use strict';
// Арена: бот против «сильного человека» (test/human-like.js) на разном здоровье, 1×1 и 2×2.
// node test/arena.js [партий] [здоровье,...]
const { Game } = require('../game/engine');
const bot = require('../game/bot');
const hl = require('./human-like');

function play(n, mode, who, hp, seedFirst) {
  const players = Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: 'P' + k, team: k % 2 ? 'B' : 'A' }));
  const g = new Game(players, { authority: hp, mode, randomOrder: false });
  let s = 0;
  while (!g.over && s++ < 40000) {
    let acted = false;
    for (const p of g.active()) {
      const pid = p.id;
      let a;
      if (who[pid] === 'bot') {
        const mate = g.players.find((x) => x.team === p.team && x.id !== pid && x.alive);
        const holdShared = g.mode === 'teams' && mate && who[mate.id] !== 'bot' && !g.ready[mate.id];
        a = bot.decide(g, pid, { holdShared });
      } else a = hl.decide(g, pid);
      if (!a) continue;
      try { g.act(pid, a); } catch (e) { try { g.act(pid, { type: 'endTurn' }); } catch {} }
      acted = true; break;
    }
    if (!acted) break;
  }
  return g;
}
function run(N, hp) {
  let duel = 0, mixed = 0, turnsD = 0, turnsM = 0, hpLeft = 0, hpN = 0;
  for (let i = 0; i < N; i++) {
    const botFirst = i % 2 === 0;
    let who = botFirst ? { p0: 'bot', p1: 'hum' } : { p0: 'hum', p1: 'bot' };
    let g = play(2, 'ffa', who, hp);
    if (g.winners.some((id) => who[id] === 'bot')) duel++;
    turnsD += g.turnNo;
    // как у пользователя: человек + бот против двух ботов
    who = botFirst ? { p0: 'bot', p2: 'bot', p1: 'hum', p3: 'bot' } : { p0: 'hum', p2: 'bot', p1: 'bot', p3: 'bot' };
    const humTeam = botFirst ? 'B' : 'A';
    g = play(4, 'teams', who, hp);
    const won = g.winners.length && g.pl(g.winners[0]).team !== humTeam;
    if (won) mixed++; else { hpLeft += g.players.find((p) => p.team === humTeam).authority; hpN++; }
    turnsM += g.turnNo;
  }
  console.log(`здоровье ${hp}: бот против «человека» 1×1 — ${(duel / N * 100).toFixed(0)}% (ходов ${(turnsD / N).toFixed(0)}); боты против «человек+бот» 2×2 — ${(mixed / N * 100).toFixed(0)}% (ходов ${(turnsM / N).toFixed(0)}, у победивших людей осталось ${hpN ? (hpLeft / hpN).toFixed(0) : '-'})`);
}
if (require.main === module) {
  const N = Number(process.argv[2] || 200);
  for (const hp of String(process.argv[3] || '50,150,350').split(',').map(Number)) run(N, hp);
}
module.exports = { play, run };
