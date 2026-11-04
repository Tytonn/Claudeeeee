/*
 * Runs before anything else draws: marks the page with the saved scene, so a light (paper)
 * scene starts out paper-coloured — its launch veil too — rather than flashing dark first.
 * (A file of its own: the site's security policy allows no inline scripts.)
 *
 * The light scenes and their paper: keep in step with src/scenes/meta.ts (`light`, `plain`).
 */
(function () {
  var LIGHT = { ink: "#f1ede5", sky: "#d6e8f8" };
  try {
    var s = JSON.parse(localStorage.getItem("umbra:settings") || "null");
    var scene = s && typeof s.scene === "string" ? s.scene : "";
    if (!scene) return;
    var root = document.documentElement;
    root.dataset.scene = scene;
    var paper = Object.prototype.hasOwnProperty.call(LIGHT, scene) ? LIGHT[scene] : null;
    if (!paper) return;
    root.dataset.tone = "light";
    root.style.setProperty("--plain", paper);
    root.style.colorScheme = "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", paper);
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute("content", "light");
  } catch (e) {
    /* storage unavailable: the dark default it is */
  }
})();
