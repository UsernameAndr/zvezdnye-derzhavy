'use strict';
// Сетевая проверка: 3 клиента через WebSocket создают стол, хост меняет влияние,
// игра стартует, клиенты делают ходы до конца партии.
const WebSocket = require('ws');
const { CARDS } = require('../public/cards.js');
const URL = process.argv[2] || 'ws://localhost:3000';

function client(name) {
  return new Promise((res) => {
    const ws = new WebSocket(URL);
    const c = { ws, name, room: null, pid: null, errors: [], waiters: [] };
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'hello') { c.pid = m.pid; res(c); }
      if (m.t === 'room') c.room = m.room;
      if (m.t === 'error') c.errors.push(m.msg);
      c.waiters.splice(0).forEach((f) => f(m));
    });
    ws.on('open', () => c.send({ t: 'hello', token: 'tok-' + name + '-' + Date.now(), name }));
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const [a, b, c] = await Promise.all([client('Аня'), client('Боря'), client('Вика')]);
  a.send({ t: 'create', name: 'Аня' });
  await wait(100);
  const code = a.room.code;
  b.send({ t: 'join', code, name: 'Боря' });
  c.send({ t: 'join', code, name: 'Вика' });
  await wait(100);
  b.send({ t: 'settings', settings: { authority: 5 } }); // не хост — должна быть ошибка
  a.send({ t: 'settings', settings: { authority: 30, maxPlayers: 4, randomOrder: true } });
  await wait(100);
  console.log('код стола', code, 'игроков', a.room.members.length, 'влияние', a.room.settings.authority, 'ошибка не-хоста:', b.errors[0]);
  a.send({ t: 'start' });
  await wait(150);
  const all = [a, b, c];
  console.log('старт: влияние у всех', a.room.game.players.map((p) => p.authority).join(','), '; руки видны только себе:',
    a.room.game.players.filter((p) => p.hand).length === 1);

  let steps = 0;
  while (!a.room.game.over && steps < 4000) {
    const g = a.room.game;
    const curC = all.find((x) => x.pid === g.turn);
    const cg = curC.room.game;
    const me = cg.players.find((p) => p.id === curC.pid);
    let act;
    if (cg.prompt) {
      const pr = cg.prompt;
      if (pr.kind === 'choose') act = { type: 'answer', option: 0 };
      else if (pr.kind === 'opponent') act = { type: 'answer', target: pr.options[0] };
      else act = { type: 'answer', uids: pr.cards.slice(0, pr.min).map((x) => x.uid) };
    } else if (me.hand.length) act = { type: 'playAll' };
    else {
      const i = cg.row.findIndex((x) => x && CARDS[x.cid].cost <= cg.pool.trade);
      if (i >= 0) act = { type: 'buy', slot: i };
      else if (cg.pool.combat > 0) {
        const t = cg.players.find((p) => p.alive && p.id !== curC.pid);
        const out = t.bases.find((x) => CARDS[x.cid].outpost);
        if (out) act = CARDS[out.cid].defense <= cg.pool.combat ? { type: 'attackBase', target: t.id, uid: out.uid } : { type: 'endTurn' };
        else act = { type: 'attackPlayer', target: t.id, amount: cg.pool.combat };
      } else act = { type: 'endTurn' };
    }
    curC.send({ t: 'act', a: act });
    await new Promise((r) => curC.waiters.push(r));
    await wait(2);
    steps++;
  }
  const g = a.room.game;
  console.log('партия окончена:', g.over, 'победитель:', g.players.find((p) => p.id === g.winner)?.name, 'ходов:', g.turnNo, 'ошибок у клиентов:', all.flatMap((x) => x.errors).length - 1);
  a.send({ t: 'toLobby' });
  await wait(100);
  console.log('возврат в лобби:', a.room.game === null, 'игроков за столом:', a.room.members.length);

  // переподключение: клиент с тем же токеном возвращается за стол
  const tok = 'tok-reconnect-' + Date.now();
  const d = await new Promise((res) => { const ws = new WebSocket(URL); ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token: tok, name: 'Гена' }))); ws.on('message', (r) => { const m = JSON.parse(r); if (m.t === 'hello') res(ws); }); });
  d.send(JSON.stringify({ t: 'join', code, name: 'Гена' }));
  await wait(100);
  d.close();
  await wait(100);
  const back = await new Promise((res) => { const ws = new WebSocket(URL); ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token: tok }))); ws.on('message', (r) => { const m = JSON.parse(r); if (m.t === 'room') res(m.room); }); });
  console.log('переподключение вернуло за стол:', back.code === code);
  process.exit(0);
})();
