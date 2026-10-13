'use strict';
// Подбор весов бота самоигрой: случайный поиск вокруг лучшего набора + проверка финалистов.
// node test/tune-bot.js [кандидатов] [партий на оценку]
const { W } = require('../game/bot');
const { duel } = require('./bench-bot');

const C = Number(process.argv[2] || 60);
const N = Number(process.argv[3] || 300);
const keys = Object.keys(W);
let best = { ...W };
Object.assign(W, best);
let bestScore = duel(N);
console.log('старт:', (bestScore * 100).toFixed(1) + '%');
let rng = 12345;
const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let i = 0; i < C; i++) {
  const cand = { ...best };
  const nChange = 2 + Math.floor(rand() * 4);
  for (let j = 0; j < nChange; j++) {
    const k = keys[Math.floor(rand() * keys.length)];
    const f = Math.exp((rand() - 0.5) * 1.2);
    cand[k] = +(cand[k] === 0 ? (rand() - 0.5) : cand[k] * f).toFixed(3);
  }
  Object.assign(W, cand);
  const r = duel(N);
  if (r > bestScore + 0.02) {
    // перепроверка, чтобы не поймать шум
    const r2 = duel(N);
    const avg = (r + r2) / 2;
    if (avg > bestScore + 0.01) { best = cand; bestScore = avg; console.log(`#${i}: ${(avg * 100).toFixed(1)}%`, JSON.stringify(cand)); }
  }
}
Object.assign(W, best);
console.log('итог (контроль 2000 партий):', (duel(2000) * 100).toFixed(1) + '%');
console.log('W =', JSON.stringify(best));
