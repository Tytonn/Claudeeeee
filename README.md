# umbra

**A quiet place to write.** A minimal, dark note-taking site with an optional to-do list, countdowns, and live, end-to-end encrypted sharing.

![umbra](public/og.png)

---

## What's inside

**Notes**
- A calm rich-text editor: type <kbd>/</kbd> for blocks (headings, lists, checklists, quotes, code, dividers, today's date), select text for a formatting bubble, or just write Markdown (`#`, `-`, `[]`, `>`, ```` ``` ````, `==highlight==`).
- Code blocks with syntax highlighting, smart quotes and dashes, links (<kbd>Ctrl/⌘</kbd>+click to open).
- Saves instantly as you type. Pin, duplicate, copy as Markdown, download `.md`, trash with undo (auto-empties after 30 days).
- Empty notes clean themselves up. Your place in each note is remembered.

**To-dos** *(optional)*
- Check things off with a little tick, a burst, and a strike-through that draws itself.
- <kbd>Enter</kbd> adds the next one, drag the handle to reorder, completed items tuck away.

**Countdowns** *(optional)*
- Type naturally: *"Tokyo trip dec 20"*, *"Mom's birthday march 3"*, *"Flight in 3 days at 7am"* — the date is understood as you type. Or pick one from the calendar.
- Birthdays and anniversaries repeat yearly automatically (and show which one it is — *58th*).
- Under 24 hours it ticks live. Each countdown has a tiny eclipse: the moon slides across the sun as the day approaches, and on the day it's total.

**Sharing**
- Hit **Share** on a note to make a live link — optionally including your to-do list and countdowns. Or share just your lists from the side panel.
- Links are **end-to-end encrypted**: the key lives in the part of the link after `#`, which browsers never send to servers. Netlify only ever stores scrambled data.
- It's live: your friend sees your edits a few seconds after you make them. Stop sharing any time and the link dies instantly.
- Friends can **Save a copy** into their own umbra.

**Everything else**
- Command palette (<kbd>Ctrl/⌘ K</kbd>) for searching notes and running any command.
- Focus mode, fade-while-typing, 7 accent colors, 3 writing fonts (Sans / Serif / Mono), 3 text sizes, optional sounds.
- Works on phones, prints cleanly, keyboard-first everywhere (press <kbd>?</kbd>).

---

## Put it on Netlify

Sharing runs on **Netlify Functions + Netlify Blobs**, which are built into every Netlify site — there's no database to create, no extra account, and no keys or environment variables to set.

1. In Netlify: **Add new site → Import an existing project → GitHub**, and pick this repository.
2. Choose the branch to deploy (this work lives on `claude/hopeful-cannon-gv8qok` — or merge it into `main` first).
3. Leave the build settings as they are — Netlify reads them from [`netlify.toml`](netlify.toml) (`npm run build`, publish `dist`, functions in `netlify/functions`). Click **Deploy**.

Already have a Netlify site you want to reuse? Open it → **Site configuration → Build & deploy → Continuous deployment → Link repository**, and pick this repo/branch.

> Use a Git-connected deploy (as above) rather than drag-and-drop: dragging a built `dist` folder onto Netlify only publishes static files, so the sharing function wouldn't exist.

---

## Your data

- Notes, to-dos, and countdowns live **privately in your browser** (IndexedDB) on the device you're using. Nothing is uploaded unless you share it.
- Clearing your browser's site data erases them, so export a backup now and then: **Settings → Your data → Export**. **Import** restores it (or moves it to another device/browser).
- Shared links are stored on Netlify (encrypted) until you stop sharing. Manage them in **Settings → Sharing → Live links**.

---

## Keyboard shortcuts

| | |
|---|---|
| Search & commands | <kbd>Ctrl/⌘</kbd> <kbd>K</kbd> |
| New note | <kbd>Alt/⌥</kbd> <kbd>N</kbd> |
| Previous / next note | <kbd>Alt/⌥</kbd> <kbd>↑</kbd> <kbd>↓</kbd> |
| Toggle sidebar / side panel | <kbd>Ctrl/⌘</kbd> <kbd>\\</kbd> · <kbd>Ctrl/⌘</kbd> <kbd>.</kbd> |
| Focus mode | <kbd>Ctrl/⌘</kbd> <kbd>Shift</kbd> <kbd>F</kbd> |
| Settings | <kbd>Ctrl/⌘</kbd> <kbd>,</kbd> |
| Blocks menu | <kbd>/</kbd> |
| Link (with text selected) | <kbd>Ctrl/⌘</kbd> <kbd>K</kbd> |
| All shortcuts | <kbd>?</kbd> |

---

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The Netlify Vite plugin emulates Functions and Blobs locally, so sharing works on your machine too.

```bash
npm run build
```

```bash
npm run typecheck
```

---

## How sharing works (for the curious)

1. Your browser builds the shared content (note + optional lists), gzips it, and encrypts it with a fresh random **AES-GCM** key.
2. It sends only the ciphertext to `POST /api/shares` ([`netlify/functions/shares.mts`](netlify/functions/shares.mts)), which stores it in a Netlify Blobs store with strong consistency and returns a short id plus a secret **edit token** (kept only as a hash on the server).
3. The link is `https://your-site/s/<id>#<key>`. Everything after `#` stays in the browser.
4. As you edit, your browser re-encrypts and `PUT`s updates with the edit token (debounced, conditional writes so nothing clobbers). Viewers poll with `ETag`/`304`, every 4s while things change, easing off to 30s when quiet, and pausing in background tabs.
5. **Stop sharing** deletes the blob — the link stops working everywhere.

---

## Make it yours

- **Name:** the wordmark is plain text — search for `umbra` in `index.html`, `src/`, and `public/manifest.webmanifest`.
- **Default accent / settings:** `DEFAULT_SETTINGS` in [`src/store/app.ts`](src/store/app.ts); the palette lives in [`src/lib/theme.ts`](src/lib/theme.ts).
- **Design tokens** (colors, type, radii, motion): the top of [`src/styles/base.css`](src/styles/base.css).

## Project layout

```
netlify/functions/shares.mts   share API (Netlify Functions + Blobs)
src/
  components/                  app shell, sidebar, top bar, side panel
    editor/                    TipTap editor, slash menu, formatting bubble
    widgets/                   to-dos, countdowns, date picker
    overlays/                  command palette, settings, share sheet, toasts
    ui/                        primitives (tooltip, popover, menu, switch, eclipse…)
  share/ShareView.tsx          what your friend sees
  store/                       state, IndexedDB persistence, live share sync
  lib/                         crypto, dates, markdown export, sounds, theme
  styles/                      design system + component styles
```

Built with React, TipTap, Motion, Zustand, Floating UI, chrono-node, and the Geist + Instrument Serif + Newsreader typefaces.
