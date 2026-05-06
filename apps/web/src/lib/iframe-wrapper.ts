export const WRAPPER_SCRIPT = `
window.addEventListener('error', function(e) {
  parent.postMessage({type:'game-error', message: e.message, stack: e.error ? e.error.stack : ''}, '*');
});
window.addEventListener('unhandledrejection', function(e) {
  parent.postMessage({type:'game-error', message: String(e.reason)}, '*');
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
