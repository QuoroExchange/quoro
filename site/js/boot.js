/* Quoro boot: decides whether local mocks load (only ?mock on localhost). Prod never loads mock.js. */
(function () {
  var h = location.hostname;
  var local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || /\.localhost$/.test(h);
  window.QUORO_MOCK = local && /[?&]mock\b/.test(location.search);
  document.documentElement.classList.add('js');
})();
