import { fx } from "./engine";

/**
 * A picture, opened up: it lifts out of the page and grows to fill the screen over a dark
 * veil, then settles back into its place when you click, tap or press Escape.
 */
export function openLightbox(img: HTMLImageElement) {
  if (!img.currentSrc && !img.src) return;
  const from = img.getBoundingClientRect();
  if (!from.width || !from.height) return;
  const o = fx.origin;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const veil = document.createElement("div");
  veil.className = "lightbox";
  veil.setAttribute("role", "dialog");
  veil.setAttribute("aria-label", img.alt || "Image");
  const big = document.createElement("img");
  big.className = "lightbox-img";
  big.src = img.currentSrc || img.src;
  big.alt = img.alt;
  veil.appendChild(big);
  document.body.appendChild(veil);

  // Where it ends up: as large as fits, with a margin.
  const vw = innerWidth;
  const vh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-h")) || innerHeight;
  const ratio = (img.naturalWidth || from.width) / (img.naturalHeight || from.height);
  const pad = vw < 640 ? 14 : 48;
  let w = Math.min(vw - pad * 2, img.naturalWidth || vw);
  let h = w / ratio;
  if (h > vh - pad * 2) {
    h = vh - pad * 2;
    w = h * ratio;
  }
  const left = (vw - w) / 2;
  const top = (vh - h) / 2;
  Object.assign(big.style, { left: `${left - o.x}px`, top: `${top - o.y}px`, width: `${w}px`, height: `${h}px` });

  const fromTransform = `translate(${from.left - left}px, ${from.top - top}px) scale(${from.width / w}, ${from.height / h})`;
  const dur = reduced ? 1 : 420;
  const easing = "cubic-bezier(0.2, 0.9, 0.25, 1)";
  big.animate([{ transform: fromTransform, borderRadius: "12px" }, { transform: "none", borderRadius: "6px" }], { duration: dur, easing });
  veil.animate([{ backgroundColor: "rgb(3 3 6 / 0)", backdropFilter: "blur(0px)" }, { backgroundColor: "rgb(3 3 6 / 0.82)", backdropFilter: "blur(14px)" }], {
    duration: dur,
    easing,
    fill: "forwards",
  });
  img.style.visibility = "hidden";

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    removeEventListener("keydown", onKey, true);
    const back = img.getBoundingClientRect();
    const toTransform = `translate(${back.left - left}px, ${back.top - top}px) scale(${back.width / w}, ${back.height / h})`;
    const a = big.animate([{ transform: "none", borderRadius: "6px" }, { transform: toTransform, borderRadius: "12px" }], { duration: reduced ? 1 : 340, easing, fill: "forwards" });
    veil.animate([{ backgroundColor: "rgb(3 3 6 / 0.82)" }, { backgroundColor: "rgb(3 3 6 / 0)" }], { duration: reduced ? 1 : 340, easing, fill: "forwards" });
    const done = () => {
      img.style.visibility = "";
      veil.remove();
    };
    a.finished.then(done, done);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  addEventListener("keydown", onKey, true);
  veil.addEventListener("click", close);
  veil.addEventListener("wheel", close, { passive: true });
}
