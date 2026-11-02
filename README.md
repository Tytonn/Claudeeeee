# umbra

**A quiet place to write — under a total eclipse.** A dark, cinematic note-taking site with a living light show, an optional to-do list, countdowns, and live, end-to-end encrypted sharing.

![umbra](public/og.png)

---

## What's inside

**The light show**
- A living sky behind everything (WebGL): a drifting nebula with glowing filaments and dark dust lanes, three depths of twinkling stars that shift with your cursor, and shooting stars — now and then a fireball or a little meteor shower.
- The editor is the moon in a total eclipse. A solar corona pours out from behind it in long, flowing streamers, swings toward your cursor, and throws off coronal loops. The side panels are smoked glass, so you see the sky through them.
- Your cursor is a light source: panels catch a rim of light where it passes, countdown cards tilt toward it and cast shadows away from it.
- Writing: a caret made of light, letters that land white-hot and cool to ink, erased letters that fall away as ash, and a sunburst every 100 words. While you type, the sky calms down so it never gets in the way.
- **New note:** the diamond ring — a blinding flash on the moon's rim, lens flare, a shockwave through the sky.
- **Delete the open note:** the moon slides across and swallows it. Anything else you delete dissolves into embers.
- **Check off a to-do:** a sunburst, then it burns away and its light streaks into *Completed*.
- **Share:** a beam of light goes up and the link decodes itself out of cipher glyphs. Your friend's page opens under a vast eclipsed moon; the note decrypts with a scanning line, the diamond ring flashes, and the corona flares whenever you edit.
- Plus: a short eclipse intro once per visit (followed by an invitation to sign in, if you aren't), a light trail when you switch notes, the new accent color flooding the screen from the swatch you clicked, a live clock, and a sky that slowly wakes up if you leave it alone.
- **Settings → Effects:** *Cosmic* (everything), *Subtle* (a calm sky and small flourishes) or *Off*. If your system asks for reduced motion, umbra uses *Subtle* automatically.
- **Settings → Background:** *Dark* (smoked glass), *Glass* (more sky), *Clear* (the sky almost fully, with a soft shade behind your words) or *Crystal* (no glass at all — just outlines over the open sky, with a crisp little drop shadow behind every word). Also in the command palette: *Show more of the sky*.
- **Settings → Text color:** six soft inks, or pick any color you like (very dark picks get lifted so they stay readable).

**Rain** *(Settings → Scene → Rain; the eclipse stays the default)*
- A night city seen through a rain-streaked window, all drawn live on the GPU — no images or video. The city is out of focus, the way it is when your eyes are on the glass: bokeh from windows, streetlamps, neon signs (one in your accent color), traffic sliding along a wet street with its reflections smeared down the road, blinking warning lights on the towers, mist, and rain falling through the lamplight.
- On the glass: beads of rain that land and slowly shrink away, and drops that gather, break free and run down in fits and starts — leaving a clear, glistening trail dotted with tiny beads. Every drop is a little lens: it shows the city upside down, small and sharp, with dark edges. The rest of the pane is fogged.
- Your cursor is a warm light held near the glass: drops glint as it passes and the fog glows around it.
- **Lightning** *(toggle)*: now and then a storm flickers in the clouds or a bolt comes down behind the skyline; every drop on the glass lights up and the room brightens for an instant. Never while you're typing, never more than three flickers a second, and never with reduced motion.
- **City lights** *(toggle)*: the city fades out, leaving just the rain and the dark.
- **How hard it rains:** *Drizzle* (clear glass, a few beads), *Rain*, or *Downpour* (misted up, drops running everywhere).
- **Blur:** how out of focus the city is — from crisp bokeh to a soft, dreamy glow (fully blurred by default). It's real defocus, worked out for every pixel (not a blurred picture), so it stays smooth at any setting; the rain outside softens a little less, and the drops on the glass always stay sharp.
- Drawn sharp: the glass at up to twice your screen's pixel density, the city at about its full resolution (and only 30 times a second, since it barely moves), the rain as fine anti-aliased streaks.
- **Rain sound** *(off by default, just on the device you turn it on)*: quiet, close rain, like an ASMR recording — a soft hush built from thousands of tiny drops a second, light patter on the glass, now and then a single drop by your left or right ear (a tick, a tap, a plip into a puddle), and low thunder rolling in a few seconds after the lightning you see. It's all synthesized at full fidelity (no recordings), has its own volume slider, and fades out whenever the tab is hidden.
- Everything else goes wet too: a new note brings the lightning close; checking a to-do is a splash (ripples, a crown of droplets); erased letters run off the page like drips; deleting a note washes it away from the top; other things you delete are rinsed off in drops; sharing calls down a bolt; the intro writes *umbra* into the fogged glass; and the little sounds become drips and bubbles.
- It switches over with a sheet of rain running down the screen. Command palette: *Make it rain*, *Back to the eclipse*, and toggles for lightning, city lights and sound.
- Like the eclipse, it pauses completely when the tab is hidden, drops to ~30 fps while you type, and lowers its resolution on its own if a device struggles.

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

**Accounts & sync** *(optional)*
- Create an account (a username and password — no email) and your notes, lists, shared links and settings follow you to every device you sign in on. Signing up is a little eclipse: the moon slides across as you fill it in, the corona grows with your password's strength, and your keys are forged at totality.
- **End-to-end encrypted.** Your password never leaves your browser; it's stretched (PBKDF2, 600k rounds) into a key that proves it's you and one that unlocks your data key. Netlify only ever stores ciphertext — so nobody can read your notes, and nobody can reset a forgotten password either.
- Signing in on a device that already has notes merges them (no duplicates of the welcome note or the starter to-dos). If two devices change the same note, the newer edit wins.

**Sharing & writing together**
- Hit **Share** on a note to make a live link — optionally including your to-do list and countdowns. Or share just your lists from the side panel.
- **Write together, like Google Docs.** With *Friends can edit* on (the default), whoever has the link can edit the note with you at the same time. You see each other's cursors with names, who's here, and each other's words arrive within about a second. Typing in the same sentence at once merges cleanly (it's a CRDT, via Yjs). Turn *Friends can edit* off to make the link view-only — it still updates live.
- Links are **end-to-end encrypted**: the key lives in the part of the link after `#`, which browsers never send to servers. Netlify only ever stores scrambled data — including every live edit.
- Stop sharing any time and the link dies instantly (the live copy on the server is deleted; your note keeps every word).
- **Who can open it — like a doc's Share dialog.** *Anyone with the link*, or *Only people I let in* (they sign in and ask; you get a toast and a badge and tap *Let in*). Everyone who opens your link while signed in shows up in the Share panel, where you can switch them between *Can edit* and *Can view*, or **remove their access at any moment** — the server turns them away on their very next request.
- **Shared with you:** every note someone shares with you lands in a *Shared with you* section in your sidebar (synced to your account), and opens right inside your editor — live, with their cursor.
- Friends can **Save a copy** into their own umbra. To-do lists and countdowns in a link are view-only.

**Everything else**
- Command palette (<kbd>Ctrl/⌘ K</kbd>) for searching notes and running any command.
- Focus mode, fade-while-typing, 7 accent colors (each one recolors the whole sky), 3 writing fonts (Sans / Serif / Mono), 3 text sizes, 3 effect levels, optional sounds.
- Works on phones, prints cleanly, keyboard-first everywhere (press <kbd>?</kbd>).
- On a phone it moves like a native app: the list and a note slide over each other, search is a button up top that opens with the keyboard ready, and added to the Home Screen it fills the whole screen, edge to edge.

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

- Notes, to-dos, and countdowns live **privately in your browser** (IndexedDB) on the device you're using. Nothing is uploaded unless you share it — or sign in to sync, in which case it's uploaded end-to-end encrypted with a key only your password can unlock.
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

**Live notes (co-editing).** Each shared note becomes a [Yjs](https://yjs.dev) document. Every change anyone makes is a tiny update, encrypted in the browser with the link's key and appended to a log in Netlify Blobs by [`netlify/functions/collab.mts`](netlify/functions/collab.mts); everyone pulls what's new and merges it. The log is folded into an encrypted snapshot every ~120 changes so joining stays quick. Anyone holding the whole link can write (the server checks a token derived from the key, never the key itself); the owner can switch that off. Netlify has no websockets, so it polls — about twice a second while you're both in the note, every few seconds when you're alone, once a minute for shared notes you don't have open, and not at all in a background tab. Two people using it for a while each day stays comfortably inside Netlify's free plan.

**The link itself.**

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
- **The sky and effects:** the WebGL sky (nebula, stars, corona) is one shader in [`src/fx/shaders.ts`](src/fx/shaders.ts); the rain is two passes in [`src/fx/rain.ts`](src/fx/rain.ts) (the city into a mipmapped texture, then the glass); everything else (meteors, flares, lightning timing, splashes, particles, trails) is in [`src/fx/engine.ts`](src/fx/engine.ts). The rain sound is [`src/lib/ambience.ts`](src/lib/ambience.ts). Each accent's nebula color is in [`src/lib/theme.ts`](src/lib/theme.ts).

## Project layout

```
netlify/functions/shares.mts   share API (Netlify Functions + Blobs)
netlify/functions/collab.mts   live co-editing log for shared notes
netlify/functions/people.mts   who can open a link (access list, approvals, removals)
netlify/functions/account.mts  accounts (sign up / in / out)
netlify/functions/sync.mts     encrypted sync of your notes across devices
netlify/lib/common.ts          shared helpers: sessions, access checks
src/
  components/                  app shell, sidebar, top bar, side panel
    editor/                    TipTap editor, slash menu, formatting bubble
    widgets/                   to-dos, countdowns, date picker
    overlays/                  command palette, settings, share sheet, toasts
    ui/                        primitives (tooltip, popover, menu, switch, eclipse…)
  fx/                          the light engine: WebGL sky (eclipse + rain), effects overlay, intro, light caret
  collab/                      live co-editing: sync engine, owner sessions, title binding
  account/                     accounts, the sign-in eclipse, cross-device sync
  share/ShareView.tsx          what your friend sees
  store/                       state, IndexedDB persistence, live share sync
  lib/                         crypto, dates, markdown export, sounds, rain ambience, theme
  styles/                      design system + component styles
```

Built with React, TipTap, Yjs, Motion, Zustand, Floating UI, chrono-node, WebGL and Canvas, and the Geist + Instrument Serif + Newsreader typefaces.
