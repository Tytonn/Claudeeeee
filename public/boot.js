/*
 * Runs before anything else draws: if the saved scene is Ink (paper), the page and its launch
 * veil start out paper-coloured rather than dark, so nothing flashes black on the way in.
 * (A file of its own: the site's security policy allows no inline scripts.)
 */
(function () {
  try {
    var s = JSON.parse(localStorage.getItem("umbra:settings") || "null");
    if (!s || s.scene !== "ink") return;
    var root = document.documentElement;
    root.dataset.scene = "ink";
    root.style.colorScheme = "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", "#f1ede5");
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute("content", "light");
  } catch (e) {
    /* storage unavailable: the dark default it is */
  }
})();
