'use strict';
// Обучение ценности карт для долгих партий (много здоровья) — как test/learn-cards.js,
// но этап партии определяется тем, сколько здоровья ещё осталось (longness в game/bot.js).
// Результат: game/card-values-long.json — карта → [мало до конца, середина, далеко до конца].
const fs = require('fs');
const path = require('path');
const { Game } = require('../game/engine');
const bot = require('../game/bot');
const { CARDS } = require('../public/cards.js');

const GAMES = Number(process.argv[2] || 20000);
const OUT = process.argv[3] || path.join(__dirname, '..', 'game', 'card-values-long.json');
const EXPLORE = 0.45;
const HPS = [100, 150, 200, 250, 350];
const ids = Object.keys(CARDS).filter((id) => CARDS[id].count > 0 || id === 'explorer');
const B = 3;
const fIdx = {};
ids.forEach((id, i) => { for (let b = 0; b < B; b++) fIdx[id + ':' + b] = i * B + b; });
const F = ids.length * B;
const MONEY = 16, HPB = 9;
const F2 = F + MONEY + B + HPB + 1;
const bucketOf = (g, p) => { const L = bot.longness(g, p); return L < 0.34 ? 0 : L < 0.67 ? 1 : 2; };

const samples = [];
const t0 = Date.now();
for (let n = 0; n < GAMES; n++) {
  const hp0 = HPS[n % HPS.length];
  const g = new Game([{ id: 'p0', name: 'A' }, { id: 'p1', name: 'B' }], { authority: hp0, randomOrder: true });
  const dec = [];
  let s = 0, skipTurn = -1;
  while (!g.over && s++ < 30000) {
    const pid = g.active()[0].id;
    let a = bot.decide(g, pid, {});
    if (!a) break;
    if (a.type === 'buy' && skipTurn === g.turnNo) a = { type: 'endTurn' };
    else if (a.type === 'buy' && bot.longness(g, g.pl(pid)) > 0 && Math.random() < EXPLORE) {
      const money = g.tradeOf(pid);
      const opts = g.row.map((c, i) => (c && CARDS[c.cid].cost <= money ? i : -1)).filter((i) => i >= 0);
      if (g.explorers > 0 && money >= 2) opts.push('explorer');
      opts.push('skip');
      const o = opts[Math.floor(Math.random() * opts.length)];
      const me = g.pl(pid), op = g.players.find((x) => x.id !== pid);
      const b = bucketOf(g, me);
      const hpd = Math.max(0, Math.min(HPB - 1, Math.floor((me.authority - op.authority) / (hp0 / 10)) + 4));
      const x = [F + Math.min(money, MONEY - 1), F + MONEY + b, F + MONEY + B + hpd];
      if (g.players[0].id === pid) x.push(F2 - 1);
      if (o !== 'skip') x.push(fIdx[(o === 'explorer' ? 'explorer' : g.row[o].cid) + ':' + b]);
      dec.push({ pid, x });
      if (o === 'skip') { skipTurn = g.turnNo; a = { type: 'endTurn' }; } else a = { type: 'buy', slot: o };
    }
    try { g.act(pid, a); } catch (e) { try { g.act(pid, { type: 'endTurn' }); } catch {} }
  }
  if (!g.over) continue;
  for (const d of dec) samples.push({ x: d.x, y: g.winners.includes(d.pid) ? 1 : 0 });
  if (n % 2000 === 0 && n) console.log(`${n} партий, решений ${samples.length}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
}
console.log(`данных: ${samples.length}`);
const w = new Float64Array(F2), bias = [0];
const l2 = 2e-4;
for (let ep = 0; ep < 12; ep++) {
  const lr = 0.03 / (1 + ep * 0.3);
  for (let i = samples.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [samples[i], samples[j]] = [samples[j], samples[i]]; }
  let loss = 0;
  for (const smp of samples) {
    let z = bias[0];
    for (const f of smp.x) z += w[f];
    const pr = 1 / (1 + Math.exp(-z));
    const gr = pr - smp.y;
    loss += -(smp.y * Math.log(pr + 1e-9) + (1 - smp.y) * Math.log(1 - pr + 1e-9));
    bias[0] -= lr * gr;
    for (const f of smp.x) w[f] -= lr * (gr + l2 * w[f]);
  }
  if (ep % 4 === 3) console.log(`эпоха ${ep + 1}: потери ${(loss / samples.length).toFixed(4)}`);
}
const out = {};
ids.forEach((id, i) => { out[id] = [0, 1, 2].map((b) => +w[i * B + b].toFixed(4)); });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
for (let b = 0; b < 3; b++) {
  const top = Object.entries(out).map(([id, v]) => [CARDS[id].name, v[b]]).sort((x, y) => y[1] - x[1]);
  console.log(['близко к концу', 'середина', 'далеко до конца'][b] + ': лучшие —', top.slice(0, 6).map((x) => `${x[0]} ${x[1].toFixed(2)}`).join(', '), '| худшие —', top.slice(-4).map((x) => `${x[0]} ${x[1].toFixed(2)}`).join(', '));
}
