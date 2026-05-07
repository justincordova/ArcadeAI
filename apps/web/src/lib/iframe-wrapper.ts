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
`;

export function injectWrapper(html: string): string {
  const scriptTag = `<script>${WRAPPER_SCRIPT}</script>`;
  const idx = html.lastIndexOf("</body>");
  if (idx !== -1) {
    return html.slice(0, idx) + scriptTag + html.slice(idx);
  }
  return html + scriptTag;
}
