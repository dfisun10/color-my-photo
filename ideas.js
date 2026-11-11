// Color My Photo home page: "Who would you color first?" and the name on the cover.
// No dependencies, no requests except the example images. Without this file the page shows
// the first example side by side and a static cover sketch.
(function () {
  'use strict';
  var AI = 'Example photo, AI-made (not a real person).';
  var DREW = ' The page is what our process drew from it.';
  var D = 'samples/ideas/';
  var IDEAS = [
    { id: 'grandma', label: 'Grandma', photo: D + 'grandma_photo.jpg', page: D + 'grandma_page.png', tag: 'Example photo, AI-made', cap: AI,
      alt: 'Example photo: a grandmother with a mug at a kitchen table',
      hook: 'Grandma brings a book where she is on page one.',
      good: 'a grandparent with a visit coming up.', cta: 'Try it with your photo of Grandma' },
    { id: 'family', label: 'Family evening', photo: D + 'family_photo.jpg', page: D + 'family_page.png', tag: 'Example photo, AI-made', cap: 'Example photo, AI-made (not real people).',
      alt: 'Example photo: a family together',
      hook: 'Tonight at the kitchen table: the kids color you, you color the kids.',
      good: 'parents and kids, on an evening with nothing planned.', cta: 'Try it with a family photo' },
    { id: 'house', label: 'Our house', photo: D + 'house_photo.jpg', page: D + 'house_page.png', tag: 'Example photo, AI-made', cap: 'Example photo, AI-made (not a real home).',
      alt: 'Example photo: a house with a porch and a red front door',
      hook: 'The front door they\'ll remember, in their colors.',
      good: 'parents, grandparents, and a family that is moving.', cta: 'Try it with a photo of your house' },
    { id: 'mom', label: 'Mom', photo: D + 'mom_photo.jpg', page: D + 'mom_page.png', tag: 'Example photo, AI-made', cap: AI,
      alt: 'Example photo: a laughing mother with curly hair',
      hook: 'Give Mom purple hair. She can\'t object.',
      good: 'the other parent, before Mother\'s Day or a birthday. Works on Dad too.', cta: 'Try it with your photo of Mom' },
    { id: 'cat', label: 'The cat', photo: 'samples/photo_04.jpg', page: 'samples/page_04.png', tag: 'Example photo', cap: 'Example photo.',
      alt: 'Example photo: a fluffy cat',
      hook: 'At last the cat can be green.',
      good: 'any kid with a pet, and pet people with no kids at all.', cta: 'Try it with a photo of your pet' },
    { id: 'baby', label: 'New baby', photo: D + 'baby_photo.jpg', page: D + 'baby_page.png', tag: 'Example photo, AI-made', cap: AI,
      alt: 'Example photo: a sleeping newborn next to a toy rabbit',
      hook: 'Meet your little brother, crayons first.',
      good: 'a new big sister or brother, from parents, an aunt or a grandparent.', cta: 'Try it with a photo of the new baby' },
    { id: 'birthday', label: 'Birthday', photo: D + 'birthday_photo.jpg', page: D + 'birthday_page.png', tag: 'Example photo, AI-made', cap: AI,
      alt: 'Example photo: a child in a party hat behind a birthday cake',
      hook: 'Every guest goes home with the birthday kid to color.',
      good: 'a parent planning a party: print a page for each guest.', cta: 'Try it with the birthday photo' }
  ];

  function $(id) { return document.getElementById(id); }
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- who would you color first? ----------
  var sec = $('ideas'), chipsEl = $('idea-chips'), card = $('idea-card'), handle = $('idea-handle');
  if (sec && chipsEl && card && handle) ideas();

  function ideas() {
    var photo = $('idea-photo'), page = $('idea-page'), cap = $('idea-cap'), coverImg = $('cover-img');
    var tag = card.querySelector('.idea-photo .tag');
    var cur = -1, shown = false, inView = false, seq = 0, timer = 0;

    IDEAS.forEach(function (d, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = d.label; b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { select(i, true); });
      d.chip = b; chipsEl.appendChild(b);
    });
    chipsEl.addEventListener('keydown', function (e) {
      var step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      var live = IDEAS.filter(function (d) { return !d.chip.hidden; }), at = -1;
      live.forEach(function (d, k) { if (d.chip === document.activeElement) at = k; });
      if (at < 0) at = live.indexOf(IDEAS[cur]);
      var next = live[(at + step + live.length) % live.length];
      if (!next) return;
      e.preventDefault(); next.chip.focus(); select(IDEAS.indexOf(next), true);
    });
    sec.classList.add('js', 'wait');
    chipsEl.hidden = false; handle.hidden = false;

    function setP(p, animate) {
      p = Math.max(0, Math.min(1, p));
      card.classList.toggle('sweep', !!animate);
      card.style.setProperty('--p', p);
      handle.setAttribute('aria-valuenow', Math.round(p * 100));
      handle.setAttribute('aria-valuetext', p > .5 ? 'Mostly the photo' : p < .5 ? 'Mostly the coloring page' : 'Half photo, half coloring page');
      card._p = p;
    }
    function ready() { card.classList.remove('sweep'); card.classList.add('ready'); }
    function sweep() {
      clearTimeout(timer);
      if (calm) { setP(.5, false); ready(); return; }   // reduced motion: no wipe, both halves shown
      card.classList.remove('ready'); setP(1, false);
      void card.offsetWidth;                            // restart the transition from the photo
      setP(0, true);                                    // the crayon uncovers the whole page...
      timer = setTimeout(function () {                  // ...then settles: photo left, page right, handle between
        card.classList.add('ready'); setP(.5, true);
        timer = setTimeout(ready, 650);
      }, 950);
    }
    function fill(d) {
      photo.src = d.photo; photo.alt = d.alt; page.src = d.page;
      photo.removeAttribute('loading'); page.removeAttribute('loading');
      tag.textContent = d.tag; cap.textContent = d.cap + DREW;
      $('idea-hook').textContent = d.hook; $('idea-good').textContent = d.good; $('idea-cta-text').textContent = d.cta;
      if (coverImg) coverImg.src = d.page;
    }
    function select(i, user) {
      var d = IDEAS[i];
      if (!d || !d.ok || i === cur) return;
      cur = i; var my = ++seq;
      IDEAS.forEach(function (o, k) { o.chip.setAttribute('aria-pressed', k === i ? 'true' : 'false'); });
      if (user) {
        if (window.cmpHit) window.cmpHit('idea_' + d.id);
        if (d.chip.scrollIntoView) d.chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      if (!shown) { fill(d); setP(calm ? .5 : 1, false); return; }
      clearTimeout(timer);
      sec.classList.add('swap');                        // 200 ms cross-fade, then the crayon sweeps again
      timer = setTimeout(function () {
        if (my !== seq) return;
        fill(d); card.classList.remove('ready'); setP(calm ? .5 : 1, false);
        sec.classList.remove('swap');
        timer = setTimeout(sweep, calm ? 0 : 220);
      }, calm ? 0 : 200);
    }

    // An example whose pictures are missing loses its chip; the first one that loads is shown.
    function settle() {
      if (shown) return;
      for (var i = 0; i < IDEAS.length; i++) {
        if (IDEAS[i].ok === undefined) return;
        if (IDEAS[i].ok) { select(i, false); shown = true; sec.classList.remove('wait'); if (inView) sweep(); return; }
      }
      chipsEl.hidden = true; $('idea').hidden = true; sec.classList.remove('wait');   // nothing loaded: text ideas only
    }
    function probe() {
      IDEAS.forEach(function (d) {
        var left = 2, bad = false;
        [d.photo, d.page].forEach(function (src) {
          var im = new Image();
          im.onload = im.onerror = function (e) {
            if (e.type === 'error') bad = true;
            if (--left) return;
            d.ok = !bad; if (bad) d.chip.hidden = true;
            settle();
          };
          im.src = src;
        });
      });
    }
    if ('IntersectionObserver' in window) {
      var near = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { near.disconnect(); probe(); } }, { rootMargin: '900px 0px' });
      near.observe(sec);
      var see = new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) return;
        see.disconnect(); inView = true; if (shown) sweep();
      }, { threshold: .4 });
      see.observe(card);
    } else { inView = true; probe(); }

    // The handle scrubs between photo and page. Pointer events live on the handle only,
    // and the card keeps touch-action: pan-y, so a thumb scrolling the page is never trapped.
    var dragging = false;
    function at(e) { var r = card.getBoundingClientRect(); setP((e.clientX - r.left) / r.width, false); }
    handle.addEventListener('pointerdown', function (e) {
      dragging = true; clearTimeout(timer); ready();
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault(); handle.focus();
    });
    handle.addEventListener('pointermove', function (e) { if (dragging) at(e); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) { handle.addEventListener(t, function () { dragging = false; }); });
    handle.addEventListener('keydown', function (e) {
      var p = card._p === undefined ? .5 : card._p, k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowDown') p -= .1; else if (k === 'ArrowRight' || k === 'ArrowUp') p += .1;
      else if (k === 'Home') p = 0; else if (k === 'End') p = 1; else return;
      e.preventDefault(); clearTimeout(timer); ready(); setP(p, false);
    });
  }

  // ---------- the name on the cover ----------
  // Saved as localStorage "cmp_gift" = {"name": "...", "from": "..."}; the shop page reads it. Nothing is sent.
  var form = $('gift-form'), nameEl = $('gift-name'), meEl = $('gift-me'), meRow = $('gift-me-row');
  var title = $('cover-title'), forEl = $('cover-for'), coverCap = $('cover-cap'), giftCta = $('gift-cta-text');
  if (!form || !nameEl || !title || !forEl) return;
  var KEY = 'cmp_gift', radios = form.querySelectorAll('input[name="from"]');
  function clean(v) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 20); }
  function picked() { for (var i = 0; i < radios.length; i++) if (radios[i].checked) return radios[i].value; return ''; }
  function paint(save) {
    var n = clean(nameEl.value), me = picked() === 'Me', from = me ? clean(meEl.value) : picked(), who = n || 'Mia';
    meRow.hidden = !me;
    title.textContent = who + '\'s Coloring Book';
    forEl.textContent = 'For ' + who + (from ? ', love ' + from : '');
    if (coverCap) coverCap.textContent = (n ? 'Cover sketch.' : 'Cover sketch with an example name.') + ' Your real cover is built from your own pages.';
    if (giftCta) giftCta.textContent = n ? 'Make ' + n + '\'s book: first page free' : 'Make the book: first page free';
    if (!save) return;
    try { if (n) localStorage.setItem(KEY, JSON.stringify({ name: n, from: from })); else localStorage.removeItem(KEY); } catch (e) {}
  }
  try {
    var g = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (g && typeof g.name === 'string') {
      nameEl.value = clean(g.name);
      var f = clean(g.from), hit = false;
      for (var i = 0; i < radios.length; i++) if (radios[i].value === f && f !== 'Me') { radios[i].checked = hit = true; }
      if (!hit) { radios[radios.length - 1].checked = true; meEl.value = f; }
    }
  } catch (e) {}
  form.hidden = false;
  form.addEventListener('input', function () { paint(true); });
  form.addEventListener('change', function () { paint(true); });
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  paint(false);
})();
