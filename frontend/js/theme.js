// Set the theme from Pipedrive's ?theme= query param before render (avoids a flash).
// Pipedrive can also push USER_SETTINGS_CHANGE at runtime; the SDK pages re-apply then.
(function () {
  try {
    var t = new URLSearchParams(location.search).get('theme');
    if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  } catch (e) {
    /* no-op */
  }
})();
