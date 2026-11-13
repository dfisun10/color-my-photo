// API base: localhost for local testing, the deployed Worker otherwise (replace REPLACE before launch)
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
// On localhost only: ?api=https://<worker>.workers.dev points the page at the deployed Worker (kept for this tab, so it survives the checkout redirect).
if (LOCAL && /^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(new URLSearchParams(location.search).get('api') || '')) sessionStorage.setItem('cmp_api', new URLSearchParams(location.search).get('api'));
const API = LOCAL ? (sessionStorage.getItem('cmp_api') || 'http://localhost:8788') : 'https://color-my-photo-shop.driftnflick.workers.dev';
(function () {
'use strict';
const MAX = 20, LONG = 1536;
const NET_MSG = "Can't reach our server. Check your connection and try again.";
const STUB = {};   // elements only make.html has (order.html lacks them): detached stand-ins keep the shared code safe
const $ = id => document.getElementById(id) || (id === 'pay-hint' || id === 'back-note' ? (STUB[id] = STUB[id] || document.createElement('p')) : null);
const qs = new URLSearchParams(location.search);
const REF = qs.get('ref');
const ORDER = document.body.dataset.mode === 'order'; // /order page: Etsy order code instead of payment

let photos = [];            // [{blob, url}] position = index
const pages = {};           // i -> {st:'wait'|'making'|'done'|'failed', url, blob, w, h, err}
let paid = false, queue = [], running = 0, busyPrev = false, busyPay = false;

// ---------- helpers ----------
async function api(path, opts, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms || 180000);
  try {
    const r = await fetch(API + path, Object.assign({ signal: ac.signal }, opts || {}));
    let j = null;
    try { j = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? 'This took too long. Please try again.' : NET_MSG);
    err.net = true; throw err;
  } finally { clearTimeout(t); }
}
function errText(r) { return (r.json && r.json.error) || ('Something went wrong (error ' + r.status + '). Please try again.'); }
function b64ToBlob(b64) {
  const bin = atob(b64), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: 'image/png' });
}
function imgSize(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
}
function setBusy(btn, on) { btn.disabled = on; btn.classList.toggle('busy', on); if (btn.id === 'btn-pdf' && $('btn-pdf-top')) { $('btn-pdf-top').disabled = on; $('btn-pdf-top').classList.toggle('busy', on); } }

// ---------- IndexedDB ----------
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('cmp', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbSave() {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('photos', 'readwrite'), s = tx.objectStore('photos');
      s.clear(); photos.forEach((p, i) => { if (!p.stub) s.put(p.blob, i); });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (e) { $('add-msg').textContent = "Your browser can't keep photos for checkout (private mode?). Photos may need to be added again after payment."; }
}
async function dbLoad() {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const out = [], tx = d.transaction('photos', 'readonly'), s = tx.objectStore('photos');
      const rq = s.openCursor();
      rq.onsuccess = () => { const c = rq.result; if (c) { out[c.key] = c.value; c.continue(); } };
      tx.oncomplete = () => res(Array.from(out, v => v || null)); tx.onerror = () => rej(tx.error);
    });
  } catch (e) { return []; }
}
async function dbClear() { try { const d = await db(); d.transaction('photos', 'readwrite').objectStore('photos').clear(); } catch (e) {} }

// ---------- photo intake ----------
async function decode(file) {
  let bmp = null;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {}
  if (!bmp) {
    const u = URL.createObjectURL(file);
    try { bmp = await imgSize(u); } catch (e) { throw new Error('decode'); } finally { setTimeout(() => URL.revokeObjectURL(u), 5000); }
  }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  if (!w || !h) throw new Error('decode');
  if (Math.min(w, h) < 300) throw new Error('small');
  const k = Math.min(1, LONG / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('decode')), 'image/jpeg', 0.85));
}
async function addFiles(list) {
  const msg = $('add-msg'); msg.textContent = '';
  const files = Array.from(list).filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (!files.length) { msg.textContent = 'Please choose image files.'; return; }
  let slots = [];   // paid: slots whose page was never made, filled first (lowest index first)
  if (paid) {       // keep made pages in their slots
    const used = Object.keys(pages).map(Number).filter(i => pages[i].st === 'done' || pages[i].missing);
    const top = used.length ? Math.max(...used) + 1 : 0;
    while (photos.length < top) photos.push({ stub: true });
    slots = used.filter(i => pages[i].missing && (!photos[i] || photos[i].stub)).sort((a, b) => a - b);
  }
  const room = MAX - photos.length + slots.length, notes = [];
  if (files.length > room) notes.push('You can add up to 20 photos. ' + (files.length - room) + ' extra photo(s) were not added.');
  $('pick').disabled = true;
  for (const f of files.slice(0, room)) {
    try {
      const b = await decode(f), ph = { blob: b, url: URL.createObjectURL(b) };
      if (slots.length) { const i = slots.shift(); photos[i] = ph; delete pages[i]; } else photos.push(ph);
    }
    catch (e) { notes.push(e.message === 'small'
      ? 'This photo is too small to make a good page (' + f.name + '). Please use one at least 300 pixels on each side.'
      : "This photo type can't be read here. Please use JPG or PNG (" + f.name + ")"); }
  }
  $('pick').disabled = false;
  msg.textContent = notes.join(' ');
  renderThumbs(); await dbSave(); refresh();
  if (paid) startMaking();
}
function renderThumbs() {
  const ul = $('thumbs'); ul.textContent = '';
  photos.forEach((p, i) => {
    if (p.stub) return;
    const li = document.createElement('li'); li.className = 'thumb';
    const im = document.createElement('img'); im.src = p.url; im.alt = 'Photo ' + (i + 1);
    const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1;
    li.append(im, n);
    if (!paid) {
      const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '×';
      x.setAttribute('aria-label', 'Remove photo ' + (i + 1));
      x.onclick = async () => { URL.revokeObjectURL(p.url); photos.splice(i, 1); renderThumbs(); await dbSave(); refresh(); };
      li.append(x);
    }
    ul.append(li);
  });
  $('count').textContent = photos.length + ' of ' + MAX;
}
function refresh() {
  $('btn-preview').disabled = busyPrev || !photos.length;
  $('btn-pay').disabled = busyPay || !photos.length || !$('agree').checked;
  $('pay-hint').textContent = busyPay ? '' : !photos.length ? 'To pay: add a photo above, then tick the box.' : !$('agree').checked ? 'To pay: tick the box above.' : '';
  $('pick').disabled = photos.length >= MAX;
}

// ---------- preview ----------
async function doPreview() {
  if (busyPrev || !photos.length) return;
  busyPrev = true; refresh(); setBusy($('btn-preview'), true);
  const st = $('pv-status'); st.innerHTML = '<span class="spin"></span>Drawing your page… about 30 to 60 seconds';
  $('pv-canvas').hidden = true; $('pv-note').hidden = true;
  try {
    const r = await api('/preview', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: photos[0].blob });
    if (!r.ok) { st.textContent = errText(r); st.className = 'err'; }
    else {
      const im = await imgSize(URL.createObjectURL(b64ToBlob(r.json.data[0].b64_json)));
      const c = $('pv-canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      const fs = Math.max(24, Math.round(c.width / 9));
      x.save(); x.translate(c.width / 2, c.height / 2); x.rotate(-Math.PI / 6);
      x.font = '700 ' + fs + 'px "Instrument Sans",system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = 'rgba(232,100,60,.35)'; x.strokeStyle = 'rgba(255,255,255,.6)'; x.lineWidth = Math.max(2, fs / 14);
      const d = Math.hypot(c.width, c.height), step = fs * 2.2;
      for (let y = -d; y <= d; y += step) for (let xx = -d; xx <= d; xx += fs * 6) {
        const off = (Math.round(y / step) % 2) * fs * 3;
        x.strokeText('PREVIEW', xx + off, y); x.fillText('PREVIEW', xx + off, y);
      }
      x.restore();
      c.hidden = false; $('pv-note').hidden = false; st.textContent = ''; st.className = '';
    }
  } catch (e) { st.textContent = e.message; st.className = 'err'; }
  busyPrev = false; setBusy($('btn-preview'), false); refresh();
}

// ---------- checkout ----------
async function doPay() {
  if (busyPay || !photos.length || !$('agree').checked) return;
  busyPay = true; refresh(); setBusy($('btn-pay'), true); $('pay-msg').textContent = 'Opening secure checkout…';
  try {
    const src = (window.cmpSource && window.cmpSource()) || 'direct';
    const r = await api('/checkout?r=' + encodeURIComponent(src) + (qs.get('testkey') ? '&testkey=' + encodeURIComponent(qs.get('testkey')) : ''), { method: 'POST' }, 30000);
    if (r.ok && r.json && r.json.url) { location.href = r.json.url; return; }
    $('pay-msg').textContent = errText(r);
  } catch (e) { $('pay-msg').textContent = e.message; }
  busyPay = false; setBusy($('btn-pay'), false); refresh();
}

// ---------- paid flow ----------
async function confirmPayment() {
  $('sec-confirm').hidden = false;
  const msg = $('confirm-msg'); msg.textContent = ORDER ? 'Opening your order…' : 'Confirming your payment…';
  const end = Date.now() + 120000;
  while (true) {
    try {
      const r = await api('/status?ref=' + encodeURIComponent(REF), {}, 20000);
      if (r.ok && r.json && r.json.paid) return r.json;
      if (r.ok && r.json && r.json.state === 'refunded') {
        msg.textContent = 'This order was refunded, so this download link no longer works. Questions: hello@getcolormyphoto.com.'; return null; }
      if (r.ok && r.json && r.json.state === 'unknown') {
        msg.textContent = 'This link has expired or is not valid. Download links work for 30 days after purchase. If you need help, write to hello@getcolormyphoto.com with your receipt.'; return null; }
    } catch (e) { msg.textContent = NET_MSG; }
    if (Date.now() > end) break;
    await new Promise(r => setTimeout(r, 3000));
    if (msg.textContent === NET_MSG) msg.textContent = ORDER ? 'Opening your order…' : 'Confirming your payment…';
  }
  msg.textContent = 'We could not confirm the payment yet. If you were charged, write to hello@getcolormyphoto.com with your receipt.';
  return null;
}
async function fetchDone(i) {
  try {
    const r = await api('/img?ref=' + encodeURIComponent(REF) + '&i=' + i, {}, 60000);
    if (r.ok) { await setPage(i, b64ToBlob(r.json.data[0].b64_json)); return; }
  } catch (e) {}
  pages[i] = { st: 'failed', err: 'Could not load this page.', redo: false }; renderGrid();
}
async function setPage(i, blob) {
  const url = URL.createObjectURL(blob), im = await imgSize(url);
  pages[i] = { st: 'done', url, blob, w: im.naturalWidth, h: im.naturalHeight };
  renderGrid();
}
function startMaking() {
  photos.forEach((p, i) => { if (!p.stub && !pages[i]) { pages[i] = { st: 'wait' }; queue.push({ i, redo: false }); } });
  renderGrid(); pump();
}
function retry(i, redo) {
  if (!photos[i] || photos[i].stub) { $('make-msg').textContent = (pages[i] && pages[i].missing ? 'Add the photo for page ' + (i + 1) + ' again' : 'Add your photos again to remake or retry this page.'); $('sec-add').hidden = false; $('again-note').hidden = false; return; }
  pages[i] = { st: 'wait', old: pages[i] && pages[i].st === 'done' ? pages[i] : null };
  queue.push({ i, redo }); renderGrid(); pump();
}
// Screen wake lock while pages are made (harmless where unsupported).
let wl = null;
async function wake(on) {
  try {
    if (on) { if (!wl && navigator.wakeLock) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener && wl.addEventListener('release', () => { wl = null; }); } }
    else if (wl) { const w = wl; wl = null; await w.release(); }
  } catch (e) { wl = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (running > 0 || queue.length)) wake(true); });
function pump() {
  while (running < (ORDER && !(pages[0] && pages[0].st === 'done') ? 1 : 2) && queue.length) {
    // order page: page 1 alone first
    const j = queue.shift(); running++; makeOne(j).finally(() => { running--; pump(); }); }
  wake(running > 0 || queue.length > 0);
}
async function makeOne(j) {
  const i = j.i, old = pages[i] && pages[i].old;
  pages[i] = { st: 'making', old }; renderGrid();
  try {
    const r = await api('/page?ref=' + encodeURIComponent(REF) + '&i=' + i + (j.redo ? '&redo=1' : ''),
      { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: photos[i].blob }, 180000);
    if (r.ok && r.json && r.json.data) { await setPage(i, b64ToBlob(r.json.data[0].b64_json)); }
    else { pages[i] = old ? Object.assign({}, old) : { st: 'failed', err: errText(r) };
           if (old) $('make-msg').textContent = 'Page ' + (i + 1) + ': ' + errText(r); }
  } catch (e) { pages[i] = old ? Object.assign({}, old) : { st: 'failed', err: e.message, redo: false }; if (old) $('make-msg').textContent = 'Page ' + (i + 1) + ': ' + e.message; }
  renderGrid();
}
let replaceAt = -1;
async function replacePhoto(f) {
  const i = replaceAt; replaceAt = -1;
  const msg = $('make-msg');
  if (!f || i < 0 || !photos[i]) return;
  try {
    const b = await decode(f);
    URL.revokeObjectURL(photos[i].url);
    photos[i] = { blob: b, url: URL.createObjectURL(b) };
  } catch (e) {
    msg.textContent = e.message === 'small' ? 'That photo is too small (at least 300 pixels on each side). Page ' + (i + 1) + ' is unchanged.' : "That photo can't be read here. Please use JPG or PNG. Page " + (i + 1) + ' is unchanged.';
    return;
  }
  msg.textContent = 'Page ' + (i + 1) + ': trying your new photo. Every try counts toward the 40 tries for this order.';
  renderThumbs(); await dbSave(); retry(i, false);
}
function renderGrid() {
  const idx = Object.keys(pages).map(Number).sort((a, b) => a - b);
  const ul = $('pgrid'); ul.textContent = '';
  let done = 0;
  idx.forEach(i => {
    const p = pages[i], li = document.createElement('li'); li.className = 'pcell' + (p.st === 'failed' ? ' failed' : '');
    const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1; li.append(n);
    const shown = p.st === 'done' ? p : p.old;
    if (p.st === 'done') done++;
    if (shown && shown.url) { const im = document.createElement('img'); im.src = shown.url; im.alt = 'Coloring page ' + (i + 1); li.append(im); }
    if (p.st === 'wait' || p.st === 'making') {
      const s = document.createElement('span'); s.innerHTML = p.st === 'making' ? '<span class="spin"></span>Making…' : 'Waiting'; li.append(s);
    } else if (p.st === 'failed') {
      const s = document.createElement('span'); s.textContent = p.err || 'Failed'; s.className = 'err'; s.style.fontSize = '.8rem';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'link'; b.textContent = 'Try again';
      b.onclick = () => retry(i, !!p.redo); li.append(s, b);
      if (!p.missing && photos[i] && !photos[i].stub) {
        const r = document.createElement('button'); r.type = 'button'; r.className = 'rlink'; r.textContent = 'Replace photo';
        r.setAttribute('aria-label', 'Replace the photo for page ' + (i + 1));
        r.onclick = () => { replaceAt = i; $('file-replace').click(); }; li.append(r);
      }
    } else {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'link'; b.textContent = 'Remake';
      b.setAttribute('aria-label', 'Remake page ' + (i + 1));
      b.onclick = () => { if (confirm('Remake page ' + (i + 1) + '? Each order allows 40 page tries in total.')) retry(i, true); };
      li.append(b);
    }
    ul.append(li);
  });
  const total = idx.length;
  $('overall-text').textContent = done + ' of ' + total + ' pages ready';
  const nf = idx.filter(i => pages[i].st === 'failed').length, fh = $('fail-help');
  fh.hidden = !nf;
  if (nf) fh.textContent = (nf === 1 ? 'One page could not be made.' : nf + ' pages could not be made.') + ' Press Try again, or write to hello@getcolormyphoto.com within 14 days and we will remake or refund the page (we reply within 24 h). Your order link: ' + $('linkbox').value;
  $('make-note').textContent = total && done === total ? 'All pages are ready. Download your book below.' : 'Keep this screen open while your pages are made (about 1 minute per 2 pages).';
  $('overall-bar').style.width = (total ? done / total * 100 : 0) + '%';
  $('overall-bar').parentNode.classList.toggle('full', !!total && done === total);
  $('btn-pdf').textContent = done ? 'Download my coloring book (PDF, ' + done + (done === 1 ? ' page)' : ' pages)') : 'Download my coloring book (PDF)';
  $('btn-pdf').disabled = !done;
  const bt = $('btn-pdf-top'); if (bt) { bt.hidden = !done; bt.textContent = $('btn-pdf').textContent; bt.disabled = !done || $('btn-pdf').classList.contains('busy'); }
  const pl = $('pnglist'); pl.textContent = '';
  idx.forEach(i => { if (pages[i].st === 'done') { const a = document.createElement('a'); a.href = pages[i].url; a.download = 'color-my-photo-page-' + (i + 1) + '.png'; a.textContent = 'Page ' + (i + 1) + ' (PNG)'; pl.append(a); } });
}


// ---------- gift: child's name + "from" on the cover (kept in this browser; carried in the link after #) ----------
const cleanName = (s, n) => String(s || '').normalize('NFC').replace(/[^\p{Script=Latin}\p{M} '’.&-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, n);
function getGift() { try { const g = JSON.parse(localStorage.getItem('cmp_gift') || '{}'); return { name: cleanName(g.name, 18), from: cleanName(g.from, 24) }; } catch (e) { return { name: '', from: '' }; } }
function setGift(g) { try { localStorage.setItem('cmp_gift', JSON.stringify(g)); } catch (e) {} }
function giftTitle(g) { return (g.name ? g.name + '’s Coloring' : 'My Coloring') + ' Book'; }
function giftLine(g) { return g.name && g.from ? 'For ' + g.name + ', love ' + g.from : g.name ? 'For ' + g.name : g.from ? 'With love from ' + g.from : ''; }
function giftHash(g) { return g.name || g.from ? '#gift=' + encodeURIComponent(JSON.stringify(g)) : ''; }
function showGift() {
  const g = getGift(), l = giftLine(g);
  $('gift-out').textContent = 'The cover will say: “' + giftTitle(g) + '”' + (l ? ' and “' + l + '”' : '');
  if (typeof REF !== 'undefined' && REF) $('linkbox').value = location.origin + location.pathname + '?ref=' + encodeURIComponent(REF) + giftHash(g);
  const m = 'mailto:?subject=' + encodeURIComponent('My Color My Photo link') + '&body=' + encodeURIComponent('Your coloring book link (works for 30 days):\n' + $('linkbox').value);
  $('btn-mail-top').href = m; $('btn-mail').href = m;
}

// ---------- PDF book design ----------
// Embedded open-licence fonts (OFL, in fonts/). If they fail to load, the book falls back to built-in fonts.
const FONTS = [['YoungSerif-Regular.ttf', 'YS', 'normal'], ['InstrumentSans-Regular.ttf', 'IS', 'normal'], ['InstrumentSans-Bold.ttf', 'IS', 'bold'], ['DMMono-Regular.ttf', 'DM', 'normal']];
let fontData = null;
async function loadFonts() {
  if (fontData) return fontData;
  try {
    fontData = await Promise.all(FONTS.map(async ([f]) => {
      const r = await fetch('fonts/' + f); if (!r.ok) throw new Error('font');
      const u = new Uint8Array(await r.arrayBuffer()); let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(s);
    }));
  } catch (e) { fontData = false; }
  return fontData;
}
// Line art on true white: some drawings come back on a faint grey ground, which prints as a tile. Lift it, keep the lines.
async function inkOnWhite(p) {
  try {
    const im = await imgSize(p.url), c = document.createElement('canvas'); c.width = p.w; c.height = p.h;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), a = d.data, lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = v < 64 ? v : v * 255 / 242; // clamps at 255
    for (let i = 0; i < a.length; i += 4) { a[i] = lut[a[i]]; a[i + 1] = lut[a[i + 1]]; a[i + 2] = lut[a[i + 2]]; a[i + 3] = 255; }
    x.putImageData(d, 0, 0);
    return c.toDataURL('image/png');
  } catch (e) {
    return new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(p.blob); });
  }
}
// The book is set on one grid: a 504pt column (54..558), mono labels, serif titles, hairline rules.
// Vector drawing only; the cover shows the same image data as the pages, so the file holds each drawing once.
async function drawBook(pdf, idx, imgs) {
  const fd = await loadFonts();
  if (fd) FONTS.forEach(([f, fam, st], k) => { pdf.addFileToVFS(f, fd[k]); pdf.addFont(f, fam, st); });
  const F = fd ? { serif: ['YS', 'normal'], sans: ['IS', 'normal'], bold: ['IS', 'bold'], mono: ['DM', 'normal'] }
               : { serif: ['times', 'normal'], sans: ['helvetica', 'normal'], bold: ['helvetica', 'bold'], mono: ['courier', 'normal'] };
  const font = (k, size) => { pdf.setFont(F[k][0], F[k][1]); pdf.setFontSize(size); };
  const INK = [24, 23, 28], MUTE = [108, 104, 115], SOFT = [80, 77, 86], RULE = [205, 200, 191], ACC = [232, 100, 60];
  const CRAY = [[229, 72, 77], [245, 165, 36], [245, 213, 71], [63, 163, 77], [47, 111, 222], [248, 148, 192]];
  const col = (c) => { pdf.setTextColor(c[0], c[1], c[2]); };
  const stroke = (c, w) => { pdf.setDrawColor(c[0], c[1], c[2]); pdf.setLineWidth(w); };
  const label = (t, x, y, o) => { font('mono', 7.5); col(SOFT); pdf.text(t.toUpperCase(), x, y, Object.assign({ charSpace: 1.2 }, o || {})); };
  const n = idx.length, two = (k) => String(k).padStart(2, '0');
  const fit = (p, bw, bh) => { const k = Math.min(bw / p.w, bh / p.h); return [p.w * k, p.h * k]; };
  const G = getGift(), T1 = G.name ? G.name + '\u2019s Coloring' : 'My Coloring', GL = giftLine(G);
  pdf.setProperties({ title: giftTitle(G), subject: n + ' coloring pages made from your photos', creator: 'Color My Photo' });

  // ---- cover ----
  const L = 54, R = 558, W = R - L;
  // the crayon box, as the top edge of the column (same strip as the price card on the site)
  CRAY.forEach((c, k) => { pdf.setFillColor(c[0], c[1], c[2]); pdf.rect(L + k * W / 6, 40, W / 6, 6, 'F'); });
  label('Color My Photo', L, 66); label('A coloring book  /  ' + two(n) + (n === 1 ? ' page' : ' pages'), R, 66, { align: 'right' });
  stroke(INK, 0.6); pdf.line(L, 76, R, 76);
  // title, as large as the column allows
  font('serif', 82); const ts = Math.min(82, 82 * (W * 0.9) / pdf.getTextWidth(T1));
  font('serif', ts); col(INK);
  const y1 = 76 + ts * 0.95, y2 = y1 + ts * 1.0;
  pdf.text(T1, L - 3, y1); pdf.text('Book', L - 3, y2);
  const bw = pdf.getTextWidth('Book');
  stroke(ACC, 5); pdf.setLineCap('round');
  pdf.lines([[bw * 0.25, -8, bw * 0.6, -10, bw + 4, -3]], L, y2 + 19);
  pdf.setLineCap('butt');
  font('sans', 11.5); col(MUTE);
  pdf.text(n === 1 ? 'One page drawn from' : n + ' pages drawn from', R, y2 - 15, { align: 'right' });
  pdf.text('your own photos', R, y2, { align: 'right' });
  // plate: the first page, hung from the right edge of the column
  const Y0 = Math.max(266, y2 + 38), GUT = 24;
  const p0 = pages[idx[0]], [w0, h0] = fit(p0, 350, 716 - Y0), CW = W - w0 - GUT, Y1 = h0 >= 300 ? Y0 + h0 : 716;
  pdf.addImage(imgs[idx[0]], 'PNG', R - w0, Y0, w0, h0, undefined, 'FAST'); // same data = same image object as its page
  stroke(INK, 1); pdf.rect(R - w0, Y0, w0, h0);
  // left column, bottom: a place to write
  const FY = [Y1 - 76, Y1 - 38, Y1];
  ['This book belongs to', 'Started on', 'Favorite page'].forEach((t, k) => { label(t, L, FY[k] - 21); stroke(INK, 0.5); pdf.line(L, FY[k], L + CW, FY[k]); });
  if (GL) { // the dedication is written on the first line, in the title face, as large as the column allows
    font('serif', 16); const ds = Math.min(16, 16 * CW / pdf.getTextWidth(GL)); font('serif', ds); col(INK); pdf.text(GL, L, FY[0] - 5);
  }
  // left column, top: every other page as a small index, in the largest tiles that fit
  const rest = idx.slice(1), m = rest.length;
  if (m) {
    label('Also inside', L, Y0 + 7);
    const top = Y0 + 20, room = FY[0] - 34 - top, g = 8, ar = Math.max(1, p0.h / p0.w);
    let c = 1, cw, ch, rows;
    for (; c <= 8; c++) { cw = (CW - (c - 1) * g) / c; ch = cw * ar; rows = Math.ceil(m / c); if (rows * ch + (rows - 1) * g <= room) break; }
    rest.forEach((i, k) => {
      const p = pages[i], [w, h] = fit(p, cw, ch), x = L + (k % c) * (cw + g), y = top + Math.floor(k / c) * (ch + g);
      pdf.addImage(imgs[i], 'PNG', x, y, w, h, undefined, 'FAST');
      stroke(INK, 0.5); pdf.rect(x, y, w, h);
    });
    // empty places in the last row become frames to draw in
    for (let k = m; k % c; k++) {
      const x = L + (k % c) * (cw + g), y = top + Math.floor(k / c) * (ch + g);
      stroke(RULE, 0.8); pdf.setLineDashPattern([3, 3], 0); pdf.rect(x, y, cw, ch); pdf.setLineDashPattern([], 0);
      if (cw > 60) { label('Draw', x + cw / 2, y + ch / 2 - 2, { align: 'center' }); label('your own', x + cw / 2, y + ch / 2 + 9, { align: 'center' }); }
    }
  } else {
    font('sans', 11.5); col(MUTE);
    pdf.text(['Print it on plain paper.', 'Color it with anything:', 'crayons, pencils, markers.'], L, Y0 + 9, { lineHeightFactor: 1.5 });
  }
  stroke(INK, 0.6); pdf.line(L, 738, R, 738);
  label('Made with Color My Photo', L, 752); label('Print on plain paper, US Letter or A4', R, 752, { align: 'right' });

  // ---- pages: running head, the drawing in its frame, one footer line; all on the drawing's own column ----
  idx.forEach((i, k) => {
    const p = pages[i];
    pdf.addPage('letter', 'portrait');
    const [w, h] = fit(p, 540, 642), x = (612 - w) / 2, y = 58 + (642 - h) / 2;
    const cx = Math.min(x, 91.5), cxr = 612 - cx;
    label('My Coloring Book', cx, 46); label('Color My Photo', cxr, 46, { align: 'right' });
    pdf.addImage(imgs[i], 'PNG', x, y, w, h, undefined, 'FAST');
    stroke(INK, 1); pdf.rect(x, y, w, h); // a frame where the drawing's lines end
    font('serif', 20); col(INK); pdf.text('No. ' + two(k + 1), cx, 739);
    const nw = pdf.getTextWidth('No. ' + two(k + 1));
    label('of ' + two(n), cx + nw + 7, 739);
    label('Try your colors', 306 - 62.25, 716);
    stroke(INK, 0.8); for (let q = 0; q < 6; q++) pdf.circle(306 - 53.75 + q * 21.5, 730.5, 8.5);
    label('Colored by', cxr - 118, 716); stroke(INK, 0.5); pdf.line(cxr - 118, 739, cxr, 739);
  });
  col(INK);
}

// ---------- PDF ----------
async function doPdf() {
  const btn = $('btn-pdf'), msg = $('dl-msg');
  if (!window.jspdf) { msg.textContent = 'The PDF tool did not load. Reload the page and try again.'; return; }
  setBusy(btn, true); msg.textContent = 'Building your PDF…';
  try {
    await new Promise(r => setTimeout(r, 30));
    const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
    const idx = Object.keys(pages).map(Number).filter(i => pages[i].st === 'done').sort((a, b) => a - b);
    const imgs = {};
    for (const i of idx) imgs[i] = await inkOnWhite(pages[i]);
    await drawBook(pdf, idx, imgs);
    pdf.save('color-my-photo-book.pdf');
    if (window.cmpInApp) {
      // An in-app browser may silently drop the download: never claim success, never wipe the photos.
      msg.textContent = 'We asked ' + (window.cmpInAppWho || 'this app') + ' to save the PDF. If nothing was saved, copy your link above and open it in Safari or Chrome. Your photos are still here.';
    } else {
      msg.textContent = 'Your PDF was created.';
      const all = photos.length > 0 && photos.every((_, i) => pages[i] && pages[i].st === 'done');
      if (all) { await dbClear(); msg.textContent += ' Your photos were removed from this browser.'; }
    }
  } catch (e) { msg.textContent = 'Could not build the PDF. Please try again.'; }
  setBusy(btn, false); renderGrid();
}

// ---------- page motion: reveal on scroll ----------
function ui() {
  const els = document.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach(e => io.observe(e));
}

// ---------- order page: redeem the Etsy order code, then reload with ?ref= like a returning paid order ----------
function initCode() {
  $('sec-code').hidden = false;
  const go = async () => {
    const code = $('code-in').value, msg = $('code-msg'), b = $('code-go');
    if (!code.trim()) { msg.textContent = 'Type the code from your PDF.'; return; }
    setBusy(b, true); msg.textContent = 'Checking your code…';
    try {
      const r = await api('/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }, 30000);
      if (r.ok && r.json && r.json.ref) { location.href = location.pathname + '?ref=' + encodeURIComponent(r.json.ref) + (qs.get('api') ? '&api=' + encodeURIComponent(qs.get('api')) : ''); return; }
      msg.textContent = errText(r);
    } catch (e) { msg.textContent = e.message; }
    setBusy(b, false);
  };
  $('code-go').onclick = go;
  $('code-in').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// ---------- init ----------
async function init() {
  ui();
  $('pick').onclick = () => $('file').click();
  $('file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  const dz = $('drop');
  ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
  $('btn-preview').onclick = doPreview;
  $('btn-pay').onclick = doPay;
  $('agree').onchange = refresh;
  $('btn-pdf').onclick = doPdf; if ($('btn-pdf-top')) $('btn-pdf-top').onclick = doPdf;
  { const fr = document.createElement('input'); fr.type = 'file'; fr.accept = 'image/*'; fr.id = 'file-replace'; fr.hidden = true;
    fr.onchange = e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; replacePhoto(f); }; document.body.appendChild(fr); }
  addEventListener('pageshow', e => { if (e.persisted) { busyPay = false; setBusy($('btn-pay'), false); $('pay-msg').textContent = ''; refresh(); } });
  try { const m = location.hash.match(/^#gift=(.+)$/); if (m) { const g = JSON.parse(decodeURIComponent(m[1])); setGift({ name: cleanName(g.name, 18), from: cleanName(g.from, 24) }); } } catch (e) {}
  { const g = getGift(); $('gift-name').value = g.name; $('gift-from').value = g.from; }
  ['gift-name', 'gift-from'].forEach(id => $(id).addEventListener('input', () => { setGift({ name: cleanName($('gift-name').value, 18), from: cleanName($('gift-from').value, 24) }); showGift(); }));
  $('btn-send').onclick = async () => {
    const g = getGift(), url = $('linkbox').value, text = (g.name ? 'A coloring book made for ' + g.name : 'A coloring book made from our photos') + (g.from ? ', from ' + g.from : '') + '. Open the link to download and print it.';
    if (navigator.share) { try { await navigator.share({ title: giftTitle(g), text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text + ' ' + url); $('btn-send').textContent = 'Link and message copied'; } catch (e) { $('linkbox').select(); $('btn-send').textContent = 'Copy the link above'; }
    setTimeout(() => $('btn-send').textContent = 'Send it as a gift', 2500);
  };
  showGift();
  $('btn-copy').onclick = async () => {
    const b = $('linkbox'); b.select();
    try { await navigator.clipboard.writeText(b.value); $('btn-copy').textContent = 'Copied'; } catch (e) { document.execCommand && document.execCommand('copy'); $('btn-copy').textContent = 'Copied'; }
    setTimeout(() => $('btn-copy').textContent = 'Copy', 2000);
  };
  $('btn-copy-top').onclick = async () => {
    const b = $('linkbox'), t = $('btn-copy-top');
    try { await navigator.clipboard.writeText(b.value); t.textContent = 'Link copied'; } catch (e) { b.scrollIntoView({ block: 'center' }); b.select(); document.execCommand && document.execCommand('copy'); t.textContent = 'Copy the link below'; }
    setTimeout(() => t.textContent = 'Copy my link', 2500);
  };
  if (window.cmpInApp) $('keep-why').textContent = 'You are in ' + (window.cmpInAppWho || 'an app') + ', which may block the download. Copy your link, then open it in Safari or Chrome to get your book.';
  if (qs.get('mockpaid') === '1') $('mockbar').hidden = false;

  const saved = await dbLoad();
  photos = saved.map(b => b ? { blob: b, url: URL.createObjectURL(b) } : { stub: true });
  renderThumbs(); refresh();
  if (qs.get('back') === '1' && !REF) { $('back-note').textContent = photos.length ? 'Your photos are still here. You were not charged.' : 'You were not charged. Add your photos again to continue.'; $('back-note').hidden = false; history.replaceState(null, '', location.pathname + location.hash); }
  if (!REF) { if (ORDER) initCode(); return; }
  if (ORDER) $('bench').hidden = false;

  if ($('gift-fs')) $('btn-pdf').parentNode.insertBefore($('gift-fs'), $('btn-pdf'));   // gift fields stay editable after paying
  $('sec-preview').hidden = true; $('sec-pay').hidden = true; document.body.classList.add('paid'); $('add-title').textContent = 'Add more photos';
  // One tab per order, so pages are never made twice.
  if (navigator.locks) {
    const got = await new Promise(res => navigator.locks.request('cmp-order-' + REF, { ifAvailable: true },
      lock => { res(!!lock); return lock ? new Promise(() => {}) : null; }));
    if (!got) { $('sec-confirm').hidden = false;
      $('confirm-msg').textContent = 'This order is already open in another tab or window. Close the other one, then reload this page.'; return; }
  }
  const st = await confirmPayment();
  if (!st) return;
  paid = true;
  $('confirm-msg').textContent = ORDER ? 'Your code is accepted. Thank you!' : 'Payment confirmed. Thank you!';
  $('testbadge').hidden = !st.test;
  $('sec-make').hidden = false;
  $('linkbox').value = location.origin + location.pathname + '?ref=' + encodeURIComponent(REF);
  showGift();
  const done = (st.done || []).map(Number);
  renderThumbs();
  done.forEach(i => { pages[i] = { st: 'making' }; });
  photos.forEach((p, i) => { if (!pages[i] && !p.stub) pages[i] = { st: 'wait' }; });
  renderGrid();
  if (!photos.length) { $('again-note').hidden = false; }
  else $('sec-add').hidden = false;
  await Promise.all(done.map(fetchDone));
  const top = done.length ? Math.max(...done) + 1 : 0;
  for (let i = 0; i < top; i++) if (!done.includes(i) && !pages[i] && !(photos[i] && !photos[i].stub))
    pages[i] = { st: 'failed', err: 'This page was not made yet.', missing: true };
  photos.forEach((_, i) => { if (pages[i] && pages[i].st === 'wait') queue.push({ i, redo: false }); });
  renderGrid(); pump();
  // if the photo picker is used later, startMaking() queues any new positions
}
init();
})();
