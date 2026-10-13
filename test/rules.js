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
  g.pool = { trade: 0, combat: 0 }; g.purse = {};
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

t('сыгранную карту можно вернуть в руку', () => {
  const { g, p } = setup(2, ['viper', 'scout', 't_post']);
  const ids = p.hand.map((c) => c.uid);
  g.act('p0', { type: 'playAll' });
  assert.equal(g.pool.combat, 1);
  assert.equal(p.bases.length, 1);
  assert.deepEqual(g.undoable('p0').sort(), ids.slice().sort());
  // вернуть вторую карту — вернутся она и все сыгранные после неё
  g.act('p0', { type: 'undo', uid: ids[1] });
  const me = g.cur();
  assert.equal(me.hand.length, 2);
  assert.equal(me.bases.length, 0);
  assert.equal(g.pool.trade, 0);
  assert.equal(g.pool.combat, 1);
  assert.deepEqual(g.undoable('p0'), [ids[0]]);
});

t('нельзя вернуть карту, если она открыла новые карты', () => {
  const { g, p } = setup(2, ['e_corvette', 'scout']);
  g.act('p0', { type: 'play', uid: p.hand[0].uid }); // берёт карту
  assert.deepEqual(g.undoable('p0'), []);
});

t('после покупки вернуть карту нельзя', () => {
  const { g, p } = setup(2, ['scout', 'scout']);
  g.act('p0', { type: 'playAll' });
  g.act('p0', { type: 'buy', slot: 'explorer' });
  assert.deepEqual(g.undoable('p0'), []);
  assert.throws(() => g.act('p0', { type: 'undo', uid: 'x' }), /нельзя/);
});

t('выбор можно отменить, вернув карту', () => {
  const { g, p } = setup(2, ['m_patrol']);
  const uid = p.hand[0].uid;
  g.act('p0', { type: 'play', uid });
  assert.equal(g.prompt.kind, 'choose');
  g.act('p0', { type: 'undo', uid });
  assert.equal(g.prompt, null);
  assert.equal(g.cur().hand.length, 1);
});

// ── режим 2 на 2 ──
function teams() {
  const g = new Game([
    { id: 'a1', name: 'A1', team: 'A' }, { id: 'b1', name: 'B1', team: 'B' },
    { id: 'a2', name: 'A2', team: 'A' }, { id: 'b2', name: 'B2', team: 'B' },
  ], { authority: 75, randomOrder: false, mode: 'teams' });
  for (const p of g.players) { p.discard.push(...p.hand); p.hand = []; }
  g.pool = { trade: 0, combat: 0 }; g.purse = {};
  return g;
}

t('2×2: ходят оба напарника, урон общий, деньги у каждого свои', () => {
  const g = teams();
  assert.deepEqual(g.active().map((p) => p.id).sort(), ['a1', 'a2']);
  g.pl('a1').hand = [c('scout'), c('scout')]; g.pl('a2').hand = [c('viper')];
  g.act('a1', { type: 'playAll' }); g.act('a2', { type: 'playAll' });
  assert.equal(g.pool.combat, 1);
  assert.equal(g.tradeOf('a1'), 2);
  assert.equal(g.tradeOf('a2'), 0);
  assert.throws(() => g.act('a2', { type: 'buy', slot: 'explorer' }), /Не хватает денег/);
  g.act('a1', { type: 'buy', slot: 'explorer' });
  assert.ok(g.pl('a1').discard.some((x) => x.cid === 'explorer'));
  assert.equal(g.view('a2').pool.trade, 0);
  assert.equal(g.view('a2').purse.a1, 0);
  assert.throws(() => g.act('b1', { type: 'endTurn' }), /не ваш ход/);
});

t('2×2: ход переходит, только когда готовы оба', () => {
  const g = teams();
  g.act('a1', { type: 'endTurn' });
  assert.ok(g.isActive('a2'));
  g.act('a2', { type: 'endTurn' });
  assert.deepEqual(g.active().map((p) => p.id).sort(), ['b1', 'b2']);
});

t('2×2: здоровье общее, напарника атаковать нельзя', () => {
  const g = teams();
  g.pool.combat = 10;
  g.act('a1', { type: 'attackPlayer', target: 'b2', amount: 10 });
  assert.equal(g.pl('b1').authority, 65);
  assert.equal(g.pl('b2').authority, 65);
  g.pool.combat = 5;
  assert.throws(() => g.act('a1', { type: 'attackPlayer', target: 'a2', amount: 5 }), /Неверная цель/);
});

t('2×2: аванпост одного защищает всю команду', () => {
  const g = teams();
  g.pl('b1').bases.push(c('t_post'));
  g.pl('b2').bases.push(c('b_hive'));
  g.pool.combat = 20;
  assert.throws(() => g.act('a1', { type: 'attackPlayer', target: 'b2', amount: 5 }), /аванпост/);
  assert.throws(() => g.act('a1', { type: 'attackBase', target: 'b2', uid: g.pl('b2').bases[0].uid }), /аванпост/);
});

t('2×2: союз срабатывает от карты напарника', () => {
  const g = teams();
  g.pl('a1').hand = [c('b_fighter')]; g.pl('a2').hand = [c('b_tradepod')];
  g.act('a1', { type: 'playAll' });
  const h = g.pl('a1').hand.length;
  g.act('a2', { type: 'playAll' });
  assert.equal(g.pool.combat, 3 + 2);   // жалохват 3 + союз спороносца 2
  assert.equal(g.pl('a1').hand.length, h + 1); // союз жалохвата: a1 берёт карту
});

t('2×2: пока напарник выбирает, второй ждёт; напарник видит руку', () => {
  const g = teams();
  g.pl('a1').hand = [c('m_patrol')]; g.pl('a2').hand = [c('scout')];
  g.act('a1', { type: 'playAll' });
  assert.equal(g.prompt.pid, 'a1');
  assert.throws(() => g.act('a2', { type: 'playAll' }), /Напарник/);
  assert.ok(g.view('a2').players.find((p) => p.id === 'a1').hand);
  assert.equal(g.view('b1').players.find((p) => p.id === 'a1').hand, null);
});

t('2×2: команда выбывает целиком, победа команды', () => {
  const g = teams();
  g.pool.combat = 100;
  g.act('a2', { type: 'attackPlayer', target: 'b1', amount: 80 });
  assert.equal(g.over, true);
  assert.deepEqual(g.winners.sort(), ['a1', 'a2']);
  assert.ok(!g.pl('b1').alive && !g.pl('b2').alive);
});

t('2×2: вернуть карту нельзя, если после неё играл напарник', () => {
  const g = teams();
  g.pl('a1').hand = [c('scout')]; g.pl('a2').hand = [c('viper')];
  g.act('a1', { type: 'playAll' });
  const u = g.pl('a1').inPlay[0].uid;
  assert.deepEqual(g.undoable('a1'), [u]);
  g.act('a2', { type: 'playAll' });
  assert.deepEqual(g.undoable('a1'), []);
  assert.equal(g.undoable('a2').length, 1);
});

t('размер торговой колоды: 80 / 1.5× / 2× и авто', () => {
  const mk = (n, deckSize) => new Game(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'x' })), { deckSize });
  const total = (g) => g.tradeDeck.length + g.row.filter(Boolean).length;
  assert.equal(total(mk(2, '1')), 80);
  assert.equal(total(mk(2, '2')), 160);
  assert.equal(total(mk(2, '1.5')), 120);
  assert.equal(total(mk(2, 'auto')), 80);
  assert.equal(total(mk(6, 'auto')), 160);
  assert.equal(mk(6, 'auto').explorers, 20);
});

t('своя колода видна без порядка, чужая — нет', () => {
  const { g } = setup();
  const v = g.view('p0');
  const mine = v.players.find((p) => p.id === 'p0');
  assert.deepEqual(mine.deckList, mine.deckList.slice().sort());
  assert.equal(mine.deckList.length, mine.deckCount);
  assert.equal(v.players.find((p) => p.id === 'p1').deckList, null);
});

t('админ меняет здоровье, деньги и урон без записи в журнал', () => {
  const { g } = setup();
  const logLen = g.log.length;
  g.adminSet('p0', { hp: 99, trade: 7, combat: 12 });
  assert.equal(g.pl('p0').authority, 99);
  assert.equal(g.tradeOf('p0'), 7); assert.equal(g.pool.combat, 12);
  g.adminSet('p1', { hp: 5, trade: 100 });     // не его ход — деньги не меняются
  assert.equal(g.pl('p1').authority, 5);
  assert.equal(g.tradeOf('p1'), 0);
  assert.equal(g.log.length, logLen);
});

t('2×2: вышедший игрок не прикрывает команду своими аванпостами', () => {
  const g = teams();
  g.pl('b1').bases.push(c('t_post'));
  g.forfeit('b1');
  assert.equal(g.pl('b1').bases.length, 0);
  g.pool.combat = 5;
  g.act('a1', { type: 'attackPlayer', target: 'b2', amount: 5 });
  assert.equal(g.pl('b2').authority, 70);
});

t('лишний урон не сгорает о почти мёртвого соперника', () => {
  const { g, o } = setup(3);
  o.authority = 1;
  g.pool.combat = 10;
  g.act('p0', { type: 'attackPlayer', target: 'p1', amount: 10 });
  assert.equal(o.alive, false);
  assert.equal(g.pool.combat, 9);
  g.act('p0', { type: 'attackPlayer', target: 'p2', amount: 9 });
  assert.equal(g.pl('p2').authority, 41);
});

t('2×2: базой пользуется только владелец, защищает она всю команду', () => {
  const g = teams();
  g.pl('a1').bases.push(c('t_barter'));          // база с выбором, a1 — владелец
  const uid = g.pl('a1').bases[0].uid;
  assert.throws(() => g.act('a2', { type: 'activate', uid }), /Базы нет/);
  assert.throws(() => g.act('a2', { type: 'scrap', uid }), /не в игре/);
  g.act('a1', { type: 'activate', uid });
  g.act('a1', { type: 'answer', option: 1 });      // +2 денег — владельцу
  assert.equal(g.tradeOf('a1'), 2);
  assert.equal(g.tradeOf('a2'), 0);
  g.pl('a1').bases.push(c('t_post'));              // аванпост a1 защищает и a2
  g.finishTurn();
  g.pool.combat = 10;
  assert.throws(() => g.act('b1', { type: 'attackPlayer', target: 'a2', amount: 5 }), /аванпост/);
});

