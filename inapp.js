// Shared by index.html and make.html (load before the page's own scripts).
// 1) Source tag: ?r=ig|tt|pin|friends|etsy|ad is kept for this tab; checkout sends it to Stripe (metadata r), else "direct".
// 2) In-app browsers (Instagram, Pinterest, Facebook, TikTok, or any iOS/Android webview) may block the PDF/PNG download: a calm notice asks to open the page in Safari/Chrome first.
(function () {
  'use strict';
  var SOURCES = ['ig', 'tt', 'pin', 'friends', 'etsy', 'ad'];
  try {
    var r = (new URLSearchParams(location.search).get('r') || '').toLowerCase();
    if (SOURCES.indexOf(r) >= 0) sessionStorage.setItem('cmp_r', r);
  } catch (e) {}
  window.cmpSource = function () {
    try { var v = sessionStorage.getItem('cmp_r'); return SOURCES.indexOf(v) >= 0 ? v : 'direct'; } catch (e) { return 'direct'; }
  };

  var ua = navigator.userAgent || '';
  // Known apps by name; unknown webviews: iPhone/iPad UA without "Safari/", Android UA with "; wv)".
  function detect(u) {
    if (/Pinterest/i.test(u)) return 'Pinterest';
    if (/Instagram/i.test(u)) return 'Instagram';
    if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(u)) return 'Facebook';
    if (/musical_ly|BytedanceWebview|TikTok/i.test(u)) return 'TikTok';
    if (/\b(iPhone|iPad|iPod)\b/.test(u) && !/Safari\//.test(u)) return 'app';
    if (/Android/.test(u) && /; wv\)/.test(u)) return 'app';
    return '';
  }
  window.cmpDetectInApp = detect;
  var app = detect(ua);
  window.cmpInApp = app;
  var who = app === 'app' ? 'an app' : 'the ' + app + ' app';
  window.cmpInAppWho = who;
  if (!app) return;
  document.documentElement.classList.add('inapp');
  function show() {
    if (document.getElementById('inapp-bar')) return;
    var bar = document.createElement('div');
    bar.className = 'inapp-bar'; bar.id = 'inapp-bar'; bar.setAttribute('role', 'note');
    bar.innerHTML = '<p><b>You are in ' + who + '.</b> It may not let you download your book. ' +
      'Open this page in Safari or Chrome first: tap <b>&#8943;</b> (top right), then <b>Open in browser</b>.</p>' +
      '<button class="btn alt" type="button" id="inapp-copy">Copy page link</button>';
    var top = document.querySelector('header.top');
    if (top && top.parentNode) top.parentNode.insertBefore(bar, top.nextSibling); else document.body.insertBefore(bar, document.body.firstChild);
    var b = document.getElementById('inapp-copy');
    b.onclick = function () {
      var u = location.href;
      var done = function () { b.textContent = 'Copied. Paste it in Safari or Chrome'; };
      // in-app browsers often block the clipboard and window.prompt: show the link to press-and-hold instead
      var manual = function () {
        var f = document.getElementById('inapp-link');
        if (!f) { f = document.createElement('input'); f.id = 'inapp-link'; f.type = 'text'; f.readOnly = true; f.value = u; f.setAttribute('aria-label', 'Page link'); bar.appendChild(f); }
        f.focus(); f.setSelectionRange(0, u.length); b.textContent = 'Press and hold the link to copy';
      };
      try { navigator.clipboard.writeText(u).then(done, manual); } catch (e) { manual(); }
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
})();
