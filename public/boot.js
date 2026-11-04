/*
 * Runs before anything else draws: marks the page with the saved scene, so a light (paper)
 * scene starts out paper-coloured — its launch veil too — rather than flashing dark first; and
 * on iPhone and iPad, keeps Safari from zooming in when you start typing.
 * (A file of its own: the site's security policy allows no inline scripts.)
 *
 * The light scenes and their paper: keep in step with src/scenes/meta.ts (`light`, `plain`,
 * and INK_NIGHT for Ink set to Dark).
 */
(function () {
  // On iPhone and iPad, Safari zooms the page in when you start typing in anything set smaller than
  // 16px — and stays zoomed in after. Telling it the page is already at its largest stops that;
  // pinching to zoom still works there (iOS always allows it). Elsewhere the page is left alone.
  try {
    var nav = navigator;
    var iOS = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
    var vp = iOS && document.querySelector('meta[name="viewport"]');
    if (vp && !/maximum-scale/.test(vp.content)) vp.setAttribute("content", vp.content + ", maximum-scale=1");
  } catch (e) {
    /* nothing to do */
  }

  var LIGHT = { ink: "#f1ede5", sky: "#d6e8f8" };
  // (Ink set to Dark: its water by night, and the dark interface)
  var INK_NIGHT = "#090b10";
  try {
    var s = JSON.parse(localStorage.getItem("umbra:settings") || "null");
    var scene = s && typeof s.scene === "string" ? s.scene : "";
    if (!scene) return;
    var root = document.documentElement;
    root.dataset.scene = scene;
    if (scene === "ink" && s.inkDark === true) {
      root.style.setProperty("--plain", INK_NIGHT);
      var night = document.querySelector('meta[name="theme-color"]');
      if (night) night.setAttribute("content", INK_NIGHT);
      return;
    }
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
