import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

/**
 * Makes the built app work offline: writes the service worker (pwa/sw.js) out as /sw.js, with
 * the list of files to keep on the device and a version of its own — a timestamp (so versions
 * sort by age) and a fingerprint of every file it keeps (so it changes with any of them).
 *
 * Kept: the pages, the app's scripts and styles, the fonts it uses, the scene cards, the icons.
 * Not kept: source maps, the old .woff fonts no current browser asks for, and the big link-preview
 * pictures that only chat apps fetch.
 */
const SKIP = [/\.map$/, /\.woff$/, /^og(-share)?\.png$/, /^sw\.js$/];

function walk(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, root));
    else out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

export function offlineApp(): Plugin {
  let outDir = "";
  let template = "";
  return {
    name: "umbra:offline-app",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      template = readFileSync(resolve(config.root, "pwa/sw.js"), "utf8");
    },
    closeBundle() {
      const files = walk(outDir)
        .filter((f) => !SKIP.some((re) => re.test(f)))
        .sort();
      const hash = createHash("sha256");
      for (const f of files) {
        hash.update(f);
        hash.update(readFileSync(join(outDir, f)));
      }
      const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
      const version = `${stamp}-${hash.digest("hex").slice(0, 10)}`;
      const sw = template.replace('"__VERSION__"', JSON.stringify(version)).replace("__FILES__", JSON.stringify(files.map((f) => `/${f}`)));
      if (sw.includes("__VERSION__") || sw.includes("__FILES__")) throw new Error("pwa/sw.js: the placeholders weren't filled in");
      writeFileSync(join(outDir, "sw.js"), sw);
    },
  };
}
