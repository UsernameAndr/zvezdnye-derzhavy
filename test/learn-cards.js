'use strict';
// Обучение ценности карт на самоигре.
// Боты играют тысячи партий 1×1; при покупке иногда выбирают случайную карту (исследование).
// Затем логистическая регрессия: какие покупки (карта × этап партии) повышают шанс победы.
// Результат пишется в game/card-values.json и используется ботом для решения, что покупать.
const fs = require('fs');
const path = require('path');
const { Game } = require('../game/engine');
const bot = require('../game/bot');
const { CARDS } = require('../public/cards.js');

const GAMES = Number(process.argv[2] || 20000);
const EXPLORE = 0.45;
const ids = Object.keys(CARDS).filter((id) => CARDS[id].count > 0 || id === 'explorer');
const B = 3; // этапы: начало / середина / конец
const fIdx = {};
ids.forEach((id, i) => { for (let b = 0; b < B; b++) fIdx[id + ':' + b] = i * B + b; });
const F = ids.length * B;
const bucket = (t) => (t <= 3 ? 0 : t <= 7 ? 1 : 2);

const samples = [];
const MONEY = 16, HPB = 9;
// признаки: [выбор карты × этап] + контроль: деньги, этап, разница здоровья, кто ходил первым
const cIdx = (m, b, h) => F + Math.min(m, MONEY - 1) + MONEY * 0 + 0 * b + 0 * h;
const F2 = F + MONEY + B + HPB + 1;
const t0 = Date.now();
for (let n = 0; n < GAMES; n++) {
  const g = new Game([{ id: 'p0', name: 'A' }, { id: 'p1', name: 'B' }], { authority: 50, randomOrder: true });
  const dec = [];
  let s = 0;
  while (!g.over && s++ < 6000) {
    const pid = g.prompt ? g.prompt.pid : g.active()[0].id;
    let a = bot.decide(g, pid, {});
    if (!a) break;
    if (a.type === 'buy' && Math.random() < EXPLORE) {
      const money = g.tradeOf(pid);
      const opts = g.row.map((c, i) => (c && CARDS[c.cid].cost <= money ? i : -1)).filter((i) => i >= 0);
      if (g.explorers > 0 && money >= 2) opts.push('explorer');
      opts.push('skip');
      const o = opts[Math.floor(Math.random() * opts.length)];
      const b = bucket(Math.floor(g.turnNo / 2));
      const me = g.pl(pid), op = g.players.find((x) => x.id !== pid);
      const hpd = Math.max(0, Math.min(HPB - 1, Math.floor((me.authority - op.authority) / 6) + 4));
      const x = [F + Math.min(money, MONEY - 1), F + MONEY + b, F + MONEY + B + hpd];
      if (g.players[0].id === pid) x.push(F2 - 1);
      if (o !== 'skip') x.push(fIdx[(o === 'explorer' ? 'explorer' : g.row[o].cid) + ':' + b]);
      dec.push({ pid, x });
      a = o === 'skip' ? null : { type: 'buy', slot: o };
      if (!a) { // «пропустить покупки»: дальше бот ходит без покупок в этот ход
        const turn = g.turnNo;
        while (!g.over && g.turnNo === turn && s++ < 6000) {
          const pid2 = g.prompt ? g.prompt.pid : g.active()[0].id;
          let b2 = bot.decide(g, pid2, {});
          if (!b2) break;
          if (b2.type === 'buy') b2 = { type: 'endTurn' };
          try { g.act(pid2, b2); } catch (e) { try { g.act(pid2, { type: 'endTurn' }); } catch {} }
        }
        continue;
      }
    }
    try { g.act(pid, a); } catch (e) { try { g.act(pid, { type: 'endTurn' }); } catch {} }
  }
  if (!g.over) continue;
  for (const d of dec) samples.push({ x: d.x, y: g.winners.includes(d.pid) ? 1 : 0 });
  if (n % 5000 === 0 && n) console.log(`${n} партий, решений ${samples.length}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
}
console.log(`данных: ${samples.length} случайных решений о покупке`);

const w = new Float64Array(F2), bias = [0];
const l2 = 2e-4;
for (let ep = 0; ep < 12; ep++) {
  const lr = 0.03 / (1 + ep * 0.3);
  for (let i = samples.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [samples[i], samples[j]] = [samples[j], samples[i]]; }
  let loss = 0;
  for (const smp of samples) {
    let z = bias[0];
    for (const f of smp.x) z += w[f];
    const p = 1 / (1 + Math.exp(-z));
    const gr = p - smp.y;
    loss += -(smp.y * Math.log(p + 1e-9) + (1 - smp.y) * Math.log(1 - p + 1e-9));
    bias[0] -= lr * gr;
    for (const f of smp.x) w[f] -= lr * (gr + l2 * w[f]);
  }
  if (ep % 4 === 3) console.log(`эпоха ${ep + 1}: потери ${(loss / samples.length).toFixed(4)}`);
}
const out = {};
ids.forEach((id, i) => { out[id] = [0, 1, 2].map((b) => +w[i * B + b].toFixed(4)); });
fs.writeFileSync(path.join(__dirname, '..', 'game', 'card-values.json'), JSON.stringify(out, null, 1));
for (let b = 0; b < 3; b++) {
  const top = Object.entries(out).map(([id, v]) => [CARDS[id].name, v[b]]).sort((x, y) => y[1] - x[1]);
  console.log(['начало', 'середина', 'конец'][b] + ': лучшие —', top.slice(0, 6).map((x) => `${x[0]} ${x[1].toFixed(2)}`).join(', '), '| худшие —', top.slice(-4).map((x) => `${x[0]} ${x[1].toFixed(2)}`).join(', '));
}
