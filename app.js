// Bücherkarte – eine zoombare Bibliothek mit semantischem Zoom.
// Ebenen: Genre → Subgenre → Thema → Buch → Details. Solange ein Fach auf dem
// Bildschirm klein ist, zeigt es als Text, was beim nächsten Hineinzoomen kommt.
// Ist es groß genug, öffnet es sich und gibt seine Kinder frei.
(() => {
  'use strict';

  const DATA = window.BOOKMAP;
  const LOCAL_COVERS = window.BOOK_COVERS || {};
  const $ = (s) => document.querySelector(s);
  const stage = $('#stage');
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
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const fmtYear = (y) => (y < 0 ? `${-y} v. Chr.` : String(y));
  const span = (list) => {
    const ys = list.map((b) => b.year);
    const a = Math.min(...ys), z = Math.max(...ys);
    return a === z ? fmtYear(a) : `${fmtYear(a)}–${fmtYear(z)}`;
  };
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function jacc(a, b) {
    let inter = 0;
    for (const t of a.tags) if (b.tags.includes(t)) inter++;
    return inter / (a.tags.length + b.tags.length - inter);
  }
  const TAG_LABEL = { ki: 'KI', ddr: 'DDR', usa: 'USA' };
  const tagLabel = (t) => TAG_LABEL[t] || t[0].toUpperCase() + t.slice(1);
  const ZOOM_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 109.5 16a6.5 6.5 0 004.2-1.6l.3.3v.8l5 5 1.5-1.5zm-6 0A4.5 4.5 0 1114 9.5 4.5 4.5 0 019.5 14zm.5-7H9v2H7v1h2v2h1v-2h2V9h-2z" fill="currentColor"/></svg>';

  // ---------------------------------------------------------------- Baum
  const root = { type: 'root', name: 'Bibliothek', children: [], books: [] };
  const genres = [], subs = [], themes = [], books = [];
  const byId = new Map();
  const nodes = new Map();

  // Bücher eines Subgenres nach gemeinsamen Themen gruppieren (größtes Thema zuerst).
  // Themen, die fast alle Bücher teilen, trennen nichts und werden übersprungen.
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
    rest.forEach((b) => {
      let best = null, bs = 0;
      groups.forEach((g) => { const s = g.books.reduce((a, o) => a + jacc(b, o), 0) / g.books.length; if (s > bs) { bs = s; best = g; } });
      if (best && bs >= 0.12) best.books.push(b); else groups.push({ tag: null, books: [b] });
    });
    return groups;
  }
  // Was die Bücher eines Themas außer dem Thema selbst noch gemeinsam haben
  function sharedTags(list, skip) {
    const cnt = new Map();
    list.forEach((b) => b.tags.forEach((t) => t !== skip && cnt.set(t, (cnt.get(t) || 0) + 1)));
    return [...cnt.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([t]) => t);
  }

  DATA.genres.forEach((g) => {
    const genre = { type: 'genre', id: g.id, name: g.name, desc: g.desc, hue: g.hue, parent: root, children: [], books: [] };
    genres.push(genre); nodes.set(genre.id, genre); root.children.push(genre);
    g.subs.forEach((s) => {
      const sub = { type: 'sub', id: 's' + subs.length, name: s.name, desc: s.desc, hue: g.hue, parent: genre, genre, children: [], books: [] };
      subs.push(sub); nodes.set(sub.id, sub); genre.children.push(sub);
      const list = s.books.map(([title, author, year, tags, blurb]) => {
        const b = { type: 'book', title, author, year, tags: tags.split(' '), blurb, hue: g.hue, genre, sub, theme: null, i: books.length };
        let id = slug(title);
        while (byId.has(id)) id += '-2';
        b.id = id;
        b.key = norm(`${title} ${author}`);
        byId.set(id, b); books.push(b); sub.books.push(b); genre.books.push(b); root.books.push(b);
        return b;
      });
      const groups = groupThemes(list);
      const real = groups.filter((gr) => gr.tag && gr.books.length >= 2);
      const loose = groups.filter((gr) => !(gr.tag && gr.books.length >= 2)).flatMap((gr) => gr.books);
      const byYear = (a, b) => a.year - b.year;
      if (real.length < 2) {
        // Ohne mindestens zwei Themen wäre die Themen-Ebene leer: Bücher direkt zeigen
        sub.children = [...list].sort(byYear);
        list.forEach((b) => { b.parent = sub; });
        return;
      }
      const make = (name, tag, list2, desc) => {
        const th = { type: 'theme', id: 't' + themes.length, name, tag, hue: g.hue, parent: sub, genre, sub, children: [...list2].sort(byYear), books: list2, desc };
        list2.forEach((b) => { b.theme = th; b.parent = th; });
        themes.push(th); nodes.set(th.id, th); sub.children.push(th);
      };
      real.forEach((gr) => {
        const more = sharedTags(gr.books, gr.tag);
        make(tagLabel(gr.tag), gr.tag, gr.books, `Alle drehen sich um ${tagLabel(gr.tag)}${more.length ? `, oft auch um ${more.map(tagLabel).join(', ')}` : ''}.`);
      });
      if (loose.length) make('Weitere Bücher', null, loose, `Titel aus ${sub.name}, die kein Thema mit den anderen teilen.`);
    });
  });
  const ancestors = (n) => { const out = []; for (let p = n.parent; p && p !== root; p = p.parent) out.unshift(p); return out; };
  const booksDirect = (n) => n.children.length && n.children[0].type === 'book';

  const tagCount = new Map();
  books.forEach((b) => b.tags.forEach((t) => tagCount.set(t, (tagCount.get(t) || 0) + 1)));

  // ---------------------------------------------------------------- Layout
  // Verschachtelte Treemap (Fläche ~ Anzahl Bücher), Bücher als Raster mit Cover + Text darunter.
  const HEAD = { root: 0, genre: 0.085, sub: 0.1, theme: 0.13 };
  const BOOK_ASPECT = 2.32; // Höhe / Breite: Cover 1.5 + Text 0.82

  function squarify(values, rect) {
    const total = values.reduce((a, b) => a + b, 0);
    const items = values.map((v, i) => ({ i, a: (v / total) * rect.w * rect.h })).sort((p, q) => q.a - p.a);
    const out = new Array(values.length);
    let { x, y, w, h } = rect;
    const worst = (row, len) => {
      const s = row.reduce((a, r) => a + r.a, 0);
      let mx = 0, mn = Infinity;
      row.forEach((r) => { mx = Math.max(mx, r.a); mn = Math.min(mn, r.a); });
      return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
    };
    const place = (row) => {
      const s = row.reduce((a, r) => a + r.a, 0);
      if (w >= h) {
        const cw = s / h;
        let yy = y;
        row.forEach((r) => { const rh = r.a / cw; out[r.i] = { x, y: yy, w: cw, h: rh }; yy += rh; });
        x += cw; w -= cw;
      } else {
        const rh = s / w;
        let xx = x;
        row.forEach((r) => { const rw = r.a / rh; out[r.i] = { x: xx, y, w: rw, h: rh }; xx += rw; });
        y += rh; h -= rh;
      }
    };
    let row = [];
    for (let i = 0; i < items.length;) {
      const len = Math.min(w, h);
      if (!row.length || worst([...row, items[i]], len) <= worst(row, len)) { row.push(items[i]); i++; }
      else { place(row); row = []; }
    }
    if (row.length) place(row);
    return out;
  }
  function gridBooks(list, rect) {
    const n = list.length;
    const gap = 0.18;
    let best = null;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const bw = Math.min(rect.w / (c + (c - 1) * gap), rect.h / (r * BOOK_ASPECT + (r - 1) * gap));
      if (!best || bw > best.bw) best = { c, r, bw };
    }
    const { c, r, bw } = best;
    const gx = bw * (1 + gap), gy = bw * (BOOK_ASPECT + gap);
    const ox = rect.x + (rect.w - (c * gx - bw * gap)) / 2;
    const oy = rect.y + (rect.h - (r * gy - bw * gap)) / 2;
    list.forEach((b, i) => { b.rect = { x: ox + (i % c) * gx, y: oy + Math.floor(i / c) * gy, w: bw, h: bw * BOOK_ASPECT }; });
  }
  function layoutNode(node, rect) {
    node.rect = rect;
    if (node.type === 'book') return;
    const pad = Math.min(rect.w, rect.h) * (node.type === 'root' ? 0 : 0.03);
    const head = rect.h * HEAD[node.type];
    const inner = { x: rect.x + pad, y: rect.y + head + pad * 0.4, w: rect.w - 2 * pad, h: rect.h - head - pad * 1.4 };
    if (booksDirect(node)) { gridBooks(node.children, inner); return; }
    const rs = squarify(node.children.map((c) => c.books.length + 1), inner);
    const g = Math.min(inner.w, inner.h) * (node.type === 'root' ? 0.008 : 0.014);
    node.children.forEach((c, i) => layoutNode(c, { x: rs[i].x + g, y: rs[i].y + g, w: rs[i].w - 2 * g, h: rs[i].h - 2 * g }));
  }

  // ---------------------------------------------------------------- Cover
  // Reihenfolge: lokale Datei (covers/manifest.js) → Open Library → gestaltetes Cover
  const coverState = new Map();
  let coverCache = {};
  try { coverCache = JSON.parse(localStorage.getItem('buecherkarte.covers') || '{}') || {}; } catch (e) { /* kein Speicher */ }
  const remote = { queue: [], active: 0, ok: 0, fails: 0, off: false };
  const olCover = (id) => `https://covers.openlibrary.org/b/id/${id}-M.jpg`;
  const coverHTML = (b, cls) => `<div class="${cls}" data-cover="${b.id}" style="--h:${b.hue}"><div class="fb" data-v="${hashStr(b.id) % 3}"><span class="ft">${esc(b.title)}</span><span class="fa">${esc(b.author)}</span></div></div>`;
  function applyCover(el, src) {
    if (el.querySelector('img')) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.onload = () => { if (img.naturalWidth > 4 && !el.querySelector('img')) el.appendChild(img); };
    img.src = src;
  }
  function setCover(b, src) {
    coverState.set(b.id, src);
    document.querySelectorAll(`[data-cover="${b.id}"]`).forEach((el) => applyCover(el, src));
  }
  function fillCovers(container) {
    container.querySelectorAll('[data-cover]').forEach((el) => {
      const b = byId.get(el.dataset.cover);
      const st = coverState.get(b.id);
      if (st && st !== 'pending') applyCover(el, st); else wantCover(b);
    });
  }
  let saveTimer = 0;
  const saveCache = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem('buecherkarte.covers', JSON.stringify(coverCache)); } catch (e) { /* egal */ } }, 800); };
  function wantCover(b) {
    if (coverState.has(b.id)) return;
    coverState.set(b.id, 'pending');
    if (LOCAL_COVERS[b.id]) { setCover(b, LOCAL_COVERS[b.id]); return; }
    const c = coverCache[b.id];
    if (c === 0) return;
    if (c && c.c) { setCover(b, olCover(c.c)); return; }
    if (remote.off) return;
    remote.queue.push(b);
    pump();
  }
  async function olSearch(params) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(`https://openlibrary.org/search.json?${params}&limit=1&fields=cover_i,number_of_pages_median,edition_count`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(String(res.status));
      return ((await res.json()).docs || [])[0] || null;
    } finally { clearTimeout(timer); }
  }
  function pump() {
    while (!remote.off && remote.active < 3 && remote.queue.length) {
      const b = remote.queue.shift();
      remote.active++;
      (async () => {
        try {
          let doc = await olSearch(`title=${encodeURIComponent(b.title)}&author=${encodeURIComponent(b.author)}`);
          if (!doc || !doc.cover_i) doc = (await olSearch(`q=${encodeURIComponent(b.title + ' ' + b.author)}`)) || doc;
          remote.ok++;
          coverCache[b.id] = doc && doc.cover_i ? { c: doc.cover_i, p: doc.number_of_pages_median || 0, e: doc.edition_count || 0 } : 0;
          saveCache();
          if (doc && doc.cover_i) setCover(b, olCover(doc.cover_i));
          if (state.selected === b) renderFacts(b);
        } catch (e) {
          coverState.delete(b.id);
          // Ohne Netz (oder gesperrt): nach drei Fehlschlägen nicht weiter versuchen
          if (++remote.fails >= 3 && remote.ok === 0) { remote.off = true; remote.queue.length = 0; }
        } finally {
          remote.active--;
          pump();
        }
      })();
    }
  }

  // ---------------------------------------------------------------- DOM der Fächer
  const nextHead = `<div class="next-label">${ZOOM_ICON}Beim Hineinzoomen</div>`;
  function summaryHTML(n) {
    const kids = n.children;
    if (n.type === 'genre') {
      return `<div class="kicker">Genre<span class="hits"></span></div>
        <h2>${esc(n.name)}</h2>
        <p class="facts">${plural(n.books.length, 'Buch', 'Bücher')} · ${plural(kids.length, 'Subgenre', 'Subgenres')} · ${span(n.books)}</p>
        <p class="desc">${esc(n.desc)}</p>
        <div class="strip">${n.thumbs.map((b) => coverHTML(b, 'th')).join('')}</div>
        <div class="next">${nextHead}<ul>${kids.map((s) => `<li><b>${esc(s.name)}</b><span class="n">${s.books.length}</span><span class="d">${esc(s.desc)}</span></li>`).join('')}</ul></div>`;
    }
    if (n.type === 'sub') {
      const list = booksDirect(n)
        ? kids.slice(0, 6).map((b) => `<li><b>${esc(b.title)}</b><span class="d">${esc(b.author)} · ${fmtYear(b.year)}</span></li>`).join('') + (kids.length > 6 ? `<li class="more">und ${kids.length - 6} weitere</li>` : '')
        : kids.map((t) => `<li><b>${esc(t.name)}</b><span class="n">${t.books.length}</span><span class="d">${esc(t.children.map((b) => b.title).join(', '))}</span></li>`).join('');
      return `<div class="kicker">Subgenre · ${esc(n.genre.name)}<span class="hits"></span></div>
        <h2>${esc(n.name)}</h2>
        <p class="facts">${plural(n.books.length, 'Buch', 'Bücher')}${booksDirect(n) ? '' : ` · ${plural(kids.length, 'Thema', 'Themen')}`} · ${span(n.books)}</p>
        <p class="desc">${esc(n.desc)}</p>
        <div class="strip">${n.thumbs.map((b) => coverHTML(b, 'th')).join('')}</div>
        <div class="next">${nextHead}<ul>${list}</ul></div>`;
    }
    return `<div class="kicker">Thema · ${esc(n.sub.name)}<span class="hits"></span></div>
      <h2>${esc(n.name)}</h2>
      <p class="facts">${plural(n.books.length, 'Buch', 'Bücher')} · ${span(n.books)}</p>
      <p class="desc">${esc(n.desc)}</p>
      <div class="next">${nextHead}<ul>${kids.map((b) => `<li class="bk">${coverHTML(b, 'th')}<span class="t"><b>${esc(b.title)}</b><span class="d">${esc(b.author)} · ${fmtYear(b.year)}. ${esc(b.blurb)}</span></span></li>`).join('')}</ul></div>`;
  }
  function headHTML(n) {
    const what = n.type === 'genre' ? plural(n.children.length, 'Subgenre', 'Subgenres')
      : n.type === 'theme' || booksDirect(n) ? plural(n.books.length, 'Buch', 'Bücher') : plural(n.children.length, 'Thema', 'Themen');
    return `<b>${esc(n.name)}</b><span>${what}</span>`;
  }
  const allNodes = [];
  function build(n) {
    if (n.type !== 'root') {
      const el = document.createElement('div');
      el._node = n;
      n.el = el;
      el.style.setProperty('--h', n.hue);
      if (n.type === 'book') {
        el.className = 'node book';
        el.innerHTML = `${coverHTML(n, 'cv')}<div class="bm"><b class="bt">${esc(n.title)}</b><span class="ba">${esc(n.author)} · ${fmtYear(n.year)}</span><p class="bb">${esc(n.blurb)}</p><div class="btags">${n.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div></div>`;
      } else {
        n.thumbs = (n.type === 'theme' ? n.children : [...n.books].sort((a, b) => hashStr(a.id) - hashStr(b.id))).slice(0, 8);
        el.className = `node box lv-${n.type}`;
        el.innerHTML = `<div class="sum">${summaryHTML(n)}</div><div class="head">${headHTML(n)}</div>`;
        n.sumEl = el.firstChild;
        n.headEl = el.lastChild;
        n.hitsEl = el.querySelector('.hits');
      }
      stage.appendChild(el);
      allNodes.push(n);
    }
    if (n.children) n.children.forEach(build);
  }
  build(root);

  // ---------------------------------------------------------------- Zustand
  const state = { selected: null, tag: null, saved: new Set(), view: null };
  try { (JSON.parse(localStorage.getItem('buecherkarte.saved') || '[]') || []).forEach((id) => byId.has(id) && state.saved.add(id)); } catch (e) { /* kein Speicher */ }
  const persistSaved = () => { try { localStorage.setItem('buecherkarte.saved', JSON.stringify([...state.saved])); } catch (e) { /* egal */ } };
  function markSaved(b) {
    const cv = b.el.querySelector('.cv');
    const has = cv.querySelector('.mark');
    if (state.saved.has(b.id) && !has) cv.insertAdjacentHTML('afterbegin', '<span class="mark"></span>');
    if (!state.saved.has(b.id) && has) has.remove();
  }
  books.forEach(markSaved);

  // ---------------------------------------------------------------- Ansicht
  const view = { cx: 0, cy: 0, k: 1 };
  let W = 0, H = 0, minK = 0.1, maxK = 30;
  const isMobile = () => W <= 760;
  function freeRect() {
    const r = { l: 0, t: 0, r: W, b: H };
    if (isMobile()) {
      r.t = 112;
      r.r = W - 58;
      if (!panel.hidden) r.b = H - panel.getBoundingClientRect().height;
    } else {
      r.t = 72;
      r.r = W - 66;
      if (!panel.hidden) r.l = 16 + panel.getBoundingClientRect().width + 12;
    }
    if (r.b - r.t < 140) r.b = r.t + 140;
    return r;
  }
  const freeCenter = () => { const f = freeRect(); return [(f.l + f.r) / 2, (f.t + f.b) / 2]; };
  const toWorld = (sx, sy) => [(sx - W / 2) / view.k + view.cx, (sy - H / 2) / view.k + view.cy];
  const scr = (r) => ({ x: (r.x - view.cx) * view.k + W / 2, y: (r.y - view.cy) * view.k + H / 2, w: r.w * view.k, h: r.h * view.k });
  function centerFor(x, y, k) {
    const [fx, fy] = freeCenter();
    return { cx: x - (fx - W / 2) / k, cy: y - (fy - H / 2) / k };
  }
  function kToFit(rect, frac = 0.92) {
    const f = freeRect();
    return clamp(Math.min(((f.r - f.l) * frac) / rect.w, ((f.b - f.t) * frac) / rect.h), minK, maxK);
  }
  function fitRect(rect, frac, animate = true) { flyTo(rect.x + rect.w / 2, rect.y + rect.h / 2, kToFit(rect, frac), animate); }

  let layoutAspect = 0;
  function relayout() {
    const top = isMobile() ? 112 : 72;
    const aspect = clamp((W - 66) / Math.max(200, H - top - 16), 0.55, 2.4);
    if (Math.abs(aspect - layoutAspect) / Math.max(aspect, layoutAspect) < 0.12) return false;
    layoutAspect = aspect;
    layoutNode(root, { x: 0, y: 0, w: 1600, h: 1600 / aspect });
    maxK = 440 / Math.min(...books.map((b) => b.rect.w));
    return true;
  }

  // --- Bewegung: Flug, weiches Zoomen, Schwung
  let fly = null, zoomAnim = null, inertia = null;
  function stopMotion() {
    if (fly) { cancelAnimationFrame(fly.raf); fly = null; }
    if (zoomAnim) { cancelAnimationFrame(zoomAnim.raf); zoomAnim = null; }
    if (inertia) { cancelAnimationFrame(inertia.raf); inertia = null; }
  }
  function flyTo(x, y, k, animate = true) {
    k = clamp(k, minK, maxK);
    const target = centerFor(x, y, k);
    stopMotion();
    if (!animate || reduceMotion) { Object.assign(view, { cx: target.cx, cy: target.cy, k }); requestRender(); return; }
    const s = { ...view };
    const lk0 = Math.log(s.k), lk1 = Math.log(k);
    const d = Math.hypot(target.cx - s.cx, target.cy - s.cy) * Math.min(s.k, k);
    const bump = clamp(Math.log2(1 + d / Math.max(W, 1)) * 0.9, 0, 1.6);
    const dur = clamp(420 + d * 0.3 + Math.abs(lk1 - lk0) * 150, 420, 1100);
    const t0 = performance.now();
    fly = { raf: 0 };
    const step = (now) => {
      const t = clamp((now - t0) / dur, 0, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      view.k = Math.exp(lk0 + (lk1 - lk0) * e - bump * Math.sin(Math.PI * e));
      view.cx = s.cx + (target.cx - s.cx) * e;
      view.cy = s.cy + (target.cy - s.cy) * e;
      render();
      if (t < 1) fly.raf = requestAnimationFrame(step); else fly = null;
    };
    fly.raf = requestAnimationFrame(step);
  }
  function applyZoom(sx, sy, f) {
    const k = clamp(view.k * f, minK, maxK);
    const [wx, wy] = toWorld(sx, sy);
    view.k = k;
    view.cx = wx - (sx - W / 2) / k;
    view.cy = wy - (sy - H / 2) / k;
  }
  function smoothZoomTo(targetK, sx, sy) {
    targetK = clamp(targetK, minK, maxK);
    if (fly) { cancelAnimationFrame(fly.raf); fly = null; }
    if (inertia) { cancelAnimationFrame(inertia.raf); inertia = null; }
    if (reduceMotion) { applyZoom(sx, sy, targetK / view.k); requestRender(); return; }
    if (zoomAnim) { Object.assign(zoomAnim, { k: targetK, sx, sy }); return; }
    zoomAnim = { k: targetK, sx, sy, last: performance.now(), raf: 0 };
    const step = (now) => {
      const z = zoomAnim;
      if (!z) return;
      const dt = Math.min(64, now - z.last);
      z.last = now;
      const d = Math.log(z.k) - Math.log(view.k);
      if (Math.abs(d) < 0.002) { applyZoom(z.sx, z.sy, z.k / view.k); zoomAnim = null; render(); return; }
      applyZoom(z.sx, z.sy, Math.exp(d * (1 - Math.exp(-dt / 80))));
      render();
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
      render();
      if (Math.hypot(it.vx, it.vy) < 0.015) { inertia = null; return; }
      it.raf = requestAnimationFrame(step);
    };
    inertia.raf = requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- Semantischer Zoom
  // Ein Fach öffnet sich, sobald es einen bestimmten Anteil der freien Fläche einnimmt.
  // So zeigt ein Fach, das man gerade herangezoomt hat, seine Kinder zuerst als Text.
  const OPEN_AREA = { genre: 0.3, sub: 0.42, theme: 0.45 };
  let T = null;
  function thresholds() {
    const f = freeRect();
    return { fw: f.r - f.l, fh: f.b - f.t };
  }
  function openRatio(n, w, h) {
    const a = OPEN_AREA[n.type];
    const side = Math.sqrt(a) * 0.6;
    return Math.min(Math.sqrt((w * h) / (T.fw * T.fh * a)), w / T.fw / side, h / T.fh / side);
  }
  function opennessOf(n, r) {
    if (n.type === 'root') return 1;
    r = r || scr(n.rect);
    return smooth(clamp((openRatio(n, r.w, r.h) - 0.92) / 0.16, 0, 1));
  }
  // Zoomfaktor, bei dem ein Fach vollständig geöffnet ist (das Verhältnis wächst linear mit dem Zoom)
  function kOpen(n) {
    T = thresholds();
    return (1.1 * view.k) / openRatio(n, n.rect.w * view.k, n.rect.h * view.k);
  }
  const bookSize = (w) => (w < 46 ? 'b-xs' : w < 110 ? 'b-s' : w < 210 ? 'b-m' : w < 280 ? 'b-l' : 'b-xl');
  function setSize(n, cls) {
    if (n.sizeCls === cls) return;
    if (n.sizeCls) n.el.classList.remove(n.sizeCls);
    n.el.classList.add(cls);
    n.sizeCls = cls;
  }

  let shown = new Set();
  let pending = false;
  function requestRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }
  function render() {
    if (!W) return;
    T = thresholds();
    const cur = new Set();
    const visit = (n, alpha) => {
      const r = scr(n.rect);
      if (r.x > W || r.y > H || r.x + r.w < 0 || r.y + r.h < 0 || r.w < 3) return;
      const el = n.el;
      cur.add(el);
      el.style.transform = `translate3d(${r.x.toFixed(1)}px,${r.y.toFixed(1)}px,0)`;
      el.style.width = `${r.w.toFixed(1)}px`;
      el.style.height = `${r.h.toFixed(1)}px`;
      el.style.opacity = alpha < 0.995 ? alpha.toFixed(3) : '';
      if (n.type === 'book') {
        setSize(n, bookSize(r.w));
        if (r.w >= 18 && alpha > 0.2) wantCover(n);
        return;
      }
      const t = opennessOf(n, r);
      // Erst blendet die Zusammenfassung aus, dann erscheinen die Kinder
      const sumA = 1 - clamp(t * 2, 0, 1);
      const kidA = clamp(t * 2 - 1, 0, 1);
      if (n._t !== t) {
        n.sumEl.style.opacity = sumA.toFixed(3);
        n.sumEl.style.visibility = sumA < 0.005 ? 'hidden' : '';
        n.headEl.style.opacity = kidA.toFixed(3);
        n.headEl.style.visibility = kidA < 0.005 ? 'hidden' : '';
        el.classList.toggle('open', t > 0.5);
        n._t = t;
      }
      if (sumA > 0) {
        const sz = r.w < 200 || r.h < 130 ? 's-s' : r.w < 380 || r.h < 290 ? 's-m' : 's-l';
        setSize(n, sz);
        if (alpha * sumA > 0.3 && (sz === 's-l' || (n.type === 'theme' && sz === 's-m'))) n.thumbs.forEach(wantCover);
      }
      if (kidA > 0.005) n.children.forEach((c) => visit(c, alpha * kidA));
    };
    root.children.forEach((g) => visit(g, 1));
    shown.forEach((el) => { if (!cur.has(el)) el.style.display = 'none'; });
    cur.forEach((el) => { if (!shown.has(el)) el.style.display = el._node.type === 'book' ? 'flex' : 'block'; });
    shown = cur;
    // Punktraster wandert mit und skaliert stufenweise
    const gs = 26 * Math.pow(2, ((Math.log2(view.k) % 1) + 1) % 1);
    stage.style.backgroundSize = `${gs}px ${gs}px`;
    stage.style.backgroundPosition = `${(W / 2 - view.cx * view.k) % gs}px ${(H / 2 - view.cy * view.k) % gs}px`;
    updateChrome();
  }

  // Pfad unter der Bildschirmmitte: welches Genre, Subgenre, Thema, Buch gerade im Fokus ist
  const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const distTo = (r, x, y) => Math.hypot(Math.max(r.x - x, 0, x - r.x - r.w), Math.max(r.y - y, 0, y - r.y - r.h));
  function focusPath(force = false) {
    const [wx, wy] = toWorld(...freeCenter());
    const path = [];
    let n = root;
    while (n.children && n.type !== 'book') {
      if (n !== root && !force && opennessOf(n) < 0.5) break;
      let next = n.children.find((c) => inside(c.rect, wx, wy));
      if (!next) next = n.children.reduce((a, c) => (distTo(c.rect, wx, wy) < distTo(a.rect, wx, wy) ? c : a));
      path.push(next);
      n = next;
    }
    return path;
  }
  // Ebene: 0 Genres, 1 Subgenres, 2 Themen, 3 Bücher, 4 Details
  function levelOf(path) {
    let lvl = 0;
    for (const n of path) {
      if (n.type === 'book') { if (scr(n.rect).w >= 280) lvl = 4; break; }
      if (opennessOf(n) < 0.5) break;
      lvl = booksDirect(n) ? 3 : n.type === 'genre' ? 1 : n.type === 'sub' ? 2 : 3;
    }
    return lvl;
  }
  function childSummary(n) {
    if (n.type === 'genre') return plural(n.children.length, 'Subgenre', 'Subgenres');
    if (n.type === 'book') return 'Beschreibung und Themen';
    if (booksDirect(n)) return plural(n.books.length, 'Buch', 'Bücher');
    return plural(n.children.length, 'Thema', 'Themen');
  }
  let chromeKey = '';
  function updateChrome() {
    const path = focusPath();
    const lvl = levelOf(path);
    const shownPath = path.filter((n) => n.type !== 'book' || lvl === 4);
    const last = shownPath[shownPath.length - 1];
    const key = shownPath.map((n) => n.id).join('/') + '|' + lvl;
    if (key === chromeKey) return;
    chromeKey = key;
    document.querySelectorAll('#levels .stop').forEach((el) => el.classList.toggle('on', +el.dataset.level === lvl));
    const focus = last && last.type !== 'book' && opennessOf(last) < 0.5 ? last : null;
    const hint = focus ? `Darin: ${childSummary(focus)}` : lvl === 3 ? 'Weiter hineinzoomen: Details und Themen' : lvl === 4 ? '' : `${plural(genres.length, 'Genre', 'Genres')} · ${plural(books.length, 'Buch', 'Bücher')}`;
    $('#crumbs').innerHTML = ['<button type="button" data-goto="root">Bibliothek</button>']
      .concat(shownPath.map((n) => `<span class="sep">›</span><button type="button" data-goto="${n.id}" style="--h:${n.hue}">${n.type === 'genre' ? '<i></i>' : ''}${esc(n.type === 'book' ? n.title : n.name)}</button>`))
      .join('') + (hint ? `<span class="nexthint">${hint}</span>` : '');
  }
  $('#crumbs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (!b) return;
    if (b.dataset.goto === 'root') { showAll(); return; }
    const n = nodes.get(b.dataset.goto) || byId.get(b.dataset.goto);
    if (n.type === 'book') zoomToBook(n); else zoomToNode(n);
  });

  function zoomToNode(n) {
    let k = Math.max(kToFit(n.rect, 0.9), kOpen(n));
    // Fächer mit Büchern nur so weit öffnen, dass die Bücher als Raster erscheinen (Details kommen danach)
    if (booksDirect(n)) k = Math.max(kOpen(n), Math.min(k, 190 / n.children[0].rect.w));
    flyTo(n.rect.x + n.rect.w / 2, n.rect.y + n.rect.h / 2, k);
  }
  function zoomToBook(b, detail = true, animate = true) {
    const f = freeRect();
    const bw = Math.min(detail ? 340 : 230, (f.r - f.l) * 0.5, ((f.b - f.t) * 0.9) / BOOK_ASPECT);
    flyTo(b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2, bw / b.rect.w, animate);
  }
  function showAll(animate = true) { fitRect(root.rect, 0.97, animate); }
  function goLevel(lvl) {
    const path = focusPath(true);
    if (lvl === 0) { showAll(); return; }
    const genre = path[0];
    if (lvl === 1) { zoomToNode(genre); return; }
    const sub = path[1];
    if (lvl === 2) { zoomToNode(sub); return; }
    const box = booksDirect(sub) ? sub : path[2];
    if (lvl === 3) { zoomToNode(box); return; }
    zoomToBook(path.find((n) => n.type === 'book') || box.children[0]);
  }

  // ---------------------------------------------------------------- Eingabe
  const pointers = new Map();
  let drag = null;
  let lastTap = null;
  const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  stage.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    pointers.set(e.pointerId, { x, y });
    stopMotion();
    const hitEl = e.target.closest('.node');
    drag = pointers.size === 1 ? { sx: x, sy: y, moved: 0, samples: [{ x, y, t: performance.now() }], node: hitEl && hitEl._node } : null;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const [x, y] = local(e);
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
      requestRender();
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
    if (drag.moved > 4) stage.classList.add('dragging');
    requestRender();
  });
  const endPointer = (e) => {
    const d = drag;
    pointers.delete(e.pointerId);
    stage.classList.remove('dragging');
    drag = null;
    if (e.type !== 'pointerup' || !d || pointers.size) return;
    const [x, y] = local(e);
    if (d.moved >= 6) {
      const s = d.samples, a = s[0], b = s[s.length - 1];
      const dt = b.t - a.t;
      if (dt > 0 && performance.now() - b.t < 60) {
        const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        if (Math.hypot(vx, vy) > 0.25) startInertia(vx, vy);
      }
      return;
    }
    if (e.pointerType !== 'mouse' && !d.node) {
      const now = performance.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) { smoothZoomBy(2, x, y); lastTap = null; return; }
      lastTap = { t: now, x, y };
    }
    const n = d.node;
    if (!n) return;
    if (n.type === 'book') selectBook(n);
    else zoomToNode(n);
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    smoothZoomBy(Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0028)), x, y);
  }, { passive: false });
  stage.addEventListener('dblclick', (e) => {
    if (e.target.closest('.node')) return;
    const [x, y] = local(e);
    smoothZoomBy(e.shiftKey ? 0.5 : 2, x, y);
  });
  stage.addEventListener('keydown', (e) => {
    const step = 90 / view.k;
    const keys = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (keys[e.key]) { e.preventDefault(); stopMotion(); view.cx += keys[e.key][0]; view.cy += keys[e.key][1]; requestRender(); }
    else if (e.key === '+' || e.key === '=') smoothZoomBy(2, ...freeCenter());
    else if (e.key === '-') smoothZoomBy(0.5, ...freeCenter());
  });

  $('#zoomIn').onclick = () => smoothZoomBy(2, ...freeCenter());
  $('#zoomOut').onclick = () => smoothZoomBy(0.5, ...freeCenter());
  $('#levels').addEventListener('click', (e) => { const s = e.target.closest('[data-level]'); if (s) goLevel(+s.dataset.level); });
  $('#homeBtn').onclick = () => { clearFilter(); showAll(); };
  $('#randomBtn').onclick = () => {
    let b;
    do b = books[Math.floor(Math.random() * books.length)]; while (b === state.selected);
    selectBook(b);
  };

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  // ---------------------------------------------------------------- Suche
  const q = $('#q');
  const sug = $('#suggest');
  let sugItems = [];
  let sugActive = -1;
  function score(hay, needle) {
    if (!needle) return 0;
    if (hay.startsWith(needle)) return 3;
    if (hay.includes(' ' + needle)) return 2;
    if (hay.includes(needle)) return 1;
    return 0;
  }
  function suggestions(text) {
    const n = norm(text.trim());
    if (!n) {
      const saved = [...state.saved].slice(0, 4).map((id) => ({ type: 'book', b: byId.get(id) }));
      return [...saved, ...genres.slice(0, 8 - saved.length).map((g) => ({ type: 'node', node: g }))];
    }
    const out = [];
    [...genres, ...subs, ...themes.filter((t) => t.tag)].forEach((nd) => {
      const s = score(norm(nd.name), n);
      if (s) out.push({ type: 'node', node: nd, s: s + (nd.type === 'genre' ? 0.6 : nd.type === 'sub' ? 0.4 : 0.1) });
    });
    tagCount.forEach((cnt, t) => { const s = score(norm(t), n); if (s >= 2) out.push({ type: 'tag', t, cnt, s }); });
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
  const KIND = { genre: 'Genre', sub: 'Subgenre', theme: 'Thema' };
  function showSuggest() {
    sugItems = suggestions(q.value);
    sugActive = q.value.trim() ? 0 : -1;
    const v = q.value;
    if (!sugItems.length) {
      sug.innerHTML = `<div class="sug-empty">Kein Treffer für „${esc(v.trim())}“. Versuch es mit einem Titel, einer Autorin oder einem Thema wie „magie“.</div>`;
    } else {
      sug.innerHTML = sugItems.map((it, i) => {
        let ico, title, sub;
        if (it.type === 'book') { ico = coverHTML(it.b, 'th'); title = hl(it.b.title, v); sub = `${hl(it.b.author, v)} · ${esc(it.b.sub.name)}`; }
        else if (it.type === 'node') {
          const nd = it.node;
          ico = `<span class="ico" style="--h:${nd.hue}">${nd.books.length}</span>`;
          title = hl(nd.name, v);
          sub = `${KIND[nd.type]}${nd.type === 'genre' ? '' : ` in ${esc((nd.type === 'theme' ? nd.sub : nd.genre).name)}`}`;
        } else { ico = '<span class="ico" style="--h:210">#</span>'; title = hl(it.t, v); sub = `Thema in allen Genres · ${plural(it.cnt, 'Buch', 'Bücher')}`; }
        return `<button type="button" class="sug${i === sugActive ? ' active' : ''}" role="option" data-i="${i}">${ico}<span class="txt"><b>${title}</b><small>${sub}</small></span></button>`;
      }).join('');
      fillCovers(sug);
    }
    sug.hidden = false;
  }
  const hideSuggest = () => { sug.hidden = true; sugActive = -1; };
  function pick(it) {
    hideSuggest();
    if (!it) return;
    q.blur();
    if (it.type === 'book') { q.value = it.b.title; selectBook(it.b); }
    else if (it.type === 'node') { q.value = it.node.name; clearFilter(); zoomToNode(it.node); }
    else { q.value = it.t; showTag(it.t); }
  }
  q.addEventListener('input', showSuggest);
  q.addEventListener('focus', showSuggest);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (sug.hidden) showSuggest();
      if (!sugItems.length) return;
      sugActive = (sugActive + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length;
      sug.querySelectorAll('.sug').forEach((el, i) => el.classList.toggle('active', i === sugActive));
      sug.querySelector('.sug.active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); pick(sugItems[Math.max(0, sugActive)]); }
    else if (e.key === 'Escape') { hideSuggest(); q.blur(); }
  });
  sug.addEventListener('pointerdown', (e) => e.preventDefault());
  sug.addEventListener('click', (e) => { const el = e.target.closest('[data-i]'); if (el) pick(sugItems[+el.dataset.i]); });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#searchcard')) hideSuggest(); });
  document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;
    if (e.key === '/') { e.preventDefault(); q.focus(); }
    else if (e.key === 'Escape') {
      if (!panel.hidden) closePanel();
      else goLevel(Math.max(0, levelOf(focusPath()) - 1));
    }
  });

  // ---------------------------------------------------------------- Panel
  const ICON = {
    save: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2zm0 15l-5-2.2L7 18V5h10z" fill="currentColor"/></svg>',
    saved: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z" fill="currentColor"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M3.9 12a3.1 3.1 0 013.1-3.1h4V7H7a5 5 0 000 10h4v-1.9H7A3.1 3.1 0 013.9 12zM8 13h8v-2H8zm9-6h-4v1.9h4a3.1 3.1 0 010 6.2h-4V17h4a5 5 0 000-10z" fill="currentColor"/></svg>',
    open: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2zM14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" fill="currentColor"/></svg>',
  };
  const row = (b, right = '') => `<button class="row" type="button" data-book="${b.id}">${coverHTML(b, 'th')}<span class="rt"><b>${esc(b.title)}</b><small>${esc(b.author)} · ${fmtYear(b.year)}</small></span>${right ? `<span class="rd">${right}</span>` : ''}</button>`;

  function setPanel(html, viewName) {
    const wasHidden = panel.hidden;
    state.view = viewName;
    panel.hidden = false;
    panel.classList.remove('expanded');
    panel.innerHTML = `<div class="sheet"><button class="grab" type="button" data-act="expand" aria-label="Bereich vergrößern oder verkleinern"></button><button class="sheet-close" type="button" data-act="close" aria-label="Schließen">${ICON.close}</button>${html}</div>`;
    panel.querySelector('.sheet').scrollTop = 0;
    fillCovers(panel);
    if (wasHidden) requestRender();
  }
  function closePanel() {
    panel.hidden = true;
    state.view = null;
    selectEl(null);
    clearFilter();
    setHash('');
    requestRender();
  }
  function selectEl(b) {
    if (state.selected) state.selected.el.classList.remove('sel');
    state.selected = b;
    if (b) b.el.classList.add('sel');
  }
  function similarTo(b, n = 5) {
    return books.filter((o) => o !== b)
      .map((o) => [o, jacc(b, o) + (o.author === b.author ? 0.3 : 0) + (o.sub === b.sub ? 0.08 : 0)])
      .sort((x, y) => y[1] - x[1]).slice(0, n).filter(([, s]) => s > 0);
  }
  function selectBook(b, opts = {}) {
    if (state.tag && !b.tags.includes(state.tag)) clearFilter();
    selectEl(b);
    setHash('buch-' + b.id);
    renderBook(b);
    if (opts.fly !== false) zoomToBook(b, false, opts.animate !== false);
  }
  function renderBook(b) {
    const isSaved = state.saved.has(b.id);
    const more = books.filter((o) => o.author === b.author && o !== b);
    const olUrl = `https://openlibrary.org/search?q=${encodeURIComponent(b.title + ' ' + b.author)}`;
    setPanel(`
      <div class="phero" style="--h:${b.hue}">
        ${coverHTML(b, 'pc')}
        <div class="where">${ancestors(b).map((n) => `<button class="linkbtn" type="button" data-node="${n.id}">${n.type === 'theme' ? 'Thema: ' : ''}${esc(n.name)}</button>`).join('')}</div>
      </div>
      <div class="sec">
        <h2>${esc(b.title)}</h2>
        <p class="meta"><button class="linkbtn" type="button" data-author="${esc(b.author)}">${esc(b.author)}</button> · ${fmtYear(b.year)}</p>
        <p class="blurb">${esc(b.blurb)}</p>
        <div class="pfacts" id="pfacts"></div>
      </div>
      <div class="actions">
        <button class="act${isSaved ? ' on' : ''}" type="button" data-act="save"><span>${isSaved ? ICON.saved : ICON.save}</span>${isSaved ? 'Gemerkt' : 'Merken'}</button>
        <button class="act" type="button" data-act="share"><span>${ICON.share}</span>Link</button>
        <a class="act" href="${olUrl}" target="_blank" rel="noopener" style="text-decoration:none"><span>${ICON.open}</span>Open Library</a>
      </div>
      <div class="sec"><h3>Themen</h3><div class="tags">${b.tags.map((t) => `<button class="tag${state.tag === t ? ' on' : ''}" type="button" data-tag="${esc(t)}">${esc(t)} <small>${tagCount.get(t)}</small></button>`).join('')}</div></div>
      <div class="sec"><h3>Ähnliche Bücher</h3><div class="list">${similarTo(b).map(([o]) => row(o, o.genre !== b.genre ? esc(o.genre.name) : '')).join('')}</div></div>
      ${more.length ? `<div class="sec"><h3>Mehr von ${esc(b.author)}</h3><div class="list">${more.map((o) => row(o)).join('')}</div></div>` : ''}`, 'book');
    renderFacts(b);
  }
  function renderFacts(b) {
    const el = $('#pfacts');
    if (!el || state.selected !== b) return;
    const c = coverCache[b.id];
    const parts = [`<span>${b.theme ? `Thema <b>${esc(b.theme.name)}</b>` : `Subgenre <b>${esc(b.sub.name)}</b>`}</span>`];
    if (c && c.p) parts.unshift(`<span><b>${c.p}</b> Seiten</span>`);
    if (c && c.e) parts.push(`<span><b>${c.e}</b> Ausgaben</span>`);
    el.innerHTML = parts.join('');
  }
  function clearFilter() {
    if (!state.tag) return;
    state.tag = null;
    app.classList.remove('filtering');
    allNodes.forEach((n) => n.el.classList.remove('nohit'));
  }
  function showTag(t) {
    state.tag = t;
    app.classList.add('filtering');
    allNodes.forEach((n) => {
      if (n.type === 'book') { n.el.classList.toggle('nohit', !n.tags.includes(t)); return; }
      const hits = n.books.filter((b) => b.tags.includes(t)).length;
      n.el.classList.toggle('nohit', hits === 0);
      if (n.hitsEl) n.hitsEl.textContent = hits ? `${hits} Treffer` : '';
    });
    const list = books.filter((b) => b.tags.includes(t));
    const gs = new Set(list.map((b) => b.genre));
    selectEl(null);
    setHash('');
    setPanel(`
      <div class="sec" style="padding-top:22px"><h3>Thema</h3><h2>${esc(tagLabel(t))}</h2>
        <p class="meta">${plural(list.length, 'Buch', 'Bücher')} in ${plural(gs.size, 'Genre', 'Genres')}. Die Fächer zeigen, wie viele Treffer in ihnen liegen, alle anderen Bücher sind abgeblendet.</p></div>
      <div class="sec"><div class="list">${list.map((b) => row(b, esc(b.genre.name))).join('')}</div></div>`, 'tag');
    showAll();
  }
  function showAuthor(name) {
    const list = books.filter((b) => b.author === name).sort((a, b) => a.year - b.year);
    setPanel(`
      <div class="sec" style="padding-top:22px"><h3>Autor·in</h3><h2>${esc(name)}</h2><p class="meta">${plural(list.length, 'Buch', 'Bücher')} in der Bibliothek</p></div>
      <div class="sec"><div class="list">${list.map((b) => row(b, esc(b.sub.name))).join('')}</div></div>`, 'author');
  }
  panel.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-book],[data-tag],[data-node],[data-author]');
    if (!t) return;
    const d = t.dataset;
    if (d.book) selectBook(byId.get(d.book));
    else if (d.tag) { if (state.tag === d.tag) { clearFilter(); if (state.selected) renderBook(state.selected); } else showTag(d.tag); }
    else if (d.node) zoomToNode(nodes.get(d.node));
    else if (d.author) showAuthor(d.author);
    else if (d.act === 'close') closePanel();
    else if (d.act === 'expand') panel.classList.toggle('expanded');
    else if (d.act === 'save') {
      const b = state.selected;
      if (state.saved.has(b.id)) { state.saved.delete(b.id); toast('Von der Merkliste entfernt'); }
      else { state.saved.add(b.id); toast('Gemerkt. Du findest es in der Suche.'); }
      persistSaved();
      markSaved(b);
      renderBook(b);
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
  function fromHash(animate = true) {
    const m = location.hash.match(/^#buch-([a-z0-9-]+)$/);
    const b = m && byId.get(m[1]);
    if (b && b !== state.selected) { selectBook(b, { animate }); return true; }
    return false;
  }
  window.addEventListener('hashchange', () => fromHash());

  // ---------------------------------------------------------------- Start
  function resize() {
    const r = stage.getBoundingClientRect();
    const first = !W;
    W = r.width; H = r.height;
    const changed = relayout();
    minK = kToFit(root.rect, 0.97) * 0.6;
    if (changed && !first) showAll(false);
    render();
  }
  resize();
  new ResizeObserver(() => resize()).observe(stage);
  if (!fromHash(false)) showAll(false);
  if (document.fonts) document.fonts.ready.then(requestRender);
  // Für Tests & Neugierige
  window.bookmap = { books, genres, subs, themes, view, focusPath, levelOf, goLevel, selectBook, remote };
})();
