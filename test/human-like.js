'use strict';
// «Сильный человек»: держит две фракции, покупает лучшее в них, чистит колоду, сносит аванпосты и полезные базы.
const { CARDS } = require('../public/cards.js');
const def = (c) => CARDS[c.copied || c.cid];
function favs(p) {
  const n = {};
  for (const c of [...p.deck, ...p.hand, ...p.discard, ...p.inPlay, ...p.bases]) { const f = def(c).faction; if (f !== 'none') n[f] = (n[f] || 0) + 1; }
  return Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]);
}
function decide(g, pid) {
  const p = g.pl(pid);
  const pr = g.promptOf(pid);
  if (pr) {
    if (pr.pid !== pid) return null;
    if (pr.kind === 'choose') { const sc = pr.options.map((o) => o.reduce((s, e) => s + (e.combat || 0) * 1.1 + (e.trade || 0) + (e.auth || 0) * 0.4 + (e.draw || 0) * 2, 0)); return { type: 'answer', option: sc.indexOf(Math.max(...sc)) }; }
    if (pr.kind === 'opponent') return { type: 'answer', target: pr.options[0] };
    const junk = pr.cards.filter((c) => c.cid === 'scout' || c.cid === 'viper');
    if (/scrapHD|brain|scrapHand|recycle|discard/.test(pr.purpose)) {
      const pick = (junk.length ? junk : pr.cards).slice(0, Math.max(pr.min, Math.min(pr.max, junk.length))).map((c) => c.uid);
      return { type: 'answer', uids: pick.length >= pr.min ? pick : pr.cards.slice(0, pr.min).map((c) => c.uid) };
    }
    const best = pr.cards.slice().sort((a, b) => CARDS[b.cid].cost - CARDS[a.cid].cost)[0];
    return { type: 'answer', uids: pr.purpose === 'scrapRow' ? [] : [best.uid] };
  }
  if (!g.isActive(pid) || g.ready[pid]) return null;
  if (p.hand.length) return { type: 'play', uid: (p.hand.find((c) => CARDS[c.cid].type === 'base') || p.hand[0]).uid };
  const man = p.bases.find((b) => def(b).primary.length && !(b.used && b.used.primary));
  if (man) return { type: 'activate', uid: man.uid };
  const money = g.tradeOf(pid), F = favs(p);
  const turn = Math.floor(g.turnNo / 2);
  const opts = g.row.map((c, i) => ({ c, i })).filter((x) => x.c && CARDS[x.c.cid].cost <= money)
    .map((x) => ({ ...x, v: CARDS[x.c.cid].cost + (F.length < 2 || F.includes(CARDS[x.c.cid].faction) ? 2.5 : 0) + (CARDS[x.c.cid].type === 'base' ? 1 : 0) }))
    .sort((a, b) => b.v - a.v);
  if (opts.length) return { type: 'buy', slot: opts[0].i };
  if (money >= 2 && turn <= 3 && g.explorers > 0) return { type: 'buy', slot: 'explorer' };
  const combat = g.pool.combat;
  if (combat > 0) {
    const t = g.opponents(p)[0];
    const outs = t.bases.filter((b) => def(b).outpost);
    if (outs.length) { const k = outs.find((b) => def(b).defense <= combat); return k ? { type: 'attackBase', target: t.id, uid: k.uid } : { type: 'endTurn' }; }
    const vb = t.bases.find((b) => def(b).defense <= combat && t.authority > combat && (def(b).fleetHQ || def(b).allAlly || def(b).primary.some((e) => e.combat || e.draw || e.blobDraw)));
    if (vb) return { type: 'attackBase', target: t.id, uid: vb.uid };
    return { type: 'attackPlayer', target: t.id, amount: Math.min(combat, t.authority) };
  }
  return { type: 'endTurn' };
}
module.exports = { decide };
