/*
 * Export as PDF where there's no print window — an iPhone or iPad Home Screen app, where asking
 * for one does nothing at all. This makes the very page the print window would: the note's copy
 * (lib/print.ts), laid out with the print styles (layout.css) at the paper's width, out of sight.
 *
 * The browser does all of the layout — every line, every font, every space — and this only reads
 * where everything landed and paints it, page by page, at print sharpness: the words and their
 * underlines, the boxes behind code and highlights, the rules of tables and quotes, pictures,
 * checkboxes and list markers. Pages break where the print styles say: never through a line, a
 * picture or a table row; a heading kept with what follows it; no first or last line of a
 * paragraph left alone on a page. Then the pages are bound into a PDF, its links still links.
 */

/** CSS px per point. */
const PX = 96 / 72;
/** Points per millimetre. */
const MM = 72 / 25.4;

type Paper = { w: number; h: number };
const LETTER: Paper = { w: 612, h: 792 };
const A4: Paper = { w: 595.28, h: 841.89 };
/** The page's margins (pt), as on paper — see @page in layout.css. */
const MARGIN = { top: 20 * MM, side: 19 * MM, bottom: 22 * MM };
/** Where paper comes in Letter (everywhere else, A4) — as the print window would choose. */
const LETTER_REGIONS = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE", "PR", "GT", "CR", "PA", "DO", "SV", "NI", "BZ"]);
/** Pixels per CSS px on the page: 288 dots an inch, print-sharp. */
const SCALE = 3;

type Band = [number, number];
type Radii = [number, number, number, number];
type Edge = { w: number; color: string };
type Ring = { inset: boolean; spread: number; color: string };
type Clip = { x: number; y: number; w: number; h: number; radii: Radii };
/** Something to paint: where it is on the long page (CSS px), and how to paint it. A `slice`
 *  (a box, a picture) is painted on every page it reaches, cut at the page's edge; anything else
 *  (words, markers) on the page its top is on, whole. */
type Item = { top: number; bottom: number; slice: boolean; draw: (p: Pen) => void };
type Link = { x: number; y: number; w: number; h: number; uri: string };
type Laid = { items: Item[]; hard: Band[]; soft: Band[]; links: Link[]; end: number };
type Picture = { data: Uint8Array<ArrayBuffer>; filter: "FlateDecode" | "DCTDecode"; gray: boolean; w: number; h: number };
type Sheet = { picture: Picture; links: { rect: [number, number, number, number]; uri: string }[] };

/** Makes the PDF of a laid-out copy of a note (an `article.print-doc`, not yet on the page). */
export async function makePdf(doc: HTMLElement, title: string): Promise<Blob> {
  const paper = paperHere();
  const g = {
    pageW: paper.w * PX,
    pageH: paper.h * PX,
    left: MARGIN.side * PX,
    top: MARGIN.top * PX,
    width: (paper.w - 2 * MARGIN.side) * PX,
    height: (paper.h - MARGIN.top - MARGIN.bottom) * PX,
  };
  const host = document.createElement("div");
  host.className = "pdf-host";
  host.setAttribute("aria-hidden", "true");
  host.style.width = `${g.width}px`;
  host.style.setProperty("--page-h", `${g.height}px`);
  host.append(doc);
  document.body.append(host);
  try {
    await settle(host);
    const laid = measure(doc, host);
    const pages = paginate(laid, g.height);
    const sheets = await paint(laid, pages, g, paper);
    return bind(sheets, paper, title);
  } finally {
    host.remove();
  }
}

function paperHere(): Paper {
  const lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
  let region = "";
  try {
    region = new Intl.Locale(lang).maximize().region ?? "";
  } catch {
    region = /[-_]([A-Za-z]{2})\b/.exec(lang)?.[1]?.toUpperCase() ?? "";
  }
  return LETTER_REGIONS.has(region) ? LETTER : A4;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Waits for the copy's fonts and pictures (it's just been laid out, which sends for them). */
async function settle(host: HTMLElement) {
  void host.offsetHeight;
  const pictures = Array.from(host.querySelectorAll("img")).map((img) => (img.getAttribute("src") ? img.decode().catch(() => undefined) : undefined));
  await Promise.race([Promise.all([document.fonts?.ready, ...pictures]), wait(8000)]);
  if (document.fonts) await Promise.race([document.fonts.ready, wait(2000)]);
}

// ── Reading the laid-out page ────────────────────────────────────────────────

/** A computed colour that shows (not transparent). */
function visible(c: string): boolean {
  if (!c || c === "transparent") return false;
  const rgb = /^rgba?\(([^)]*)\)$/.exec(c.trim());
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length < 4 || parseFloat(parts[3]) > 0;
  }
  const alpha = /\/\s*([\d.]+)(%?)\s*\)$/.exec(c);
  return !alpha || parseFloat(alpha[1]) > 0;
}

/** Splits a list on its top-level commas (not the ones inside rgb(…)). */
function topLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

/** The hard-edged rings among a box's shadows (no offset, no blur: a line round or inside it). */
function ringsOf(shadow: string): Ring[] {
  if (!shadow || shadow === "none") return [];
  const out: Ring[] = [];
  for (const part of topLevel(shadow)) {
    let color = "";
    let rest = part.replace(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/i, (m) => {
      color = m;
      return " ";
    });
    const inset = /\binset\b/.test(rest);
    rest = rest.replace(/\binset\b/g, " ");
    const nums: number[] = [];
    for (const tok of rest.trim().split(/\s+/)) {
      if (!tok) continue;
      if (/^-?[\d.]+(px)?$/.test(tok)) nums.push(parseFloat(tok));
      else if (!color) color = tok;
    }
    const [x = 0, y = 0, blur = 0, spread = 0] = nums;
    if (x === 0 && y === 0 && blur === 0 && spread > 0 && visible(color)) out.push({ inset, spread, color });
  }
  return out;
}

/** A box's corner radii (CSS px, each corner round — the smaller of its two radii), shrunk
 *  together if they'd overlap, as CSS does. */
function radiiOf(s: CSSStyleDeclaration, w: number, h: number): Radii {
  const one = (v: string) => {
    const [a, b = a] = v.trim().split(/\s+/);
    const px = (t: string, len: number) => (t.endsWith("%") ? (parseFloat(t) / 100) * len : parseFloat(t) || 0);
    return Math.max(0, Math.min(px(a ?? "0", w), px(b ?? "0", h)));
  };
  const r: Radii = [one(s.borderTopLeftRadius), one(s.borderTopRightRadius), one(s.borderBottomRightRadius), one(s.borderBottomLeftRadius)];
  const fit = (len: number, a: number, b: number) => (a + b > len ? len / (a + b) : 1);
  const f = Math.min(fit(w, r[0], r[1]), fit(w, r[3], r[2]), fit(h, r[0], r[3]), fit(h, r[1], r[2]));
  return f < 1 ? (r.map((v) => v * f) as Radii) : r;
}

/** The font, as a canvas takes it. */
function fontOf(s: CSSStyleDeclaration): string {
  const italic = s.fontStyle === "italic" || s.fontStyle.startsWith("oblique");
  return `${italic ? "italic" : "normal"} ${s.fontWeight || "400"} ${s.fontSize} ${s.fontFamily}`;
}

/** Whether a canvas can space letters itself (newer browsers); if not, spaced-out words are
 *  painted letter by letter, each where the page has it. */
const CAN_SPACE = typeof CanvasRenderingContext2D !== "undefined" && "letterSpacing" in CanvasRenderingContext2D.prototype;

const graphemes: (s: string) => string[] = (() => {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return (s: string) => Array.from(seg.segment(s), (x) => x.segment);
  }
  return (s: string) => Array.from(s);
})();

function counter(type: string, n: number): string {
  const alpha = (k: number) => {
    let out = "";
    for (let v = k; v > 0; v = Math.floor((v - 1) / 26)) out = String.fromCharCode(65 + ((v - 1) % 26)) + out;
    return out || String(k);
  };
  const roman = (k: number) => {
    if (k <= 0 || k >= 4000) return String(k);
    const marks: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    let v = k;
    for (const [num, mark] of marks)
      while (v >= num) {
        out += mark;
        v -= num;
      }
    return out;
  };
  switch (type) {
    case "decimal-leading-zero":
      return n < 10 && n >= 0 ? `0${n}` : String(n);
    case "lower-alpha":
    case "lower-latin":
      return alpha(n).toLowerCase();
    case "upper-alpha":
    case "upper-latin":
      return alpha(n);
    case "lower-roman":
      return roman(n).toLowerCase();
    case "upper-roman":
      return roman(n);
    default:
      return String(n);
  }
}

/** A CSS transform's matrix (its turn and scale), if it has one. */
function matrixOf(t: string): [number, number, number, number] | null {
  const m = /^matrix\(([^)]*)\)$/.exec(t.trim());
  if (!m) return null;
  const v = m[1].split(",").map((x) => parseFloat(x));
  return v.length >= 4 && v.slice(0, 4).every(Number.isFinite) ? [v[0], v[1], v[2], v[3]] : null;
}

function sameOrigin(src: string): boolean {
  if (src.startsWith("blob:") || src.startsWith("data:")) return true;
  try {
    return new URL(src, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/** Where a typeface's baseline sits in a box of its text, and how tall the box is (CSS px). */
type Metric = { base: number; height: number };
type Deco = { id: number; kind: "underline" | "line-through" | "overline"; color: string; thick: number; offset: number | null; size: number };
type Marker = { li: Element; draw: (base: number, top: number, bottom: number) => void };

/** Reads where everything on the copy landed: what to paint, and where a page may break. */
function measure(doc: HTMLElement, host: HTMLElement): Laid {
  const origin = doc.getBoundingClientRect();
  const ox = origin.left;
  const oy = origin.top;
  const items: Item[] = [];
  /** (strike-throughs: painted over the words they cross) */
  const late: Item[] = [];
  const hard: Band[] = [];
  const soft: Band[] = [];
  const links: Link[] = [];
  const keeps: Band[] = [];

  const styles = new Map<Element, CSSStyleDeclaration>();
  const css = (el: Element) => {
    let s = styles.get(el);
    if (!s) {
      s = getComputedStyle(el);
      styles.set(el, s);
    }
    return s;
  };

  // Each typeface's baseline, measured once: a line of its text with a mark sitting on the
  // baseline (an empty inline-block's bottom edge is the baseline).
  const probes: HTMLElement[] = [];
  const metrics = new Map<string, Metric>();
  const metric = (s: CSSStyleDeclaration): Metric => {
    const key = `${fontOf(s)}|${s.lineHeight}`;
    let m = metrics.get(key);
    if (m) return m;
    const probe = document.createElement("div");
    const st = probe.style;
    st.position = "absolute";
    st.left = "0";
    st.top = "0";
    st.whiteSpace = "nowrap";
    st.fontStyle = s.fontStyle;
    st.fontWeight = s.fontWeight;
    st.fontSize = s.fontSize;
    st.fontFamily = s.fontFamily;
    st.fontStretch = s.fontStretch;
    st.lineHeight = s.lineHeight;
    const text = document.createTextNode("Hxgy");
    const mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    probe.append(text, mark);
    host.append(probe);
    probes.push(probe);
    const r = document.createRange();
    r.setStart(text, 0);
    r.setEnd(text, 4);
    const box = r.getBoundingClientRect();
    const size = parseFloat(s.fontSize) || 16;
    m = { base: mark.getBoundingClientRect().top - box.top, height: box.height || size * 1.2 };
    if (!(m.base > 0 && m.base <= m.height * 1.2)) m.base = m.height * 0.8;
    metrics.set(key, m);
    return m;
  };

  // The block each run of words belongs to (for its lines: see orphans and widows below).
  const blocks = new Map<Element, Element>();
  const blockOf = (el: Element): Element => {
    let b = blocks.get(el);
    if (b) return b;
    b = el;
    while (b !== doc && b.parentElement && (css(b).display === "inline" || css(b).display === "contents")) b = b.parentElement;
    blocks.set(el, b);
    return b;
  };
  const lines = new Map<Element, Band[]>();

  // Underlines and strike-throughs reach down from whatever set them; each line of each is one
  // stroke, gathered as the words come.
  const decoIds = new Map<Element, number>();
  const decoCache = new Map<Element, Deco[]>();
  const decorators = (el: Element): Deco[] => {
    const hit = decoCache.get(el);
    if (hit) return hit;
    const out: Deco[] = [];
    for (let a: Element | null = el; a; a = a.parentElement) {
      const s = css(a);
      const on = s.textDecorationLine || s.getPropertyValue("-webkit-text-decoration-line");
      if (on && on !== "none") {
        let id = decoIds.get(a);
        if (id === undefined) decoIds.set(a, (id = decoIds.size));
        const size = parseFloat(s.fontSize) || 16;
        const thick = parseFloat(s.textDecorationThickness);
        const offset = parseFloat(s.textUnderlineOffset);
        for (const kind of ["underline", "line-through", "overline"] as const)
          if (on.includes(kind))
            out.push({ id, kind, color: s.textDecorationColor || s.color, thick: thick > 0 ? thick : Math.max(1, size * 0.06), offset: Number.isFinite(offset) ? offset : null, size });
      }
      if (a === doc) break;
      // (none reach into an inline-block, or a box out of the flow, from above it)
      if (s.display.startsWith("inline-") || s.position === "absolute" || s.position === "fixed" || (s.cssFloat && s.cssFloat !== "none")) break;
    }
    decoCache.set(el, out);
    return out;
  };
  const runs = new Map<string, { x1: number; x2: number }>();
  const decorate = (d: Deco, x1: number, x2: number, base: number, top: number, bottom: number) => {
    const key = `${d.id}|${d.kind}|${Math.round(base * 2)}`;
    const run = runs.get(key);
    if (run) {
      run.x1 = Math.min(run.x1, x1);
      run.x2 = Math.max(run.x2, x2);
      return;
    }
    const fresh = { x1, x2 };
    runs.set(key, fresh);
    const y = d.kind === "underline" ? base + (d.offset ?? Math.max(1, d.size * 0.09)) : d.kind === "line-through" ? base - d.size * 0.28 - d.thick / 2 : base - d.size * 0.92;
    const item: Item = { top, bottom, slice: false, draw: (p) => p.rect(fresh.x1, y, fresh.x2 - fresh.x1, d.thick, d.color) };
    (d.kind === "line-through" ? late : items).push(item);
  };

  // List markers wait for their item's first line (they sit on its baseline).
  const pending: Marker[] = [];
  const settleMarkers = (node: Node, base: number, top: number, bottom: number) => {
    for (let i = pending.length - 1; i >= 0; i--)
      if (pending[i].li.contains(node)) {
        pending[i].draw(base, top, bottom);
        pending.splice(i, 1);
      }
  };

  const range = document.createRange();
  const rectsOf = (node: Text, a: number, b: number) => {
    range.setStart(node, a);
    range.setEnd(node, b);
    return range.getClientRects();
  };

  /** The words of a run of text, each painted where the page set it. */
  const words = (node: Text, parent: Element) => {
    const data = node.data;
    if (!/\S/.test(data)) return;
    const s = css(parent);
    if (s.visibility !== "visible") return;
    const font = fontOf(s);
    const color = s.color;
    const m = metric(s);
    const ls = parseFloat(s.letterSpacing) || 0;
    const spacing = ls ? `${ls}px` : "0px";
    const apart = ls !== 0 && !CAN_SPACE && Math.abs(ls) >= 0.1;
    const tt = s.textTransform;
    const shape = (t: string) => (tt === "uppercase" ? t.toLocaleUpperCase() : tt === "lowercase" ? t.toLocaleLowerCase() : t);
    const decos = decorators(parent);
    const block = blockOf(parent);
    const blockLines: Band[] = lines.get(block) ?? [];
    lines.set(block, blockLines);

    const piece = (text: string, left: number, right: number, rtop: number, rbottom: number) => {
      const x = left - ox;
      const top = rtop - oy;
      const bottom = rbottom - oy;
      const base = top + m.base;
      for (const d of decos) decorate(d, x, right - ox, base, top, bottom);
      const str = shape(text);
      items.push({ top, bottom, slice: false, draw: (p) => p.text(str, x, base, font, color, spacing) });
      hard.push([top, bottom]);
      blockLines.push([top, bottom]);
      if (pending.length) settleMarkers(node, base, top, bottom);
    };

    const word = /\S+/g;
    for (let mt = word.exec(data); mt; mt = word.exec(data)) {
      const from = mt.index;
      const rects = rectsOf(node, from, from + mt[0].length);
      if (!rects.length) continue;
      if (rects.length === 1 && !apart) {
        const r = rects[0];
        if (r.width > 0 || r.height > 0) piece(mt[0], r.left, r.right, r.top, r.bottom);
        continue;
      }
      // a word that wraps onto the next line, or that's in two directions at once (a Hebrew word
      // and its full stop), or spaced out: letter by letter, each stretch of letters side by side
      // on one line painted together
      let at = from;
      let run: { text: string; left: number; right: number; top: number; bottom: number } | null = null;
      for (const ch of graphemes(mt[0])) {
        const r = rectsOf(node, at, at + ch.length)[0];
        at += ch.length;
        if (!r || (r.width <= 0 && r.height <= 0)) {
          if (run) run.text += ch;
          continue;
        }
        const near = run ? Math.max(1.5, (run.bottom - run.top) * 0.25) : 0;
        if (run && !apart && Math.abs(r.top - run.top) < Math.max(1, (run.bottom - run.top) * 0.5) && (Math.abs(r.left - run.right) <= near || Math.abs(r.right - run.left) <= near)) {
          run.text += ch;
          run.left = Math.min(run.left, r.left);
          run.right = Math.max(run.right, r.right);
          run.bottom = Math.max(run.bottom, r.bottom);
          continue;
        }
        if (run) piece(run.text, run.left, run.right, run.top, run.bottom);
        run = { text: ch, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }
      if (run) piece(run.text, run.left, run.right, run.top, run.bottom);
    }
  };

  /** A box's own paint: its background, borders, and ring-like shadows. */
  const box = (el: Element, s: CSSStyleDeclaration) => {
    const bg = visible(s.backgroundColor) ? s.backgroundColor : "";
    const edges = (["top", "right", "bottom", "left"] as const).map((side): Edge => {
      const w = parseFloat(s.getPropertyValue(`border-${side}-width`)) || 0;
      const style = s.getPropertyValue(`border-${side}-style`);
      const color = s.getPropertyValue(`border-${side}-color`);
      return w > 0 && style !== "none" && style !== "hidden" && visible(color) ? { w, color } : { w: 0, color: "" };
    }) as [Edge, Edge, Edge, Edge];
    const rings = ringsOf(s.boxShadow);
    if (!bg && !edges.some((e) => e.w) && !rings.length) return;
    const inline = s.display === "inline";
    const rects = inline ? Array.from(el.getClientRects()) : [el.getBoundingClientRect()];
    const out = rings.reduce((v, r) => (r.inset ? v : Math.max(v, r.spread)), 0);
    for (const r of rects) {
      if (r.width <= 0 || r.height <= 0) continue;
      const x = r.left - ox;
      const y = r.top - oy;
      const w = r.width;
      const h = r.height;
      const radii = radiiOf(s, w, h);
      items.push({ top: y - out, bottom: y + h + out, slice: true, draw: (p) => p.box(x, y, w, h, radii, bg, edges, rings) });
      // (a highlight or a bit of code, or a rule, is never cut across)
      if (inline || h <= 4) hard.push([y - out, y + h + out]);
    }
  };

  /** The box a picture is cut to: the nearest frame round it that hides what overflows. */
  const frameOf = (el: Element): Clip | null => {
    for (let a = el.parentElement; a && a !== doc.parentElement; a = a.parentElement) {
      const s = css(a);
      if (s.overflowX !== "visible" || s.overflowY !== "visible") {
        const r = a.getBoundingClientRect();
        return { x: r.left - ox, y: r.top - oy, w: r.width, h: r.height, radii: radiiOf(s, r.width, r.height) };
      }
      if (a === doc) break;
    }
    return null;
  };

  const picture = (img: HTMLImageElement, s: CSSStyleDeclaration) => {
    const src = img.currentSrc || img.src;
    if (!src || !img.complete || !img.naturalWidth || !sameOrigin(src)) return;
    const r = img.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const x = r.left - ox;
    const y = r.top - oy;
    const w = r.width;
    const h = r.height;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    let dx = x;
    let dy = y;
    let dw = w;
    let dh = h;
    const fit = s.objectFit;
    if (fit === "cover" || fit === "contain" || fit === "none" || fit === "scale-down") {
      const k = fit === "cover" ? Math.max(w / nw, h / nh) : fit === "contain" ? Math.min(w / nw, h / nh) : fit === "none" ? 1 : Math.min(1, w / nw, h / nh);
      const [px, py] = s.objectPosition.split(/\s+/).map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : 0.5));
      dw = nw * k;
      dh = nh * k;
      dx = x + (w - dw) * (Number.isFinite(px) ? px : 0.5);
      dy = y + (h - dh) * (Number.isFinite(py) ? py : 0.5);
    }
    const clips: Clip[] = [{ x, y, w, h, radii: radiiOf(s, w, h) }];
    const frame = frameOf(img);
    if (frame) clips.push(frame);
    items.push({ top: y, bottom: y + h, slice: true, draw: (p) => p.picture(img, dx, dy, dw, dh, clips) });
    hard.push([y, y + h]);
  };

  /** A checkbox: its circle is its own box (see `box`); a done one has its tick, its ::after. */
  const checkbox = (input: HTMLInputElement, s: CSSStyleDeclaration) => {
    const r = input.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const x = r.left - ox;
    const y = r.top - oy;
    hard.push([y, y + r.height]);
    if (!input.checked) return;
    const a = getComputedStyle(input, "::after");
    const em = parseFloat(s.fontSize) || 16;
    const lw = parseFloat(a.borderLeftWidth) || 2;
    const w = parseFloat(a.width) || em * 0.5;
    const h = parseFloat(a.height) || em * 0.27;
    const mt = parseFloat(a.marginTop);
    const color = visible(a.borderLeftColor) ? a.borderLeftColor : "#fff";
    const turn = matrixOf(a.transform) ?? [Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2];
    // (centred in the circle, raised by half its negative top margin)
    const cx = x + r.width / 2;
    const cy = y + r.height / 2 + (Number.isFinite(mt) ? mt / 2 : -0.06 * em);
    items.push({ top: y, bottom: y + r.height, slice: false, draw: (p) => p.tick(cx, cy, w, h, lw, turn, color) });
  };

  /** A list item's marker: a bullet, or its number, on the item's first line. */
  const marker = (li: Element, s: CSSStyleDeclaration) => {
    const type = s.listStyleType;
    if (!type || type === "none") return;
    let ms = getComputedStyle(li, "::marker");
    if (!ms.fontSize || !ms.fontFamily) ms = s;
    const r = li.getBoundingClientRect();
    const start = r.left - ox + (parseFloat(s.borderLeftWidth) || 0) + (parseFloat(s.paddingLeft) || 0);
    const color = ms.color || s.color;
    let draw: Marker["draw"];
    if (type === "disc" || type === "circle" || type === "square") {
      // drawn as the browsers draw them: a third of the typeface's ascent across, its top half
      // the ascent below the text's top, standing a little clear of the item
      const A = metric(ms).base;
      const d = (A * (2 / 3) + 1) / 2;
      const x0 = start - A * (2 / 3) - 7;
      draw = (base, top, bottom) => items.push({ top, bottom, slice: false, draw: (p) => p.bullet(type, x0, base - A / 2, d, color) });
    } else {
      const list = li.parentElement;
      let n = list instanceof HTMLOListElement ? list.start : 1;
      for (let sib = li.previousElementSibling; sib; sib = sib.previousElementSibling) if (sib.tagName === "LI") n++;
      const label = `${counter(type, n)}. `;
      const font = fontOf(ms);
      draw = (base, top, bottom) => items.push({ top, bottom, slice: false, draw: (p) => p.textEnd(label, start, base, font, color) });
    }
    pending.push({ li, draw });
  };

  const link = (a: HTMLAnchorElement) => {
    const uri = a.href;
    if (!/^(https?:|mailto:|tel:)/i.test(uri)) return;
    for (const r of Array.from(a.getClientRects())) if (r.width > 0 && r.height > 0) links.push({ x: r.left - ox, y: r.top - oy, w: r.width, h: r.height, uri });
  };

  const walk = (el: Element) => {
    if (el.namespaceURI !== "http://www.w3.org/1999/xhtml") return;
    const s = css(el);
    if (s.display === "none" || s.opacity === "0") return;
    const tag = el.tagName;
    if (el !== doc && s.visibility === "visible") box(el, s);
    if (tag === "IMG") picture(el as HTMLImageElement, s);
    else if (tag === "INPUT" && (el as HTMLInputElement).type === "checkbox") checkbox(el as HTMLInputElement, s);
    else if (tag === "A") link(el as HTMLAnchorElement);
    if (s.display === "list-item") marker(el, s);
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === Node.TEXT_NODE) words(c as Text, el);
      else if (c.nodeType === Node.ELEMENT_NODE) walk(c as Element);
    }
    // a list item with no words: its marker on where its first line would be
    for (let i = pending.length - 1; i >= 0; i--)
      if (pending[i].li === el) {
        const m = metric(s);
        const lh = parseFloat(s.lineHeight) || m.height;
        const r = el.getBoundingClientRect();
        const top = r.top - oy + (parseFloat(s.paddingTop) || 0);
        pending[i].draw(top + (lh - m.height) / 2 + m.base, top, top + lh);
        pending.splice(i, 1);
      }
    // what must stay whole on one page, or on the same page as what follows it
    const inside = s.breakInside || s.pageBreakInside;
    const after = s.breakAfter || s.pageBreakAfter;
    if (inside === "avoid" || inside === "avoid-page" || after === "avoid" || after === "avoid-page") {
      const r = el.getBoundingClientRect();
      if (inside === "avoid" || inside === "avoid-page") soft.push([r.top - oy, r.bottom - oy]);
      if (after === "avoid" || after === "avoid-page") keeps.push([r.top - oy, r.bottom - oy]);
    }
  };

  try {
    walk(doc);
  } finally {
    for (const p of probes) p.remove();
  }

  hard.sort((a, b) => a[0] - b[0]);
  // a heading stays with the first line after it
  for (const [top, bottom] of keeps) {
    const next = hard.find(([t]) => t >= bottom - 0.5);
    if (next) soft.push([top, next[1]]);
  }
  // no paragraph leaves fewer than `orphans` lines at the foot of a page, or `widows` at the top
  for (const [block, bands] of lines) {
    if (bands.length < 2) continue;
    bands.sort((a, b) => a[0] - b[0]);
    const rows: Band[] = [];
    for (const [t, b] of bands) {
      const last = rows[rows.length - 1];
      if (last && t < last[1] - Math.min(b - t, last[1] - last[0]) * 0.5) last[1] = Math.max(last[1], b);
      else rows.push([t, b]);
    }
    const s = css(block);
    const orphans = Math.max(1, parseInt(s.orphans, 10) || 2);
    const widows = Math.max(1, parseInt(s.widows, 10) || 2);
    const n = rows.length;
    if (n < 2) continue;
    soft.push([rows[0][0], rows[Math.min(orphans, n) - 1][1]]);
    soft.push([rows[Math.max(0, n - widows)][0], rows[n - 1][1]]);
  }

  const all = items.concat(late);
  const end = all.reduce((v, it) => Math.max(v, it.bottom), 0);
  return { items: all, hard, soft, links, end };
}

// ── Pages ────────────────────────────────────────────────────────────────────

/** Merges bands that overlap (more than a hair) into runs that can't be broken. */
function merge(bands: Band[]): Band[] {
  const sorted = bands.slice().sort((a, b) => a[0] - b[0]);
  const out: Band[] = [];
  for (const [t, b] of sorted) {
    const last = out[out.length - 1];
    if (last && t < last[1] - 0.5) last[1] = Math.max(last[1], b);
    else out.push([t, b]);
  }
  return out;
}

/** The lowest place a page can end, at or above `limit`, outside every unbreakable run — or
 *  null if the run there starts right at the top of the page (it can't move to the next). */
function breakAt(runs: Band[], top: number, limit: number): number | null {
  for (const [a, b] of runs) {
    if (a >= limit) break;
    if (a < limit && limit < b) return a > top + 1 ? a : null;
  }
  return limit;
}

/** Where each page starts and ends on the long page (CSS px). */
function paginate(laid: Laid, height: number): Band[] {
  const strict = merge(laid.hard);
  const runs = merge(laid.hard.concat(laid.soft.filter(([a, b]) => b - a <= height)));
  const tops = laid.items.map((it) => it.top).sort((a, b) => a - b);
  const pages: Band[] = [];
  let top = 0;
  while (top < laid.end - 0.5 && pages.length < 500) {
    const limit = top + height;
    if (limit >= laid.end) {
      pages.push([top, laid.end]);
      break;
    }
    let cut = breakAt(runs, top, limit) ?? breakAt(strict, top, limit) ?? limit;
    if (cut <= top + 1) cut = limit;
    pages.push([top, cut]);
    // the next page starts with the next thing on it (the space between is the page break) —
    // or right where this one stopped, when it stopped partway through something
    const through = strict.some(([a, b]) => a < cut - 0.5 && b > cut + 0.5);
    const next = through ? cut : tops.find((t) => t >= cut - 0.5);
    if (next === undefined) break;
    top = Math.max(cut, next);
  }
  return pages.length ? pages : [[0, Math.max(laid.end, 1)]];
}

// ── Painting ─────────────────────────────────────────────────────────────────

/** A rounded rectangle's path. */
function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: Radii) {
  c.beginPath();
  if (w <= 0 || h <= 0) return;
  c.moveTo(x + r[0], y);
  c.lineTo(x + w - r[1], y);
  if (r[1]) c.arcTo(x + w, y, x + w, y + r[1], r[1]);
  c.lineTo(x + w, y + h - r[2]);
  if (r[2]) c.arcTo(x + w, y + h, x + w - r[2], y + h, r[2]);
  c.lineTo(x + r[3], y + h);
  if (r[3]) c.arcTo(x, y + h, x, y + h - r[3], r[3]);
  c.lineTo(x, y + r[0]);
  if (r[0]) c.arcTo(x, y, x + r[0], y, r[0]);
  c.closePath();
}

/** Paints onto one page (in CSS px of the long page; the page's transform does the rest). */
class Pen {
  private font = "";
  private spacing = "";
  private fonts = new Map<string, string>();

  constructor(readonly c: CanvasRenderingContext2D) {}

  reset() {
    this.font = "";
    this.spacing = "";
  }

  /** Sets a font — or, if the canvas won't take it as it is, the nearest it will. */
  private setFont(font: string) {
    if (font === this.font) return;
    let use = this.fonts.get(font);
    if (use === undefined) {
      const c = this.c;
      c.font = "1px a";
      const before = c.font;
      c.font = font;
      use = font;
      if (c.font === before) {
        use = font.replace(/^(\S+) (\d+)/, (_, st: string, w: string) => `${st} ${Math.min(900, Math.max(100, Math.round(Number(w) / 100) * 100))}`);
        c.font = use;
        if (c.font === before) use = font.replace(/^\S+ \S+ /, "");
      }
      this.fonts.set(font, use);
    }
    this.c.font = use;
    this.font = font;
  }

  private setSpacing(spacing: string) {
    if (!CAN_SPACE || spacing === this.spacing) return;
    (this.c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = spacing;
    this.spacing = spacing;
  }

  text(str: string, x: number, base: number, font: string, color: string, spacing: string) {
    this.setFont(font);
    this.setSpacing(spacing);
    this.c.fillStyle = color;
    this.c.fillText(str, x, base);
  }

  /** Text ending at `x` (a list number, which ends where its item begins). */
  textEnd(str: string, x: number, base: number, font: string, color: string) {
    this.setFont(font);
    this.setSpacing("0px");
    const c = this.c;
    c.fillStyle = color;
    c.textAlign = "right";
    c.fillText(str, x, base);
    c.textAlign = "left";
  }

  rect(x: number, y: number, w: number, h: number, color: string) {
    if (w <= 0 || h <= 0) return;
    this.c.fillStyle = color;
    this.c.fillRect(x, y, w, h);
  }

  bullet(type: string, x: number, y: number, d: number, color: string) {
    const c = this.c;
    if (type === "square") return this.rect(x, y, d, d, color);
    c.beginPath();
    c.arc(x + d / 2, y + d / 2, type === "circle" ? Math.max(0.1, d / 2 - 0.5) : d / 2, 0, Math.PI * 2);
    if (type === "circle") {
      c.lineWidth = 1;
      c.strokeStyle = color;
      c.stroke();
    } else {
      c.fillStyle = color;
      c.fill();
    }
  }

  box(x: number, y: number, w: number, h: number, radii: Radii, bg: string, edges: [Edge, Edge, Edge, Edge], rings: Ring[]) {
    const c = this.c;
    if (bg) {
      rounded(c, x, y, w, h, radii);
      c.fillStyle = bg;
      c.fill();
    }
    const [t, r, b, l] = edges;
    if (t.w && t.w === r.w && r.w === b.w && b.w === l.w && t.color === r.color && r.color === b.color && b.color === l.color && radii.some((v) => v > 0)) {
      // one even border, round rounded corners
      const k = t.w / 2;
      rounded(c, x + k, y + k, w - t.w, h - t.w, radii.map((v) => Math.max(0, v - k)) as Radii);
      c.lineWidth = t.w;
      c.strokeStyle = t.color;
      c.stroke();
    } else {
      if (t.w) this.rect(x, y, w, t.w, t.color);
      if (r.w) this.rect(x + w - r.w, y, r.w, h, r.color);
      if (b.w) this.rect(x, y + h - b.w, w, b.w, b.color);
      if (l.w) this.rect(x, y, l.w, h, l.color);
    }
    for (const g of rings) {
      const k = g.spread / 2;
      if (g.inset) rounded(c, x + k, y + k, w - g.spread, h - g.spread, radii.map((v) => Math.max(0, v - k)) as Radii);
      else rounded(c, x - k, y - k, w + g.spread, h + g.spread, radii.map((v) => (v > 0 ? v + k : 0)) as Radii);
      c.lineWidth = g.spread;
      c.strokeStyle = g.color;
      c.stroke();
    }
  }

  picture(img: HTMLImageElement, x: number, y: number, w: number, h: number, clips: Clip[]) {
    const c = this.c;
    c.save();
    for (const k of clips) {
      rounded(c, k.x, k.y, k.w, k.h, k.radii);
      c.clip();
    }
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    try {
      c.drawImage(img, x, y, w, h);
    } catch {
      /* (a picture that won't draw is left out) */
    }
    c.restore();
  }

  /** A checkbox's tick: an L, turned. */
  tick(cx: number, cy: number, w: number, h: number, lw: number, turn: [number, number, number, number], color: string) {
    const c = this.c;
    c.save();
    c.translate(cx, cy);
    c.transform(turn[0], turn[1], turn[2], turn[3], 0, 0);
    c.beginPath();
    c.moveTo(-w / 2 + lw / 2, -h / 2);
    c.lineTo(-w / 2 + lw / 2, h / 2 - lw / 2);
    c.lineTo(w / 2, h / 2 - lw / 2);
    c.lineWidth = lw;
    c.lineCap = "butt";
    c.lineJoin = "miter";
    c.strokeStyle = color;
    c.stroke();
    c.restore();
  }
}

type Geometry = { pageW: number; pageH: number; left: number; top: number };

/** Paints each page and keeps it as a picture (with its links). */
async function paint(laid: Laid, pages: Band[], g: Geometry, paper: Paper): Promise<Sheet[]> {
  const W = Math.round(g.pageW * SCALE);
  const H = Math.round(g.pageH * SCALE);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas to paint the pages on");
  const pen = new Pen(ctx);
  const tops = pages.map(([t]) => t);
  const pageOf = (y: number) => {
    let i = 0;
    while (i + 1 < tops.length && tops[i + 1] <= y + 0.5) i++;
    return i;
  };
  const whole: Item[][] = pages.map(() => []);
  for (const it of laid.items) if (!it.slice) whole[pageOf(it.top)].push(it);
  const linksOn: Sheet["links"][] = pages.map(() => []);
  for (const l of laid.links) {
    const i = pageOf(l.y);
    const top = pages[i][0];
    const x1 = (g.left + l.x) / PX;
    const x2 = (g.left + l.x + l.w) / PX;
    const y2 = paper.h - (g.top + l.y - top) / PX;
    const y1 = paper.h - (g.top + l.y + l.h - top) / PX;
    linksOn[i].push({ rect: [x1, y1, x2, y2], uri: l.uri });
  }
  const sheets: Sheet[] = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      const [top, bottom] = pages[i];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
      ctx.setTransform(SCALE, 0, 0, SCALE, SCALE * g.left, SCALE * (g.top - top));
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.direction = "ltr";
      pen.reset();
      // the boxes and pictures first (each cut to this page), then the words over them
      for (const it of laid.items) {
        if (!it.slice || it.bottom <= top || it.top >= bottom) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(-g.left, top, g.pageW, bottom - top);
        ctx.clip();
        it.draw(pen);
        ctx.restore();
      }
      for (const it of whole[i]) it.draw(pen);
      sheets.push({ picture: await encode(canvas, ctx, W, H), links: linksOn[i] });
      // (a breath between pages, so the screen keeps moving)
      await wait(0);
    }
  } finally {
    // (a canvas this size is a lot of memory on a phone: let it go now)
    canvas.width = canvas.height = 0;
  }
  return sheets;
}

/** A page's picture: lossless (in grey when it's all ink and paper), or a fine JPEG where the
 *  browser can't compress. */
async function encode(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, W: number, H: number): Promise<Picture> {
  if (typeof CompressionStream === "function") {
    try {
      const px = ctx.getImageData(0, 0, W, H).data;
      const gray = isGray(px);
      const raw = gray ? toGray(px) : toRgb(px);
      return { data: await deflate(raw), filter: "FlateDecode", gray, w: W, h: H };
    } catch {
      /* (and if that fails, a JPEG) */
    }
  }
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
  if (!blob) throw new Error("A page wouldn't encode");
  return { data: new Uint8Array(await blob.arrayBuffer()), filter: "DCTDecode", gray: false, w: W, h: H };
}

function isGray(px: Uint8ClampedArray): boolean {
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    if (r - g > 10 || g - r > 10 || g - b > 10 || b - g > 10 || r - b > 10 || b - r > 10) return false;
  }
  return true;
}

function toGray(px: Uint8ClampedArray): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) out[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
  return out;
}

function toRgb(px: Uint8ClampedArray): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array((px.length / 4) * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    out[j] = px[i];
    out[j + 1] = px[i + 1];
    out[j + 2] = px[i + 2];
  }
  return out;
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ── The PDF ──────────────────────────────────────────────────────────────────

const num = (v: number) => String(Math.round(v * 100) / 100);

/** A PDF string: plain when it's plain ASCII, else UTF-16 (as titles in any language need). */
function pdfText(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

/** Binds the pages into a PDF: each page its picture, its links laid over it. */
function bind(sheets: Sheet[], paper: Paper, title: string): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const put = (p: string | Uint8Array<ArrayBuffer>) => {
    const b = typeof p === "string" ? enc.encode(p) : p;
    parts.push(b);
    pos += b.length;
  };
  let count = 0;
  const alloc = () => ++count;
  const obj = (n: number, body: string) => {
    offsets[n] = pos;
    put(`${n} 0 obj\n${body}\nendobj\n`);
  };
  const stream = (n: number, dict: string, data: Uint8Array<ArrayBuffer>) => {
    offsets[n] = pos;
    put(`${n} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`);
    put(data);
    put("\nendstream\nendobj\n");
  };

  put("%PDF-1.4\n");
  put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const catalog = alloc();
  const tree = alloc();
  const info = alloc();
  const kids: number[] = [];
  for (const sheet of sheets) {
    const page = alloc();
    const content = alloc();
    const image = alloc();
    const annots = sheet.links.map(() => alloc());
    kids.push(page);
    const p = sheet.picture;
    stream(image, `/Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /${p.gray ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /${p.filter}`, p.data);
    stream(content, "", enc.encode(`q ${num(paper.w)} 0 0 ${num(paper.h)} 0 0 cm /Im0 Do Q`));
    sheet.links.forEach((l, i) => obj(annots[i], `<< /Type /Annot /Subtype /Link /Rect [${l.rect.map(num).join(" ")}] /Border [0 0 0] /A << /S /URI /URI ${pdfText(l.uri)} >> >>`));
    obj(
      page,
      `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${num(paper.w)} ${num(paper.h)}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R${annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(" ")}]` : ""} >>`,
    );
  }
  obj(tree, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  obj(catalog, `<< /Type /Catalog /Pages ${tree} 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`);
  const d = new Date();
  const p2 = (v: number) => String(v).padStart(2, "0");
  const stamp = `D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  obj(info, `<< /Title ${pdfText(title || "Untitled")} /Producer (umbra) /Creator (umbra) /CreationDate (${stamp}) >>`);
  const xref = pos;
  let table = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= count; n++) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  put(table);
  put(`trailer\n<< /Size ${count + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}
