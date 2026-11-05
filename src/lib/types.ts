import type { JSONContent } from "@tiptap/core";

export type Note = {
  id: string;
  title: string;
  doc: JSONContent | null;
  /** Plain-text projection of `doc`, used for previews + search. */
  text: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  deletedAt?: number | null;
  /** The group (folder) it's filed in, if any. */
  groupId?: string | null;
  /** Kept out of the list and search until hidden notes are unlocked with the PIN. */
  hidden?: boolean;
  /** This note's own title look (right-click its title); anything left out follows Settings. */
  titleStyle?: TitleStyle | null;
};

/** A named group of notes in the sidebar. */
export type NoteGroup = {
  id: string;
  name: string;
  collapsed?: boolean;
  createdAt: number;
  updatedAt: number;
};

/** The colors a to-do can be tagged with (and grouped by). */
export type TodoColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple";

export type Todo = {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
  doneAt?: number | null;
  color?: TodoColor | null;
};

/**
 * The PIN for hidden notes — never the PIN itself, only a salted, stretched hash of it
 * (and, with an account, synced end-to-end encrypted like everything else).
 */
export type Vault = { v: 1; salt: string; hash: string; iter: number; updatedAt: number };

export type Countdown = {
  id: string;
  title: string;
  /** Local calendar date, YYYY-MM-DD. For yearly events the year is the original one. */
  date: string;
  /** Optional local time, HH:MM (24h). */
  time?: string | null;
  repeat?: "yearly" | null;
  createdAt: number;
  updatedAt: number;
};

export type AccentId = "iris" | "moon" | "sky" | "mint" | "corona" | "ember" | "rose";
/** The note title's typeface. */
export type TitleFontId = "display" | "italic" | "serif" | "sans" | "mono";
export type TitleSizeId = "s" | "m" | "l" | "xl";
export type TitleAlignId = "left" | "center";
/** A title's look: its typeface, size and alignment (each optional: the rest come from Settings). */
export type TitleStyle = { font?: TitleFontId; size?: TitleSizeId; align?: TitleAlignId };
/** The solar eclipse's corona: Pearl is its natural light. */
export type SolarTintId = "pearl" | "gold" | "ember" | "rose" | "violet" | "ice" | "mint";
export type FontId = "sans" | "serif" | "mono";
export type SizeId = "s" | "m" | "l";
export type EffectsId = "cosmic" | "subtle" | "off";
/** How much of the sky shows through the panels. */
export type BackdropId = "dark" | "glass" | "clear" | "crystal" | "bare";
/** What's behind the glass: deep space round the eclipse (shown as "Galaxy"), a night city in the rain, a total solar eclipse over the clouds, ink in water, or a summer sky full of clouds. */
export type SceneId = "eclipse" | "rain" | "solar" | "ink" | "sky";
/** The Sky's colours (scenes/sky/palettes.ts). */
export type SkyPaletteId = "azure" | "pastel" | "golden" | "sunset" | "twilight";
export type RainAmountId = "drizzle" | "rain" | "downpour";

/** A profile picture: which account it's for, and the (encrypted, stored-once) image — see lib/images.ts. */
export type ProfilePicture = { uid: string; id: string; key: string; type: string };

export function normalizeAvatar(raw: unknown): ProfilePicture | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.uid !== "string" || !a.uid || a.uid.length > 64) return null;
  if (typeof a.id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(a.id)) return null;
  if (typeof a.key !== "string" || a.key.length < 40 || a.key.length > 64) return null;
  if (typeof a.type !== "string" || !/^image\/(webp|jpeg|png)$/.test(a.type)) return null;
  return { uid: a.uid, id: a.id, key: a.key, type: a.type };
}

export type Settings = {
  accent: AccentId;
  font: FontId;
  /** The typeface of every note's title. */
  titleFont: TitleFontId;
  /** Every title's size and alignment, unless a note has its own (right-click a title → Use for all notes). */
  titleSize: TitleSizeId;
  titleAlign: TitleAlignId;
  size: SizeId;
  todos: boolean;
  countdowns: boolean;
  sounds: boolean;
  fadeWhileTyping: boolean;
  effects: EffectsId;
  backdrop: BackdropId;
  scene: SceneId;
  /** Rain: lightning now and then. */
  lightning: boolean;
  /** Rain: the blurred lights of the city behind the glass. */
  cityLights: boolean;
  rainAmount: RainAmountId;
  /** Rain: how out of focus the city is, 0..1 (fully, by default). */
  cityBlur: number;
  /** Galaxy: an eclipse of its own — a moon hanging in the sky beside your writing, the corona
   *  streaming out round it into the nebula (off by default: the note is the moon). */
  galaxyEclipse: boolean;
  /** Galaxy (with its eclipse): where the eclipse hangs — beside your writing, or right in the middle of the screen, behind it. */
  galaxyEclipseSpot: "beside" | "middle";
  /** Solar eclipse: the clouds drifting below it (and the thin high ones that cross it). */
  solarClouds: boolean;
  /** Solar eclipse: how close it looks, 0 (far off) .. 1 (close); 0.5 by default. */
  solarSize: number;
  /** Solar eclipse: the pearly corona in a dusky sky, or a golden ring of fire with the diamond ring blazing, in a warm, smoky sky. */
  solarLook: "corona" | "golden";
  /** Solar eclipse (Corona look): the colour of the corona. */
  solarTint: SolarTintId;
  /** Solar eclipse: the Golden look has turned the accent gold once already. It does that only the
   *  first time it's chosen — after that the accent stays whatever you've picked. */
  solarGoldenTried: boolean;
  /** A small version number next to the logo (for screenshots). */
  showVersion: boolean;
  /** The cursor as a light: the glow on the glass and panel edges that follows it. */
  cursorLight: boolean;
  /** Ink: each letter you type lands in wet, blue-black ink and dries to the page's own tone — off
   *  unless you turn it on. (It was `inkSettle`, on by default; that's set aside, so everyone starts
   *  with it off.) */
  inkLetters: boolean;
  /** Ink: the ink in the water — charcoal and indigo, or with drops of your accent among them. */
  inkColours: "sumi" | "accent";
  /** Ink: how finely the ink in the water is drawn (sharper asks more of the graphics card). (A "max" saved by v1.15 reads as high.) */
  inkDetail: "standard" | "high";
  /** Ink by night: dark water instead of paper — the ink glowing pale in it, and the whole
   *  interface dark to match (off: paper). */
  inkDark: boolean;
  /** Sky: its colours — one of the palettes, or "auto": whichever suits the time of day. */
  skyColours: SkyPaletteId | "auto";
  /** Sky: how cloudy, 0 (a few wisps) .. 1 (heaped with cloud). */
  skyClouds: number;
  /** Sky: how fast the wind carries the clouds, 0 (barely moving) .. 1 (racing); 0.5 by default. */
  skyWind: number;
  /** Show milliseconds on the clock (off by default)… */
  clockMs: boolean;
  /** …to this many digits. */
  clockMsDigits: 1 | 2 | 3;
  /** Show to-dos in sections, one per color. */
  todoGroups: boolean;
  /** Your names for the to-do colors ("Work", "Home"…). */
  todoLabels: Partial<Record<TodoColor, string>>;
  /** Your profile picture — shown to the others in a note you're writing together. Belongs to
   *  the account it was set for (`uid`); the picture itself is stored encrypted, like a note's. */
  avatar: ProfilePicture | null;
  sidebar: boolean;
  rail: boolean;
};

/** A live link the owner can keep updating or revoke. Keyed by anchor (note id or "board"). */
export type ShareRecord = {
  anchor: string;
  id: string;
  token: string;
  key: string;
  includeTodos: boolean;
  includeCountdowns: boolean;
  createdAt: number;
  pushedAt: number;
  hash?: string;
  rev?: number;
  /** The note lives in a co-editable doc on the server (see collab.mts). */
  collab?: boolean;
  /** Friends holding the link may edit (notes only; default true). */
  editable?: boolean;
  /** Only people the owner lets in can open it. */
  restricted?: boolean;
};

/** A link someone shared with you — kept so you can find it again (and synced with your account). */
export type SharedLink = {
  id: string;
  key: string;
  title: string;
  from: string;
  /** What you can do there, as last seen. */
  role?: "edit" | "view" | null;
  addedAt: number;
  openedAt: number;
};

/** What the friend receives (inside the encrypted envelope). */
export type SharePayload = {
  v: 1;
  from?: string;
  sharedAt: number;
  /** With `collab`, the note itself is in the live doc rather than in here. */
  note?: { title: string; doc: JSONContent | null; text: string; updatedAt: number; collab?: boolean; titleStyle?: TitleStyle };
  todos?: { text: string; done: boolean }[];
  countdowns?: { title: string; date: string; time?: string | null; repeat?: "yearly" | null; createdAt: number }[];
};
