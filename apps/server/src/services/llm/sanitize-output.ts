// The sanitizer lives in @arcadeai/shared so the web client can apply the
// EXACT same cleanup to streamed repair output before rendering it in the
// iframe (otherwise the live preview shows raw prose/fences the server strips
// before persisting). Re-exported here so existing server imports and tests
// keep their stable path.
export { sanitizeHtmlOutput } from "@arcadeai/shared/sanitize-html.js";
