import { Node, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { addImage, imageUrl, type ImageAttrs, type ImageAuth } from "../../lib/images";
import { openLightbox } from "../../fx/lightbox";
import { toast } from "../../store/toasts";
import { play } from "../../lib/sound";
import { fx } from "../../fx/engine";

export type ImageOptions = {
  /** How pictures added here may be uploaded (null: keep them on this device for now). */
  auth: () => ImageAuth | null;
};

const PH_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files].filter((f) => f.type.startsWith("image/"));
}

/** Adds pictures to a note — from a paste, a drop, or the file picker. */
export async function insertImageFiles(editor: Editor, files: File[], pos?: number) {
  const ext = editor.extensionManager.extensions.find((e) => e.name === "image");
  const auth = (ext?.options as ImageOptions | undefined)?.auth?.() ?? null;
  let at = pos;
  for (const file of files.slice(0, 12)) {
    let attrs: ImageAttrs;
    try {
      attrs = await addImage(file, auth);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't add that image", { tone: "error" });
      continue;
    }
    if (editor.isDestroyed) return;
    const where = at ?? editor.state.selection.to;
    editor.chain().focus().insertContentAt(where, { type: "image", attrs }).run();
    at = undefined;
    play("pop");
  }
}

/** Opens the system picker (photos and camera on a phone) and adds what you choose. */
export function pickImages(editor: Editor) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.style.cssText = "position:fixed;left:-9999px;opacity:0";
  document.body.appendChild(input);
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    input.remove();
    if (files.length) void insertImageFiles(editor, files);
  });
  input.addEventListener("cancel", () => input.remove());
  input.click();
}

/**
 * A picture in a note. Its blurry stand-in shows at once (so nothing jumps as it loads), then
 * the real image develops in over it. Double-click (or the corner button) opens it full-screen.
 */
export const NoteImage = Node.create<ImageOptions>({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { auth: () => null };
  },

  addAttributes() {
    return {
      id: { default: null },
      key: { default: null },
      w: { default: 0 },
      h: { default: 0 },
      ph: { default: "" },
      alt: { default: "" },
      type: { default: "image/webp" },
    };
  },

  parseHTML() {
    return [{ tag: "figure[data-umbra-image]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["figure", { "data-umbra-image": HTMLAttributes.id ?? "", class: "note-image" }];
  },

  addNodeView() {
    return ({ node, editor }) => {
      let current = node;
      const dom = document.createElement("figure");
      dom.className = "note-image";
      dom.contentEditable = "false";
      dom.draggable = true;
      const frame = document.createElement("div");
      frame.className = "note-image-frame";
      const ph = document.createElement("img");
      ph.className = "note-image-ph";
      ph.alt = "";
      ph.setAttribute("aria-hidden", "true");
      const img = document.createElement("img");
      img.className = "note-image-img";
      img.decoding = "async";
      img.draggable = false;
      const status = document.createElement("span");
      status.className = "note-image-status";
      const zoom = document.createElement("button");
      zoom.type = "button";
      zoom.className = "note-image-zoom";
      zoom.setAttribute("aria-label", "View full size");
      zoom.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
      frame.append(ph, img, status, zoom);
      dom.append(frame);

      const apply = (n: typeof node) => {
        const w = Number(n.attrs.w) || 0;
        const h = Number(n.attrs.h) || 0;
        frame.style.setProperty("--ratio", String(w && h ? w / h : 1.5));
        frame.style.setProperty("--w", w ? `${w}px` : "100%");
        const src = typeof n.attrs.ph === "string" && PH_RE.test(n.attrs.ph) ? n.attrs.ph : "";
        if (ph.getAttribute("src") !== src) {
          if (src) ph.src = src;
          else ph.removeAttribute("src");
        }
        img.alt = typeof n.attrs.alt === "string" ? n.attrs.alt : "";
      };

      let token = 0;
      let retry = 0;
      const load = (n: typeof node) => {
        const t = ++token;
        window.clearTimeout(retry);
        if (dom.dataset.state !== "ready") dom.dataset.state = "loading";
        void imageUrl({ id: String(n.attrs.id ?? ""), key: String(n.attrs.key ?? ""), type: String(n.attrs.type ?? "image/webp") }).then((url) => {
          if (t !== token) return;
          if (!url) {
            // Not here yet (still on its way up from another device): keep the stand-in, try again.
            dom.dataset.state = "waiting";
            status.textContent = "On its way…";
            retry = window.setTimeout(() => load(current), 12_000);
            return;
          }
          const fresh = img.getAttribute("src") !== url;
          img.src = url;
          const done = () => {
            if (t !== token) return;
            dom.dataset.state = "ready";
            status.textContent = "";
          };
          if (fresh) img.decode().then(done, done);
          else done();
        });
      };

      apply(node);
      load(node);

      const open = () => {
        if (dom.dataset.state === "ready") openLightbox(img);
      };
      zoom.addEventListener("mousedown", (e) => e.preventDefault());
      zoom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        open();
      });
      // Reading: a click opens it. Writing: a click selects it (to move or delete), a double-click opens it.
      img.addEventListener("click", () => {
        if (!editor.isEditable) open();
      });
      img.addEventListener("dblclick", open);

      return {
        dom,
        update: (n) => {
          if (n.type !== current.type) return false;
          const changed = n.attrs.id !== current.attrs.id || n.attrs.key !== current.attrs.key;
          current = n;
          apply(n);
          if (changed) load(n);
          return true;
        },
        selectNode: () => {
          dom.classList.add("is-selected");
          if (fx.active && dom.dataset.state === "ready") {
            const r = dom.getBoundingClientRect();
            if (r.width) fx.flash(r.left + r.width / 2, r.top + r.height / 2, Math.max(r.width, r.height) * 0.4, { dur: 420, alpha: 0.08 });
          }
        },
        deselectNode: () => dom.classList.remove("is-selected"),
        stopEvent: (e) => Boolean((e.target as HTMLElement | null)?.closest?.(".note-image-zoom")),
        ignoreMutation: () => true,
        destroy: () => {
          token++;
          window.clearTimeout(retry);
        },
      };
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("umbraImages"),
        props: {
          handlePaste: (_view, event) => {
            if (!editor.isEditable) return false;
            const files = imageFiles(event.clipboardData);
            if (!files.length) return false;
            event.preventDefault();
            void insertImageFiles(editor, files);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved || !editor.isEditable) return false;
            const files = imageFiles(event.dataTransfer);
            if (!files.length) return false;
            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            void insertImageFiles(editor, files, pos);
            return true;
          },
        },
      }),
    ];
  },
});
