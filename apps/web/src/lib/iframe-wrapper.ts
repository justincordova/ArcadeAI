export const WRAPPER_SCRIPT = `
window.addEventListener('error', function(e) {
  var payload = {type:'game-error', message: e.message};
  if (e.error && e.error.stack) payload.stack = e.error.stack;
  parent.postMessage(payload, '*');
});
window.addEventListener('unhandledrejection', function(e) {
  var reason = e.reason;
  var payload = {type:'game-error', message: reason && reason.message ? reason.message : String(reason)};
  if (reason && reason.stack) payload.stack = reason.stack;
  parent.postMessage(payload, '*');
});
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'capture-thumbnail') {
    var canvas = document.querySelector('canvas');
    if (canvas) {
      try {
        var dataUrl = canvas.toDataURL('image/png');
        parent.postMessage({type:'thumbnail', dataUrl: dataUrl}, '*');
      } catch(err) {
        parent.postMessage({type:'thumbnail', dataUrl: null}, '*');
      }
    } else {
      parent.postMessage({type:'thumbnail', dataUrl: null}, '*');
    }
  }
});
// Signal the parent once the game has actually painted a frame, so the
// thumbnail capture waits for real pixels instead of a fixed timeout (which
// produced blank/black thumbnails on slow machines). A double rAF guarantees
// the browser has committed at least one paint after the inline scripts ran
// their init()/first render(). The parent treats this as best-effort: if it
// never arrives (e.g. a game with no rAF-driven first frame), a timeout
// fallback fires the capture anyway.
requestAnimationFrame(function() {
  requestAnimationFrame(function() {
    parent.postMessage({type:'rendered'}, '*');
  });
});
`;

// Defense-in-depth CSP for generated games. The iframe is already sandboxed
// (`allow-scripts` only), but the sandbox does not restrict outbound
// network requests. A hallucinated or malicious fetch in generated code
// could otherwise exfiltrate data or load remote scripts.
//
// - default-src 'none'             — no remote anything by default
// - script-src 'unsafe-inline'     — inline <script> required (no remote scripts)
// - style-src 'unsafe-inline'      — inline <style>/style="" required
// - img-src data: blob:            — only data URIs and blob URLs (no remote images)
// - media-src data: blob:          — same for audio/video
// - font-src data:                 — only data URIs
// - connect-src 'none'             — no fetch/XHR/WebSocket to anywhere
// - form-action 'none'             — no form submission targets
// - base-uri 'none'                — no <base> hijacking
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none';">`;

export function injectWrapper(html: string): string {
  const scriptTag = `<script>${WRAPPER_SCRIPT}</script>`;

  // Inject CSP into <head> (or at start if no <head>). Browsers respect
  // the first CSP header/meta they see, so this needs to be early.
  //
  // The regex is intentionally case-insensitive and tolerant of attributes
  // (`<head class="x">` etc.). A previous case-sensitive `indexOf("<head>")`
  // would silently miss a model-generated `<HEAD>` or `<Head>`, falling
  // through to the "prepend" branch — but prepending the meta tag BEFORE
  // `<!doctype html>` puts the document into quirks mode and browsers
  // refuse to honor <meta http-equiv="Content-Security-Policy"> outside of
  // a real <head>. Net result of the old bug: such a game ran with NO CSP.
  let withCsp: string;
  const headMatch = html.match(/<head\b[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length;
    withCsp = html.slice(0, insertAt) + CSP_META + html.slice(insertAt);
  } else {
    // No <head> — prepend so it parses before the first script
    withCsp = CSP_META + html;
  }

  const bodyMatch = withCsp.match(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
  if (bodyMatch && bodyMatch.index !== undefined) {
    return withCsp.slice(0, bodyMatch.index) + scriptTag + withCsp.slice(bodyMatch.index);
  }
  return withCsp + scriptTag;
}
