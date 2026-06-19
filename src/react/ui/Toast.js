// Toast — React-side bridge to the app's single canonical toast region.
//
// There is exactly ONE toast surface in this app: `window.UI.toast`, which owns
// the lone aria-live region. The React island must NOT spin up a second region
// (that would split announcements across two live regions and double-speak to
// screen readers). So this module is a thin, stateless delegate to
// `window.UI.toast` rather than a real React provider/portal.
//
// Every method null-guards `window.UI` (the island can mount before, or
// independently of, the legacy UI namespace) and degrades to a console log so a
// missing toast surface is never a thrown error in a render/event handler.

const ui = () => (typeof window !== 'undefined' ? window.UI : null);

/**
 * Route a call to `window.UI.toast[method]` when present, else log.
 * @param {'success'|'error'|'info'|'warning'} method
 * @param {string} msg
 */
function deliver(method, msg) {
  const u = ui();
  if (u && u.toast && typeof u.toast[method] === 'function') {
    return u.toast[method](msg);
  }
  // No toast surface available — keep the signal, don't throw.
  return console.log('[toast]', method, msg);
}

/**
 * toast — stable, app-wide toast facade for React code.
 * Mirrors `window.UI.toast` (success/error/info/warning) plus a `show(msg,type)`
 * router. Frozen so the object identity is stable across renders/imports.
 */
export const toast = Object.freeze({
  success: (msg) => deliver('success', msg),
  error: (msg) => deliver('error', msg),
  info: (msg) => deliver('info', msg),
  warning: (msg) => deliver('warning', msg),
  /**
   * show — type-routed entry point. Unknown/missing type falls back to 'info'.
   * @param {string} msg
   * @param {'success'|'error'|'info'|'warning'} [type='info']
   */
  show: (msg, type) => {
    const method = type === 'success' || type === 'error' || type === 'warning' ? type : 'info';
    return deliver(method, msg);
  },
});

/**
 * useToast — hook accessor returning the stable `toast` facade.
 * No state/subscription: the real toast state lives in the single legacy region,
 * so this just hands back the frozen singleton (stable identity → safe in deps).
 * @returns {typeof toast}
 */
export function useToast() {
  return toast;
}
