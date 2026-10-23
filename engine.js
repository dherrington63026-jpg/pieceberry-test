// Pieceberry jigsaw engine: cuts a picture into classic jigsaw pieces, tray at the bottom, drag, snap to board and to neighbours.
// Draws on one <canvas>. Never reads pixels back, so it also works when opened straight from a file.
(function () {
  'use strict';

  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // Best columns x rows near n pieces with near-square pieces.
  // Round piece counts for 4:3 (and 3:4) pictures: exact grids, square pieces. Other shapes get the nearest fit.
  const STD = { 12: [4, 3], 24: [6, 4], 48: [8, 6], 108: [12, 9], 192: [16, 12], 300: [20, 15] };
  function gridFor(n, aspect) {
    if (STD[n]) {
      if (Math.abs(aspect - 4 / 3) < 0.03) return { cols: STD[n][0], rows: STD[n][1] };
      if (Math.abs(aspect - 3 / 4) < 0.03) return { cols: STD[n][1], rows: STD[n][0] };
    }
    let best = null;
    for (let c = 2; c <= 24; c++) {
      const r = Math.max(2, Math.round(n / c));
      const pa = aspect * r / c;
      const s = Math.abs(Math.log(pa)) * 2 + Math.abs(c * r - n) / n * 3;
      if (!best || s < best.s) best = { cols: c, rows: r, s };
    }
    return best;
  }

  // One wavy tab edge, 10 bezier points in (along, across) units of the edge length.
  function tabPoints(rand) {
    const j = 0.035, J = () => rand() * 2 * j - j;
    const t = 0.09 + rand() * 0.025, a = J(), b = J(), c = J(), d = J(), e = J();
    const s = rand() < 0.5 ? 1 : -1;
    return [[0, 0], [0.2, a], [0.5 + b + d, -t + c], [0.5 - t + b, t + c], [0.5 - 2 * t + b - d, 3 * t + c],
      [0.5 + 2 * t + b - d, 3 * t + c], [0.5 + t + b, t + c], [0.5 + b + d, -t + c], [0.8, e], [1, 0]].map(([u, v]) => [u, v * s]);
  }

  // Edges stored in cell units (x = columns, y = rows). pa = piece width / piece height.
  function makeEdges(cols, rows, pa, seed) {
    const rand = mulberry(seed), H = [], V = [];
    for (let r = 1; r < rows; r++) { H[r] = []; for (let c = 0; c < cols; c++) H[r][c] = tabPoints(rand).map(([u, v]) => [c + u, r + v * pa]); }
    for (let r = 0; r < rows; r++) { V[r] = []; for (let c = 1; c < cols; c++) V[r][c] = tabPoints(rand).map(([u, v]) => [c + v / pa, r + u]); }
    return { H, V };
  }

  function piecePath(G, p, pw, ph, ox, oy) {
    const P = new Path2D(), m = (q) => [(q[0] - p.c) * pw + ox, (q[1] - p.r) * ph + oy];
    const chain = (pts) => { for (let i = 1; i < 10; i += 3) { const a = m(pts[i]), b = m(pts[i + 1]), c = m(pts[i + 2]); P.bezierCurveTo(a[0], a[1], b[0], b[1], c[0], c[1]); } };
    const { H, V } = G.edges, { r, c } = p;
    P.moveTo(ox, oy);
    if (r === 0) P.lineTo(ox + pw, oy); else chain(H[r][c]);
    if (c === G.cols - 1) P.lineTo(ox + pw, oy + ph); else chain(V[r][c + 1]);
    if (r === G.rows - 1) P.lineTo(ox, oy + ph); else chain(H[r + 1][c].slice().reverse());
    if (c === 0) P.closePath(); else { chain(V[r][c].slice().reverse()); P.closePath(); }
    return P;
  }

  // ---------- sound ----------
  let AC = null;
  function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } if (AC && AC.state === 'suspended') AC.resume(); return AC; }
  // The little sound when a piece clicks in. Packs: wood (free), chimes, raindrop, bubble, paper.
  function tock(big) {
    if (!Jig.sound) return; const a = ac(); if (!a) return;
    const t = a.currentTime, v = big ? 1 : 0.7, pk = Jig.soundPack || 'wood';
    const tone = (type, f0, f1, dur, vol, delay) => {
      const d = t + (delay || 0), o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, d); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, d + dur * 0.7);
      g.gain.setValueAtTime(0.0001, d); g.gain.exponentialRampToValueAtTime(vol * v, d + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, d + dur);
      o.connect(g).connect(a.destination); o.start(d); o.stop(d + dur + 0.03);
    };
    if (pk === 'chimes') { tone('sine', big ? 1318 : 1046, big ? 1318 : 1046, 0.5, 0.16); tone('sine', big ? 1976 : 1568, big ? 1976 : 1568, 0.35, 0.07, 0.04); }
    else if (pk === 'drops') { tone('sine', big ? 1500 : 1250, 520, 0.16, 0.2); tone('sine', big ? 900 : 760, 380, 0.14, 0.08, 0.09); }
    else if (pk === 'bubble') { tone('sine', 280, big ? 980 : 800, 0.12, 0.2); }
    else if (pk === 'paper') {
      const n = Math.floor(a.sampleRate * 0.09), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < n; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / n, 2.2);
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      src.buffer = buf; f.type = 'bandpass'; f.frequency.value = big ? 3200 : 2600; f.Q.value = 0.7; g.gain.value = 0.5 * v;
      src.connect(f).connect(g).connect(a.destination); src.start(t);
    }
    else tone('triangle', big ? 640 : 520, 160, 0.12, big ? 0.22 : 0.15);   // wood
  }
  function chime() {
    if (!Jig.sound) return; const a = ac(); if (!a) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const t = a.currentTime + i * 0.12, o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + 1.2);
    });
  }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { } }

  // ---------- game ----------
  const Jig = { sound: true, soundPack: 'wood', pieceStyle: 'classic', big: true, ghost: true, edgesOnly: false, peek: false, onChange: null, onWin: null };
  let cv, ctx, G = null, L = null, dirty = true, drag = null, scroll = 0, ro = null, view = { s: 1, x: 0, y: 0 }, ptrs = new Map(), qTimer = null;

  function save() {
    if (!G) return;
    const loose = G.loose.map(id => { const p = G.pieces[id]; return [id, +((p.x - L.bx) / L.pw).toFixed(3), +((p.y - L.by) / L.ph).toFixed(3), p.group]; });
    const st = { cols: G.cols, rows: G.rows, seed: G.seed, tray: G.tray, loose, placed: G.pieces.filter(p => p.placed).map(p => p.id), done: G.done || false };
    try { localStorage.setItem(G.key, JSON.stringify(st)); } catch (e) { }
  }
  Jig.loadSave = function (key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } };
  Jig.clearSave = function (key) { try { localStorage.removeItem(key); } catch (e) { } };
  Jig.gridFor = gridFor;

  // seed (optional): fixed cut for the Daily Puzzle so everyone gets the same pieces that day.
  Jig.start = function (canvas, img, key, n, saved, fixedSeed) {
    cv = canvas; ctx = cv.getContext('2d');
    const aspect = img.naturalWidth / img.naturalHeight;
    let cols, rows, seed;
    if (saved) { cols = saved.cols; rows = saved.rows; seed = saved.seed; }
    else { const g = gridFor(n, aspect); cols = g.cols; rows = g.rows; seed = fixedSeed != null ? fixedSeed : (Math.random() * 1e9) | 0; }
    const pa = aspect * rows / cols;
    G = { img, key, cols, rows, seed, pa, edges: makeEdges(cols, rows, pa, seed), pieces: [], tray: [], loose: [], done: false };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const id = r * cols + c; G.pieces.push({ id, r, c, x: 0, y: 0, group: id, placed: false, sprite: null, edge: r === 0 || c === 0 || r === rows - 1 || c === cols - 1 }); }
    if (saved) {
      G.tray = saved.tray.slice(); G.done = !!saved.done;
      saved.placed.forEach(id => { G.pieces[id].placed = true; });
      G._pendingLoose = saved.loose;
    } else {
      const rand = mulberry(seed ^ 0x5bd1e995), ids = G.pieces.map(p => p.id);
      for (let i = ids.length - 1; i > 0; i--) { const k = Math.floor(rand() * (i + 1)); [ids[i], ids[k]] = [ids[k], ids[i]]; }
      G.tray = ids;
    }
    scroll = 0; drag = null; ptrs.clear(); Jig.edgesOnly = false; Jig.peek = false;
    layout();
    if (G._pendingLoose) { G._pendingLoose.forEach(([id, u, v, g]) => { const p = G.pieces[id]; p.x = L.bx + u * L.pw; p.y = L.by + v * L.ph; p.group = g; G.loose.push(id); }); delete G._pendingLoose; nudgeAll(); }
    if (!ro) { ro = new ResizeObserver(() => Jig.relayout()); ro.observe(cv.parentElement); }
    if (!cv._wired) wire();
    if (!saved) save();
    changed();
  };
  Jig.stop = function () { if (G) save(); G = null; };
  Jig.progress = function () { if (!G) return null; const placed = G.pieces.filter(p => p.placed).length; return { placed, total: G.pieces.length }; };
  Jig.redraw = function () { dirty = true; };
  if (!window.STORE_LIVE) Jig._debug = function () { return { G, L, scroll, view }; };

  // Called when the screen size changes (rotate, resize): re-fit everything and keep loose pieces at the same spot on the picture.
  Jig.relayout = function () {
    if (!G) return;
    // keep the player's zoom and the spot they are looking at (a phone browser's address bar sliding away also triggers this)
    const keep = view.s > 1.001 ? { s: view.s, fx: (L.w / 2 - view.x) / view.s / L.w, fy: (L.trayTop / 2 - view.y) / view.s / L.trayTop } : null;
    const before = G.loose.map(id => { const p = G.pieces[id]; return [id, (p.x - L.bx) / L.pw, (p.y - L.by) / L.ph]; });
    layout();
    before.forEach(([id, u, v]) => { const p = G.pieces[id]; p.x = L.bx + u * L.pw; p.y = L.by + v * L.ph; });
    // pieces that now sit outside (or under the tray) are pulled back onto the visible table
    G.loose.forEach(id => { const p = G.pieces[id]; p.x = Math.max(4, Math.min(L.w - L.pw - 4, p.x)); p.y = Math.max(4, Math.min(L.trayTop - L.ph - 4, p.y)); });
    if (keep) {
      view.s = Math.min(keep.s, maxZoom()); view.x = L.w / 2 - keep.fx * L.w * view.s; view.y = L.trayTop / 2 - keep.fy * L.trayTop * view.s;
      clampView(); scheduleQuality();
    }
    nudgeAll();
    dirty = true; drawFrame();
    changed();
  };

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5), box = cv.parentElement.getBoundingClientRect();
    const w = Math.max(200, box.width), h = Math.max(240, box.height);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const trayH = Math.round(Math.min(230, Math.max(124, h * 0.25)));
    const m = 12, aw = w - 2 * m, ah = h - trayH - 2 * m;
    const iw = G.img.naturalWidth, ih = G.img.naturalHeight, s = Math.min(aw / iw, ah / ih);
    const bw = iw * s, bh = ih * s, bx = (w - bw) / 2, by = m + (ah - bh) / 2;
    const pw = bw / G.cols, ph = bh / G.rows;
    const slot = Math.min(112, Math.max(Math.min(pw, ph) * 1.3, Jig.big ? 76 : 58));
    const trows = Math.max(1, Math.floor((trayH - 14) / slot));
    L = { w, h, dpr, trayH, trayTop: h - trayH, bx, by, bw, bh, pw, ph, pad: Math.max(pw, ph) * 0.34 + 4, slot, trows, spr: Math.min(dpr, 2) };
    L.snap = Math.max(12, Math.min(pw, ph) * 0.32);
    G.pieces.forEach(p => { p.sprite = null; p.path = null; });
    view = { s: 1, x: 0, y: 0 }; buildLayer();
    clampScroll(); dirty = true; drawFrame();   // draw at once: resizing a canvas blanks it, so waiting for the next frame would flash an empty table
  }

  // board layer: placed pieces are painted here once (and again whenever the sharpness changes)
  function buildLayer() {
    L.layer = document.createElement('canvas'); L.layer.width = Math.round(L.bw * L.spr); L.layer.height = Math.round(L.bh * L.spr);
    const lc = L.layer.getContext('2d'); lc.scale(L.spr, L.spr);
    G.pieces.forEach(p => { if (p.placed) paintPlaced(p, lc); });
  }

  function hitPath(p) { if (!p.path) p.path = piecePath(G, p, L.pw, L.ph, 0, 0); return p.path; }

  // Piece looks: classic (free), glossy, soft, wooden, stained. Used for loose pieces and for the finished board.
  const LINE = {   // line drawn round pieces already on the board
    classic: ['rgba(0,0,0,.16)', 0.7], glossy: ['rgba(0,0,0,.22)', 0.8], soft: ['rgba(255,255,255,.16)', 0.6],
    wooden: ['rgba(110,66,28,.6)', 1.1], stained: ['rgba(18,16,26,.85)', 2.2],
  };
  function sprite(p) {
    if (p.sprite) return p.sprite;
    const { pw, ph, pad, spr } = L, st = Jig.pieceStyle || 'classic', c = document.createElement('canvas');
    c.width = Math.ceil((pw + 2 * pad) * spr); c.height = Math.ceil((ph + 2 * pad) * spr);
    const x = c.getContext('2d'); x.scale(spr, spr);
    const path = piecePath(G, p, pw, ph, pad, pad);
    x.save();
    x.shadowColor = st === 'soft' ? 'rgba(0,0,0,.38)' : 'rgba(0,0,0,.45)'; x.shadowBlur = (st === 'soft' ? 10 : 5) * spr;
    x.shadowOffsetX = (st === 'soft' ? 0.8 : 1.2) * spr; x.shadowOffsetY = (st === 'soft' ? 2.8 : 2.4) * spr;
    x.fillStyle = '#333'; x.fill(path); x.restore();
    x.save(); x.clip(path);
    x.drawImage(G.img, pad - p.c * pw, pad - p.r * ph, L.bw, L.bh);
    if (st === 'glossy') {
      const gl = x.createLinearGradient(pad, pad, pad + pw, pad + ph);
      gl.addColorStop(0, 'rgba(255,255,255,.42)'); gl.addColorStop(0.45, 'rgba(255,255,255,.06)'); gl.addColorStop(0.55, 'rgba(0,0,0,0)'); gl.addColorStop(1, 'rgba(0,0,0,.22)');
      x.fillStyle = gl; x.fillRect(0, 0, pw + 2 * pad, ph + 2 * pad);
    } else if (st === 'wooden') { x.fillStyle = 'rgba(170,110,50,.1)'; x.fillRect(0, 0, pw + 2 * pad, ph + 2 * pad); }
    if (st === 'classic' || st === 'glossy') {
      x.lineWidth = 2.2; x.translate(1, 1); x.strokeStyle = 'rgba(255,255,255,.42)'; x.stroke(path);
      x.translate(-2, -2); x.strokeStyle = 'rgba(0,0,0,.32)'; x.stroke(path); x.translate(1, 1);
    } else if (st === 'soft') { x.lineWidth = 3; x.strokeStyle = 'rgba(255,255,255,.28)'; x.stroke(path); }
    else if (st === 'wooden') { x.lineWidth = 5; x.strokeStyle = 'rgba(214,160,96,.55)'; x.stroke(path); }
    x.restore();
    if (st === 'wooden') { x.lineWidth = 2.6; x.strokeStyle = 'rgba(96,56,22,.9)'; }
    else if (st === 'stained') { x.lineWidth = 3.4; x.strokeStyle = 'rgba(16,14,24,.95)'; }
    else if (st === 'soft') { x.lineWidth = 0.6; x.strokeStyle = 'rgba(0,0,0,.18)'; }
    else { x.lineWidth = 0.8; x.strokeStyle = 'rgba(0,0,0,.35)'; }
    x.stroke(path);
    p.sprite = c; return c;
  }

  function paintPlaced(p, lc) {
    lc = lc || L.layer.getContext('2d');
    const path = piecePath(G, p, L.pw, L.ph, p.c * L.pw, p.r * L.ph), ln = LINE[Jig.pieceStyle] || LINE.classic;
    lc.save(); lc.clip(path); lc.drawImage(G.img, 0, 0, L.bw, L.bh); lc.restore();
    lc.lineWidth = ln[1]; lc.strokeStyle = ln[0]; lc.stroke(path);
  }
  // Change the look while a puzzle is open.
  Jig.setPieceStyle = function (name) {
    Jig.pieceStyle = name;
    if (!G || !L) return;
    G.pieces.forEach(p => { p.sprite = null; }); buildLayer(); dirty = true;
  };
  Jig.preview = function (kind) { if (kind === 'sound') { ac(); tock(true); setTimeout(() => tock(false), 260); } };

  function visTray() { return Jig.edgesOnly ? G.tray.filter(id => G.pieces[id].edge) : G.tray; }
  function trayGeom() { const y0 = L.trayTop + (L.trayH - L.trows * L.slot) / 2; return { x0: 12, y0 }; }
  function clampScroll() { if (!G || !L) return; const n = visTray().length, cols = Math.ceil(n / L.trows); const max = Math.max(0, cols * L.slot - (L.w - 24)); scroll = Math.max(0, Math.min(max, scroll)); }
  function slotCenter(i) { const { x0, y0 } = trayGeom(); const col = Math.floor(i / L.trows), row = i % L.trows; return [x0 + col * L.slot + L.slot / 2 - scroll, y0 + row * L.slot + L.slot / 2]; }
  function slotAt(x, y) { const { x0, y0 } = trayGeom(); const col = Math.floor((x - x0 + scroll) / L.slot), row = Math.floor((y - y0) / L.slot); if (col < 0 || row < 0 || row >= L.trows) return -1; return col * L.trows + row; }

  // ---------- view (zoom + pan of the table; the tray never zooms) ----------
  function maxZoom() { return Math.max(3, Math.min(8, 90 / Math.min(L.pw, L.ph))); }
  function s2w(sx, sy) { return [(sx - view.x) / view.s, (sy - view.y) / view.s]; }
  function clampView() {
    view.s = Math.max(1, Math.min(maxZoom(), view.s));
    view.x = Math.min(0, Math.max(L.w - L.w * view.s, view.x));
    view.y = Math.min(0, Math.max(L.trayTop - L.trayTop * view.s, view.y));
  }
  function zoomAt(f, sx, sy) {
    const [wx, wy] = s2w(sx, sy), ns = Math.max(1, Math.min(maxZoom(), view.s * f));
    view.x = sx - wx * ns; view.y = sy - wy * ns; view.s = ns; clampView(); dirty = true; scheduleQuality();
  }
  // Sprites and the placed-pieces layer are redrawn sharper once the zoom settles.
  function scheduleQuality() {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      if (!G || !L) return;
      const base = Math.min(L.dpr, 2), want = Math.max(base, Math.min(3, Math.round(base * view.s * 2) / 2));
      if (Math.abs(want - L.spr) < 0.25) return;
      L.spr = want; G.pieces.forEach(p => { p.sprite = null; }); buildLayer(); dirty = true;
    }, 250);
  }
  Jig.zoomBy = function (f) { if (G) zoomAt(f, L.w / 2, L.trayTop / 2); };
  Jig.zoomFit = function () { if (G) { view = { s: 1, x: 0, y: 0 }; dirty = true; scheduleQuality(); } };
  Jig.zoomLevel = function () { return view.s; };

  // ---------- drawing ----------
  function visTray() { return Jig.edgesOnly ? G.tray.filter(id => G.pieces[id].edge) : G.tray; }
  function trayGeom() { const y0 = L.trayTop + (L.trayH - L.trows * L.slot) / 2; return { x0: 12, y0 }; }
  function clampScroll() { if (!G || !L) return; const n = visTray().length, cols = Math.ceil(n / L.trows); const max = Math.max(0, cols * L.slot - (L.w - 24)); scroll = Math.max(0, Math.min(max, scroll)); }
  function slotCenter(i) { const { x0, y0 } = trayGeom(); const col = Math.floor(i / L.trows), row = i % L.trows; return [x0 + col * L.slot + L.slot / 2 - scroll, y0 + row * L.slot + L.slot / 2]; }
  function slotAt(x, y) { const { x0, y0 } = trayGeom(); const col = Math.floor((x - x0 + scroll) / L.slot), row = Math.floor((y - y0) / L.slot); if (col < 0 || row < 0 || row >= L.trows) return -1; return col * L.trows + row; }

  function draw() { requestAnimationFrame(draw); drawFrame(); }
  // test hook: average milliseconds to draw one full frame
  if (!window.STORE_LIVE) Jig._timeDraw = function (n) { const t = performance.now(); for (let i = 0; i < n; i++) { dirty = true; drawFrame(); } return (performance.now() - t) / n; };
  function drawFrame() {
    if (!G || !dirty) return; dirty = false;
    const { w, h, dpr } = L;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const dg = drag && drag.mode === 'drag' ? drag.group : null;
    // table (clipped above the tray, zoomed)
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, L.trayTop); ctx.clip();
    ctx.translate(view.x, view.y); ctx.scale(view.s, view.s);
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.22)'; rr(ctx, L.bx - 5, L.by - 5, L.bw + 10, L.bh + 10, 10); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(L.bx, L.by, L.bw, L.bh); ctx.restore();
    if (Jig.ghost) { ctx.globalAlpha = 0.2; ctx.drawImage(G.img, L.bx, L.by, L.bw, L.bh); ctx.globalAlpha = 1; }
    ctx.drawImage(L.layer, L.bx, L.by, L.bw, L.bh);
    G.loose.forEach(id => { const p = G.pieces[id]; if (p.group !== dg) drawPiece(p); });
    if (Jig.peek) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 18; ctx.drawImage(G.img, L.bx, L.by, L.bw, L.bh); ctx.restore(); }
    ctx.restore();
    // tray
    ctx.save();
    const g = ctx.createLinearGradient(0, L.trayTop, 0, h); g.addColorStop(0, 'rgba(20,12,24,.42)'); g.addColorStop(1, 'rgba(20,12,24,.55)');
    ctx.fillStyle = g; ctx.fillRect(0, L.trayTop, w, L.trayH);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, L.trayTop, w, 1);
    ctx.beginPath(); ctx.rect(0, L.trayTop + 1, w, L.trayH); ctx.clip();
    const vis = visTray();
    vis.forEach((id, i) => {
      const [cx, cy] = slotCenter(i); if (cx < -L.slot || cx > w + L.slot) return;
      const p = G.pieces[id], k = L.slot * 0.68 / Math.max(L.pw, L.ph), sp = sprite(p);
      ctx.drawImage(sp, cx - (L.pw / 2 + L.pad) * k, cy - (L.ph / 2 + L.pad) * k, (L.pw + 2 * L.pad) * k, (L.ph + 2 * L.pad) * k);
    });
    if (!vis.length) {
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '700 15px ui-rounded, "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(Jig.edgesOnly && G.tray.length ? 'All edge pieces are out' : (G.tray.length ? '' : 'All pieces are out of the tray'), w / 2, L.trayTop + L.trayH / 2 + 5);
    }
    const cols = Math.ceil(vis.length / L.trows), max = Math.max(0, cols * L.slot - (w - 24));
    if (scroll > 2) fade(0, 1); if (scroll < max - 2) fade(w, -1);
    ctx.restore();
    // the piece(s) being carried are drawn last, on top of everything, even over the tray
    if (dg !== null) { ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.s, view.s); G.loose.forEach(id => { const p = G.pieces[id]; if (p.group === dg) drawPiece(p); }); ctx.restore(); }
    function fade(x, dir) { const f = ctx.createLinearGradient(x, 0, x + dir * 26, 0); f.addColorStop(0, 'rgba(20,12,24,.6)'); f.addColorStop(1, 'rgba(20,12,24,0)'); ctx.fillStyle = f; ctx.fillRect(Math.min(x, x + dir * 26), L.trayTop + 1, 26, L.trayH); }
  }
  function drawPiece(p) { const sp = sprite(p); ctx.drawImage(sp, p.x - L.pad, p.y - L.pad, L.pw + 2 * L.pad, L.ph + 2 * L.pad); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ---------- input ----------
  const probe = document.createElement('canvas').getContext('2d');
  function pieceAt(x, y) {   // x, y in table (world) coordinates
    for (let i = G.loose.length - 1; i >= 0; i--) {
      const p = G.pieces[G.loose[i]];
      if (x < p.x - L.pad || x > p.x + L.pw + L.pad || y < p.y - L.pad || y > p.y + L.ph + L.pad) continue;
      if (probe.isPointInPath(hitPath(p), x - p.x, y - p.y)) return p;
    }
    return null;
  }
  function members(g) { return G.loose.filter(id => G.pieces[id].group === g).map(id => G.pieces[id]); }
  function toTop(g) { const a = G.loose.filter(id => G.pieces[id].group !== g), b = G.loose.filter(id => G.pieces[id].group === g); G.loose = a.concat(b); }
  function pos(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function pinchPts() { const v = [...ptrs.values()]; return v.length >= 2 ? [v[0], v[1]] : null; }

  function wire() {
    cv._wired = true; cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => {
      if (!G) return; ac();
      const [x, y] = pos(e); ptrs.set(e.pointerId, { x, y });
      if (drag && drag.mode === 'pan' && ptrs.size === 2) {   // second finger on an empty table: pinch
        const [a, b] = pinchPts(), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        drag = { mode: 'pinch', d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), s0: view.s, w0: s2w(mx, my), pid: drag.pid };
        return;
      }
      if (drag) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { }
      if (y >= L.trayTop) {
        const i = slotAt(x, y), vis = visTray();
        if (i >= 0 && i < vis.length) drag = { mode: 'trayPending', id: vis[i], sx: x, sy: y, s0: scroll, pid: e.pointerId, touch: e.pointerType === 'touch', moved: false };
        else drag = { mode: 'scroll', sx: x, s0: scroll, pid: e.pointerId };
        return;
      }
      const [wx, wy] = s2w(x, y), p = pieceAt(wx, wy);
      if (p) { toTop(p.group); drag = { mode: 'drag', group: p.group, lx: x, ly: y, pid: e.pointerId }; dirty = true; buzz(5); }
      else drag = { mode: 'pan', lx: x, ly: y, pid: e.pointerId };
    });
    cv.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e); if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x, y });
      if (!drag) return;
      if (drag.mode === 'pinch') {
        const pp = pinchPts(); if (!pp) return;
        const [a, b] = pp, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y);
        view.s = Math.max(1, Math.min(maxZoom(), drag.s0 * d / drag.d0));
        view.x = mx - drag.w0[0] * view.s; view.y = my - drag.w0[1] * view.s; clampView(); dirty = true; return;
      }
      if (e.pointerId !== drag.pid) return;
      if (drag.mode === 'trayPending') {
        const dx = x - drag.sx, dy = y - drag.sy;
        if (Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx) * 0.8) {
          const p = G.pieces[drag.id];
          G.tray.splice(G.tray.indexOf(p.id), 1); G.loose.push(p.id); p.group = p.id;
          const lift = drag.touch ? Math.max(28, L.ph * view.s * 0.55) : 0, [wx, wy] = s2w(x, y - lift);
          p.x = wx - L.pw / 2; p.y = wy - L.ph / 2;
          drag = { mode: 'drag', group: p.group, lx: x, ly: y, pid: drag.pid }; clampScroll(); buzz(5);
        } else if (Math.abs(dx) > 9) drag = { mode: 'scroll', sx: drag.sx, s0: drag.s0, pid: drag.pid };
        dirty = true; return;
      }
      if (drag.mode === 'scroll') { scroll = drag.s0 - (x - drag.sx); clampScroll(); dirty = true; return; }
      if (drag.mode === 'pan') { view.x += x - drag.lx; view.y += y - drag.ly; drag.lx = x; drag.ly = y; clampView(); dirty = true; return; }
      if (drag.mode === 'drag') {
        const dx = (x - drag.lx) / view.s, dy = (y - drag.ly) / view.s; drag.lx = x; drag.ly = y;
        members(drag.group).forEach(p => { p.x += dx; p.y += dy; });
        dirty = true;
      }
    });
    const end = (e) => {
      ptrs.delete(e.pointerId);
      if (!drag) return;
      if (drag.mode === 'pinch') { drag = null; scheduleQuality(); dirty = true; return; }
      if (e.pointerId !== drag.pid) return;
      const d = drag; drag = null;
      if (d.mode === 'pan' && view.s > 1) scheduleQuality();
      if (d.mode === 'trayPending') { tapTrayPiece(d.id); }
      if (d.mode === 'drag') drop(d.group, d.lx, d.ly);
      dirty = true; changed();
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      if (!G) return; const [x, y] = pos(e); e.preventDefault();
      if (y >= L.trayTop) { scroll += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY); clampScroll(); dirty = true; }
      else zoomAt(Math.exp(-e.deltaY * 0.0018), x, y);
    }, { passive: false });
    requestAnimationFrame(draw);
  }

  // A tap on a tray piece lifts it onto an empty spot of the table just above the tray (inside what you can see).
  function tapTrayPiece(id) {
    const p = G.pieces[id]; G.tray.splice(G.tray.indexOf(id), 1); G.loose.push(id); p.group = id;
    const n = G.loose.length % 6, s = view.s;
    const [wx, wy] = s2w(L.w / 2 - L.pw * s / 2 + (n - 2.5) * L.pw * s * 0.6, L.trayTop - L.ph * s - 14 - (n % 2) * 8);
    p.x = Math.max(6, Math.min(L.w - L.pw - 6, wx)); p.y = Math.max(6, wy);
    clampScroll(); tock(false); save();
  }

  // The round + / - / Fit buttons sit over the top-right corner of the table (see .zoom in index.html). A loose piece must never come to rest
  // under them (the buttons would take the touch and the piece could not be picked up), so groups are nudged left, out of that strip.
  function nudgeFromButtons(ms) {
    if (!ms.length || !L) return;
    const x0 = L.w - 62, y1 = 176; let over = 0;
    ms.forEach(p => {
      const sx1 = (p.x + L.pw) * view.s + view.x, sy0 = p.y * view.s + view.y, sy1 = (p.y + L.ph) * view.s + view.y;
      if (sx1 > x0 && sy0 < y1 && sy1 > 0) over = Math.max(over, sx1 - x0);
    });
    if (over > 0) { const d = over / view.s; ms.forEach(p => { p.x -= d; }); }
  }
  function nudgeAll() { [...new Set(G.loose.map(id => G.pieces[id].group))].forEach(g => nudgeFromButtons(members(g))); }
  function settle(g) { nudgeFromButtons(members(g)); save(); }

  function drop(g, px, py) {
    let ms = members(g);
    // back into the tray (single pieces only)
    if (ms.length === 1 && py >= L.trayTop) {
      const p = ms[0], vis = visTray(); let i = slotAt(px, Math.max(py, trayGeom().y0 + 1));
      G.loose.splice(G.loose.indexOf(p.id), 1);
      const at = i >= 0 && i < vis.length ? G.tray.indexOf(vis[i]) : G.tray.length;
      G.tray.splice(at < 0 ? G.tray.length : at, 0, p.id); clampScroll(); save(); return;
    }
    // keep the group inside the part of the table you can see
    const vx0 = -view.x / view.s, vx1 = (L.w - view.x) / view.s, vy0 = -view.y / view.s, vy1 = (L.trayTop - view.y) / view.s;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    ms.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + L.pw); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + L.ph); });
    let sx = 0, sy = 0;
    if (maxX - minX < vx1 - vx0) { if (minX < vx0) sx = vx0 - minX; if (maxX > vx1) sx = vx1 - maxX; }
    if (maxY > vy1 - 2) sy = vy1 - 2 - maxY; if (minY + sy < vy0) sy = vy0 - minY;
    if (sx || sy) ms.forEach(p => { p.x += sx; p.y += sy; });
    // snap to its place on the board?
    if (ms.some(p => Math.hypot(p.x - (L.bx + p.c * L.pw), p.y - (L.by + p.r * L.ph)) < L.snap)) { place(ms); return; }
    // snap to a loose neighbour?
    for (const p of ms) {
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const r = p.r + dr, c = p.c + dc; if (r < 0 || c < 0 || r >= G.rows || c >= G.cols) continue;
        const q = G.pieces[r * G.cols + c]; if (q.placed || q.group === g || G.loose.indexOf(q.id) < 0) continue;
        const ex = q.x - dc * L.pw, ey = q.y - dr * L.ph;
        if (Math.hypot(p.x - ex, p.y - ey) < L.snap) {
          const ox = ex - p.x, oy = ey - p.y;
          ms.forEach(m => { m.x += ox; m.y += oy; m.group = q.group; });
          toTop(q.group); tock(false); buzz(10); settle(q.group); return;
        }
      }
    }
    settle(g);
  }

  function place(ms) {
    const lc = L.layer.getContext('2d');
    ms.forEach(p => { p.placed = true; p.x = L.bx + p.c * L.pw; p.y = L.by + p.r * L.ph; G.loose.splice(G.loose.indexOf(p.id), 1); paintPlaced(p, lc); });
    tock(true); buzz(14);
    if (G.pieces.every(p => p.placed)) { G.done = true; save(); setTimeout(() => { chime(); if (Jig.onWin) Jig.onWin(); }, 250); }
    else save();
  }

  function changed() { if (Jig.onChange) Jig.onChange(Jig.progress()); }

  window.Jig = Jig;
})();
