/* Иллюстрации карт. Каждая картинка — отдельный SVG (туманность из шума, звёзды,
 * корабль или база со светом и тенью), который браузер отрисовывает как обычное изображение.
 * Результат кэшируется: одна и та же карта рисуется один раз.
 */
(function () {
  'use strict';
  const cache = {};
  const W = 300, H = 180;

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
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

  const SECOND = { blob: '#1d6f7a', trade: '#5b3a9c', empire: '#9c3b24', machine: '#4a2a7a', none: '#2f4566' };
  const METAL = { blob: '#6f8f63', trade: '#8e9db3', empire: '#a39a86', machine: '#8f8a8a', none: '#9aa3b0' };

  function nebula(id, seed, freq, color, s) {
    const [R, G, B] = rgb(color).map((v) => (v / 255).toFixed(3));
    return `<filter id="${id}" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse">
<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="5" seed="${seed}"/>
<feColorMatrix type="matrix" values="0 0 0 0 ${R} 0 0 0 0 ${G} 0 0 0 0 ${B} ${(4.4 * s).toFixed(2)} 0 0 0 ${(-2.05 * s).toFixed(2)}"/></filter>`;
  }

  function stars(r) {
    let s = '';
    for (let i = 0; i < 90; i++) s += `<circle cx="${n(r() * W)}" cy="${n(r() * H)}" r="${n(0.25 + r() * 0.6)}" fill="#fff" opacity="${n(0.25 + r() * 0.7)}"/>`;
    for (let i = 0; i < 5; i++) {
      const x = r() * W, y = r() * H, k = 2 + r() * 3;
      s += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(k * 2)}" fill="url(#star)"/><path d="M${n(x - k * 3)} ${n(y)}H${n(x + k * 3)}M${n(x)} ${n(y - k * 3)}V${n(y + k * 3)}" stroke="#fff" stroke-width=".4" opacity=".7"/>`;
    }
    return s;
  }

  // ── общие градиенты для объекта ──
  function objDefs(F, f) {
    const metal = METAL[f];
    return `
<linearGradient id="hull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(metal, '#ffffff', 0.55)}"/><stop offset=".35" stop-color="${metal}"/><stop offset=".7" stop-color="${mix(metal, '#000000', 0.55)}"/><stop offset="1" stop-color="#0b0d12"/></linearGradient>
<linearGradient id="hullL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(metal, '#ffffff', 0.7)}"/><stop offset="1" stop-color="${mix(metal, '#000000', 0.2)}"/></linearGradient>
<linearGradient id="hullD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(metal, '#000000', 0.45)}"/><stop offset="1" stop-color="#07080b"/></linearGradient>
<linearGradient id="acc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${F.light}"/><stop offset=".5" stop-color="${F.color}"/><stop offset="1" stop-color="${F.dark}"/></linearGradient>
<radialGradient id="glow"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="${F.light}"/><stop offset=".6" stop-color="${F.color}" stop-opacity=".45"/><stop offset="1" stop-color="${F.color}" stop-opacity="0"/></radialGradient>
<linearGradient id="plume" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${F.color}" stop-opacity="0"/><stop offset=".7" stop-color="${F.light}" stop-opacity=".7"/><stop offset="1" stop-color="#fff"/></linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8fbff"/><stop offset=".5" stop-color="#5fb7d8"/><stop offset="1" stop-color="#0c2a3a"/></linearGradient>
<filter id="blur2"><feGaussianBlur stdDeviation="2"/></filter>
<filter id="blur6"><feGaussianBlur stdDeviation="6"/></filter>`;
  }

  const plume = (x, y, len, h) => `<ellipse cx="${n(x - len / 2)}" cy="${n(y)}" rx="${n(len / 2)}" ry="${n(h)}" fill="url(#plume)"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(h * 1.6)}" fill="url(#glow)"/>`;
  const lights = (pts, c) => pts.map(([x, y]) => `<circle cx="${n(x)}" cy="${n(y)}" r=".9" fill="${c}"/><circle cx="${n(x)}" cy="${n(y)}" r="2.6" fill="${c}" opacity=".25"/>`).join('');

  // ── корабли (нос вправо, центр в 0,0) ──
  function shipTrade(r, F) {
    const L = 80 + r() * 15;
    let s = plume(-L + 6, -9, 70, 5) + plume(-L + 6, 9, 70, 5);
    s += `<rect x="${n(-L)}" y="-17" width="14" height="34" rx="3" fill="url(#hullD)"/>`;
    // грузовые контейнеры
    const cc = ['#7d4a32', '#3f5f7a', '#6b6b3a', '#4c3f6b', '#2f6b5a', '#7a3a3a'];
    const pods = 4 + Math.floor(r() * 2);
    for (let row of [-1, 1]) for (let i = 0; i < pods; i++) {
      const x = -L + 18 + i * 21, y = row < 0 ? -33 : 17, c = cc[Math.floor(r() * cc.length)];
      s += `<rect x="${x}" y="${y}" width="18" height="16" rx="1.5" fill="${c}"/><rect x="${x}" y="${y}" width="18" height="5" fill="#fff" opacity="${row < 0 ? 0.25 : 0.06}"/><path d="M${x + 6} ${y}v16M${x + 12} ${y}v16" stroke="#000" stroke-width=".6" opacity=".35"/>`;
    }
    s += `<path d="M${n(-L + 10)} -16 L40 -18 Q78 -15 ${n(L * 0.5 + 52)} -3 L${n(L * 0.5 + 56)} 0 L${n(L * 0.5 + 52)} 3 Q78 15 40 18 L${n(-L + 10)} 16Z" fill="url(#hull)"/>`;
    s += `<path d="M${n(-L + 10)} -16 L40 -18 Q78 -15 ${n(L * 0.5 + 52)} -3" fill="none" stroke="${F.light}" stroke-width="1" opacity=".7"/>`;
    s += `<rect x="${n(-L + 14)}" y="-3" width="${n(L + 50)}" height="4" fill="url(#acc)" opacity=".9"/>`;
    for (let x = -L + 24; x < 50; x += 13) s += `<path d="M${x} -16v32" stroke="#000" stroke-width=".5" opacity=".3"/>`;
    s += `<path d="M30 -18 L52 -27 L70 -27 L74 -15Z" fill="url(#hullL)"/><path d="M54 -25 L68 -25 L70 -20 L54 -20Z" fill="url(#glass)"/>`;
    s += lights([[n(L * 0.5 + 54), 0], [-20, 8], [0, 8], [20, 8]], '#ffe9b0');
    return s;
  }

  function shipEmpire(r, F) {
    const L = 95, Wd = 36 + r() * 10;
    let s = plume(-62, -10, 60, 6) + plume(-62, 10, 60, 6) + plume(-58, 0, 50, 4);
    s += `<path d="M${L} 0 L-60 ${n(-Wd)} L-46 -12 L-66 -10 L-66 10 L-46 12 L-60 ${n(Wd)}Z" fill="url(#hullD)"/>`;
    s += `<path d="M${L - 4} 0 L-56 ${n(-Wd + 4)} L-40 0Z" fill="url(#hullL)"/>`;
    s += `<path d="M${L - 4} 0 L-40 0 L-56 ${n(Wd - 4)}Z" fill="url(#hullD)" opacity=".95"/>`;
    for (let i = 1; i < 6; i++) { const t = i / 6; s += `<path d="M${n(L - 4 - t * (L + 52))} ${n(-(Wd - 4) * t)} L${n(L - 4 - t * (L + 36))} 0" stroke="#000" stroke-width=".6" opacity=".35"/>`; }
    s += `<path d="M${L} 0 L-60 ${n(-Wd)} M${L} 0 L-60 ${n(Wd)}" stroke="${F.color}" stroke-width="1.4"/>`;
    s += `<path d="M${L - 4} 0 L-40 0" stroke="${F.light}" stroke-width=".8" opacity=".8"/>`;
    // надстройка
    s += `<rect x="-38" y="-14" width="26" height="12" fill="url(#hullL)"/><rect x="-32" y="-22" width="14" height="9" fill="url(#hull)"/><rect x="-30" y="-20" width="10" height="2.5" fill="url(#glass)"/>`;
    s += `<path d="M-38 -14 h26" stroke="${F.color}" stroke-width="1"/>`;
    s += lights([[60, -6], [30, -12], [0, -18], [-30, -24], [30, 12], [0, 18]], F.light);
    return s;
  }

  function gear(cx, cy, R, teeth) {
    let pts = [];
    for (let i = 0; i < teeth * 2; i++) { const a = (i / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? R * 0.8 : R; pts.push(`${n(cx + Math.cos(a) * rr)},${n(cy + Math.sin(a) * rr)}`); }
    return `<polygon points="${pts.join(' ')}" fill="url(#hull)" stroke="#000" stroke-width=".6"/><circle cx="${cx}" cy="${cy}" r="${n(R * 0.55)}" fill="url(#hullD)"/><circle cx="${cx}" cy="${cy}" r="${n(R * 0.25)}" fill="url(#glow)"/>`;
  }

  function shipMachine(r, F) {
    let s = plume(-78, -8, 55, 5) + plume(-78, 8, 55, 5);
    // ферма
    s += `<rect x="-76" y="-7" width="110" height="14" fill="none" stroke="#5d6066" stroke-width="1.6"/>`;
    for (let x = -76; x < 34; x += 10) s += `<path d="M${x} -7 L${x + 10} 7 M${x} 7 L${x + 10} -7" stroke="#5d6066" stroke-width=".9"/>`;
    const mods = 3 + Math.floor(r() * 2);
    for (let i = 0; i < mods; i++) {
      const x = -70 + i * 26 + r() * 6, w = 18 + r() * 8, h = 14 + r() * 14, up = r() < 0.5;
      s += `<rect x="${n(x)}" y="${n(up ? -7 - h : 7)}" width="${n(w)}" height="${n(h)}" rx="1.5" fill="url(#hull)" stroke="#111" stroke-width=".5"/>`;
      s += `<rect x="${n(x)}" y="${n(up ? -7 - h + 3 : 7 + h - 6)}" width="${n(w)}" height="3" fill="url(#acc)"/>`;
    }
    s += `<path d="M30 -16 L72 -10 L88 0 L72 10 L30 16Z" fill="url(#hull)"/><path d="M30 -16 L72 -10 L88 0" fill="none" stroke="${F.light}" stroke-width=".8" opacity=".6"/>`;
    s += `<path d="M58 -6 L76 -3 L76 3 L58 6Z" fill="#300" /><path d="M60 -4 L74 -2 L74 2 L60 4Z" fill="${F.color}" opacity=".9"/>`;
    s += gear(-8, 0, 17 + r() * 4, 10);
    s += `<path d="M10 -16 L14 -38 M20 -16 L22 -30" stroke="#888" stroke-width=".9"/>` + lights([[14, -38], [22, -30], [86, 0]], '#ff4a3a');
    return s;
  }

  function smoothPath(pts) {
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      const c = pts[(i + 1) % pts.length], nx = pts[(i + 2) % pts.length];
      if (i === 0) { const a = pts[0]; d += `M${n((a[0] + c[0]) / 2)} ${n((a[1] + c[1]) / 2)}`; }
      d += ` Q${n(c[0])} ${n(c[1])} ${n((c[0] + nx[0]) / 2)} ${n((c[1] + nx[1]) / 2)}`;
    }
    return d + 'Z';
  }

  function shipBlob(r, F, cost) {
    const R = 38 + Math.min(cost, 8) * 2.5;
    let s = `<circle cx="0" cy="0" r="${n(R * 1.5)}" fill="${F.color}" opacity=".25" filter="url(#blur6)"/>`;
    const tent = 4 + Math.floor(r() * 3);
    for (let i = 0; i < tent; i++) {
      const y0 = (r() - 0.5) * R * 0.9, x3 = -R * 2.4 - r() * 30, y3 = y0 + (r() - 0.5) * 60;
      const d = `M${n(-R * 0.6)} ${n(y0)} Q${n(-R * 1.4)} ${n(y0 + (r() - 0.5) * 50)} ${n((x3 - R) / 2)} ${n((y0 + y3) / 2)} T${n(x3)} ${n(y3)}`;
      s += `<path d="${d}" fill="none" stroke="${F.dark}" stroke-width="${n(5 + r() * 4)}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${F.color}" stroke-width="${n(2 + r() * 2)}" stroke-linecap="round" opacity=".9"/>`;
    }
    const pts = [];
    for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2, rr = R * (0.78 + r() * 0.36); pts.push([Math.cos(a) * rr * 1.15, Math.sin(a) * rr * 0.8]); }
    const body = smoothPath(pts);
    s += `<radialGradient id="flesh" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${mix(F.light, '#ffffff', 0.3)}"/><stop offset=".35" stop-color="${F.color}"/><stop offset=".8" stop-color="${F.dark}"/><stop offset="1" stop-color="#050a05"/></radialGradient>`;
    s += `<path d="${body}" fill="url(#flesh)"/><path d="${body}" fill="none" stroke="${F.light}" stroke-width="1" opacity=".5"/>`;
    for (let i = 0; i < 4; i++) s += `<path d="M${n((r() - 0.5) * R)} ${n((r() - 0.5) * R * 0.8)} q${n((r() - 0.5) * 30)} ${n((r() - 0.5) * 20)} ${n((r() - 0.5) * 40)} ${n((r() - 0.5) * 20)}" stroke="${F.dark}" stroke-width="1.2" fill="none" opacity=".6"/>`;
    for (let i = 0; i < 6; i++) { const x = (r() - 0.5) * R * 1.4, y = (r() - 0.5) * R * 0.9, rr = 2 + r() * 4; s += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(rr)}" fill="${F.dark}" opacity=".7"/><circle cx="${n(x - rr * 0.3)}" cy="${n(y - rr * 0.3)}" r="${n(rr * 0.35)}" fill="${F.light}" opacity=".4"/>`; }
    const ex = R * 0.55, ey = -R * 0.12;
    s += `<circle cx="${n(ex)}" cy="${n(ey)}" r="${n(R * 0.24)}" fill="#ffe36b" opacity=".35" filter="url(#blur2)"/><circle cx="${n(ex)}" cy="${n(ey)}" r="${n(R * 0.16)}" fill="#fff3a6"/><ellipse cx="${n(ex + 1)}" cy="${n(ey)}" rx="${n(R * 0.04)}" ry="${n(R * 0.13)}" fill="#141400"/>`;
    if (cost >= 4) for (let i = 0; i < 5; i++) { const a = -2.2 + i * 0.45, x = Math.cos(a) * R * 1.05, y = Math.sin(a) * R * 0.78; s += `<path d="M${n(x - 4)} ${n(y + 2)} L${n(x * 1.25)} ${n(y * 1.3)} L${n(x + 4)} ${n(y + 1)}Z" fill="${F.dark}"/>`; }
    s += `<path d="M${n(R * 0.62)} ${n(R * 0.26)} Q${n(R * 0.95)} ${n(R * 0.5)} ${n(R * 1.12)} ${n(R * 0.2)} Q${n(R * 0.9)} ${n(R * 0.34)} ${n(R * 0.62)} ${n(R * 0.26)}Z" fill="#160a05"/>`;
    for (let i = 0; i < 4; i++) s += `<path d="M${n(R * (0.7 + i * 0.1))} ${n(R * (0.3 + i * 0.03))} l1.5 ${n(-R * 0.06)} l1.5 ${n(R * 0.06)}" fill="#f4f0d0"/>`;
    s += `<ellipse cx="${n(-R * 0.25)}" cy="${n(-R * 0.42)}" rx="${n(R * 0.4)}" ry="${n(R * 0.12)}" fill="#fff" opacity=".22"/>`;
    return s;
  }

  function shipNeutral(r, F, cid) {
    let s = '';
    if (cid === 'explorer') {
      s += plume(-40, 0, 50, 6);
      s += `<rect x="-40" y="-18" width="58" height="36" rx="6" fill="url(#hull)"/><path d="M-40 -12 h58" stroke="#fff" stroke-width=".7" opacity=".4"/>`;
      s += `<path d="M18 -12 L52 0 L18 12Z" fill="#c99a3a"/><path d="M22 -8 L48 0 L22 8" fill="none" stroke="#6b4c10" stroke-width="1"/>`;
      for (let i = 0; i < 4; i++) s += `<path d="M${24 + i * 6} ${-8 + i * 1.6} l3 ${16 - i * 3.2}" stroke="#6b4c10" stroke-width=".8"/>`;
      s += `<rect x="-30" y="-28" width="30" height="10" rx="2" fill="url(#hullD)"/><rect x="-6" y="-8" width="12" height="7" rx="2" fill="url(#glass)"/>`;
    } else if (cid === 'viper') {
      s += plume(-34, 0, 60, 5);
      s += `<path d="M58 0 L-30 -26 L-18 -4 L-34 -4 L-34 4 L-18 4 L-30 26Z" fill="url(#hull)"/><path d="M58 0 L-30 -26" stroke="#fff" stroke-width=".8" opacity=".6"/>`;
      s += `<path d="M40 0 L0 -8 L4 0 L0 8Z" fill="#b8322a"/><ellipse cx="18" cy="0" rx="10" ry="3.5" fill="url(#glass)"/>`;
    } else {
      s += plume(-44, -6, 50, 4) + plume(-44, 6, 50, 4);
      s += `<path d="M50 0 C40 -18 -20 -20 -44 -14 L-44 14 C-20 20 40 18 50 0Z" fill="url(#hull)"/><path d="M50 0 C40 -18 -20 -20 -44 -14" stroke="#fff" stroke-width=".8" fill="none" opacity=".5"/>`;
      s += `<rect x="-30" y="-24" width="34" height="8" rx="2" fill="url(#hullD)"/><rect x="-30" y="16" width="34" height="8" rx="2" fill="url(#hullD)"/>`;
      s += `<ellipse cx="28" cy="-4" rx="9" ry="4" fill="url(#glass)"/>`;
    }
    return s;
  }

  // ── базы ──
  function planet(r, F, f) {
    const cx = 120 + r() * 60, cy = 120 + r() * 20, R = 62 + r() * 10;
    const surf = { blob: [F.color, '#0d2a10'], trade: ['#2f7fd0', '#0c2244'], empire: ['#c9a04a', '#4a3410'], machine: ['#a14a40', '#2a1210'], none: ['#888', '#222'] }[f];
    let s = `<radialGradient id="pl" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${mix(surf[0], '#ffffff', 0.35)}"/><stop offset=".5" stop-color="${surf[0]}"/><stop offset="1" stop-color="${surf[1]}"/></radialGradient>`;
    s += `<filter id="surf" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="${f === 'machine' ? '0.09 0.02' : '0.025 0.06'}" numOctaves="5" seed="${Math.floor(r() * 99)}"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -3 1.6"/></filter>`;
    s += `<filter id="cloud" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.07" numOctaves="4" seed="${Math.floor(r() * 99)}"/><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 3 0 0 0 -1.7"/></filter>`;
    s += `<linearGradient id="night" x1="0" y1="0" x2="1" y2="1"><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset=".75" stop-color="#000" stop-opacity=".88"/></linearGradient>`;
    s += `<clipPath id="pc"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}"/></clipPath>`;
    const ring = f === 'empire' || (f !== 'blob' && r() < 0.5);
    if (ring) s += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(R * 1.75)}" ry="${n(R * 0.3)}" fill="none" stroke="${F.light}" stroke-width="5" opacity=".35" transform="rotate(-14 ${n(cx)} ${n(cy)})"/>`;
    s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R + 6)}" fill="${F.light}" opacity=".35" filter="url(#blur6)"/>`;
    s += `<g clip-path="url(#pc)"><rect width="${W}" height="${H}" fill="url(#pl)"/>`;
    s += `<rect width="${W}" height="${H}" filter="url(#surf)" opacity="${f === 'trade' ? 0.55 : 0.7}"/>`;
    if (f === 'trade' || f === 'blob') s += `<rect width="${W}" height="${H}" filter="url(#cloud)" opacity=".55"/>`;
    if (f === 'machine') for (let i = -4; i <= 4; i++) s += `<ellipse cx="${n(cx)}" cy="${n(cy + i * R * 0.22)}" rx="${n(R)}" ry="${n(R * 0.05)}" fill="none" stroke="#1a0503" stroke-width=".8" opacity=".6"/>`;
    s += `<rect x="${n(cx - R)}" y="${n(cy - R)}" width="${n(R * 2)}" height="${n(R * 2)}" fill="url(#night)"/>`;
    if (f !== 'blob') for (let i = 0; i < 40; i++) { const a = Math.PI * (0.05 + r() * 0.5), d = R * (0.2 + r() * 0.75); s += `<circle cx="${n(cx + Math.cos(a) * d)}" cy="${n(cy + Math.sin(a) * d)}" r=".7" fill="#ffd98a" opacity="${n(0.4 + r() * 0.6)}"/>`; }
    s += `</g>`;
    s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" fill="none" stroke="${mix(F.light, '#ffffff', 0.4)}" stroke-width="1.6" opacity=".7" stroke-dasharray="${n(R * 2.2)} ${n(R * 10)}" transform="rotate(170 ${n(cx)} ${n(cy)})"/>`;
    if (ring) s += `<path d="M${n(cx - R * 1.7)} ${n(cy + R * 0.42)} A${n(R * 1.75)} ${n(R * 0.3)} -14 0 0 ${n(cx + R * 1.7)} ${n(cy - R * 0.42)}" fill="none" stroke="${F.light}" stroke-width="5" opacity=".55"/>`;
    // орбитальная станция
    const sx = cx + R * 0.95, sy = cy - R * 0.95;
    s += `<g transform="translate(${n(sx)} ${n(sy)}) scale(.45)"><rect x="-20" y="-3" width="40" height="6" fill="url(#hullL)"/><rect x="-34" y="-10" width="12" height="20" fill="#2b4a7a"/><rect x="22" y="-10" width="12" height="20" fill="#2b4a7a"/><circle r="6" fill="url(#hull)"/></g>` + lights([[sx, sy]], F.light);
    return s;
  }

  function station(r, F) {
    let s = `<g transform="translate(150 96)">`;
    s += `<circle r="62" fill="${F.color}" opacity=".18" filter="url(#blur6)"/>`;
    // солнечные панели
    for (const side of [-1, 1]) {
      const x = side < 0 ? -128 : 64;
      s += `<rect x="${x}" y="-14" width="64" height="28" fill="#1b2c4a" stroke="#6d84a8" stroke-width=".8"/>`;
      for (let i = 1; i < 8; i++) s += `<path d="M${x + i * 8} -14v28" stroke="#6d84a8" stroke-width=".4"/>`;
      s += `<path d="M${x} 0h64" stroke="#6d84a8" stroke-width=".4"/><rect x="${x}" y="-14" width="64" height="9" fill="#fff" opacity=".08"/>`;
    }
    s += `<rect x="-64" y="-2" width="128" height="4" fill="url(#hullD)"/>`;
    // кольцо: задняя половина
    s += `<path d="M-56 0 A56 18 0 0 1 56 0" fill="none" stroke="url(#hullD)" stroke-width="9"/>`;
    // ядро
    const h = 46 + r() * 16;
    s += `<rect x="-10" y="${n(-h)}" width="20" height="${n(h * 2)}" rx="6" fill="url(#hull)"/>`;
    s += `<rect x="-16" y="${n(-h * 0.45)}" width="32" height="10" rx="2" fill="url(#hullL)"/><rect x="-16" y="${n(h * 0.3)}" width="32" height="8" rx="2" fill="url(#hullD)"/>`;
    for (let i = 0; i < 6; i++) s += `<rect x="-6" y="${n(-h + 8 + i * 9)}" width="12" height="1.6" fill="#ffe9b0" opacity=".85"/>`;
    s += `<circle cx="0" cy="0" r="13" fill="url(#hull)"/><circle cx="0" cy="0" r="6" fill="url(#glow)"/>`;
    // кольцо: передняя половина
    s += `<path d="M-56 0 A56 18 0 0 0 56 0" fill="none" stroke="url(#hull)" stroke-width="9"/><path d="M-56 0 A56 18 0 0 0 56 0" fill="none" stroke="${F.color}" stroke-width="2"/>`;
    s += `<path d="M0 ${n(-h)} V${n(-h - 16)}" stroke="#aab" stroke-width="1"/>`;
    s += lights([[0, -h - 16], [-56, 0], [56, 0], [0, 18]], F.light);
    s += `</g>`;
    return s;
  }


  // ── дополнительные силуэты ──
  function tradeShuttle(r, F) {
    let s = plume(-40, -8, 50, 4) + plume(-40, 8, 50, 4);
    s += `<rect x="-36" y="-26" width="44" height="10" rx="4" fill="url(#hullD)"/><rect x="-36" y="16" width="44" height="10" rx="4" fill="url(#hullD)"/>`;
    s += `<path d="M58 0 C46 -20 -10 -22 -40 -14 L-40 14 C-10 22 46 20 58 0Z" fill="url(#hull)"/>`;
    s += `<path d="M58 0 C46 -20 -10 -22 -40 -14" fill="none" stroke="${F.light}" stroke-width=".9" opacity=".7"/>`;
    s += `<path d="M-34 -2 H44" stroke="url(#acc)" stroke-width="3"/><path d="M30 -10 C40 -10 48 -6 50 -2 L30 -2Z" fill="url(#glass)"/>`;
    s += lights([[-10, 7], [4, 7], [18, 7]], '#ffe9b0');
    return s;
  }
  function tradeCruiser(r, F) {
    const L = 110;
    let s = plume(-L + 4, -12, 80, 6) + plume(-L + 4, 12, 80, 6) + plume(-L + 4, 0, 70, 5);
    s += `<path d="M${-L + 6} -20 L50 -22 Q96 -18 112 -4 L116 0 L112 4 Q96 18 50 22 L${-L + 6} 20Z" fill="url(#hull)"/>`;
    s += `<path d="M${-L + 6} -20 L50 -22 Q96 -18 112 -4" fill="none" stroke="${F.light}" stroke-width="1" opacity=".7"/>`;
    s += `<ellipse cx="-30" cy="0" rx="9" ry="38" fill="none" stroke="url(#hullD)" stroke-width="7"/><ellipse cx="-30" cy="0" rx="9" ry="38" fill="none" stroke="${F.color}" stroke-width="1.6"/>`;
    for (let x = -90; x < 60; x += 14) s += `<path d="M${x} -20v40" stroke="#000" stroke-width=".5" opacity=".3"/>`;
    s += `<rect x="${-L + 10}" y="-3" width="${L + 90}" height="5" fill="url(#acc)"/>`;
    for (const x of [10, 40]) s += `<rect x="${x}" y="-30" width="14" height="8" rx="2" fill="url(#hullL)"/><path d="M${x + 12} -27 h14" stroke="#ccd" stroke-width="2"/>`;
    s += `<path d="M66 -22 L82 -30 L98 -30 L102 -16Z" fill="url(#hullL)"/><path d="M84 -28 L96 -28 L98 -22 L84 -22Z" fill="url(#glass)"/>`;
    s += lights([[114, 0], [-60, 10], [-30, 38], [-30, -38], [20, 10], [60, 10]], F.light);
    return s;
  }
  function empireFighter(r, F) {
    let s = plume(-30, -6, 50, 4) + plume(-30, 6, 50, 4);
    s += `<path d="M-10 -8 L-34 -34 L-22 -34 L14 -8Z M-10 8 L-34 34 L-22 34 L14 8Z" fill="url(#hullD)" stroke="${F.color}" stroke-width="1"/>`;
    s += `<path d="M64 0 L-28 -10 L-20 0 L-28 10Z" fill="url(#hull)"/><path d="M64 0 L-28 -10" stroke="${F.light}" stroke-width=".8" opacity=".8"/>`;
    s += `<path d="M30 0 L4 -5 L8 0 L4 5Z" fill="url(#glass)"/>`;
    s += lights([[-34, -34], [-34, 34]], F.light);
    return s;
  }
  function empireDread(r, F) {
    let s = plume(-80, -18, 80, 7) + plume(-80, 0, 80, 7) + plume(-80, 18, 80, 7);
    s += `<path d="M125 0 L-78 -52 L-62 -16 L-86 -16 L-86 16 L-62 16 L-78 52Z" fill="url(#hullD)"/>`;
    s += `<path d="M118 0 L-72 -46 L-52 0Z" fill="url(#hullL)"/><path d="M118 0 L-52 0 L-72 46Z" fill="url(#hullD)"/>`;
    s += `<path d="M90 0 L-30 -26 L-22 0Z" fill="url(#hull)" opacity=".9"/>`;
    for (let i = 1; i < 9; i++) { const t = i / 9; s += `<path d="M${n(118 - t * 190)} ${n(-46 * t)} L${n(118 - t * 170)} 0" stroke="#000" stroke-width=".6" opacity=".35"/>`; }
    s += `<path d="M125 0 L-78 -52 M125 0 L-78 52" stroke="${F.color}" stroke-width="1.6"/>`;
    s += `<rect x="-60" y="-20" width="40" height="16" fill="url(#hullL)"/><rect x="-52" y="-32" width="24" height="13" fill="url(#hull)"/><rect x="-48" y="-29" width="16" height="3" fill="url(#glass)"/><path d="M-60 -20 h40" stroke="${F.color}" stroke-width="1.2"/>`;
    for (const [x, y] of [[40, -14], [10, -20], [-20, 22]]) s += `<circle cx="${x}" cy="${y}" r="4" fill="url(#hullL)"/><path d="M${x} ${y} h12" stroke="#ccc" stroke-width="1.6"/>`;
    s += lights([[90, -8], [60, -16], [30, -24], [0, -32], [-30, -40], [60, 16], [30, 24], [0, 32]], F.light);
    return s;
  }
  function machineDrone(r, F) {
    let s = plume(-26, 0, 40, 5);
    for (const a of [-50, -20, 20, 50]) {
      const rad = a * Math.PI / 180, x2 = Math.cos(rad) * 44, y2 = Math.sin(rad) * 44;
      s += `<path d="M0 0 L${n(x2)} ${n(y2)} l8 ${a < 0 ? -6 : 6}" stroke="#777" stroke-width="3" fill="none"/><path d="M0 0 L${n(x2)} ${n(y2)}" stroke="#bbb" stroke-width="1" />`;
    }
    s += `<circle r="22" fill="url(#hull)"/><circle r="22" fill="none" stroke="${F.light}" stroke-width=".8" opacity=".5"/>`;
    s += `<circle cx="8" cy="0" r="9" fill="#200"/><circle cx="8" cy="0" r="6" fill="${F.color}"/><circle cx="8" cy="0" r="12" fill="url(#glow)" opacity=".8"/>`;
    s += `<path d="M-18 -10 h14 M-18 10 h14" stroke="#000" stroke-width=".8" opacity=".5"/>`;
    return s;
  }
  function machineHeavy(r, F) {
    let s = plume(-96, -14, 70, 7) + plume(-96, 14, 70, 7);
    s += `<rect x="-94" y="-30" width="150" height="60" rx="4" fill="url(#hull)" stroke="#111" stroke-width=".6"/>`;
    s += `<path d="M-94 -30 h150" stroke="${F.light}" stroke-width=".8" opacity=".6"/>`;
    for (let x = -84; x < 50; x += 16) s += `<rect x="${x}" y="-24" width="12" height="48" fill="url(#hullD)" opacity=".7"/>`;
    s += `<rect x="-94" y="-6" width="150" height="5" fill="url(#acc)"/>`;
    s += `<path d="M56 -30 L104 -12 L104 12 L56 30Z" fill="url(#hullL)"/><path d="M80 -8 L100 -4 L100 4 L80 8Z" fill="${F.color}"/>`;
    for (const y of [-44, 36]) { s += `<rect x="-60" y="${y}" width="80" height="8" rx="3" fill="url(#hullD)"/>`; for (let i = 0; i < 5; i++) s += `<path d="M${-56 + i * 16} ${y + 4} l12 0" stroke="${F.light}" stroke-width="3" stroke-linecap="round"/>`; }
    s += gear(-30, 0, 20, 12);
    s += lights([[104, 0], [-94, -30], [-94, 30]], '#ff4a3a');
    return s;
  }
  function citadel(r, F) {
    let s = `<g transform="translate(150 110)">`;
    s += `<circle r="70" fill="${F.color}" opacity=".15" filter="url(#blur6)"/>`;
    s += `<path d="M-90 30 Q0 0 90 30 L70 46 Q0 24 -70 46Z" fill="url(#hullD)"/>`;
    const towers = 5 + Math.floor(r() * 3);
    for (let i = 0; i < towers; i++) {
      const x = -70 + i * (140 / (towers - 1)), h = 30 + (1 - Math.abs(i - (towers - 1) / 2) / ((towers - 1) / 2)) * 60 + r() * 12, w = 12 + r() * 6;
      s += `<path d="M${n(x - w / 2)} 26 L${n(x - w / 3)} ${n(26 - h)} L${n(x)} ${n(16 - h)} L${n(x + w / 3)} ${n(26 - h)} L${n(x + w / 2)} 26Z" fill="url(#hull)"/>`;
      s += `<path d="M${n(x - w / 3)} ${n(26 - h)} L${n(x)} ${n(16 - h)}" stroke="${F.light}" stroke-width=".8" opacity=".7"/>`;
      for (let k = 0; k < h / 10 - 1; k++) s += `<rect x="${n(x - 1.5)}" y="${n(20 - k * 10)}" width="3" height="1.4" fill="#ffe9b0" opacity=".8"/>`;
      s += lights([[x, 16 - h]], F.light);
    }
    s += `<ellipse cx="0" cy="-10" rx="100" ry="80" fill="none" stroke="${F.light}" stroke-width="1" opacity=".25"/>`;
    s += `<path d="M-100 -10 A100 80 0 0 1 100 -10" fill="none" stroke="${F.light}" stroke-width="3" opacity=".12"/>`;
    s += `</g>`;
    return s;
  }
  function asteroidBase(r, F) {
    let s = `<filter id="rock" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="4" seed="${Math.floor(r() * 99)}"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.5 1.4"/></filter>`;
    const pts = [];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, rr = 62 * (0.8 + r() * 0.35); pts.push([150 + Math.cos(a) * rr * 1.3, 104 + Math.sin(a) * rr * 0.75]); }
    const d = smoothPath(pts);
    s += `<radialGradient id="rk" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#8a8580"/><stop offset=".6" stop-color="#4a4542"/><stop offset="1" stop-color="#151312"/></radialGradient>`;
    s += `<clipPath id="ac"><path d="${d}"/></clipPath>`;
    s += `<path d="${d}" fill="url(#rk)"/><g clip-path="url(#ac)"><rect width="${W}" height="${H}" filter="url(#rock)" opacity=".7"/></g>`;
    for (let i = 0; i < 5; i++) s += `<circle cx="${n(110 + r() * 80)}" cy="${n(90 + r() * 30)}" r="${n(4 + r() * 6)}" fill="#000" opacity=".3"/>`;
    // заводы
    for (let i = 0; i < 4; i++) {
      const x = 100 + i * 28 + r() * 8, h = 18 + r() * 22;
      s += `<rect x="${n(x)}" y="${n(80 - h)}" width="14" height="${n(h)}" fill="url(#hull)"/><rect x="${n(x + 3)}" y="${n(80 - h - 14)}" width="5" height="14" fill="url(#hullD)"/>`;
      s += `<circle cx="${n(x + 5.5)}" cy="${n(80 - h - 20)}" r="6" fill="#999" opacity=".2" filter="url(#blur2)"/>`;
      s += lights([[x + 7, 80 - h + 6]], F.light);
    }
    s += `<path d="M95 82 h120" stroke="url(#acc)" stroke-width="3"/>`;
    s += gear(208, 70, 14, 10);
    return s;
  }

  function svg(cid) {
    const d = window.CARDS[cid];
    const f = d.faction, F = window.FACTIONS[f];
    const r = rng(hash(cid));
    let defs = `<radialGradient id="star"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#cfe3ff" stop-opacity=".6"/><stop offset="1" stop-color="#cfe3ff" stop-opacity="0"/></radialGradient>
<radialGradient id="vig" cx="50%" cy="50%" r="75%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></radialGradient>`;
    defs += nebula('n1', Math.floor(r() * 999), (0.006 + r() * 0.006).toFixed(4), f === 'none' ? '#55657f' : F.color, 0.5 + r() * 0.15);
    defs += nebula('n2', Math.floor(r() * 999), (0.01 + r() * 0.008).toFixed(4), SECOND[f], 0.45 + r() * 0.15);
    defs += objDefs(F, f);
    let body = `<rect width="${W}" height="${H}" fill="#02030a"/><rect width="${W}" height="${H}" filter="url(#n2)"/><rect width="${W}" height="${H}" filter="url(#n1)"/>` + stars(r);
    if (d.type === 'base') {
      if (!d.outpost) body += planet(r, F, f);
      else if (f === 'empire') body += hash(cid) % 2 ? citadel(r, F) : station(r, F);
      else if (f === 'machine') body += hash(cid) % 3 === 0 ? station(r, F) : asteroidBase(r, F);
      else body += hash(cid) % 2 ? station(r, F) : citadel(r, F);
    }
    else {
      const sc = 0.78 + Math.min(d.cost, 8) * 0.045;
      const rot = -10 + r() * 14;
      body += `<g transform="translate(${n(150 + (r() - 0.5) * 16)} ${n(92 + (r() - 0.5) * 12)}) rotate(${n(rot)}) scale(${n(sc)})">`;
      if (f === 'trade') body += d.cost <= 2 ? tradeShuttle(r, F) : d.cost >= 5 ? tradeCruiser(r, F) : shipTrade(r, F);
      else if (f === 'empire') body += d.cost <= 2 ? empireFighter(r, F) : d.cost >= 6 ? empireDread(r, F) : shipEmpire(r, F);
      else if (f === 'machine') body += d.cost <= 2 ? machineDrone(r, F) : d.cost >= 6 ? machineHeavy(r, F) : shipMachine(r, F);
      else if (f === 'blob') body += shipBlob(r, F, d.cost);
      else body += shipNeutral(r, F, cid);
      body += '</g>';
      if (d.cost >= 5 && f !== 'blob') {
        body += `<g transform="translate(${n(40 + r() * 30)} ${n(30 + r() * 20)}) rotate(${n(rot)}) scale(.2)" opacity=".85">` +
          (f === 'trade' ? shipTrade(r, F) : f === 'empire' ? shipEmpire(r, F) : shipMachine(r, F)) + '</g>';
      }
    }
    body += `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}"><defs>${defs}</defs>${body}</svg>`;
  }

  // URL картинки для <img>
  window.cardArtURL = function (cid) {
    if (!cache[cid]) cache[cid] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(cid));
    return cache[cid];
  };
  window.cardArtSVG = svg;
})();
