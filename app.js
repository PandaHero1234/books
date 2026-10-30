// Bücherkarte – eine Weltkarte der Bücher.
// Hierarchie wie bei einer Cluster-Karte: Kontinent (Genre) → Region (Subgenre)
// → Themen-Cluster (Bücher mit gemeinsamem Thema) → Ort (Buch).
// Je nach Zoomstufe fassen Zahlenblasen Bücher zusammen und teilen sich beim
// Hineinzoomen auf. Straßen, Hauptstraßen und Fährlinien bilden das Netz für den
// Routenplaner.
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
  const smooth = (t) => t * t * (3 - 2 * t);
  const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const fmtYear = (y) => (y < 0 ? `${-y} v. Chr.` : String(y));
  const fmtKm = (d) => Math.round(d).toLocaleString('de-DE');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
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
  function jacc(a, b) {
    let inter = 0;
    for (const t of a.tags) if (b.tags.includes(t)) inter++;
    return inter / (a.tags.length + b.tags.length - inter);
  }

  // ---------------------------------------------------------------- Hierarchie
  const continents = [];
  const regions = [];
  const themes = [];
  const books = [];
  const byId = new Map();
  const nodes = new Map();
  const TAG_LABEL = { ki: 'KI', ddr: 'DDR', usa: 'USA' };
  const tagLabel = (t) => TAG_LABEL[t] || t[0].toUpperCase() + t.slice(1);
  const KIND = { cont: 'Kontinent', region: 'Region', theme: 'Themen-Cluster' };

  // Bücher einer Region nach gemeinsamen Themen gruppieren (gierig: größtes Thema zuerst).
  // Themen, die fast alle Bücher der Region teilen, trennen nichts und werden übersprungen.
  function groupThemes(list) {
    const limit = list.length >= 4 ? Math.ceil(list.length * 0.75) : Infinity;
    const total = (t) => list.filter((b) => b.tags.includes(t)).length;
    const rest = [...list];
    const groups = [];
    for (;;) {
      const cnt = new Map();
      rest.forEach((b) => b.tags.forEach((t) => cnt.set(t, (cnt.get(t) || 0) + 1)));
      let best = null, bc = 1;
      [...cnt.keys()].sort().forEach((t) => { if (cnt.get(t) > bc && total(t) < limit) { bc = cnt.get(t); best = t; } });
      if (!best) break;
      const g = rest.filter((b) => b.tags.includes(best));
      groups.push({ tag: best, books: g });
      g.forEach((b) => rest.splice(rest.indexOf(b), 1));
    }
    // Einzelgänger dem thematisch nächsten Cluster zuordnen, sonst bleiben sie freie Orte
    rest.forEach((b) => {
      let best = null, bs = 0;
      groups.forEach((g) => { const s = g.books.reduce((a, o) => a + jacc(b, o), 0) / g.books.length; if (s > bs) { bs = s; best = g; } });
      if (best && bs >= 0.12) best.books.push(b); else groups.push({ tag: null, books: [b] });
    });
    return groups;
  }

  DATA.continents.forEach((c) => {
    const cont = { type: 'cont', id: c.id, name: c.name, genre: c.genre, hue: c.hue, dataX: c.x, dataY: c.y, children: [], books: [], regions: [], shapes: [], tints: [] };
    continents.push(cont);
    nodes.set(cont.id, cont);
    c.regions.forEach((r) => {
      const reg = { type: 'region', id: 'r' + regions.length, idx: regions.length, name: r.name, cont, children: [], books: [] };
      regions.push(reg); nodes.set(reg.id, reg);
      cont.regions.push(reg); cont.children.push(reg);
      const list = r.books.map(([title, author, year, tags]) => {
        const b = { type: 'book', title, author, year, tags: tags.split(' '), region: reg, cont, theme: null, i: books.length };
        let id = slug(title);
        while (byId.has(id)) id += '-2';
        b.id = id;
        b.key = norm(`${title} ${author}`);
        byId.set(id, b); books.push(b); reg.books.push(b); cont.books.push(b);
        return b;
      });
      groupThemes(list).forEach((g) => {
        if (g.books.length < 2 || !g.tag) { reg.children.push(...g.books); return; }
        const th = { type: 'theme', id: 't' + themes.length, name: tagLabel(g.tag), tag: g.tag, region: reg, cont, children: g.books, books: g.books };
        g.books.forEach((b) => { b.theme = th; });
        themes.push(th); nodes.set(th.id, th); reg.children.push(th);
      });
      // Ein einziges Thema pro Region wäre nur eine Zwischenstufe ohne Nutzen
      if (reg.children.length === 1 && reg.children[0].type === 'theme') {
        const th = themes.pop();
        nodes.delete(th.id);
        th.books.forEach((b) => { b.theme = null; });
        reg.children = th.children;
      }
    });
  });
  const parentOf = (b) => b.theme || b.region;

  // ---------------------------------------------------------------- Layout
  // Kinder liegen auf einem Ring um ihren Elternknoten, Bücher als Sonnenblumen-Spirale.
  const SP = 26;
  function place(node) {
    if (node.type === 'book') return 10;
    const ch = node.children;
    if (ch.every((c) => c.type === 'book')) {
      const rot = hashStr(node.name) % 10;
      ch.forEach((b, j) => {
        const r = ch.length === 1 ? 0 : SP * Math.sqrt(j + 0.5);
        const a = j * 2.39996 + rot;
        b.ox = Math.cos(a) * r; b.oy = Math.sin(a) * r;
      });
      return SP * Math.sqrt(Math.max(0, ch.length - 0.5)) + 18;
    }
    const rads = ch.map(place);
    const m = ch.length;
    const gap = node.type === 'cont' ? 70 : 24;
    let R = 0;
    if (m > 1) for (let i = 0; i < m; i++) R = Math.max(R, (rads[i] + rads[(i + 1) % m] + gap) / (2 * Math.sin(Math.PI / m)));
    const rot = (hashStr(node.name) % 628) / 100;
    ch.forEach((c, i) => {
      const a = rot + (i * 2 * Math.PI) / m;
      c.ox = Math.cos(a) * R; c.oy = Math.sin(a) * R;
    });
    return R + Math.max(...rads);
  }
  continents.forEach((c) => { c.rad = place(c); });
  // Kontinente so weit auseinanderschieben, dass sich keine Küsten berühren
  let worldScale = 0;
  for (let i = 0; i < continents.length; i++) for (let j = i + 1; j < continents.length; j++) {
    const a = continents[i], b = continents[j];
    worldScale = Math.max(worldScale, (a.rad + b.rad + 170) / Math.hypot(a.dataX - b.dataX, a.dataY - b.dataY));
  }
  function absolute(node) {
    node.children.forEach((ch) => {
      ch.x = node.x + ch.ox; ch.y = node.y + ch.oy;
      if (ch.type !== 'book') absolute(ch);
    });
  }
  continents.forEach((c) => { c.x = c.dataX * worldScale; c.y = c.dataY * worldScale; absolute(c); });
  const seas = DATA.seas.map((s) => ({ name: s.name, x: s.x * worldScale, y: s.y * worldScale }));

  // Küstenlinien: Vereinigung verrauschter Kreise um alle Knoten und Landbrücken dazwischen
  function blob(x, y, r, seed) {
    const rnd = seeded(seed);
    const p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
    const pts = [];
    const N = 24;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const f = 1 + 0.12 * Math.sin(t * 3 + p1) + 0.07 * Math.sin(t * 5 + p2) + 0.04 * Math.sin(t * 9 + p3) + (rnd() - 0.5) * 0.06;
      pts.push(x + Math.cos(t) * r * f, y + Math.sin(t) * r * f);
    }
    return pts;
  }
  function addLand(node, out) {
    if (node.type === 'book') { out.push(blob(node.x, node.y, 46, hashStr(node.id))); return; }
    const r = node.type === 'theme' ? 34 : node.type === 'region' ? 62 : 90;
    out.push(blob(node.x, node.y, r, hashStr(node.type + node.name)));
    node.children.forEach((ch) => {
      const steps = Math.ceil(dist(node, ch) / 55);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        out.push(blob(node.x + (ch.x - node.x) * t, node.y + (ch.y - node.y) * t, node.type === 'cont' ? 70 : 44, hashStr((ch.id || ch.name) + i)));
      }
      addLand(ch, out);
    });
  }
  continents.forEach((cont) => {
    addLand(cont, cont.shapes);
    const rnd = seeded(hashStr(cont.id + 'isles'));
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      const d = cont.rad + 40 + rnd() * 50;
      cont.shapes.push(blob(cont.x + Math.cos(a) * d, cont.y + Math.sin(a) * d, 14 + rnd() * 16, hashStr(cont.id + i)));
    }
    // Jede zweite Region leicht abgesetzt, damit Grenzen erkennbar sind
    cont.regions.forEach((reg, ri) => {
      if (ri % 2) return;
      reg.books.forEach((b) => cont.tints.push(blob(b.x, b.y, 34, hashStr(b.id + 'r'))));
      reg.children.forEach((ch) => ch.type === 'theme' && cont.tints.push(blob(ch.x, ch.y, 38, hashStr(ch.id + 'r'))));
    });
  });

  const tagCount = new Map();
  books.forEach((b) => b.tags.forEach((t) => tagCount.set(t, (tagCount.get(t) || 0) + 1)));
  const sim = (a, b) => jacc(a, b) + (a.author === b.author ? 0.5 : 0) + (a.region === b.region ? 0.08 : 0);

  // ---------------------------------------------------------------- Straßennetz
  // local = Straße innerhalb einer Region, pass = Hauptstraße zwischen Regionen,
  // ferry = Fährlinie zwischen Kontinenten (thematisch verwandt)
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
    const kind = a.cont !== b.cont ? 'ferry' : a.region !== b.region ? 'pass' : 'local';
    // Fähren sind schnell, thematische Nähe verkürzt jede Strecke.
    const w = d * (kind === 'ferry' ? 0.7 : 1) * (1 - 0.45 * s);
    const e = { a, b, d, w, kind };
    edges.push(e);
    edgeMap.set(k, e);
    adj[a.i].push([b, e]);
    adj[b.i].push([a, e]);
  }
  const nearest = (b, list, n) => list.filter((o) => o !== b).sort((p, q) => dist(b, p) - dist(b, q)).slice(0, n);
  themes.forEach((th) => th.books.forEach((b) => nearest(b, th.books, 1).forEach((o) => link(b, o))));
  regions.forEach((reg) => reg.books.forEach((b) => nearest(b, reg.books, 2).forEach((o) => link(b, o))));
  continents.forEach((cont) => {
    for (let i = 0; i < cont.regions.length; i++) for (let j = i + 1; j < cont.regions.length; j++) {
      let best = null, bd = Infinity;
      for (const a of cont.regions[i].books) for (const b of cont.regions[j].books) {
        const d = dist(a, b);
        if (d < bd) { bd = d; best = [a, b]; }
      }
      if (best) link(best[0], best[1]);
    }
  });
  const byAuthor = new Map();
  books.forEach((b) => { if (!byAuthor.has(b.author)) byAuthor.set(b.author, []); byAuthor.get(b.author).push(b); });
  byAuthor.forEach((list) => {
    list.sort((p, q) => p.year - q.year);
    for (let i = 1; i < list.length; i++) link(list[i - 1], list[i]);
  });
  books.forEach((b) => {
    let best = null, bs = 0.39;
    for (const o of books) {
      if (o.cont === b.cont) continue;
      const s = jacc(b, o);
      if (s > bs || (s === bs && best && dist(b, o) < dist(b, best))) { bs = s; best = o; }
    }
    if (best) link(b, best);
  });
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
  // Fährlinien zusammengefasst pro Kontinentpaar (für die Weltansicht)
  const contFerries = new Map();
  edges.forEach((e) => {
    if (e.kind !== 'ferry') return;
    const [p, q] = e.a.cont.id < e.b.cont.id ? [e.a.cont, e.b.cont] : [e.b.cont, e.a.cont];
    const k = p.id + '|' + q.id;
    if (!contFerries.has(k)) contFerries.set(k, { a: p, b: q, n: 0 });
    contFerries.get(k).n++;
  });

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
    if (a.region !== b.region) return `Hauptstraße nach ${esc(b.region.name)}${sh}`;
    return shared.length ? `Gemeinsam: <em>${esc(shared.join(', '))}</em>` : `Nachbarort in ${esc(b.region.name)}`;
  }

  // ---------------------------------------------------------------- Zoomstufen der Cluster
  // Ein Knoten teilt sich auf, sobald seine Kinder auf dem Bildschirm weit genug auseinander liegen.
  const SPLIT_PX = { cont: 175, region: 88, theme: 30 };
  function computeSplit(node, parentK) {
    const ch = node.children;
    let dmin = Infinity;
    for (let i = 0; i < ch.length; i++) for (let j = i + 1; j < ch.length; j++) dmin = Math.min(dmin, dist(ch[i], ch[j]));
    if (!isFinite(dmin)) dmin = 200;
    node.splitK = Math.max(SPLIT_PX[node.type] / dmin, parentK * 1.45);
    ch.forEach((c) => c.type !== 'book' && computeSplit(c, node.splitK));
  }
  continents.forEach((c) => computeSplit(c, 0));
  const LEVEL_T = [median(continents.map((c) => c.splitK)), median(regions.map((r) => r.splitK)), median(themes.map((t) => t.splitK))];
  const BAND = Math.log(1.17);

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
      road: g('--road'), casing: g('--road-casing'), highway: g('--highway'), highwayCasing: g('--highway-casing'), ferry: g('--ferry'),
      label: g('--label'), labelSoft: g('--label-soft'), halo: g('--halo'),
      pin: g('--pin'), pinInk: g('--pin-ink'), route: g('--route'),
      bubbleText: g('--bubble-text'), bubbleRing: g('--bubble-ring'),
      landS: parseFloat(g('--land-s')) || 34, landL: parseFloat(g('--land-l')) || 85, dotL: parseFloat(g('--dot-l')) || 36,
    };
    const dark = C.landL < 50;
    continents.forEach((c) => {
      c.fill = `hsl(${c.hue} ${C.landS}% ${C.landL}%)`;
      c.fill2 = `hsl(${c.hue} ${C.landS + 4}% ${C.landL + (dark ? 3 : -4)}%)`;
      c.ink = `hsl(${c.hue} ${dark ? 50 : 52}% ${C.dotL}%)`;
      c.glow = `hsl(${c.hue} 55% ${dark ? 60 : 45}% / .22)`;
      c.text = `hsl(${c.hue} ${dark ? 30 : 40}% ${dark ? 78 : 26}%)`;
    });
    requestDraw();
  }

  // ---------------------------------------------------------------- Ansicht
  const view = { cx: 0, cy: 0, k: 0.3 };
  let W = 0, H = 0, dpr = 1, minK = 0.1, fitK = 0.3;
  const MAX_K = 5;
  const boundsOf = (pts, pad = 60) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  };
  const bounds = boundsOf(books, 190);

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
  const freeCenter = () => { const f = freeRect(); return [(f.l + f.r) / 2, (f.t + f.b) / 2]; };
  function centerFor(x, y, k) {
    const [fx, fy] = freeCenter();
    return { cx: x - (fx - W / 2) / k, cy: y - (fy - H / 2) / k };
  }
  function kToFit(b, pad = 40) {
    const f = freeRect();
    return clamp(Math.min((f.r - f.l - pad * 2) / (b.x1 - b.x0), (f.b - f.t - pad * 2) / (b.y1 - b.y0)), minK, MAX_K);
  }
  function fitBounds(b, maxK = 2.2, animate = true) {
    flyTo((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, Math.min(kToFit(b), maxK), animate);
  }
  const toScreen = (x, y) => [(x - view.cx) * view.k + W / 2, (y - view.cy) * view.k + H / 2];
  const toWorld = (sx, sy) => [(sx - W / 2) / view.k + view.cx, (sy - H / 2) / view.k + view.cy];

  // --- Bewegung: Flug (Klick/Suche), weiches Zoomen (Mausrad/Knöpfe), Schwung nach dem Ziehen
  let fly = null, zoomAnim = null, inertia = null;
  function stopMotion() {
    if (fly) { cancelAnimationFrame(fly.raf); fly = null; }
    if (zoomAnim) { cancelAnimationFrame(zoomAnim.raf); zoomAnim = null; }
    if (inertia) { cancelAnimationFrame(inertia.raf); inertia = null; }
  }
  function flyTo(x, y, k, animate = true) {
    k = clamp(k, minK, MAX_K);
    const target = centerFor(x, y, k);
    stopMotion();
    if (!animate || reduceMotion) { view.cx = target.cx; view.cy = target.cy; view.k = k; requestDraw(); return; }
    const s = { ...view };
    const lk0 = Math.log(s.k), lk1 = Math.log(k);
    const d = Math.hypot(target.cx - s.cx, target.cy - s.cy);
    const bump = clamp(Math.log2(1 + (d * Math.min(s.k, k)) / Math.max(W, 1)) * 0.9, 0, 1.4);
    const dur = clamp(450 + d * Math.min(s.k, k) * 0.35 + Math.abs(lk1 - lk0) * 160, 450, 1100);
    const t0 = performance.now();
    fly = { raf: 0 };
    const step = (now) => {
      const t = clamp((now - t0) / dur, 0, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      view.k = Math.exp(lk0 + (lk1 - lk0) * e - bump * Math.sin(Math.PI * e));
      view.cx = s.cx + (target.cx - s.cx) * e;
      view.cy = s.cy + (target.cy - s.cy) * e;
      draw();
      if (t < 1) fly.raf = requestAnimationFrame(step); else fly = null;
    };
    fly.raf = requestAnimationFrame(step);
  }
  // Zoomt so, dass der Weltpunkt unter (sx, sy) an Ort und Stelle bleibt
  function applyZoom(sx, sy, f) {
    const k = clamp(view.k * f, minK, MAX_K);
    const [wx, wy] = toWorld(sx, sy);
    view.k = k;
    view.cx = wx - (sx - W / 2) / k;
    view.cy = wy - (sy - H / 2) / k;
  }
  function smoothZoomTo(targetK, sx, sy) {
    targetK = clamp(targetK, minK, MAX_K);
    if (fly) { cancelAnimationFrame(fly.raf); fly = null; }
    if (inertia) { cancelAnimationFrame(inertia.raf); inertia = null; }
    if (reduceMotion) { applyZoom(sx, sy, targetK / view.k); requestDraw(); return; }
    if (zoomAnim) { Object.assign(zoomAnim, { k: targetK, sx, sy }); return; }
    zoomAnim = { k: targetK, sx, sy, last: performance.now(), raf: 0 };
    const step = (now) => {
      const z = zoomAnim;
      if (!z) return;
      const dt = Math.min(64, now - z.last);
      z.last = now;
      const d = Math.log(z.k) - Math.log(view.k);
      if (Math.abs(d) < 0.002) { applyZoom(z.sx, z.sy, z.k / view.k); zoomAnim = null; draw(); return; }
      applyZoom(z.sx, z.sy, Math.exp(d * (1 - Math.exp(-dt / 80))));
      draw();
      z.raf = requestAnimationFrame(step);
    };
    zoomAnim.raf = requestAnimationFrame(step);
  }
  const smoothZoomBy = (f, sx, sy) => smoothZoomTo((zoomAnim ? zoomAnim.k : view.k) * f, sx, sy);
  function startInertia(vx, vy) {
    if (reduceMotion) return;
    inertia = { vx, vy, last: performance.now(), raf: 0 };
    const step = (now) => {
      const it = inertia;
      if (!it) return;
      const dt = Math.min(64, now - it.last);
      it.last = now;
      view.cx -= (it.vx * dt) / view.k;
      view.cy -= (it.vy * dt) / view.k;
      const decay = Math.exp(-dt / 320);
      it.vx *= decay; it.vy *= decay;
      draw();
      if (Math.hypot(it.vx, it.vy) < 0.015) { inertia = null; return; }
      it.raf = requestAnimationFrame(step);
    };
    inertia.raf = requestAnimationFrame(step);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    fitK = Math.min(W / (bounds.x1 - bounds.x0), H / (bounds.y1 - bounds.y0));
    minK = Math.min(fitK * 0.6, LEVEL_T[0] * 0.5);
    draw();
  }
  // Zielzoom pro Detailstufe (für den Stufenregler)
  const levelK = (i) => [Math.min(fitK * 1.05, LEVEL_T[0] * 0.8), LEVEL_T[0] * 1.35, LEVEL_T[1] * 1.35, LEVEL_T[2] * 1.7][i];
  const currentLevel = () => LEVEL_T.filter((t) => view.k >= t).length;
  // 0 = geschlossen (Zahlenblase), 1 = vollständig aufgeteilt
  const openness = (splitK) => smooth(clamp((Math.log(view.k) - Math.log(splitK)) / (2 * BAND) + 0.5, 0, 1));

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
  // Fährlinien als Bogen; die Richtung hängt nur vom Paar ab, nicht von der Reihenfolge
  function curve(p, q, flip) {
    const [lo, hi] = flip ? [q, p] : [p, q];
    const dx = hi[0] - lo[0], dy = hi[1] - lo[1];
    ctx.moveTo(p[0], p[1]);
    ctx.quadraticCurveTo((lo[0] + hi[0]) / 2 - dy * 0.16, (lo[1] + hi[1]) / 2 + dx * 0.16, q[0], q[1]);
  }
  function edgeStroke(e, from, to, drawn) {
    const p = drawn ? [from.dx, from.dy] : [from.x, from.y];
    const q = drawn ? [to.dx, to.dy] : [to.x, to.y];
    if (e.kind === 'ferry') curve(p, q, from.i > to.i);
    else { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
  }
  const bubbleR = (node, n) => (node.type === 'cont' ? 24 + 3.2 * Math.log2(Math.max(1, n)) : node.type === 'region' ? 17 + 2.8 * Math.log2(Math.max(1, n)) : 13 + 2.4 * Math.log2(Math.max(1, n)));
  const matches = (b) => (!state.tag || b.tags.includes(state.tag)) && (!state.cont || b.cont === state.cont);

  let clusters = [];
  let shownLevel = -1;

  function draw() {
    if (!W) return;
    const k = view.k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.ocean;
    ctx.fillRect(0, 0, W, H);

    // --- Cluster-Baum für die aktuelle Zoomstufe auflösen
    const all = [];
    const walk = (node, px, py, appear) => {
      const x = px + (node.x - px) * appear, y = py + (node.y - py) * appear;
      node.dx = x; node.dy = y;
      if (node.type === 'book') { node.alpha = appear; return; }
      const open = openness(node.splitK);
      if (open < 1) all.push({ node, x, y, a: appear * (1 - open) });
      if (open <= 0) { node.books.forEach((b) => { b.dx = x; b.dy = y; b.alpha = 0; }); return; }
      node.children.forEach((ch) => walk(ch, x, y, open));
    };
    continents.forEach((c) => walk(c, c.x, c.y, 1));

    // --- Weltkoordinaten
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(k, k);
    ctx.translate(-view.cx, -view.cy);
    const [vx0, vy0] = toWorld(0, 0);
    const [vx1, vy1] = toWorld(W, H);

    // Gradnetz
    ctx.strokeStyle = C.oceanLine;
    ctx.lineWidth = 1 / k;
    ctx.beginPath();
    const gs = k < 0.6 ? 400 : k < 1.6 ? 200 : 100;
    for (let x = Math.floor(vx0 / gs) * gs; x <= vx1; x += gs) { ctx.moveTo(x, vy0); ctx.lineTo(x, vy1); }
    for (let y = Math.floor(vy0 / gs) * gs; y <= vy1; y += gs) { ctx.moveTo(vx0, y); ctx.lineTo(vx1, y); }
    ctx.stroke();

    // Flachwasser, Küste, Land
    ctx.lineJoin = 'round';
    ctx.beginPath();
    continents.forEach((c) => c.shapes.forEach(polyPath));
    ctx.strokeStyle = C.shallow;
    ctx.lineWidth = 34;
    ctx.stroke();
    continents.forEach((c) => {
      ctx.beginPath();
      c.shapes.forEach(polyPath);
      ctx.strokeStyle = C.coast;
      ctx.lineWidth = 2.2 / k;
      ctx.stroke();
      ctx.fillStyle = c.fill;
      ctx.fill();
      ctx.beginPath();
      c.tints.forEach(polyPath);
      ctx.fillStyle = c.fill2;
      ctx.fill();
      if (state.cont && state.cont !== c) {
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        c.shapes.forEach(polyPath);
        ctx.fillStyle = C.ocean;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    });

    // Fährlinien: in der Weltansicht gebündelt pro Kontinentpaar, danach einzeln
    if (state.ferries) {
      ctx.setLineDash([7 / k, 6 / k]);
      ctx.strokeStyle = C.ferry;
      contFerries.forEach((p) => {
        const a = 1 - openness(LEVEL_T[2]);
        if (a < 0.02) return;
        ctx.globalAlpha = a * 0.6;
        ctx.lineWidth = (1 + Math.sqrt(p.n) * 0.9) / k;
        ctx.beginPath();
        curve([p.a.x, p.a.y], [p.b.x, p.b.y], false);
        ctx.stroke();
      });
      ctx.lineWidth = 1.4 / k;
      edges.forEach((e) => {
        if (e.kind !== 'ferry') return;
        const a = Math.max(e.a.alpha, e.b.alpha) * openness(LEVEL_T[2]);
        if (a < 0.02) return;
        ctx.globalAlpha = a * 0.45;
        ctx.beginPath();
        edgeStroke(e, e.a, e.b, true);
        ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // Hauptstraßen zwischen Regionen (sobald Regionen sichtbar), Straßen zwischen Büchern
    ctx.lineCap = 'round';
    const rw = clamp(1 + k * 1.5, 1.5, 6);
    const strokeEdges = (kind, alphaOf, casing, fill, width) => {
      edges.forEach((e) => {
        if (e.kind !== kind) return;
        const a = alphaOf(e);
        if (a < 0.02) return;
        ctx.globalAlpha = a;
        ctx.beginPath();
        edgeStroke(e, e.a, e.b, true);
        ctx.strokeStyle = casing;
        ctx.lineWidth = (width + 2) / k;
        ctx.stroke();
        ctx.strokeStyle = fill;
        ctx.lineWidth = width / k;
        ctx.stroke();
      });
    };
    strokeEdges('local', (e) => Math.min(e.a.alpha, e.b.alpha), C.casing, C.road, rw);
    strokeEdges('pass', (e) => Math.min(openness(e.a.region.splitK), openness(e.b.region.splitK)), C.highwayCasing, C.highway, rw + 1.2);
    ctx.globalAlpha = 1;

    // Verbindungen des gewählten Buchs
    if (state.selected && !state.route && state.selected.alpha > 0.5) {
      const s = state.selected;
      ctx.beginPath();
      adj[s.i].forEach(([o, e]) => edgeStroke(e, s, o, true));
      ctx.strokeStyle = C.pin;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2.5 / k;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Route (immer an den echten Orten, auf jeder Zoomstufe)
    if (state.route) {
      const p = state.route;
      ctx.beginPath();
      for (let i = 1; i < p.length; i++) edgeStroke(edgeOf(p[i - 1], p[i]), p[i - 1], p[i], false);
      ctx.strokeStyle = C.halo;
      ctx.lineWidth = 9 / k;
      ctx.stroke();
      ctx.strokeStyle = C.route;
      ctx.lineWidth = 5.5 / k;
      ctx.stroke();
    }
    ctx.restore();

    // --- Bildschirmkoordinaten
    const placed = [];
    const fits = (x, y, w, h) => {
      for (const r of placed) if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return false;
      placed.push({ x, y, w, h });
      return true;
    };
    const onScreen = (sx, sy, m = 40) => sx > -m && sx < W + m && sy > -m && sy < H + m;
    const label = (text, sx, sy, font, color, align = 'left', halo = 3) => {
      ctx.font = font;
      ctx.textAlign = align;
      ctx.lineJoin = 'round';
      if (halo) { ctx.lineWidth = halo; ctx.strokeStyle = C.halo; ctx.strokeText(text, sx, sy); }
      ctx.fillStyle = color;
      ctx.fillText(text, sx, sy);
    };
    const spaced = (v) => { if ('letterSpacing' in ctx) ctx.letterSpacing = v; };
    const inRoute = new Set(state.route || []);
    const lk = Math.log(k);

    // Hintergrundnamen: Meere, Kontinente und Regionen, die schon aufgeteilt sind
    if (k < LEVEL_T[1] && k > LEVEL_T[0] * 0.5) {
      ctx.globalAlpha = 0.85;
      spaced('2px');
      seas.forEach((s) => {
        const [sx, sy] = toScreen(s.x, s.y);
        if (!onScreen(sx, sy, 150)) return;
        label(s.name, sx, sy, `italic 400 ${clamp(10 + k * 8, 11, 16)}px ${getFont('map')}`, C.coast, 'center', 0);
      });
      spaced('0px');
    }
    continents.forEach((c) => {
      const a = openness(c.splitK) * clamp((Math.log(c.splitK * 2.6) - lk) / 0.45, 0, 1);
      if (a < 0.02) return;
      const [sx, sy] = toScreen(c.x, c.y);
      if (!onScreen(sx, sy, 300)) return;
      ctx.globalAlpha = a * 0.55;
      spaced('5px');
      label(c.name.toUpperCase(), sx, sy, `600 ${clamp(16 + k * 14, 18, 34)}px ${getFont('map')}`, c.text, 'center', 0);
      spaced('0px');
    });
    regions.forEach((r) => {
      const a = openness(r.splitK) * clamp((Math.log(r.splitK * 2.8) - lk) / 0.45, 0, 1);
      if (a < 0.02) return;
      const [sx, sy] = toScreen(r.x, r.y);
      if (!onScreen(sx, sy, 200)) return;
      ctx.globalAlpha = a * 0.8;
      label(r.name, sx, sy + 5, `italic 500 ${clamp(12 + k * 3, 14, 19)}px ${getFont('map')}`, r.cont.text, 'center', 3.5);
    });
    ctx.globalAlpha = 1;

    // Orte (Bücher)
    const poi = k >= 2.1;
    const dr = poi ? 9 : k < 1.2 ? 4 : 5;
    books.forEach((b) => {
      const rb = inRoute.has(b) && b.alpha < 0.5;
      if (b.alpha < 0.02 && !rb) return;
      const [sx, sy] = rb ? toScreen(b.x, b.y) : toScreen(b.dx, b.dy);
      if (!onScreen(sx, sy)) return;
      const dim = !matches(b) && !inRoute.has(b);
      ctx.globalAlpha = (rb ? 1 : b.alpha) * (dim ? 0.3 : 1);
      const hl = (state.tag && b.tags.includes(state.tag)) || inRoute.has(b);
      const r = rb ? 4.5 : hl && !poi ? dr + 1.6 : dr;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = inRoute.has(b) ? C.route : b.cont.ink;
      ctx.fill();
      ctx.lineWidth = poi ? 2 : 1.6;
      ctx.strokeStyle = C.halo;
      ctx.stroke();
      if (poi && !rb) {
        // kleines Buch-Symbol wie ein Kartenpunkt bei Google Maps
        ctx.fillStyle = C.bubbleText;
        ctx.fillRect(sx - 4.5, sy - 3.5, 4, 7);
        ctx.fillRect(sx + 0.5, sy - 3.5, 4, 7);
      }
      if (state.saved.has(b.id)) {
        ctx.beginPath();
        ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = C.pin;
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;

    // Cluster-Blasen mit Anzahl
    all.sort((p, q) => p.node.books.length - q.node.books.length);
    const hits = [];
    all.forEach((cl) => {
      const { node } = cl;
      const [sx, sy] = toScreen(cl.x, cl.y);
      if (!onScreen(sx, sy, 60) || cl.a < 0.02) return;
      const total = node.books.length;
      const n = state.tag || state.cont ? node.books.filter(matches).length : total;
      const r = bubbleR(node, total) * (0.7 + 0.3 * cl.a) * clamp(k / (LEVEL_T[0] * 0.66), 0.5, 1);
      ctx.globalAlpha = cl.a * (n === 0 ? 0.35 : 1);
      ctx.beginPath();
      ctx.arc(sx, sy, r + 6, 0, Math.PI * 2);
      ctx.fillStyle = node.cont ? node.cont.glow : node.glow;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = node.cont ? node.cont.ink : node.ink;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = node === state.hover ? C.route : C.bubbleRing;
      ctx.stroke();
      const txt = n === total ? String(total) : `${n}/${total}`;
      ctx.font = `700 ${node.type === 'cont' ? 15 : 13}px ${getFont('ui')}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = C.bubbleText;
      ctx.fillText(txt, sx, sy + (node.type === 'cont' ? 5 : 4.5));
      cl.sx = sx; cl.sy = sy; cl.r = r;
      if (cl.a > 0.5) hits.push(cl);
      placed.push({ x: sx - r, y: sy - r, w: r * 2, h: r * 2 });
    });
    ctx.globalAlpha = 1;
    clusters = hits;

    // Pins für gewähltes Buch & Routenenden
    const pins = [];
    if (state.route) pins.push([state.route[0], 'start'], [state.route[state.route.length - 1], 'pin']);
    else if (state.selected) pins.push([state.selected, 'pin']);
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

    // Beschriftung: gewähltes Buch & Route zuerst, dann Cluster (große zuerst), dann Bücher
    const bookLabel = (b, force) => {
      const route = inRoute.has(b) && b.alpha < 0.85;
      if (!route && b.alpha < 0.85 && !force) return;
      const [sx, sy] = route || force ? toScreen(b.x, b.y) : toScreen(b.dx, b.dy);
      if (!onScreen(sx, sy, 0)) return;
      let t = b.title;
      const max = k < 1.8 && !force ? 26 : 60;
      if (t.length > max) t = t.slice(0, max - 1).trimEnd() + '…';
      const font = `${force ? 700 : 600} ${force ? 13.5 : 12.5}px ${getFont('ui')}`;
      ctx.font = font;
      const w = ctx.measureText(t).width;
      const off = poi && !route ? 12 : route ? 8 : dr + 5;
      const showAuthor = k >= 2.4;
      if (!fits(sx + off - 2, sy - 11, w + 4, showAuthor ? 30 : 16) && !force) return;
      label(t, sx + off, sy + 4, font, C.label, 'left', 3.5);
      if (showAuthor) label(b.author, sx + off, sy + 18, `500 11.5px ${getFont('ui')}`, C.labelSoft, 'left', 3);
    };
    const done = new Set();
    const first = [];
    if (state.selected) first.push([state.selected, true]);
    if (state.route) { first.push([state.route[0], true], [state.route[state.route.length - 1], true]); state.route.forEach((b) => first.push([b, false])); }
    if (state.hover && state.hover.type === 'book') first.push([state.hover, true]);
    first.forEach(([b, force]) => { if (!done.has(b)) { done.add(b); bookLabel(b, force); } });

    [...clusters].reverse().forEach((cl) => {
      const { node, sx, sy, r } = cl;
      ctx.globalAlpha = clamp((cl.a - 0.5) * 2, 0, 1);
      if (node.type === 'cont') {
        spaced('2.5px');
        const font = `600 ${clamp(12 + k * 14, 14, 20)}px ${getFont('map')}`;
        ctx.font = font;
        const w = ctx.measureText(node.name.toUpperCase()).width;
        if (fits(sx - w / 2, sy + r + 4, w, 34)) {
          label(node.name.toUpperCase(), sx, sy + r + 20, font, node.text, 'center', 4);
          spaced('1.2px');
          label(node.genre.toUpperCase(), sx, sy + r + 34, `700 10px ${getFont('ui')}`, C.labelSoft, 'center', 3);
        }
        spaced('0px');
      } else {
        const font = node.type === 'region' ? `italic 600 15px ${getFont('map')}` : `700 12.5px ${getFont('ui')}`;
        ctx.font = font;
        const w = ctx.measureText(node.name).width;
        if (fits(sx - w / 2 - 2, sy + r + 3, w + 4, 17)) label(node.name, sx, sy + r + 16, font, node.type === 'region' ? node.cont.text : C.label, 'center', 3.5);
      }
    });
    ctx.globalAlpha = 1;
    const filterOn = state.tag || state.cont;
    books.forEach((b) => {
      if (done.has(b) || b.alpha < 0.85) return;
      if (filterOn && !matches(b)) return;
      if (!filterOn && k < LEVEL_T[2] * 1.15) return;
      bookLabel(b, false);
    });

    updateScale();
    const lvl = currentLevel();
    if (lvl !== shownLevel) {
      shownLevel = lvl;
      document.querySelectorAll('#levels .stop').forEach((el) => {
        const on = +el.dataset.level === lvl;
        el.classList.toggle('on', on);
        el.setAttribute('aria-pressed', String(on));
      });
    }
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
  let lastTap = null;
  const tip = $('#tip');

  function hit(sx, sy) {
    for (let i = clusters.length - 1; i >= 0; i--) {
      const cl = clusters[i];
      if ((cl.sx - sx) ** 2 + (cl.sy - sy) ** 2 <= (cl.r + 4) ** 2) return cl.node;
    }
    let best = null, bd = 14 * 14;
    books.forEach((b) => {
      if (b.alpha < 0.6) return;
      const [x, y] = toScreen(b.dx, b.dy);
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
    stopMotion();
    drag = pointers.size === 1 ? { sx: x, sy: y, moved: 0, samples: [{ x, y, t: performance.now() }] } : null;
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
      const m0 = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      pointers.set(e.pointerId, { x, y });
      const [c, d] = [...pointers.values()];
      const d1 = Math.hypot(c.x - d.x, c.y - d.y);
      const m1 = [(c.x + d.x) / 2, (c.y + d.y) / 2];
      view.cx -= (m1[0] - m0[0]) / view.k;
      view.cy -= (m1[1] - m0[1]) / view.k;
      if (d0 > 0) applyZoom(m1[0], m1[1], d1 / d0);
      requestDraw();
      return;
    }
    pointers.set(e.pointerId, { x, y });
    if (!drag) return;
    view.cx -= (x - prev.x) / view.k;
    view.cy -= (y - prev.y) / view.k;
    drag.moved = Math.max(drag.moved, Math.hypot(x - drag.sx, y - drag.sy));
    const now = performance.now();
    drag.samples.push({ x, y, t: now });
    while (drag.samples.length > 2 && now - drag.samples[0].t > 90) drag.samples.shift();
    if (drag.moved > 4) canvas.classList.add('dragging');
    requestDraw();
  });
  const endPointer = (e) => {
    const d = drag;
    pointers.delete(e.pointerId);
    canvas.classList.remove('dragging');
    drag = null;
    if (e.type !== 'pointerup' || !d || pointers.size) return;
    const [x, y] = local(e);
    if (d.moved >= 6) {
      // Schwung mitnehmen
      const s = d.samples;
      const a = s[0], b = s[s.length - 1];
      const dt = b.t - a.t;
      if (dt > 0 && performance.now() - b.t < 60) {
        const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        if (Math.hypot(vx, vy) > 0.25) startInertia(vx, vy);
      }
      return;
    }
    const target = hit(x, y);
    if (e.pointerType !== 'mouse' && !target) {
      const now = performance.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
        smoothZoomBy(2, x, y);
        lastTap = null;
        return;
      }
      lastTap = { t: now, x, y };
    }
    if (!target) return;
    if (target.type === 'book') selectBook(target);
    else openCluster(target);
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { if (!pointers.size) { setHover(null); hideTip(); } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    smoothZoomBy(Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0028)), x, y);
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const [x, y] = local(e);
    if (hit(x, y)) return;
    smoothZoomBy(e.shiftKey ? 0.5 : 2, x, y);
  });
  canvas.addEventListener('keydown', (e) => {
    const step = 90 / view.k;
    const keys = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (keys[e.key]) { e.preventDefault(); stopMotion(); view.cx += keys[e.key][0]; view.cy += keys[e.key][1]; requestDraw(); }
    else if (e.key === '+' || e.key === '=') smoothZoomBy(2, ...freeCenter());
    else if (e.key === '-') smoothZoomBy(0.5, ...freeCenter());
  });

  function setHover(n) { if (n !== state.hover) { state.hover = n; requestDraw(); } }
  function hoverAt(x, y) {
    const n = hit(x, y);
    canvas.classList.toggle('over', !!n);
    setHover(n);
    if (!n) { hideTip(); return; }
    let sx, sy;
    if (n.type === 'book') {
      [sx, sy] = toScreen(n.dx, n.dy);
      tip.innerHTML = `${esc(n.title)} <small>· ${esc(n.author)}</small>`;
    } else {
      const cl = clusters.find((c) => c.node === n);
      sx = cl.sx; sy = cl.sy - cl.r + 6;
      const list = n.books.slice(0, 3).map((b) => b.title).join(', ');
      tip.innerHTML = `<b>${esc(n.name)}</b> <small>· ${KIND[n.type]} · ${plural(n.books.length, 'Buch', 'Bücher')}</small><br><small>${esc(list)}${n.books.length > 3 ? ' …' : ''}</small>`;
    }
    tip.style.left = `${sx}px`;
    tip.style.top = `${sy}px`;
    tip.hidden = false;
  }
  function hideTip() { tip.hidden = true; }

  // Klick auf eine Zahlenblase: hineinzoomen, bis sie sich aufteilt
  function zoomIntoNode(node) {
    const fit = kToFit(boundsOf(node.books, 50));
    const k = clamp(Math.max(node.splitK * 1.4, Math.min(fit, node.splitK * 1.7)), minK, MAX_K);
    flyTo(node.x, node.y, k);
  }
  function openCluster(node) {
    if (isMobile() || state.route) { zoomIntoNode(node); return; }
    showNode(node);
  }

  // ---------------------------------------------------------------- Steuerelemente
  $('#zoomIn').onclick = () => smoothZoomBy(2, ...freeCenter());
  $('#zoomOut').onclick = () => smoothZoomBy(0.5, ...freeCenter());
  $('#levels').addEventListener('click', (e) => {
    const stop = e.target.closest('[data-level]');
    if (stop) smoothZoomTo(levelK(+stop.dataset.level), ...freeCenter());
  });
  $('#worldBtn').onclick = () => { state.cont = null; state.tag = null; renderChips(); fitBounds(bounds, levelK(0)); };
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

  function renderChips() {
    $('#chips').innerHTML = continents.map((c) =>
      `<button class="chip${state.cont === c ? ' on' : ''}" type="button" data-cont="${c.id}"><i style="background:${swatch(c.hue)}"></i>${esc(c.genre)}</button>`).join('');
  }
  $('#chips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cont]');
    if (!btn) return;
    const c = nodes.get(btn.dataset.cont);
    if (state.cont === c) { state.cont = null; renderChips(); showHome(); return; }
    showNode(c);
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
      return [...saved, ...continents.slice(0, 8 - saved.length).map((c) => ({ type: 'node', node: c }))];
    }
    if (!booksOnly) {
      continents.forEach((c) => { const s = Math.max(score(norm(c.name), n), score(norm(c.genre), n)); if (s) out.push({ type: 'node', node: c, s: s + 0.5 }); });
      regions.forEach((r) => { const s = score(norm(r.name), n); if (s) out.push({ type: 'node', node: r, s: s + 0.3 }); });
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
  const initial = (s) => esc((s.replace(/^[^\p{L}\d]+/u, '')[0] || '?').toUpperCase());
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
        if (it.type === 'book') {
          ico = `<span class="ico" style="background:${swatch(it.b.cont.hue)}">${state.saved.has(it.b.id) ? '★' : initial(it.b.title)}</span>`;
          title = hl(it.b.title, v);
          sub = `${hl(it.b.author, v)} · ${esc(it.b.region.name)}`;
        } else if (it.type === 'node') {
          const nd = it.node;
          ico = `<span class="ico" style="background:${swatch(nd.cont ? nd.cont.hue : nd.hue)}">${nd.books.length}</span>`;
          title = hl(nd.name, v);
          sub = nd.type === 'cont' ? `Kontinent · ${esc(nd.genre)}` : `Region in ${esc(nd.cont.name)}`;
        } else {
          ico = '<span class="ico" style="background:var(--ui-muted)">#</span>';
          title = hl(it.t, v);
          sub = `Thema · ${plural(it.cnt, 'Buch', 'Bücher')}`;
        }
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
      else if (it.type === 'node') { q.value = it.node.name; showNode(it.node); }
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
  function closeRouteForm() {
    routeform.hidden = true;
    panel.classList.remove('route-open');
    $('#routeBtn').setAttribute('aria-pressed', 'false');
  }
  function closeRoute() {
    closeRouteForm();
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
    layers: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 18.5l-7.4-5.7L3 14l9 7 9-7-1.6-1.2zM12 16l7.4-5.7L21 9l-9-7-9 7 1.6 1.3z" fill="currentColor"/></svg>',
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

  function fantasyStats() {
    const c = nodes.get('fantasy');
    const nThemes = themes.filter((t) => t.cont === c).length;
    return `${plural(c.regions.length, 'Region', 'Regionen')}, ${nThemes} Themen-Cluster, ${c.books.length} Bücher`;
  }
  function showHome() {
    state.selected = null; state.tag = null; state.cont = null;
    renderChips();
    setHash('');
    const saved = [...state.saved].map((id) => byId.get(id));
    setPanel(`
      <div class="sec intro">
        <h1>Bücherkarte</h1>
        <p>${books.length} Bücher auf ${continents.length} Kontinenten. Zahlenblasen fassen Bücher zusammen: erst nach Genre, dann nach Subgenre, dann nach gemeinsamem Thema. Zoom hinein, und sie teilen sich bis zu den einzelnen Büchern auf.</p>
      </div>
      <div class="sec">
        <h3>Ausprobieren</h3>
        <div class="stack">
          <button class="cta" type="button" data-node="fantasy">${ICON.layers}<span><b>In Drachenland hineinzoomen</b><small>Fantasy · ${fantasyStats()}</small></span></button>
          <button class="cta" type="button" data-act="demo">${ICON.route}<span><b>Lese-Route: Der Hobbit → Eine kurze Geschichte der Zeit</b><small>Vom Auenland bis ans Ende des Universums</small></span></button>
          <button class="cta" type="button" data-act="random">${ICON.dice}<span><b>Zufälliges Buch entdecken</b><small>Lass dich irgendwo auf der Karte absetzen</small></span></button>
        </div>
      </div>
      ${saved.length ? `<div class="sec"><h3>Gemerkt · ${saved.length}</h3><div class="list">${saved.map((b) => row(b)).join('')}</div></div>` : ''}
      <div class="sec">
        <h3>Kontinente</h3>
        <div class="legend">${continents.map((c) => `<button type="button" data-node="${c.id}"><i style="background:${swatch(c.hue)}"></i><span><b>${esc(c.name)}</b><small>${esc(c.genre)} · ${c.books.length}</small></span></button>`).join('')}</div>
      </div>
      <div class="sec hint">Tipp: Mausrad oder zwei Finger zoomen, Doppelklick zoomt hinein, <span class="kbd">/</span> öffnet die Suche. Der Regler rechts springt direkt zu Kontinenten, Regionen, Themen oder Büchern.</div>`, 'home');
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
    if (opts.fly !== false) flyTo(b.x, b.y, Math.max(view.k, parentOf(b).splitK * 1.6, 1.4));
    requestDraw();
  }

  function renderBook(b) {
    const isSaved = state.saved.has(b.id);
    const more = books.filter((o) => o.author === b.author && o !== b);
    const olUrl = `https://openlibrary.org/search?q=${encodeURIComponent(b.title + ' ' + b.author)}`;
    const crumb = [b.cont, b.region, b.theme].filter(Boolean)
      .map((n) => `<button class="linkbtn" type="button" data-node="${n.id}">${esc(n.name)}</button>`).join(' › ');
    setPanel(`
      <div class="cover" style="background:${coverBg(b.cont.hue)}">
        <div class="book" id="bookCover" style="background:${coverBg((b.cont.hue + 12) % 360)}"><span class="bt">${esc(b.title)}</span><span class="ba">${esc(b.author)}</span></div>
        <div class="where"><small>${esc(b.cont.genre)}</small>${esc(b.region.name)}${b.theme ? `<br>Thema: ${esc(b.theme.name)}` : ''}</div>
      </div>
      <div class="sec">
        <h2>${esc(b.title)}</h2>
        <p class="meta"><button class="linkbtn" type="button" data-author="${esc(b.author)}">${esc(b.author)}</button> · ${fmtYear(b.year)}</p>
        <p class="meta" style="font-size:13.5px">${crumb}</p>
        <div class="facts" id="facts"><span><b>${adj[b.i].length}</b> Verbindungen</span><span>Koordinaten <b>${Math.round(b.x)} / ${Math.round(b.y)}</b></span></div>
      </div>
      <div class="actions">
        <button class="act primary" type="button" data-act="routeTo"><span>${ICON.route}</span>Route hierher</button>
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

  // Panel für einen Cluster (Kontinent, Region oder Thema)
  function showNode(node, opts = {}) {
    state.selected = null;
    state.tag = null;
    state.cont = node.type === 'cont' ? node : null;
    if (state.route) { state.route = null; closeRouteForm(); }
    renderChips();
    setHash('');
    const link = (n) => `<button class="linkbtn" type="button" data-node="${n.id}">${esc(n.name)}</button>`;
    const crumb = node.type === 'cont' ? esc(node.genre) : node.type === 'region' ? link(node.cont) : `${link(node.cont)} › ${link(node.region)}`;
    const subs = node.children.filter((c) => c.type !== 'book');
    const loose = node.children.filter((c) => c.type === 'book');
    const subLabel = node.type === 'cont' ? plural(subs.length, 'Region', 'Regionen') : subs.length ? `${subs.length} Themen-Cluster` : '';
    const section = (n) => `<div class="sec"><h3>${link(n)} · ${n.books.length}</h3><div class="list">${n.books.map((b) => row(b, n.type === 'region' && b.theme ? esc(b.theme.name) : '')).join('')}</div></div>`;
    setPanel(`
      <div class="cover" style="background:${coverBg(node.cont ? node.cont.hue : node.hue)}"><div class="where"><small>${KIND[node.type]}</small><span class="big">${esc(node.name)}</span></div></div>
      <div class="sec">
        <p class="meta" style="margin:0">${crumb}</p>
        <p class="meta">${plural(node.books.length, 'Buch', 'Bücher')}${subLabel ? ` in ${subLabel}` : ''}${loose.length && subs.length ? ` und ${plural(loose.length, 'einzelnem Ort', 'einzelnen Orten')}` : ''}</p>
      </div>
      ${subs.map(section).join('')}
      ${loose.length ? `<div class="sec"><h3>${subs.length ? 'Einzelne Orte' : 'Bücher'}</h3><div class="list">${loose.map((b) => row(b)).join('')}</div></div>` : ''}`, 'node');
    if (opts.fly !== false) zoomIntoNode(node);
    requestDraw();
  }
  function showTag(t) {
    state.tag = t; state.cont = null; state.selected = null;
    if (state.route) { state.route = null; closeRouteForm(); }
    renderChips();
    setHash('');
    const list = books.filter((b) => b.tags.includes(t));
    const conts = new Set(list.map((b) => b.cont));
    setPanel(`
      <div class="sec" style="padding-top:22px"><h3>Thema</h3><h2>${esc(t)}</h2><p class="meta">${plural(list.length, 'Buch', 'Bücher')} auf ${plural(conts.size, 'Kontinent', 'Kontinenten')}. Die Zahlenblasen zeigen, wie viele Treffer in jedem Cluster liegen.</p></div>
      <div class="sec"><div class="list">${list.map((b) => row(b, esc(b.cont.genre))).join('')}</div></div>`, 'tag');
    fitBounds(boundsOf(list, 120), 1.6);
    requestDraw();
  }
  function showAuthor(name) {
    const list = books.filter((b) => b.author === name).sort((a, b) => a.year - b.year);
    state.selected = null; state.tag = null; state.cont = null;
    renderChips();
    setPanel(`
      <div class="sec" style="padding-top:22px"><h3>Autor·in</h3><h2>${esc(name)}</h2><p class="meta">${plural(list.length, 'Buch', 'Bücher')} auf der Karte</p></div>
      <div class="sec"><div class="list">${list.map((b) => row(b, esc(b.region.name))).join('')}</div></div>`, 'author');
    if (list.length === 1) flyTo(list[0].x, list[0].y, Math.max(view.k, parentOf(list[0]).splitK * 1.6));
    else fitBounds(boundsOf(list, 120), 2);
  }

  function renderRoute(path) {
    let total = 0;
    let ferries = 0;
    for (let i = 1; i < path.length; i++) { const e = edgeOf(path[i - 1], path[i]); total += e.d; if (e.kind === 'ferry') ferries++; }
    const conts = new Set(path.map((b) => b.cont));
    const steps = path.map((b, i) => `
      <li class="step"><span class="node"></span><div>
        ${i > 0 ? `<div class="via">${reason(path[i - 1], b)}</div>` : ''}
        ${row(b, i === 0 ? 'Start' : i === path.length - 1 ? 'Ziel' : `${i}. Halt`)}
      </div></li>`).join('');
    setPanel(`
      <div class="sec" style="padding-top:22px">
        <h3>Lese-Route</h3>
        <div class="summary"><strong>${path.length} Bücher</strong><span class="meta">${fmtKm(total)} Lese-km · ${plural(conts.size, 'Kontinent', 'Kontinente')}${ferries ? ` · ${plural(ferries, 'Fähre', 'Fähren')}` : ''}</span></div>
        <p class="meta" style="margin-top:6px">Die Route folgt Straßen zwischen Nachbarn, Hauptstraßen zwischen Regionen und Fährlinien zwischen verwandten Themen. Gemeinsame Themen machen eine Etappe kürzer.</p>
      </div>
      <div class="sec"><ol class="steps">${steps}</ol></div>`, 'route');
    requestDraw();
  }

  panel.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-book],[data-tag],[data-node],[data-author]');
    if (!t) return;
    const d = t.dataset;
    if (d.book) {
      const b = byId.get(d.book);
      if (state.view === 'route') { state.selected = b; flyTo(b.x, b.y, Math.max(view.k, parentOf(b).splitK * 1.6)); requestDraw(); }
      else selectBook(b);
    } else if (d.tag) {
      if (state.tag === d.tag) { state.tag = null; if (state.selected) renderBook(state.selected); requestDraw(); }
      else showTag(d.tag);
    } else if (d.node) showNode(nodes.get(d.node));
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
    fitBounds(bounds, levelK(0), false);
  } else {
    const b = state.selected;
    flyTo(b.x, b.y, Math.max(parentOf(b).splitK * 1.6, 1.4), false);
  }
  if (document.fonts) document.fonts.ready.then(() => { fontsReady = true; requestDraw(); });
  // Für Tests & Neugierige
  window.bookmap = { books, edges, continents, regions, themes, shortestPath, selectBook, view, LEVEL_T, levelK };
})();
