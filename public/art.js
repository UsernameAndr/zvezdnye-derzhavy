/* Процедурные иллюстрации карт: у каждой карты своя картинка, стиль зависит от фракции. */
(function () {
  'use strict';
  const cache = {};

  function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const n = (v) => (Math.round(v * 10) / 10).toString();
  const between = (r, a, b) => a + r() * (b - a);

  function background(r, F, id) {
    let s = `<defs>
<radialGradient id="bg-${id}" cx="${n(between(r, 25, 75))}%" cy="${n(between(r, 25, 70))}%" r="85%"><stop offset="0" stop-color="${F.dark}"/><stop offset="1" stop-color="#04060c"/></radialGradient>
<radialGradient id="neb-${id}"><stop offset="0" stop-color="${F.color}" stop-opacity=".42"/><stop offset="1" stop-color="${F.color}" stop-opacity="0"/></radialGradient>
<linearGradient id="hull-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${F.light}"/><stop offset=".45" stop-color="${F.color}"/><stop offset="1" stop-color="${F.dark}"/></linearGradient>
<linearGradient id="metal-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef2f8"/><stop offset=".5" stop-color="#8d97a8"/><stop offset="1" stop-color="#2b313c"/></linearGradient>
<radialGradient id="glow-${id}"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="${F.light}"/><stop offset="1" stop-color="${F.color}" stop-opacity="0"/></radialGradient>
<radialGradient id="pl-${id}" cx="33%" cy="30%" r="75%"><stop offset="0" stop-color="${F.light}"/><stop offset=".42" stop-color="${F.color}"/><stop offset="1" stop-color="#020306"/></radialGradient>
</defs>
<rect width="120" height="72" fill="url(#bg-${id})"/>`;
    for (let i = 0; i < 2; i++) s += `<ellipse cx="${n(between(r, 0, 120))}" cy="${n(between(r, 0, 72))}" rx="${n(between(r, 25, 55))}" ry="${n(between(r, 12, 26))}" fill="url(#neb-${id})"/>`;
    for (let i = 0; i < 34; i++) s += `<circle cx="${n(r() * 120)}" cy="${n(r() * 72)}" r="${n(between(r, 0.15, 0.7))}" fill="#fff" opacity="${n(between(r, 0.3, 1))}"/>`;
    if (r() < 0.5) s += `<circle cx="${n(between(r, 8, 112))}" cy="${n(between(r, 6, 20))}" r="${n(between(r, 3, 7))}" fill="${F.color}" opacity=".35"/>`;
    return s;
  }

  const glow = (id, x, y, rx, ry) => `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="url(#glow-${id})"/>`;

  // ── корабли ──
  function shipTrade(r, id, F) {
    const L = between(r, 28, 34), H = between(r, 6, 9);
    let s = '';
    s += glow(id, -L * 0.85, -H * 0.45, 9, 3.5) + glow(id, -L * 0.85, H * 0.45, 9, 3.5);
    s += `<rect x="${n(-L * 0.55)}" y="${n(-H * 1.75)}" width="${n(L * 0.7)}" height="${n(H * 0.55)}" rx="1.5" fill="url(#metal-${id})"/>`;
    s += `<rect x="${n(-L * 0.55)}" y="${n(H * 1.2)}" width="${n(L * 0.7)}" height="${n(H * 0.55)}" rx="1.5" fill="url(#metal-${id})"/>`;
    s += `<path d="M${n(L)} 0 C${n(L * 0.6)} ${n(-H)} ${n(-L * 0.3)} ${n(-H * 1.25)} ${n(-L * 0.75)} ${n(-H)} L${n(-L * 0.78)} ${n(H)} C${n(-L * 0.3)} ${n(H * 1.25)} ${n(L * 0.6)} ${n(H)} ${n(L)} 0Z" fill="url(#hull-${id})" stroke="${F.light}" stroke-width=".5"/>`;
    s += `<path d="M${n(-L * 0.6)} 0 L${n(L * 0.75)} 0" stroke="${F.dark}" stroke-width="1.6"/>`;
    s += `<ellipse cx="${n(-L * 0.15)}" cy="0" rx="2.6" ry="${n(H * 1.7)}" fill="none" stroke="${F.light}" stroke-width="1.3" opacity=".9"/>`;
    s += `<ellipse cx="${n(L * 0.55)}" cy="${n(-H * 0.32)}" rx="4" ry="1.6" fill="#dff6ff"/>`;
    for (let i = 0; i < 5; i++) s += `<circle cx="${n(-L * 0.5 + i * L * 0.22)}" cy="${n(H * 0.45)}" r=".55" fill="#fff" opacity=".85"/>`;
    return s;
  }

  function shipEmpire(r, id, F) {
    const L = between(r, 30, 36), W = between(r, 14, 21);
    let s = '';
    s += glow(id, -L * 0.62, -W * 0.28, 8, 3) + glow(id, -L * 0.62, W * 0.28, 8, 3) + glow(id, -L * 0.55, 0, 6, 2.5);
    s += `<path d="M${n(L)} 0 L${n(-L * 0.7)} ${n(-W)} L${n(-L * 0.42)} 0 L${n(-L * 0.7)} ${n(W)}Z" fill="url(#hull-${id})" stroke="${F.light}" stroke-width=".6"/>`;
    s += `<path d="M${n(L * 0.8)} 0 L${n(-L * 0.3)} ${n(-W * 0.45)} L${n(-L * 0.18)} 0 L${n(-L * 0.3)} ${n(W * 0.45)}Z" fill="${F.dark}" opacity=".75"/>`;
    s += `<path d="M${n(L * 0.85)} 0 L${n(-L * 0.4)} 0" stroke="${F.light}" stroke-width=".7"/>`;
    s += `<path d="M${n(-L * 0.1)} ${n(-W * 0.55)} L${n(-L * 0.55)} ${n(-W * 1.05)} M${n(-L * 0.1)} ${n(W * 0.55)} L${n(-L * 0.55)} ${n(W * 1.05)}" stroke="${F.color}" stroke-width="1.2"/>`;
    s += `<circle cx="${n(L * 0.35)}" cy="0" r="1.6" fill="#fff6d0"/>`;
    s += `<circle cx="${n(-L * 0.7)}" cy="${n(-W)}" r=".9" fill="#ff5" /><circle cx="${n(-L * 0.7)}" cy="${n(W)}" r=".9" fill="#ff5"/>`;
    return s;
  }

  function gear(cx, cy, R, teeth, fill, stroke) {
    let pts = [];
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const rr = i % 2 ? R * 0.78 : R;
      pts.push(`${n(cx + Math.cos(a) * rr)},${n(cy + Math.sin(a) * rr)}`);
    }
    return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width=".6"/><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 0.35)}" fill="#111"/>`;
  }

  function shipMachine(r, id, F) {
    let s = '';
    s += glow(id, -26, -4, 8, 3) + glow(id, -26, 4, 8, 3);
    const blocks = 2 + Math.floor(r() * 3);
    for (let i = 0; i < blocks; i++) {
      const w = between(r, 8, 16), h = between(r, 5, 9);
      const x = between(r, -18, 10), y = r() < 0.5 ? between(r, -16, -10) : between(r, 7, 11);
      s += `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="1" fill="url(#metal-${id})" stroke="#222" stroke-width=".4"/>`;
    }
    s += `<path d="M-24 -8 L18 -9 L28 -3 L28 3 L18 9 L-24 8Z" fill="url(#hull-${id})" stroke="${F.light}" stroke-width=".5"/>`;
    s += `<rect x="-20" y="-3" width="30" height="6" fill="${F.dark}" opacity=".7"/>`;
    s += gear(-6, 0, between(r, 6, 8), 8, '#5a5f69', F.light);
    for (let i = 0; i < 4; i++) s += `<circle cx="${n(4 + i * 5)}" cy="0" r=".9" fill="#ff4a3a"/>`;
    s += `<path d="M12 -9 L16 -17 M8 -9 L9 -15" stroke="#aab" stroke-width=".6"/><circle cx="16" cy="-17" r=".9" fill="#f44"/>`;
    s += `<path d="M28 -2 L36 -1 L36 1 L28 2Z" fill="#ccc"/>`;
    return s;
  }

  function smoothPath(pts) {
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      d += i === 0 ? `M${n(mx)} ${n(my)}` : '';
      const c = pts[(i + 1) % pts.length], nx = pts[(i + 2) % pts.length];
      d += ` Q${n(c[0])} ${n(c[1])} ${n((c[0] + nx[0]) / 2)} ${n((c[1] + nx[1]) / 2)}`;
    }
    return d + 'Z';
  }

  function shipBlob(r, id, F) {
    let s = '';
    const R = between(r, 14, 19);
    const tent = 3 + Math.floor(r() * 3);
    for (let i = 0; i < tent; i++) {
      const y0 = between(r, -R * 0.5, R * 0.5);
      const x3 = between(r, -46, -32), y3 = y0 + between(r, -14, 14);
      s += `<path d="M${n(-R * 0.6)} ${n(y0)} Q${n(-R * 1.3)} ${n(y0 + between(r, -12, 12))} ${n((x3 - R) / 2)} ${n((y0 + y3) / 2)} T${n(x3)} ${n(y3)}" fill="none" stroke="${F.color}" stroke-width="${n(between(r, 1.5, 3))}" stroke-linecap="round" opacity=".9"/>`;
    }
    const pts = [];
    const N = 9;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const rr = R * between(r, 0.72, 1.18);
      pts.push([Math.cos(a) * rr * 1.15, Math.sin(a) * rr * 0.78]);
    }
    s += glow(id, 0, 0, R * 1.8, R * 1.2);
    s += `<path d="${smoothPath(pts)}" fill="url(#hull-${id})" stroke="${F.light}" stroke-width=".6"/>`;
    for (let i = 0; i < 5; i++) s += `<circle cx="${n(between(r, -R * 0.7, R * 0.7))}" cy="${n(between(r, -R * 0.45, R * 0.45))}" r="${n(between(r, 1, 2.6))}" fill="${F.dark}" opacity=".55"/>`;
    const eyes = r() < 0.4 ? 2 : 1;
    for (let i = 0; i < eyes; i++) {
      const ex = R * 0.45 + i * 3, ey = -R * 0.12 + i * 6;
      s += `<circle cx="${n(ex)}" cy="${n(ey)}" r="3.6" fill="#fff1a8"/><ellipse cx="${n(ex + 0.6)}" cy="${n(ey)}" rx=".9" ry="2.6" fill="#120"/>`;
    }
    if (r() < 0.6) s += `<path d="M${n(R * 0.7)} ${n(R * 0.25)} Q${n(R * 0.95)} ${n(R * 0.4)} ${n(R * 1.1)} ${n(R * 0.15)}" stroke="#0a1a08" stroke-width="1.3" fill="none"/>`;
    return s;
  }

  function shipNeutral(r, id, F, cid) {
    let s = glow(id, -16, 0, 9, 4);
    if (cid === 'explorer') {
      s += `<rect x="-14" y="-7" width="22" height="14" rx="3" fill="url(#metal-${id})" stroke="#556" stroke-width=".5"/>`;
      s += `<path d="M8 -5 L22 0 L8 5Z" fill="#d8b04a"/><path d="M10 -3 L22 0 L10 3" stroke="#865" stroke-width=".5" fill="none"/>`;
      s += `<rect x="-10" y="-11" width="12" height="4" fill="#667"/><circle cx="-2" cy="0" r="2.2" fill="#bfe8ff"/>`;
    } else if (cid === 'viper') {
      s += `<path d="M24 0 L-12 -11 L-6 0 L-12 11Z" fill="url(#metal-${id})" stroke="#dde" stroke-width=".5"/>`;
      s += `<path d="M18 0 L-4 -4 L-2 0 L-4 4Z" fill="#c33"/><circle cx="6" cy="0" r="1.6" fill="#bfe8ff"/>`;
    } else {
      s += `<path d="M20 0 C14 -7 -8 -8 -12 -6 L-12 6 C-8 8 14 7 20 0Z" fill="url(#metal-${id})" stroke="#dde" stroke-width=".5"/>`;
      s += `<rect x="-8" y="-10" width="12" height="4" rx="1" fill="#99a"/><rect x="-8" y="6" width="12" height="4" rx="1" fill="#99a"/>`;
      s += `<circle cx="10" cy="-1.5" r="1.8" fill="#bfe8ff"/>`;
    }
    return s;
  }

  // ── базы ──
  function station(r, id, F) {
    let s = `<g transform="translate(60 42)">`;
    s += glow(id, 0, 0, 30, 14);
    s += `<g transform="scale(1 .42)"><circle r="27" fill="none" stroke="${F.dark}" stroke-width="7"/><circle r="27" fill="none" stroke="url(#hull-${id})" stroke-width="4"/>`;
    const sp = 6 + Math.floor(r() * 3);
    for (let i = 0; i < sp; i++) {
      const a = (i / sp) * Math.PI * 2;
      s += `<line x1="${n(Math.cos(a) * 6)}" y1="${n(Math.sin(a) * 6)}" x2="${n(Math.cos(a) * 25)}" y2="${n(Math.sin(a) * 25)}" stroke="#8a93a3" stroke-width="1.3"/>`;
      s += `<circle cx="${n(Math.cos(a) * 27)}" cy="${n(Math.sin(a) * 27)}" r="2.2" fill="${F.light}"/>`;
    }
    s += `</g>`;
    const h = between(r, 18, 28);
    s += `<rect x="-5" y="${n(-h)}" width="10" height="${n(h + 4)}" rx="2" fill="url(#metal-${id})" stroke="#333" stroke-width=".4"/>`;
    s += `<rect x="-9" y="${n(-h * 0.55)}" width="18" height="5" rx="1.5" fill="url(#hull-${id})"/>`;
    s += `<path d="M0 ${n(-h)} L0 ${n(-h - 8)}" stroke="#ccd" stroke-width=".7"/><circle cx="0" cy="${n(-h - 8)}" r="1.2" fill="${F.light}"/>`;
    for (let i = 0; i < 4; i++) s += `<rect x="-3" y="${n(-h + 3 + i * 4)}" width="6" height="1" fill="#fff" opacity=".7"/>`;
    s += `<ellipse cx="0" cy="4" rx="8" ry="3" fill="${F.color}"/>`;
    return s + '</g>';
  }

  function planet(r, id, F, faction) {
    const cx = between(r, 48, 72), cy = between(r, 44, 52), R = between(r, 22, 28);
    let s = glow(id, cx, cy, R * 1.6, R * 1.4);
    const ring = r() < 0.55;
    if (ring) s += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(R * 1.7)}" ry="${n(R * 0.32)}" fill="none" stroke="${F.light}" stroke-width="1.4" opacity=".55" transform="rotate(-12 ${n(cx)} ${n(cy)})"/>`;
    s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" fill="url(#pl-${id})"/>`;
    s += `<clipPath id="cl-${id}"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}"/></clipPath><g clip-path="url(#cl-${id})">`;
    if (faction === 'blob') {
      for (let i = 0; i < 9; i++) s += `<circle cx="${n(cx + between(r, -R, R))}" cy="${n(cy + between(r, -R, R))}" r="${n(between(r, 2, 6))}" fill="${F.dark}" opacity=".6"/>`;
      for (let i = 0; i < 4; i++) s += `<path d="M${n(cx - R)} ${n(cy + between(r, -R, R))} q${n(R * 0.6)} ${n(between(r, -8, 8))} ${n(R * 2)} 0" stroke="${F.light}" stroke-width="1" fill="none" opacity=".4"/>`;
    } else if (faction === 'machine') {
      for (let i = -3; i <= 3; i++) s += `<ellipse cx="${n(cx)}" cy="${n(cy + i * R * 0.28)}" rx="${n(R)}" ry="${n(R * 0.08)}" fill="none" stroke="#300" stroke-width=".7" opacity=".7"/>`;
      for (let i = -3; i <= 3; i++) s += `<ellipse cx="${n(cx + i * R * 0.28)}" cy="${n(cy)}" rx="${n(R * 0.08 + Math.abs(i) * 0.5)}" ry="${n(R)}" fill="none" stroke="#300" stroke-width=".5" opacity=".6"/>`;
      for (let i = 0; i < 12; i++) s += `<circle cx="${n(cx + between(r, -R, R))}" cy="${n(cy + between(r, -R, R))}" r=".7" fill="#ff6a50"/>`;
    } else {
      for (let i = 0; i < 4; i++) s += `<ellipse cx="${n(cx + between(r, -R * 0.4, R * 0.4))}" cy="${n(cy + between(r, -R * 0.8, R * 0.8))}" rx="${n(between(r, R * 0.4, R))}" ry="${n(between(r, 1.5, 4))}" fill="${F.dark}" opacity=".45"/>`;
      for (let i = 0; i < 22; i++) s += `<circle cx="${n(cx + between(r, -R, R * 0.3))}" cy="${n(cy + between(r, -R * 0.2, R))}" r=".55" fill="#fff6c8" opacity=".9"/>`;
    }
    s += '</g>';
    // строения на «вершине» планеты
    const towers = faction === 'empire' ? 5 : 3;
    for (let i = 0; i < towers; i++) {
      const tx = cx - R * 0.5 + i * (R / (towers - 1 || 1)), th = between(r, 5, faction === 'empire' ? 14 : 9);
      const ty = cy - Math.sqrt(Math.max(0, R * R - (tx - cx) ** 2)) + 1;
      s += `<rect x="${n(tx - 1.4)}" y="${n(ty - th)}" width="2.8" height="${n(th)}" fill="url(#metal-${id})"/><circle cx="${n(tx)}" cy="${n(ty - th)}" r=".9" fill="${F.light}"/>`;
    }
    if (ring) s += `<path d="M${n(cx - R * 1.66)} ${n(cy + R * 0.05)} A${n(R * 1.7)} ${n(R * 0.32)} -12 0 0 ${n(cx + R * 1.66)} ${n(cy - R * 0.62)}" fill="none" stroke="${F.light}" stroke-width="1.4" opacity=".75"/>`;
    return s;
  }

  function art(cid) {
    if (cache[cid]) return cache[cid];
    const d = window.CARDS[cid];
    const F = window.FACTIONS[d.faction];
    const r = rng(hash(cid));
    const id = cid.replace(/[^a-z0-9]/gi, '');
    let s = `<svg viewBox="0 0 120 72" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">` + background(r, F, id);
    if (d.type === 'base') {
      s += d.outpost ? station(r, id, F) : planet(r, id, F, d.faction);
    } else {
      const sc = 0.75 + Math.min(d.cost, 8) * 0.055;
      const rot = between(r, -14, 6);
      const x = between(r, 56, 66), y = between(r, 34, 40);
      s += `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)}) scale(${n(sc)})">`;
      if (d.faction === 'trade') s += shipTrade(r, id, F);
      else if (d.faction === 'empire') s += shipEmpire(r, id, F);
      else if (d.faction === 'machine') s += shipMachine(r, id, F);
      else if (d.faction === 'blob') s += shipBlob(r, id, F);
      else s += shipNeutral(r, id, F, cid);
      s += '</g>';
      // эскорт для дорогих кораблей
      if (d.cost >= 5 && d.faction !== 'blob') {
        s += `<g transform="translate(${n(between(r, 14, 30))} ${n(between(r, 10, 20))}) rotate(${n(rot)}) scale(.22)">`;
        s += d.faction === 'trade' ? shipTrade(r, id, F) : d.faction === 'empire' ? shipEmpire(r, id, F) : shipMachine(r, id, F);
        s += '</g>';
      }
    }
    s += '</svg>';
    cache[cid] = s;
    return s;
  }

  window.cardArt = art;
})();
