'use strict';
// Точечные проверки правил на подстроенных ситуациях.
const assert = require('assert');
const { Game } = require('../game/engine');

let uid = 0;
const c = (cid) => ({ uid: 't' + uid++, cid });
function setup(n = 2, hand = []) {
  const g = new Game(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), { authority: 50, randomOrder: false });
  const p = g.cur();
  p.discard.push(...p.hand); p.hand = hand.map(c);
  g.pool = { trade: 0, combat: 0 };
  return { g, p, o: g.players[1] };
}
const t = (name, fn) => { try { fn(); console.log('✓', name); } catch (e) { console.log('✗', name, '\n ', e.message); process.exitCode = 1; } };

t('союзная способность срабатывает при второй карте фракции', () => {
  const { g, p } = setup(2, ['b_fighter', 'b_tradepod']);
  const h0 = p.hand.length;
  g.act('p0', { type: 'play', uid: p.hand[0].uid });
  assert.equal(g.pool.combat, 3);
  g.act('p0', { type: 'play', uid: p.hand[0].uid });
  // Жалохват: +3, ally +карта; Спороносец: +3 торг., ally +2 урона
  assert.equal(g.pool.combat, 5);
  assert.equal(g.pool.trade, 3);
  assert.equal(p.hand.length, h0 - 2 + 1);
});

t('аванпост защищает игрока и другие базы', () => {
  const { g, o } = setup();
  o.bases.push(c('t_post'), c('b_hive'));
  g.pool.combat = 20;
  assert.throws(() => g.act('p0', { type: 'attackPlayer', target: 'p1', amount: 5 }), /аванпост/);
  assert.throws(() => g.act('p0', { type: 'attackBase', target: 'p1', uid: o.bases[1].uid }), /аванпост/);
  g.act('p0', { type: 'attackBase', target: 'p1', uid: o.bases[0].uid });
  assert.equal(g.pool.combat, 16);
  g.act('p0', { type: 'attackBase', target: 'p1', uid: o.bases[0].uid });
  g.act('p0', { type: 'attackPlayer', target: 'p1', amount: 11 });
  assert.equal(o.authority, 39);
  assert.equal(o.discard.filter((x) => x.cid === 't_post' || x.cid === 'b_hive').length, 2);
});

t('сброс у соперника происходит в начале его хода по его выбору', () => {
  const { g, p, o } = setup(2, ['e_fighter']);
  g.act('p0', { type: 'play', uid: p.hand[0].uid });
  assert.equal(o.pendingDiscard, 1);
  g.act('p0', { type: 'endTurn' });
  assert.equal(g.cur().id, 'p1');
  assert.equal(g.prompt.purpose, 'discard');
  const before = o.hand.length;
  g.act('p1', { type: 'answer', uids: [o.hand[0].uid] });
  assert.equal(o.hand.length, before - 1);
});

t('в игре на 3+ игроков сброс выбирает цель', () => {
  const { g, p } = setup(3, ['e_fighter']);
  g.act('p0', { type: 'play', uid: p.hand[0].uid });
  assert.equal(g.prompt.kind, 'opponent');
  g.act('p0', { type: 'answer', target: 'p2' });
  assert.equal(g.players[2].pendingDiscard, 1);
});

t('Адмиралтейство: +1 урон каждому кораблю', () => {
  const { g, p } = setup(2, ['viper', 'scout']);
  p.bases.push(c('e_hq'));
  g.act('p0', { type: 'play', uid: p.hand[0].uid });
  g.act('p0', { type: 'play', uid: p.hand[0].uid });
  assert.equal(g.pool.combat, 3);
});

t('Сердце Ордена — союзник для любой фракции', () => {
  const { g, p } = setup(2, ['t_shuttle']);
  p.bases.push(c('m_mechworld'));
  const a = p.authority;
  g.act('p0', { type: 'play', uid: p.hand[0].uid });
  assert.equal(p.authority, a + 4);
});

t('Мимикр копирует корабль и получает его фракцию', () => {
  const { g, p } = setup(2, ['b_ram', 'm_needle']);
  g.act('p0', { type: 'play', uid: p.hand[0].uid });
  assert.equal(g.pool.combat, 5);
  g.act('p0', { type: 'play', uid: p.hand[0].uid });
  assert.equal(g.prompt.purpose, 'copy');
  g.act('p0', { type: 'answer', uids: [g.prompt.cards[0].uid] });
  // копия Тарана +5, и оба получают союз Роя +2
  assert.equal(g.pool.combat, 14);
});

t('Тяжёлый транспорт: купленный корабль на верх колоды', () => {
  const { g, p } = setup(2, ['t_freighter', 't_shuttle']);
  g.act('p0', { type: 'playAll' });
  assert.equal(g.topNext, 1);
  g.row[0] = c('b_fighter');
  g.act('p0', { type: 'buy', slot: 0 });
  assert.equal(p.deck[p.deck.length - 1].cid, 'b_fighter');
});

t('база выбора активируется вручную, простая — сама в начале хода', () => {
  const { g, p } = setup(2, []);
  p.bases.push(c('t_barter'), c('b_hive'));
  g.act('p0', { type: 'endTurn' });
  g.act('p1', { type: 'endTurn' });
  assert.equal(g.pool.combat, 3);
  g.act('p0', { type: 'activate', uid: p.bases[0].uid });
  g.act('p0', { type: 'answer', option: 1 });
  assert.equal(g.pool.trade, 2);
  assert.throws(() => g.act('p0', { type: 'activate', uid: p.bases[0].uid }), /уже/);
});

t('утилизация Старателя возвращает его в стопку', () => {
  const { g, p } = setup(2, ['explorer']);
  g.explorers = 9;
  g.act('p0', { type: 'play', uid: p.hand[0].uid });
  g.act('p0', { type: 'scrap', uid: p.inPlay[0].uid });
  assert.equal(g.pool.combat, 2);
  assert.equal(g.explorers, 10);
});

t('выбывание и победа', () => {
  const { g, o } = setup();
  g.pool.combat = 60;
  g.act('p0', { type: 'attackPlayer', target: 'p1', amount: 60 });
  assert.equal(o.alive, false);
  assert.equal(g.over, true);
  assert.equal(g.winner, 'p0');
});

t('стартовые руки: 3/4/5/5', () => {
  const g = new Game([1, 2, 3, 4].map((i) => ({ id: 'p' + i, name: 'x' })), { authority: 50, randomOrder: false });
  assert.deepEqual(g.players.map((p) => p.hand.length), [3, 4, 5, 5]);
});
