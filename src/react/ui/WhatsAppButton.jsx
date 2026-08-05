/**
 * WhatsAppButton — list-row shortcut that opens a WhatsApp chat with a person.
 *
 * Desktop lists only (Prospects + Customers tables); mobile already has its own
 * WhatsApp affordance on the mp cards (chunks/script-mobile.js). Opens wa.me
 * directly — NOT the Meta Business API send modal the customer detail view uses.
 *
 * Number handling delegates to the canonical MY MSISDN normalizer in script.js
 * (window.app.waPhone), the same one the legacy chunk renderers call, so the two
 * paths can never disagree about what number a row dials. Renders NOTHING when
 * there is no usable number — a disabled grey icon on half the rows is noise the
 * agent can't act on (mirrors the mobile `${phone ? … : ''}` pattern).
 *
 * The open must stay synchronous inside the click: popups require transient user
 * activation, and any await before window.open consumes it (the chat then
 * silently never opens on Safari/iOS). app.openWaChat is non-async for exactly
 * this reason — do not wrap this handler in one.
 */
const app = () => window.app || {};

export function WhatsAppButton({ phone, stopPropagation = false }) {
  const num = ((app().waPhone) || (() => ''))(phone);
  if (!num) return null;
  return (
    <button
      className="btn-icon"
      title={`WhatsApp ${phone}`}
      aria-label={`WhatsApp ${phone}`}
      style={{ color: '#25d366' }}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        if (app().openWaChat) app().openWaChat(num);
      }}
    >
      <i className="fab fa-whatsapp" aria-hidden="true"></i>
    </button>
  );
}
