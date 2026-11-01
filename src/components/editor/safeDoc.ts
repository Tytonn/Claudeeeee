import { getSchema, type JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { buildExtensions } from "./extensions";

let schema: Schema | null = null;

/**
 * Returns `doc` if it's a valid document for our editor schema; otherwise rebuilds a
 * plain one from `text` (one paragraph per line). Keeps foreign content — shared links,
 * backups — from ever crashing the editor.
 */
export function safeDoc(doc: JSONContent | null | undefined, text: string): JSONContent | null {
  schema ??= getSchema(buildExtensions({ editable: false }));
  if (doc) {
    try {
      schema.nodeFromJSON(doc).check();
      return doc;
    } catch {
      /* fall through to plain text */
    }
  }
  if (!text.trim()) return null;
  return {
    type: "doc",
    content: text.split("\n").map((line) => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" })),
  };
}
