/* Quoro /docs — contents highlight (scroll-spy), phone contents collapse, footer block. */
(function () {
  var U = window.QuoroUI, F = U.fmt, API = window.QuoroAPI, W = window.QuoroWallet;
  var toc = document.getElementById('dtoc'), links = toc ? toc.querySelectorAll('nav a') : [];
  var mq = window.matchMedia('(max-width:1023px)');
  var sum = document.getElementById('dsum');
  function setOpen(o) { toc.classList.toggle('open', o); sum.setAttribute('aria-expanded', String(o)); }
  if (sum) sum.addEventListener('click', function () { setOpen(!toc.classList.contains('open')); });
  links.forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
  document.addEventListener('click', function (e) { if (toc && !toc.contains(e.target)) setOpen(false); });
  var secs = Array.prototype.map.call(links, function (a) { return document.querySelector(a.getAttribute('href')); });
  function spy() {
    var y = window.scrollY + 140, cur = 0;
    secs.forEach(function (s, i) { if (s && s.offsetTop <= y) cur = i; });
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = secs.length - 1;
    links.forEach(function (a, i) { a.classList.toggle('on', i === cur); });
  }
  window.addEventListener('scroll', spy, { passive: true }); spy();
  if (API) {
    var P = null, t0 = 0;
    var tick = function () { if (!P) return; var b = P.block + (U.RM ? 0 : Math.floor((Date.now() - t0) / (P.blockMs || 100))); document.querySelectorAll('[data-pulse="block"]').forEach(function (e) { e.textContent = F.int(b); }); };
    var lp = function () { API.pulse().then(function (p) { P = p; t0 = Date.now(); tick(); }).catch(function () {}); };
    lp(); setInterval(lp, 30000); if (!U.RM) setInterval(tick, 500);
  }
})();
