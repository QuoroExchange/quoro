/* Quoro 404 — footer block + connect button, same as other pages. */
(function () {
  var U = window.QuoroUI, F = U.fmt, API = window.QuoroAPI, W = window.QuoroWallet;
  if (API) API.pulse().then(function (p) { document.querySelectorAll('[data-pulse="block"]').forEach(function (e) { e.textContent = F.int(p.block); }); }).catch(function () {});
})();
