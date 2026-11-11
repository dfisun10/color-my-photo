// Color My Photo: small page effects shared by index.html and make.html. Decorative only; the page works without it.
(function () {
  'use strict';
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1. Headline: each word rises out of its own line mask (words keep their spaces, so wrapping is unchanged).
  var h = document.querySelector('h1.split');
  if (h && !calm) {
    var n = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var f = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(function (w) {
            if (!w) return;
            if (/^\s+$/.test(w)) { f.appendChild(document.createTextNode(' ')); return; }
            var o = document.createElement('span'), i = document.createElement('span');
            o.className = 'w'; i.textContent = w; i.style.setProperty('--i', n++); o.appendChild(i); f.appendChild(o);
          });
          node.replaceChild(f, c);
        } else if (c.nodeType === 1 && c.tagName !== 'svg') walk(c);
      });
    })(h);
    h.classList.add('is-split');
    requestAnimationFrame(function () { requestAnimationFrame(function () { h.classList.add('in'); }); });
  }

  // 2. Color the sample page: drag across it with a mouse or pen. Each stroke takes the next crayon.
  var pg = document.querySelector('.pin-page'), fig = pg && pg.closest('.pin');
  if (!pg || !window.PointerEvent || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  var CRAY = ['#f5a524', '#e5484d', '#2f6fde', '#3fa34d', '#f894c0', '#f5d547'];
  var c = document.createElement('canvas'), x = c.getContext('2d'), k = 0, last = null;
  c.className = 'pin-ink'; c.setAttribute('aria-hidden', 'true'); pg.appendChild(c);
  function fit() { var r = pg.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
  function pt(e) { var r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; }
  fit(); window.addEventListener('resize', fit);
  c.addEventListener('pointerdown', function (e) {
    last = pt(e); try { c.setPointerCapture(e.pointerId); } catch (err) {}
    x.strokeStyle = x.fillStyle = CRAY[k++ % CRAY.length]; x.lineWidth = c.width / 14; x.lineCap = x.lineJoin = 'round';
    x.beginPath(); x.arc(last[0], last[1], x.lineWidth / 2, 0, 7); x.fill();
    fig.classList.add('inked'); e.preventDefault();
  });
  c.addEventListener('pointermove', function (e) {
    if (!last) return; var p = pt(e);
    x.beginPath(); x.moveTo(last[0], last[1]); x.lineTo(p[0], p[1]); x.stroke(); last = p;
  });
  ['pointerup', 'pointercancel'].forEach(function (t) { c.addEventListener(t, function () { last = null; }); });
  c.addEventListener('dblclick', function () { x.clearRect(0, 0, c.width, c.height); fig.classList.remove('inked'); });
  var cap = fig.querySelector('figcaption');
  if (cap) { var s = document.createElement('span'); s.className = 'try'; s.textContent = 'Try it: drag across the page to color it in. Double-click to start over.'; cap.insertBefore(s, cap.firstChild); }
})();
