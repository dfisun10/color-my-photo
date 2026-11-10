// ---- Config (edit here) ----
const APP_NAME = "Color My Photo";            // working name: the ONLY place it is defined
const FORM_ACTION_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdEskFkp8zv2fqOWWadOTDqqLMhSLZ_x3vZPibhP60Qjjccvw/formResponse";
const ENTRY_ID = "1041978016";                 // Email question (required)
const ABACUS_NS = "cmp-live-q9w2";
// ----------------------------
(function () {
  document.title = APP_NAME + " — early access";
  document.querySelectorAll("[data-name]").forEach(function (e) { e.textContent = APP_NAME; });

  function hit(key) {
    if (/^(localhost|127\.0\.0\.1|)$/.test(location.hostname)) return; // no counting in local previews
    try { fetch("https://abacus.jasoncameron.dev/hit/" + ABACUS_NS + "/" + key).catch(function () {}); } catch (e) {}
  }
  try {
    if (!sessionStorage.getItem("visited")) { sessionStorage.setItem("visited", "1"); hit("visit"); }
  } catch (e) { hit("visit"); }

  var modal = document.getElementById("modal"), form = document.getElementById("form"),
      email = document.getElementById("email"), msg = document.getElementById("msg"),
      fields = document.getElementById("fields");

  var mt = document.getElementById("mt"), send = document.getElementById("send");
  var TEXT = {
    click_make: "The tool isn't open yet. Leave your email and we'll tell you the day it opens.",
    click_pro: "The $12 photo coloring book isn't on sale yet, so there is nothing to pay now. Leave your email and we'll tell you first."
  };
  function open(key) { hit(key); mt.textContent = TEXT[key]; msg.textContent = ""; fields.hidden = false; send.disabled = false; modal.hidden = false; email.focus(); }
  function close() { modal.hidden = true; }
  document.getElementById("btn-make").onclick = function () { open("click_make"); };
  document.getElementById("btn-pro").onclick = function () { open("click_pro"); };
  document.getElementById("close").onclick = close;
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var v = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { msg.textContent = "Please enter a valid email."; return; }
    function done() { hit("email_submit"); fields.hidden = true; msg.textContent = "Thanks, you're on the list. We'll email you once, when it opens."; }
    if (!FORM_ACTION_URL || !ENTRY_ID) { console.log("[early-access] form not configured; email:", v); done(); return; }
    if (send.disabled) return;
    send.disabled = true; msg.textContent = "Sending…";
    var body = new URLSearchParams(); body.set("entry." + ENTRY_ID, v);
    fetch(FORM_ACTION_URL, { method: "POST", mode: "no-cors", body: body })
      .then(done).catch(function () { send.disabled = false; msg.textContent = "Something went wrong. Please check your connection and try again."; });
  });
})();
