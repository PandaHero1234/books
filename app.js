// Bücherkarte – eine Weltkarte der Bücher.
// Kontinente = Genres, Regionen = Subgenres, Orte = Bücher.
// Straßen verbinden Nachbarn, Fährlinien verbinden thematisch verwandte Bücher
// über Genregrenzen hinweg. Der Routenplaner sucht darauf den kürzesten Lese-Weg.
(() => {
  'use strict';

  const DATA = window.BOOKMAP;
  const $ = (s) => document.querySelector(s);
  const canvas = $('#map');
  const ctx = canvas.getContext('2d');
  const app = $('.app');
  const panel = $('#panel');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- Hilfen
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  const slug = (s) => norm(s.replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue'))
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtYear = (y) => (y < 0 ? `${-y} v. Chr.` : String(y));
  const fmtKm = (d) => Math.round(d).toLocaleString('de-DE');
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seeded(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  }
  const swatch = (h) => `hsl(${h} 42% 40%)`;
  const coverBg = (h) => `linear-gradient(140deg, hsl(${h} 38% 42%), hsl(${(h + 24) % 360} 44% 26%))`;

  // ---------------------------------------------------------------- Welt aufbauen
  const continents = [];
  const regions = [];
  const books = [];
  const byId = new Map();

  DATA.continents.forEach((c) => {
    const cont = { id: c.id, name: c.name, genre: c.genre, hue: c.hue, x: c.x, y: c.y, regions: [], books: [], shapes: [] };
    continents.push(cont);
    const n = c.regions.length;
    const R = n >= 4 ? 210 : n === 3 ? 182 : 150;
    const rot = (hashStr(c.id) % 628) / 100;
    c.regions.forEach((r, ri) => {
      const a = rot + (ri * Math.PI * 2) / n;
      const reg = { name: r.name, cont, idx: regions.length, x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R * 0.85, books: [] };
      regions.push(reg);
      cont.regions.push(reg);
      r.books.forEach(([title, author, year, tags], j) => {
        const rr = 37 * Math.sqrt(j + 0.7);
        const ang = j * 2.39996 + ri * 1.3 + rot;
        const b = {
          title, author, year, tags: tags.split(' '),
          x: reg.x + Math.cos(ang) * rr, y: reg.y + Math.sin(ang) * rr,
          region: reg, cont, i: books.length,
        };
        let id = slug(title);
        while (byId.has(id)) id += '-2';
        b.id = id;
        b.key = norm(`${title} ${author}`);
        byId.set(id, b);
        reg.books.push(b); cont.books.push(b); books.push(b);
      });
    });
  });

  // Küstenlinien: Vereinigung verrauschter Kreise um Bücher, Regionen und Kontinentmitte.
  function blob(x, y, r, seed) {
    const rnd = seeded(seed);
    const p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
    const pts = [];
    const N = 26;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const f = 1 + 0.12 * Math.sin(t * 3 + p1) + 0.07 * Math.sin(t * 5 + p2) + 0.04 * Math.sin(t * 9 + p3) + (rnd() - 0.5) * 0.06;
      pts.push(x + Math.cos(t) * r * f, y + Math.sin(t) * r * f);
    }
    return pts;
  }
  continents.forEach((cont) => {
    const rnd = seeded(hashStr(cont.id + 'isles'));
    cont.shapes.push(blob(cont.x, cont.y, cont.regions.length > 2 ? 110 : 80, hashStr(cont.id)));
    cont.regions.forEach((reg, ri) => {
      cont.shapes.push(blob(reg.x, reg.y, 82, hashStr(reg.name)));
      cont.shapes.push(blob((reg.x + cont.x) / 2, (reg.y + cont.y) / 2, 88, hashStr(reg.name + ri)));
    });
    cont.books.forEach((b) => cont.shapes.push(blob(b.x, b.y, 60, hashStr(b.id))));
    // ein paar vorgelagerte Inseln
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 300 + rnd() * 70;
      cont.shapes.push(blob(cont.x + Math.cos(a) * d, cont.y + Math.sin(a) * d * 0.85, 14 + rnd() * 16, hashStr(cont.id + i)));
    }
  });

  const tagCount = new Map();
  books.forEach((b) => b.tags.forEach((t) => tagCount.set(t, (tagCount.get(t) || 0) + 1)));

  // ---------------------------------------------------------------- Ähnlichkeit & Straßennetz
  function jacc(a, b) {
    let inter = 0;
    for (const t of a.tags) if (b.tags.includes(t)) inter++;
    return inter / (a.tags.length + b.tags.length - inter);
  }
  const sim = (a, b) => jacc(a, b) + (a.author === b.author ? 0.5 : 0) + (a.region === b.region ? 0.08 : 0);

  const edges = [];
  const edgeMap = new Map();
  const adj = books.map(() => []);
  const ekey = (a, b) => (a.i < b.i ? `${a.i}-${b.i}` : `${b.i}-${a.i}`);
  function link(a, b) {
    if (a === b) return;
    const k = ekey(a, b);
    if (edgeMap.has(k)) return;
    const d = dist(a, b);
    const s = Math.min(1, jacc(a, b) + (a.author === b.author ? 0.5 : 0));
    const ferry = a.cont !== b.cont;
    // Fähren sind schnell, thematische Nähe verkürzt jede Strecke.
    const w = d * (ferry ? 0.7 : 1) * (1 - 0.45 * s);
    const e = { a, b, d, w, ferry };
    edges.push(e);
    edgeMap.set(k, e);
    adj[a.i].push([b, e]);
    adj[b.i].push([a, e]);
  }
  // Straßen: zwei nächste Nachbarn in der Region
  regions.forEach((reg) => reg.books.forEach((b) => {
    reg.books.filter((o) => o !== b).sort((p, q) => dist(b, p) - dist(b, q)).slice(0, 2).forEach((o) => link(b, o));
  }));
  // Pässe zwischen Regionen eines Kontinents
  continents.forEach((cont) => {
    for (let i = 0; i < cont.regions.length; i++) {
      for (let j = i + 1; j < cont.regions.length; j++) {
        let best = null, bd = Infinity;
        for (const a of cont.regions[i].books) for (const b of cont.regions[j].books) {
          const d = dist(a, b);
          if (d < bd) { bd = d; best = [a, b]; }
        }
        if (best) link(best[0], best[1]);
      }
    }
  });
  // Gleiche Autor·innen, chronologisch verkettet
  const byAuthor = new Map();
  books.forEach((b) => { if (!byAuthor.has(b.author)) byAuthor.set(b.author, []); byAuthor.get(b.author).push(b); });
  byAuthor.forEach((list) => {
    list.sort((p, q) => p.year - q.year);
    for (let i = 1; i < list.length; i++) link(list[i - 1], list[i]);
  });
  // Fährlinien: das thematisch nächste Buch auf einem anderen Kontinent
  books.forEach((b) => {
    let best = null, bs = 0.39;
    for (const o of books) {
      if (o.cont === b.cont) continue;
      const s = jacc(b, o);
      if (s > bs || (s === bs && best && dist(b, o) < dist(b, best))) { bs = s; best = o; }
    }
    if (best) link(b, best);
  });
  // Zusammenhang sicherstellen: isolierte Inselgruppen an das Festland anbinden
  (function connect() {
    for (;;) {
      const seen = new Set([0]);
      const stack = [0];
      while (stack.length) { const i = stack.pop(); for (const [o] of adj[i]) if (!seen.has(o.i)) { seen.add(o.i); stack.push(o.i); } }
      if (seen.size === books.length) return;
      let best = null, bd = Infinity;
      for (const a of books) if (seen.has(a.i)) for (const b of books) if (!seen.has(b.i)) {
        const d = dist(a, b) * (1 - 0.6 * jacc(a, b));
        if (d < bd) { bd = d; best = [a, b]; }
      }
      link(best[0], best[1]);
    }
  })();

  function shortestPath(from, to) {
    const n = books.length;
    const d = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    d[from.i] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && d[i] < best) { best = d[i]; u = i; }
      if (u < 0 || u === to.i) break;
      done[u] = 1;
      for (const [o, e] of adj[u]) {
        const nd = d[u] + e.w;
        if (nd < d[o.i]) { d[o.i] = nd; prev[o.i] = u; }
      }
    }
    if (!isFinite(d[to.i])) return null;
    const path = [];
    for (let i = to.i; i >= 0; i = prev[i]) path.unshift(books[i]);
    return path;
  }
  const edgeOf = (a, b) => edgeMap.get(ekey(a, b));

  function reason(a, b) {
    const shared = a.tags.filter((t) => b.tags.includes(t));
    const sh = shared.length ? ` · gemeinsam: <em>${esc(shared.join(', '))}</em>` : '';
    if (a.author === b.author) return `Ebenfalls von <em>${esc(a.author)}</em>`;
    if (a.cont !== b.cont) return `Fährlinie nach ${esc(b.cont.name)}${sh}`;
    if (a.region !== b.region) return `Über den Pass nach ${esc(b.region.name)}${sh}`;
    return shared.length ? `Gemeinsam: <em>${esc(shared.join(', '))}</em>` : `Nachbarort in ${esc(b.region.name)}`;
  }

  // ---------------------------------------------------------------- Zustand
  const state = {
    selected: null,
    hover: null,
    route: null,
    routeFrom: null,
    routeTo: null,
    tag: null,
    cont: null,
    ferries: true,
    view: 'home',
    saved: new Set(),
  };
  try { (JSON.parse(localStorage.getItem('buecherkarte.saved') || '[]') || []).forEach((id) => byId.has(id) && state.saved.add(id)); } catch (e) { /* kein Speicher */ }
  function persistSaved() { try { localStorage.setItem('buecherkarte.saved', JSON.stringify([...state.saved])); } catch (e) { /* egal */ } }

  // ---------------------------------------------------------------- Farben aus CSS
  let C = {};
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    C = {
      ocean: g('--ocean'), oceanLine: g('--ocean-line'), shallow: g('--shallow'), coast: g('--coast'),
      road: g('--road'), casing: g('--road-casing'), ferry: g('--ferry'),
      label: g('--label'), labelSoft: g('--label-soft'), halo: g('--halo'),
      pin: g('--pin'), pinInk: g('--pin-ink'), route: g('--route'),
      landS: parseFloat(g('--land-s')) || 34, landL: parseFloat(g('--land-l')) || 85, dotL: parseFloat(g('--dot-l')) || 36,
    };
    const dark = C.landL < 50;
    continents.forEach((c) => {
      c.fill = `hsl(${c.hue} ${C.landS}% ${C.landL}%)`;
      c.fill2 = `hsl(${c.hue} ${C.landS + 4}% ${C.landL + (dark ? 3 : -4)}%)`;
      c.ink = `hsl(${c.hue} ${dark ? 50 : 52}% ${C.dotL}%)`;
      c.text = `hsl(${c.hue} ${dark ? 30 : 40}% ${dark ? 78 : 26}%)`;
    });
    requestDraw();
  }

  // ---------------------------------------------------------------- Ansicht
  const view = { cx: 1800, cy: 1350, k: 0.35 };
  let W = 0, H = 0, dpr = 1, minK = 0.15;
  const MAX_K = 4.5;
  const bounds = (() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    books.forEach((b) => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x); y1 = Math.max(y1, b.y); });
    return { x0: x0 - 170, y0: y0 - 150, x1: x1 + 170, y1: y1 + 150 };
  })();

  const isMobile = () => W <= 760;
  function freeRect() {
    const r = { l: 0, t: 0, r: W, b: H };
    if (isMobile()) {
      r.t = 120 + ($('#routeform').hidden ? 0 : 100);
      if (!panel.hidden) r.b = H - panel.getBoundingClientRect().height;
      r.r = W - 60;
    } else {
      r.t = 70;
      if (!panel.hidden) r.l = 16 + panel.getBoundingClientRect().width + 8;
      r.r = W - 64;
    }
    if (r.b - r.t < 120) r.b = r.t + 120;
    return r;
  }
  function centerFor(x, y, k) {
    const f = freeRect();
    return { cx: x - ((f.l + f.r) / 2 - W / 2) / k, cy: y - ((f.t + f.b) / 2 - H / 2) / k };
  }
  function kToFit(b, pad = 40) {
    const f = freeRect();
    return clamp(Math.min((f.r - f.l - pad * 2) / (b.x1 - b.x0), (f.b - f.t - pad * 2) / (b.y1 - b.y0)), minK, MAX_K);
  }
  function fitBounds(b, maxK = 2.2, animate = true) {
    const k = Math.min(kToFit(b), maxK);
    flyTo((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, k, animate);
  }
  const boundsOf = (pts, pad = 60) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  };

  let anim = null;
  function flyTo(x, y, k, animate = true) {
    k = clamp(k, minK, MAX_K);
    const target = centerFor(x, y, k);
    if (!animate || reduceMotion) { cancelAnim(); view.cx = target.cx; view.cy = target.cy; view.k = k; requestDraw(); return; }
    const s = { ...view };
    const lk0 = Math.log(s.k), lk1 = Math.log(k);
    const d = Math.hypot(target.cx - s.cx, target.cy - s.cy);
    const bump = clamp(Math.log2(1 + (d * Math.min(s.k, k)) / Math.max(W, 1)) * 0.9, 0, 1.4);
    const dur = clamp(450 + d * 0.25, 500, 1100);
    const t0 = performance.now();
    cancelAnim();
    anim = { raf: 0 };
    const step = (now) => {
      const t = clamp((now - t0) / dur, 0, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      view.k = Math.exp(lk0 + (lk1 - lk0) * e - bump * Math.sin(Math.PI * e));
      view.cx = s.cx + (target.cx - s.cx) * e;
      view.cy = s.cy + (target.cy - s.cy) * e;
      draw();
      if (t < 1) anim.raf = requestAnimationFrame(step); else anim = null;
    };
    anim.raf = requestAnimationFrame(step);
  }
  function cancelAnim() { if (anim) { cancelAnimationFrame(anim.raf); anim = null; } }

  function zoomAt(sx, sy, f) {
    cancelAnim();
    const k = clamp(view.k * f, minK, MAX_K);
    const wx = (sx - W / 2) / view.k + view.cx;
    const wy = (sy - H / 2) / view.k + view.cy;
    view.k = k;
    view.cx = wx - (sx - W / 2) / k;
    view.cy = wy - (sy - H / 2) / k;
    requestDraw();
  }
  const toScreen = (x, y) => [(x - view.cx) * view.k + W / 2, (y - view.cy) * view.k + H / 2];

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    minK = Math.min(0.5, (Math.min(W / (bounds.x1 - bounds.x0), H / (bounds.y1 - bounds.y0))) * 0.6);
    draw();
  }

  // ---------------------------------------------------------------- Zeichnen
  let pending = false;
  function requestDraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; draw(); });
  }

  function polyPath(pts) {
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
  }
  function edgeCtrl(e) {
    const [lo, hi] = e.a.i < e.b.i ? [e.a, e.b] : [e.b, e.a];
    const mx = (lo.x + hi.x) / 2, my = (lo.y + hi.y) / 2;
    const dx = hi.x - lo.x, dy = hi.y - lo.y;
    return [mx - dy * 0.16, my + dx * 0.16];
  }
  function edgeStroke(e, from, to) {
    ctx.moveTo(from.x, from.y);
    if (e.ferry) { const [qx, qy] = edgeCtrl(e); ctx.quadraticCurveTo(qx, qy, to.x, to.y); } else ctx.lineTo(to.x, to.y);
  }

  function draw() {
    if (!W) return;
    const k = view.k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.ocean;
    ctx.fillRect(0, 0, W, H);

    // --- Weltkoordinaten
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(k, k);
    ctx.translate(-view.cx, -view.cy);
    const vx0 = view.cx - W / 2 / k, vx1 = view.cx + W / 2 / k;
    const vy0 = view.cy - H / 2 / k, vy1 = view.cy + H / 2 / k;

    // Gradnetz
    ctx.strokeStyle = C.oceanLine;
    ctx.lineWidth = 1 / k;
    ctx.beginPath();
    const gs = k < 0.6 ? 400 : k < 1.6 ? 200 : 100;
    for (let x = Math.floor(vx0 / gs) * gs; x <= vx1; x += gs) { ctx.moveTo(x, vy0); ctx.lineTo(x, vy1); }
    for (let y = Math.floor(vy0 / gs) * gs; y <= vy1; y += gs) { ctx.moveTo(vx0, y); ctx.lineTo(vx1, y); }
    ctx.stroke();

    // Flachwasser + Küste + Land
    ctx.lineJoin = 'round';
    ctx.beginPath();
    continents.forEach((c) => c.shapes.forEach(polyPath));
    ctx.strokeStyle = C.shallow;
    ctx.lineWidth = 34;
    ctx.stroke();
    continents.forEach((c) => {
      const dim = state.cont && state.cont !== c;
      ctx.beginPath();
      c.shapes.forEach(polyPath);
      ctx.strokeStyle = C.coast;
      ctx.lineWidth = 2.2 / k;
      ctx.stroke();
      ctx.fillStyle = c.fill;
      ctx.fill();
      // Regionen leicht abgesetzt
      c.regions.forEach((reg, ri) => {
        if (ri % 2) return;
        ctx.beginPath();
        reg.books.forEach((b) => polyPath(blob(b.x, b.y, 44, hashStr(b.id + 'r'))));
        ctx.fillStyle = c.fill2;
        ctx.fill();
      });
      if (dim) {
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        c.shapes.forEach(polyPath);
        ctx.fillStyle = C.ocean;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    });

    // Fährlinien
    if (state.ferries && k > 0.22) {
      ctx.setLineDash([7 / k, 6 / k]);
      ctx.lineWidth = 1.4 / k;
      ctx.strokeStyle = C.ferry;
      ctx.globalAlpha = clamp((k - 0.22) * 3, 0, 0.75);
      ctx.beginPath();
      edges.forEach((e) => { if (e.ferry) edgeStroke(e, e.a, e.b); });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // Straßen
    if (k > 0.42) {
      const rw = clamp(1 + k * 1.6, 1.5, 6);
      ctx.globalAlpha = clamp((k - 0.42) * 4, 0, 1);
      ctx.lineCap = 'round';
      ctx.beginPath();
      edges.forEach((e) => { if (!e.ferry) edgeStroke(e, e.a, e.b); });
      ctx.strokeStyle = C.casing;
      ctx.lineWidth = (rw + 2) / k;
      ctx.stroke();
      ctx.strokeStyle = C.road;
      ctx.lineWidth = rw / k;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Verbindungen des gewählten Buchs
    if (state.selected && !state.route && k > 0.3) {
      const s = state.selected;
      ctx.beginPath();
      adj[s.i].forEach(([o, e]) => edgeStroke(e, s, o));
      ctx.strokeStyle = C.pin;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2.5 / k;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Route
    if (state.route) {
      const p = state.route;
      ctx.beginPath();
      for (let i = 1; i < p.length; i++) edgeStroke(edgeOf(p[i - 1], p[i]), p[i - 1], p[i]);
      ctx.lineCap = 'round';
      ctx.strokeStyle = C.halo;
      ctx.lineWidth = 9 / k;
      ctx.stroke();
      ctx.strokeStyle = C.route;
      ctx.lineWidth = 5.5 / k;
      ctx.stroke();
    }
    ctx.restore();

    // --- Bildschirmkoordinaten: Punkte & Beschriftung
    const placed = [];
    const fits = (x, y, w, h) => {
      for (const r of placed) if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return false;
      placed.push({ x, y, w, h });
      return true;
    };
    const onScreen = (sx, sy, m = 40) => sx > -m && sx < W + m && sy > -m && sy < H + m;
    const filtered = (b) => (state.tag && !b.tags.includes(state.tag)) || (state.cont && b.cont !== state.cont);
    const inRoute = new Set(state.route || []);

    // Punkte
    const dr = k < 0.5 ? 2.6 : k < 1.2 ? 3.8 : 5;
    books.forEach((b) => {
      const [sx, sy] = toScreen(b.x, b.y);
      if (!onScreen(sx, sy)) return;
      const dim = filtered(b) && !inRoute.has(b);
      ctx.globalAlpha = dim ? 0.28 : 1;
      const hl = (state.tag && b.tags.includes(state.tag)) || inRoute.has(b);
      const r = hl ? dr + 1.6 : dr;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = inRoute.has(b) ? C.route : b.cont.ink;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = C.halo;
      ctx.stroke();
      if (state.saved.has(b.id)) {
        ctx.beginPath();
        ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = C.pin;
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;

    const label = (text, sx, sy, font, color, align = 'left', halo = 3) => {
      ctx.font = font;
      ctx.textAlign = align;
      ctx.lineJoin = 'round';
      ctx.lineWidth = halo;
      ctx.strokeStyle = C.halo;
      ctx.strokeText(text, sx, sy);
      ctx.fillStyle = color;
      ctx.fillText(text, sx, sy);
    };
    const spaced = (on) => { if ('letterSpacing' in ctx) ctx.letterSpacing = on; };

    // Pins für gewähltes Buch & Routenenden
    const pins = [];
    if (state.route) {
      pins.push([state.route[0], 'start'], [state.route[state.route.length - 1], 'pin']);
    } else if (state.selected) pins.push([state.selected, 'pin']);
    pins.forEach(([b, kind]) => {
      const [sx, sy] = toScreen(b.x, b.y);
      if (kind === 'start') {
        ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2);
        ctx.fillStyle = C.halo; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = C.labelSoft; ctx.stroke();
        return;
      }
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx - 4, sy - 10, sx - 13, sy - 17, sx - 13, sy - 28);
      ctx.arc(sx, sy - 28, 13, Math.PI, 0);
      ctx.bezierCurveTo(sx + 13, sy - 17, sx + 4, sy - 10, sx, sy);
      ctx.fillStyle = C.pin; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(sx, sy - 28, 5, 0, Math.PI * 2); ctx.fillStyle = C.pinInk; ctx.fill();
      placed.push({ x: sx - 14, y: sy - 42, w: 28, h: 28 });
    });

    // Kontinentnamen
    const ca = clamp((1.05 - k) / 0.3, 0, 1);
    if (ca > 0) {
      ctx.globalAlpha = ca;
      continents.forEach((c) => {
        const [sx, sy] = toScreen(c.x, c.y);
        if (!onScreen(sx, sy, 200)) return;
        const size = clamp(8 + k * 48, 11, 30);
        const name = c.name.toUpperCase();
        spaced(`${(size * 0.12).toFixed(1)}px`);
        ctx.font = `600 ${size}px ${getFont('map')}`;
        const w = ctx.measureText(name).width + 8;
        const sub = size >= 16;
        if (!fits(sx - w / 2, sy - size - 2, w, size + (sub ? 22 : 6))) { spaced('0px'); return; }
        label(name, sx, sy - 4, ctx.font, c.text, 'center', 4);
        spaced('1.5px');
        if (sub) label(c.genre.toUpperCase(), sx, sy + 14, `700 10.5px ${getFont('ui')}`, C.labelSoft, 'center', 3);
        spaced('0px');
      });
      ctx.globalAlpha = 1;
    }
    // Meeresnamen
    if (k < 1.4 && k > 0.2) {
      ctx.globalAlpha = 0.85;
      spaced('2px');
      DATA.seas.forEach((s) => {
        const [sx, sy] = toScreen(s.x, s.y);
        if (!onScreen(sx, sy, 150)) return;
        ctx.font = `italic 400 ${clamp(11 + k * 6, 12, 17)}px ${getFont('map')}`;
        const w = ctx.measureText(s.name).width;
        if (!fits(sx - w / 2, sy - 12, w, 16)) return;
        label(s.name, sx, sy, `italic 400 ${clamp(11 + k * 6, 12, 17)}px ${getFont('map')}`, C.coast, 'center', 0);
      });
      spaced('0px');
      ctx.globalAlpha = 1;
    }
    // Regionsnamen
    const ra = Math.min(clamp((k - 0.42) / 0.2, 0, 1), clamp((2.6 - k) / 0.6, 0, 1));
    if (ra > 0) {
      ctx.globalAlpha = ra;
      regions.forEach((reg) => {
        const [sx, sy] = toScreen(reg.x, reg.y - 8);
        if (!onScreen(sx, sy, 120)) return;
        const font = `italic 500 ${clamp(12 + k * 3, 13, 17)}px ${getFont('map')}`;
        ctx.font = font;
        const w = ctx.measureText(reg.name).width;
        if (!fits(sx - w / 2 - 4, sy - 14, w + 8, 18)) return;
        label(reg.name, sx, sy, font, reg.cont.text, 'center', 3.5);
      });
      ctx.globalAlpha = 1;
    }
    // Buchtitel – Priorität: gewählt, Route, Hover, Themenfilter, Rest
    const prio = [];
    if (state.selected) prio.push(state.selected);
    (state.route || []).forEach((b) => prio.push(b));
    if (state.hover) prio.push(state.hover);
    if (state.tag || state.cont) books.forEach((b) => !filtered(b) && prio.push(b));
    if (k >= 0.95) books.forEach((b) => prio.push(b));
    const done = new Set();
    const showAuthor = k >= 2.1;
    prio.forEach((b) => {
      if (done.has(b)) return;
      done.add(b);
      if (k < 0.95 && !(b === state.selected || inRoute.has(b) || b === state.hover || ((state.tag || state.cont) && !filtered(b) && k > 0.55))) return;
      if (k >= 0.95 && filtered(b) && !inRoute.has(b) && b !== state.selected && b !== state.hover) return;
      const [sx, sy] = toScreen(b.x, b.y);
      if (!onScreen(sx, sy, 0)) return;
      const important = b === state.selected || b === state.hover || (state.route && (b === state.route[0] || b === state.route[state.route.length - 1]));
      let t = b.title;
      const max = k < 1.8 && !important ? 26 : 60;
      if (t.length > max) t = t.slice(0, max - 1).trimEnd() + '…';
      const font = `${important ? 700 : 600} ${important ? 13.5 : 12.5}px ${getFont('ui')}`;
      ctx.font = font;
      const w = ctx.measureText(t).width;
      const lx = sx + dr + 5;
      const h = showAuthor ? 30 : 16;
      if (!fits(lx - 2, sy - 11, w + 4, h) && !important) return;
      label(t, lx, sy + 4, font, C.label, 'left', 3.5);
      if (showAuthor) label(b.author, lx, sy + 18, `500 11.5px ${getFont('ui')}`, C.labelSoft, 'left', 3);
    });

    updateScale();
  }

  let fontsReady = false;
  const getFont = (role) => (role === 'map'
    ? (fontsReady ? "'Spectral', Georgia, serif" : 'Georgia, serif')
    : (fontsReady ? "'Figtree', system-ui, sans-serif" : 'system-ui, sans-serif'));

  function updateScale() {
    const target = 90 / view.k;
    const nice = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    let n = nice[0];
    for (const v of nice) if (v <= target) n = v;
    $('#scaleLabel').textContent = `${n.toLocaleString('de-DE')} Lese-km`;
    $('#scaleBar').style.width = `${Math.round(n * view.k)}px`;
  }

  // ---------------------------------------------------------------- Eingabe auf der Karte
  const pointers = new Map();
  let drag = null;
  const tip = $('#tip');

  function hit(sx, sy) {
    let best = null, bd = 14 * 14;
    books.forEach((b) => {
      const [x, y] = toScreen(b.x, b.y);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) { bd = d; best = b; }
    });
    return best;
  }
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = local(e);
    pointers.set(e.pointerId, { x, y });
    cancelAnim();
    if (pointers.size === 1) drag = { x, y, sx: x, sy: y, moved: 0 };
    else drag = null;
    hideTip();
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') hoverAt(x, y);
      return;
    }
    const prev = pointers.get(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d0 = Math.hypot(a.x - b.x, a.y - b.y);
      const mid0 = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      pointers.set(e.pointerId, { x, y });
      const [c, d] = [...pointers.values()];
      const d1 = Math.hypot(c.x - d.x, c.y - d.y);
      const mid1 = [(c.x + d.x) / 2, (c.y + d.y) / 2];
      view.cx -= (mid1[0] - mid0[0]) / view.k;
      view.cy -= (mid1[1] - mid0[1]) / view.k;
      if (d0 > 0) zoomAt(mid1[0], mid1[1], d1 / d0);
      requestDraw();
      return;
    }
    pointers.set(e.pointerId, { x, y });
    if (!drag) return;
    view.cx -= (x - prev.x) / view.k;
    view.cy -= (y - prev.y) / view.k;
    drag.moved = Math.max(drag.moved, Math.hypot(x - drag.sx, y - drag.sy));
    if (drag.moved > 4) canvas.classList.add('dragging');
    requestDraw();
  });
  const endPointer = (e) => {
    const wasDrag = drag;
    pointers.delete(e.pointerId);
    canvas.classList.remove('dragging');
    if (e.type === 'pointerup' && wasDrag && wasDrag.moved < 6 && pointers.size === 0) {
      const [x, y] = local(e);
      const b = hit(x, y);
      if (b) selectBook(b);
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { if (!pointers.size) { state.hover = null; hideTip(); requestDraw(); } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoomAt(x, y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const [x, y] = local(e);
    zoomAt(x, y, 2);
  });
  canvas.addEventListener('keydown', (e) => {
    const step = 90 / view.k;
    const keys = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (keys[e.key]) { e.preventDefault(); view.cx += keys[e.key][0]; view.cy += keys[e.key][1]; requestDraw(); }
    else if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.4);
    else if (e.key === '-') zoomAt(W / 2, H / 2, 1 / 1.4);
  });

  function hoverAt(x, y) {
    const b = hit(x, y);
    canvas.classList.toggle('over', !!b);
    if (b !== state.hover) { state.hover = b; requestDraw(); }
    if (b) {
      const [sx, sy] = toScreen(b.x, b.y);
      tip.innerHTML = `${esc(b.title)} <small>· ${esc(b.author)}</small>`;
      tip.style.left = `${sx}px`;
      tip.style.top = `${sy}px`;
      tip.hidden = false;
    } else hideTip();
  }
  function hideTip() { tip.hidden = true; }

  // ---------------------------------------------------------------- Steuerelemente
  $('#zoomIn').onclick = () => zoomAt(W / 2, H / 2, 1.5);
  $('#zoomOut').onclick = () => zoomAt(W / 2, H / 2, 1 / 1.5);
  $('#worldBtn').onclick = () => { state.cont = null; state.tag = null; renderChips(); fitBounds(bounds, 1); };
  $('#randomBtn').onclick = () => {
    let b;
    do b = books[Math.floor(Math.random() * books.length)]; while (b === state.selected);
    selectBook(b);
  };
  $('#ferryBtn').onclick = (e) => {
    state.ferries = !state.ferries;
    e.currentTarget.setAttribute('aria-pressed', String(state.ferries));
    toast(state.ferries ? 'Fährlinien eingeblendet' : 'Fährlinien ausgeblendet');
    requestDraw();
  };

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  // Chips
  function renderChips() {
    $('#chips').innerHTML = continents.map((c) =>
      `<button class="chip${state.cont === c ? ' on' : ''}" type="button" data-cont="${c.id}"><i style="background:${swatch(c.hue)}"></i>${esc(c.genre)}</button>`).join('');
  }
  $('#chips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cont]');
    if (!btn) return;
    const c = continents.find((x) => x.id === btn.dataset.cont);
    if (state.cont === c) { state.cont = null; renderChips(); showHome(); return; }
    showContinent(c);
  });

  // ---------------------------------------------------------------- Suche
  const q = $('#q');
  const sug = $('#suggest');
  let sugTarget = q;
  let sugItems = [];
  let sugActive = -1;

  function score(hay, needle) {
    if (!needle) return 0;
    if (hay.startsWith(needle)) return 3;
    if (hay.includes(' ' + needle)) return 2;
    if (hay.includes(needle)) return 1;
    return 0;
  }
  function suggestions(text, booksOnly) {
    const n = norm(text.trim());
    const out = [];
    if (!n) {
      if (booksOnly) return [...state.saved].map((id) => ({ type: 'book', b: byId.get(id) })).slice(0, 6);
      const saved = [...state.saved].slice(0, 4).map((id) => ({ type: 'book', b: byId.get(id) }));
      return [...saved, ...continents.slice(0, 8 - saved.length).map((c) => ({ type: 'cont', c }))];
    }
    if (!booksOnly) {
      continents.forEach((c) => { const s = Math.max(score(norm(c.name), n), score(norm(c.genre), n)); if (s) out.push({ type: 'cont', c, s: s + 0.5 }); });
      regions.forEach((r) => { const s = score(norm(r.name), n); if (s) out.push({ type: 'region', r, s: s + 0.3 }); });
      tagCount.forEach((cnt, t) => { const s = score(norm(t), n); if (s >= 2) out.push({ type: 'tag', t, cnt, s: s + 0.2 }); });
    }
    books.forEach((b) => {
      const s = Math.max(score(norm(b.title), n) + 0.1, score(norm(b.author), n), score(b.key, n) * 0.8);
      if (s > 0) out.push({ type: 'book', b, s });
    });
    out.sort((a, b) => b.s - a.s);
    return out.slice(0, 8);
  }
  function hl(text, needle) {
    const n = norm(needle.trim());
    if (!n) return esc(text);
    const i = norm(text).indexOf(n);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + n.length)) + '</mark>' + esc(text.slice(i + n.length));
  }
  function showSuggest(input) {
    sugTarget = input;
    const booksOnly = input !== q;
    sugItems = suggestions(input.value, booksOnly);
    sugActive = input.value.trim() ? 0 : -1;
    const v = input.value;
    if (!sugItems.length) {
      sug.innerHTML = `<div class="sug-empty">${v.trim() ? `Kein Treffer für „${esc(v.trim())}“. Versuch es mit einem Titel, einer Autorin oder einem Thema wie „magie“.` : 'Noch nichts gemerkt. Tippe einen Buchtitel.'}</div>`;
    } else {
      sug.innerHTML = sugItems.map((it, i) => {
        let ico, title, sub;
        if (it.type === 'book') { ico = `<span class="ico" style="background:${swatch(it.b.cont.hue)}">${state.saved.has(it.b.id) ? '★' : esc(it.b.title.replace(/^[^\p{L}\d]+/u, '')[0] || '?')}</span>`; title = hl(it.b.title, v); sub = `${hl(it.b.author, v)} · ${esc(it.b.region.name)}`; }
        else if (it.type === 'cont') { ico = `<span class="ico" style="background:${swatch(it.c.hue)}">${esc(it.c.name[0])}</span>`; title = hl(it.c.name, v); sub = `Kontinent · ${esc(it.c.genre)} · ${it.c.books.length} Bücher`; }
        else if (it.type === 'region') { ico = `<span class="ico" style="background:${swatch(it.r.cont.hue)}">${esc(it.r.name[0])}</span>`; title = hl(it.r.name, v); sub = `Region in ${esc(it.r.cont.name)} · ${it.r.books.length} Bücher`; }
        else { ico = '<span class="ico" style="background:var(--ui-muted)">#</span>'; title = hl(it.t, v); sub = `Thema · ${it.cnt} Bücher`; }
        return `<button type="button" class="sug${i === sugActive ? ' active' : ''}" role="option" data-i="${i}">${ico}<span class="txt"><b>${title}</b><small>${sub}</small></span></button>`;
      }).join('');
    }
    sug.hidden = false;
  }
  function hideSuggest() { sug.hidden = true; sugActive = -1; }
  function pick(it) {
    hideSuggest();
    if (!it) return;
    if (sugTarget === q) {
      if (it.type === 'book') { q.value = it.b.title; selectBook(it.b); }
      else if (it.type === 'cont') { q.value = it.c.name; showContinent(it.c); }
      else if (it.type === 'region') { q.value = it.r.name; showRegion(it.r); }
      else { q.value = it.t; showTag(it.t); }
      q.blur();
    } else if (it.type === 'book') {
      sugTarget.value = it.b.title;
      if (sugTarget.id === 'from') state.routeFrom = it.b; else state.routeTo = it.b;
      sugTarget.blur();
      tryRoute();
    }
  }
  [q, $('#from'), $('#to')].forEach((input) => {
    input.addEventListener('input', () => {
      if (input.id === 'from') state.routeFrom = null;
      if (input.id === 'to') state.routeTo = null;
      showSuggest(input);
    });
    input.addEventListener('focus', () => showSuggest(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (sug.hidden) showSuggest(input);
        if (!sugItems.length) return;
        sugActive = (sugActive + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length;
        sug.querySelectorAll('.sug').forEach((el, i) => el.classList.toggle('active', i === sugActive));
        sug.querySelector('.sug.active')?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pick(sugItems[Math.max(0, sugActive)]);
      } else if (e.key === 'Escape') { hideSuggest(); input.blur(); }
    });
  });
  sug.addEventListener('pointerdown', (e) => e.preventDefault());
  sug.addEventListener('click', (e) => {
    const el = e.target.closest('[data-i]');
    if (el) pick(sugItems[+el.dataset.i]);
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#searchcard')) hideSuggest(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); q.focus(); }
    else if (e.key === 'Escape' && document.activeElement.tagName !== 'INPUT') closePanel();
  });

  // ---------------------------------------------------------------- Routenplaner
  const routeform = $('#routeform');
  function openRoute(opts = {}) {
    routeform.hidden = false;
    panel.classList.add('route-open');
    $('#routeBtn').setAttribute('aria-pressed', 'true');
    if (opts.from !== undefined) { state.routeFrom = opts.from; $('#from').value = opts.from ? opts.from.title : ''; }
    if (opts.to !== undefined) { state.routeTo = opts.to; $('#to').value = opts.to ? opts.to.title : ''; }
    if (!tryRoute()) {
      const empty = !state.routeFrom ? $('#from') : $('#to');
      setTimeout(() => empty.focus(), 30);
    }
  }
  function closeRoute() {
    routeform.hidden = true;
    panel.classList.remove('route-open');
    $('#routeBtn').setAttribute('aria-pressed', 'false');
    const had = state.route;
    state.route = null;
    hideSuggest();
    if (had) { if (state.selected) selectBook(state.selected, { fly: false }); else showHome(); }
    requestDraw();
  }
  $('#routeBtn').onclick = () => (routeform.hidden ? openRoute({ to: state.selected || state.routeTo || null }) : closeRoute());
  $('#closeRoute').onclick = closeRoute;
  $('#swapBtn').onclick = () => {
    [state.routeFrom, state.routeTo] = [state.routeTo, state.routeFrom];
    [$('#from').value, $('#to').value] = [$('#to').value, $('#from').value];
    tryRoute();
  };
  routeform.addEventListener('submit', (e) => e.preventDefault());

  function tryRoute() {
    const { routeFrom: a, routeTo: b } = state;
    if (!a || !b) return false;
    if (a === b) { toast('Start und Ziel sind dasselbe Buch.'); return false; }
    const path = shortestPath(a, b);
    if (!path) { toast('Keine Verbindung gefunden.'); return false; }
    state.route = path;
    state.tag = null;
    state.cont = null;
    renderChips();
    renderRoute(path);
    fitBounds(boundsOf(path, 90), 2.2);
    return true;
  }

  // ---------------------------------------------------------------- Panel-Ansichten
  const ICON = {
    route: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M21.7 11.3l-9-9a1 1 0 00-1.4 0l-9 9a1 1 0 000 1.4l9 9a1 1 0 001.4 0l9-9a1 1 0 000-1.4zM14 14.5V12h-4v3H8v-4a1 1 0 011-1h5V7.5l3.5 3.5z" fill="currentColor"/></svg>',
    start: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
    save: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2zm0 15l-5-2.2L7 18V5h10z" fill="currentColor"/></svg>',
    saved: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z" fill="currentColor"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M3.9 12a3.1 3.1 0 013.1-3.1h4V7H7a5 5 0 000 10h4v-1.9H7A3.1 3.1 0 013.9 12zM8 13h8v-2H8zm9-6h-4v1.9h4a3.1 3.1 0 010 6.2h-4V17h4a5 5 0 000-10z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" fill="currentColor"/></svg>',
    dice: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M10.6 9.2L5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zm.3 9.4l-1.4 1.4 3.1 3.1-2 2.1H20v-5.5l-2 2z" fill="currentColor"/></svg>',
  };

  function setPanel(html, viewName) {
    state.view = viewName;
    panel.hidden = false;
    panel.classList.remove('expanded', 'home');
    app.classList.add('has-panel');
    panel.innerHTML = `<div class="sheet"><button class="grab" type="button" data-act="expand" aria-label="Karte vergrößern oder verkleinern"></button><button class="sheet-close" type="button" data-act="close" aria-label="Schließen">${ICON.close}</button>${html}</div>`;
    panel.querySelector('.sheet').scrollTop = 0;
  }
  function closePanel() {
    if (state.route) { closeRoute(); return; }
    state.selected = null;
    state.tag = null;
    state.cont = null;
    renderChips();
    panel.hidden = true;
    app.classList.remove('has-panel');
    setHash('');
    requestDraw();
  }

  const row = (b, right = '') => `<button class="row" type="button" data-book="${b.id}">
      <span class="sw" style="background:${coverBg(b.cont.hue)}"></span>
      <span class="rt"><b>${esc(b.title)}</b><small>${esc(b.author)} · ${fmtYear(b.year)}</small></span>
      ${right ? `<span class="rd">${right}</span>` : ''}</button>`;

  function showHome() {
    state.selected = null; state.tag = null; state.cont = null;
    renderChips();
    setHash('');
    const saved = [...state.saved].map((id) => byId.get(id));
    setPanel(`
      <div class="sec intro">
        <h1>Bücherkarte</h1>
        <p>${books.length} Bücher auf ${continents.length} Kontinenten. Jedes Genre ist ein Kontinent, jedes Buch ein Ort. Straßen verbinden Nachbarn, gestrichelte Fährlinien verbinden verwandte Themen über Genregrenzen hinweg.</p>
      </div>
      <div class="sec">
        <h3>Ausprobieren</h3>
        <div class="stack">
          <button class="cta" type="button" data-act="demo">${ICON.route}<span><b>Lese-Route: Der Hobbit → Eine kurze Geschichte der Zeit</b><small>Vom Auenland bis ans Ende des Universums</small></span></button>
          <button class="cta" type="button" data-act="random">${ICON.dice}<span><b>Zufälliges Buch entdecken</b><small>Lass dich irgendwo auf der Karte absetzen</small></span></button>
        </div>
      </div>
      ${saved.length ? `<div class="sec"><h3>Gemerkt · ${saved.length}</h3><div class="list">${saved.map((b) => row(b)).join('')}</div></div>` : ''}
      <div class="sec">
        <h3>Kontinente</h3>
        <div class="legend">${continents.map((c) => `<button type="button" data-cont="${c.id}"><i style="background:${swatch(c.hue)}"></i><span><b>${esc(c.name)}</b><small>${esc(c.genre)} · ${c.books.length}</small></span></button>`).join('')}</div>
      </div>
      <div class="sec hint">Tipp: <span class="kbd">/</span> öffnet die Suche, Mausrad oder zwei Finger zoomen, Doppelklick zoomt hinein.</div>`, 'home');
    panel.classList.add('home');
    requestDraw();
  }

  function similarTo(b, n = 5) {
    return books.filter((o) => o !== b).map((o) => [o, sim(b, o)]).sort((x, y) => y[1] - x[1]).slice(0, n).filter(([, s]) => s > 0);
  }
  function nearby(b, n = 5) {
    return books.filter((o) => o !== b).map((o) => [o, dist(b, o)]).sort((x, y) => x[1] - y[1]).slice(0, n);
  }

  function selectBook(b, opts = {}) {
    state.selected = b;
    if (state.route && !state.route.includes(b)) { state.route = null; closeRouteForm(); }
    if (state.cont && state.cont !== b.cont) { state.cont = null; renderChips(); }
    if (state.tag && !b.tags.includes(state.tag)) state.tag = null;
    setHash('buch-' + b.id);
    renderBook(b);
    if (opts.fly !== false) flyTo(b.x, b.y, Math.max(view.k, 1.5));
    requestDraw();
  }
  function closeRouteForm() {
    routeform.hidden = true;
    panel.classList.remove('route-open');
    $('#routeBtn').setAttribute('aria-pressed', 'false');
  }

  function renderBook(b) {
    const isSaved = state.saved.has(b.id);
    const more = books.filter((o) => o.author === b.author && o !== b);
    const olUrl = `https://openlibrary.org/search?q=${encodeURIComponent(b.title + ' ' + b.author)}`;
    setPanel(`
      <div class="cover" style="background:${coverBg(b.cont.hue)}">
        <div class="book" id="bookCover" style="background:${coverBg((b.cont.hue + 12) % 360)}"><span class="bt">${esc(b.title)}</span><span class="ba">${esc(b.author)}</span></div>
        <div class="where"><small>${esc(b.cont.genre)}</small>${esc(b.region.name)}<br>${esc(b.cont.name)}</div>
      </div>
      <div class="sec">
        <h2>${esc(b.title)}</h2>
        <p class="meta"><button class="linkbtn" type="button" data-author="${esc(b.author)}">${esc(b.author)}</button> · ${fmtYear(b.year)}</p>
        <div class="facts" id="facts"><span>Koordinaten <b>${Math.round(b.x)} / ${Math.round(b.y)}</b></span><span><b>${adj[b.i].length}</b> Verbindungen</span></div>
      </div>
      <div class="actions">
        <button class="act primary" type="button" data-act="routeTo">${'<span>' + ICON.route + '</span>'}Route hierher</button>
        <button class="act" type="button" data-act="routeFrom"><span>${ICON.start}</span>Von hier</button>
        <button class="act${isSaved ? ' on' : ''}" type="button" data-act="save"><span>${isSaved ? ICON.saved : ICON.save}</span>${isSaved ? 'Gemerkt' : 'Merken'}</button>
        <button class="act" type="button" data-act="share"><span>${ICON.share}</span>Link</button>
      </div>
      <div class="sec">
        <h3>Themen</h3>
        <div class="tags">${b.tags.map((t) => `<button class="tag${state.tag === t ? ' on' : ''}" type="button" data-tag="${esc(t)}">${esc(t)} <small>${tagCount.get(t)}</small></button>`).join('')}</div>
      </div>
      <div class="sec"><h3>Ähnliche Bücher</h3><div class="list">${similarTo(b).map(([o]) => row(o, o.cont !== b.cont ? esc(o.cont.genre) : '')).join('')}</div></div>
      <div class="sec"><h3>In der Nähe</h3><div class="list">${nearby(b).map(([o, d]) => row(o, `${fmtKm(d)} km`)).join('')}</div></div>
      ${more.length ? `<div class="sec"><h3>Mehr von ${esc(b.author)}</h3><div class="list">${more.map((o) => row(o)).join('')}</div></div>` : ''}
      <div class="sec"><a class="linkbtn" href="${olUrl}" target="_blank" rel="noopener">Bei Open Library ansehen ↗</a></div>`, 'book');
    enrich(b);
  }

  // Optional: Cover & Seitenzahl von Open Library (scheitert still, wenn offline/blockiert)
  const olCache = new Map();
  async function enrich(b) {
    let info = olCache.get(b.id);
    if (info === undefined) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(b.title)}&author=${encodeURIComponent(b.author)}&limit=1&fields=cover_i,number_of_pages_median,ratings_average,edition_count`;
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        info = res.ok ? ((await res.json()).docs || [])[0] || null : null;
      } catch (e) { info = null; }
      olCache.set(b.id, info);
    }
    if (!info || state.selected !== b || state.view !== 'book') return;
    const facts = $('#facts');
    if (facts) {
      if (info.number_of_pages_median) facts.insertAdjacentHTML('afterbegin', `<span><b>${info.number_of_pages_median}</b> Seiten</span>`);
      if (info.edition_count) facts.insertAdjacentHTML('beforeend', `<span><b>${info.edition_count}</b> Ausgaben</span>`);
      if (info.ratings_average) facts.insertAdjacentHTML('beforeend', `<span><b>${info.ratings_average.toFixed(1).replace('.', ',')}</b> ★ Open Library</span>`);
    }
    const cover = $('#bookCover');
    if (cover && info.cover_i) {
      const img = new Image();
      img.alt = '';
      img.onload = () => { if (img.naturalWidth > 2) cover.appendChild(img); };
      img.src = `https://covers.openlibrary.org/b/id/${info.cover_i}-M.jpg`;
    }
  }

  function showContinent(c) {
    state.cont = c; state.tag = null; state.selected = null;
    if (state.route) { state.route = null; closeRouteForm(); }
    renderChips();
    setHash('');
    setPanel(`
      <div class="cover" style="background:${coverBg(c.hue)}"><div class="where"><small>Kontinent · ${esc(c.genre)}</small><span style="font-size:26px;font-weight:600;font-style:normal">${esc(c.name)}</span></div></div>
      <div class="sec"><p class="meta">${c.books.length} Bücher in ${c.regions.length} Regionen</p></div>
      ${c.regions.map((r) => `<div class="sec"><h3><button class="linkbtn" type="button" data-region="${r.idx}">${esc(r.name)}</button> · ${r.books.length}</h3><div class="list">${r.books.map((b) => row(b)).join('')}</div></div>`).join('')}`, 'cont');
    fitBounds(boundsOf(c.books, 120), 1.4);
  }
  function showRegion(r) {
    state.cont = r.cont; state.tag = null; state.selected = null;
    if (state.route) { state.route = null; closeRouteForm(); }
    renderChips();
    setHash('');
    setPanel(`
      <div class="cover" style="background:${coverBg(r.cont.hue)}"><div class="where"><small>Region in ${esc(r.cont.name)}</small><span style="font-size:24px;font-weight:600;font-style:normal">${esc(r.name)}</span></div></div>
      <div class="sec"><h3>${r.books.length} Bücher</h3><div class="list">${r.books.map((b) => row(b)).join('')}</div></div>`, 'region');
    fitBounds(boundsOf(r.books, 80), 2.2);
  }
  function showTag(t) {
    state.tag = t; state.cont = null; state.selected = null;
    if (state.route) { state.route = null; closeRouteForm(); }
    renderChips();
    setHash('');
    const list = books.filter((b) => b.tags.includes(t));
    const conts = new Set(list.map((b) => b.cont));
    setPanel(`
      <div class="sec" style="padding-top:22px"><h3>Thema</h3><h2>${esc(t)}</h2><p class="meta">${list.length} Bücher auf ${conts.size} ${conts.size === 1 ? 'Kontinent' : 'Kontinenten'}</p></div>
      <div class="sec"><div class="list">${list.map((b) => row(b, esc(b.cont.genre))).join('')}</div></div>`, 'tag');
    fitBounds(boundsOf(list, 120), 1.6);
    requestDraw();
  }
  function showAuthor(name) {
    const list = books.filter((b) => b.author === name).sort((a, b) => a.year - b.year);
    state.selected = null; state.tag = null; state.cont = null;
    renderChips();
    setPanel(`
      <div class="sec" style="padding-top:22px"><h3>Autor·in</h3><h2>${esc(name)}</h2><p class="meta">${list.length} ${list.length === 1 ? 'Buch' : 'Bücher'} auf der Karte</p></div>
      <div class="sec"><div class="list">${list.map((b) => row(b, esc(b.region.name))).join('')}</div></div>`, 'author');
    if (list.length === 1) flyTo(list[0].x, list[0].y, Math.max(view.k, 1.5)); else fitBounds(boundsOf(list, 120), 2);
  }

  function renderRoute(path) {
    let total = 0;
    let ferries = 0;
    for (let i = 1; i < path.length; i++) { const e = edgeOf(path[i - 1], path[i]); total += e.d; if (e.ferry) ferries++; }
    const conts = new Set(path.map((b) => b.cont));
    const steps = path.map((b, i) => `
      <li class="step"><span class="node"></span><div>
        ${i > 0 ? `<div class="via">${reason(path[i - 1], b)}</div>` : ''}
        ${row(b, i === 0 ? 'Start' : i === path.length - 1 ? 'Ziel' : `${i}. Halt`)}
      </div></li>`).join('');
    setPanel(`
      <div class="sec" style="padding-top:22px">
        <h3>Lese-Route</h3>
        <div class="summary"><strong>${path.length} Bücher</strong><span class="meta">${fmtKm(total)} Lese-km · ${conts.size} ${conts.size === 1 ? 'Kontinent' : 'Kontinente'}${ferries ? ` · ${ferries} ${ferries === 1 ? 'Fähre' : 'Fähren'}` : ''}</span></div>
        <p class="meta" style="margin-top:6px">Die Route folgt Straßen zwischen Nachbarn und Fährlinien zwischen verwandten Themen. Gemeinsame Themen machen eine Etappe kürzer.</p>
      </div>
      <div class="sec"><ol class="steps">${steps}</ol></div>`, 'route');
    requestDraw();
  }

  panel.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-book],[data-tag],[data-cont],[data-region],[data-author]');
    if (!t) return;
    const d = t.dataset;
    if (d.book) {
      const b = byId.get(d.book);
      if (state.view === 'route') { state.selected = b; flyTo(b.x, b.y, Math.max(view.k, 1.6)); requestDraw(); }
      else selectBook(b);
    } else if (d.tag) {
      if (state.tag === d.tag) { state.tag = null; if (state.selected) renderBook(state.selected); requestDraw(); }
      else showTag(d.tag);
    } else if (d.cont) showContinent(continents.find((c) => c.id === d.cont));
    else if (d.region) showRegion(regions[+d.region]);
    else if (d.author) showAuthor(d.author);
    else if (d.act === 'close') closePanel();
    else if (d.act === 'expand') panel.classList.toggle('expanded');
    else if (d.act === 'random') $('#randomBtn').click();
    else if (d.act === 'demo') openRoute({ from: byId.get('der-hobbit'), to: byId.get('eine-kurze-geschichte-der-zeit') });
    else if (d.act === 'routeTo') openRoute({ to: state.selected, from: state.routeFrom && state.routeFrom !== state.selected ? state.routeFrom : null });
    else if (d.act === 'routeFrom') openRoute({ from: state.selected, to: state.routeTo && state.routeTo !== state.selected ? state.routeTo : null });
    else if (d.act === 'save') {
      const b = state.selected;
      if (state.saved.has(b.id)) { state.saved.delete(b.id); toast('Von der Merkliste entfernt'); }
      else { state.saved.add(b.id); toast('Gemerkt. Du findest es auf der Startseite und in der Suche.'); }
      persistSaved();
      renderBook(b);
      requestDraw();
    } else if (d.act === 'share') {
      const url = location.href.split('#')[0] + '#buch-' + state.selected.id;
      const fallback = () => toast(`Link: ${url}`);
      try { navigator.clipboard.writeText(url).then(() => toast('Link kopiert'), fallback); } catch (err) { fallback(); }
    }
  });

  // ---------------------------------------------------------------- Hash-Links (#buch-…)
  function setHash(h) {
    const target = h ? '#' + h : '';
    if (location.hash === target || (!h && !location.hash)) return;
    try { history.replaceState(null, '', target || location.pathname + location.search); } catch (e) { /* egal */ }
  }
  function fromHash() {
    const m = location.hash.match(/^#buch-([a-z0-9-]+)$/);
    const b = m && byId.get(m[1]);
    if (b && b !== state.selected) { selectBook(b); return true; }
    return false;
  }
  window.addEventListener('hashchange', fromHash);

  // ---------------------------------------------------------------- Start
  new ResizeObserver(() => resize()).observe(canvas);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  readTheme();
  renderChips();
  resize();
  if (!fromHash()) {
    showHome();
    fitBounds(bounds, 1, false);
  } else {
    const b = state.selected;
    flyTo(b.x, b.y, 1.6, false);
  }
  if (document.fonts) document.fonts.ready.then(() => { fontsReady = true; requestDraw(); });
  // Für Tests & Neugierige
  window.bookmap = { books, edges, continents, regions, shortestPath, selectBook, view };
})();
