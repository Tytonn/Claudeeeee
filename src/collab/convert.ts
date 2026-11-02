import * as Y from "yjs";
import type { JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { editorSchema, safeDoc } from "../components/editor/safeDoc";
import { docToText } from "../lib/text";
import { BODY, TITLE } from "./fields";

/** Puts a note into an empty live doc: the body as rich text, the title as plain text. */
export function fillDoc(doc: Y.Doc, note: { title: string; doc: JSONContent | null; text: string }) {
  const json = safeDoc(note.doc, note.text) ?? { type: "doc", content: [{ type: "paragraph" }] };
  doc.transact(() => {
    prosemirrorJSONToYXmlFragment(editorSchema(), json, doc.getXmlFragment(BODY));
    if (note.title) doc.getText(TITLE).insert(0, note.title);
  });
}

/** Reads a live doc back out as an ordinary note. */
export function readDoc(doc: Y.Doc): { title: string; doc: JSONContent; text: string } {
  const json = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(BODY), editorSchema()).toJSON() as JSONContent;
  return { title: doc.getText(TITLE).toString().replace(/[\r\n]+/g, " "), doc: json, text: docToText(json) };
}
