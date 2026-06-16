// Generic modal-content passthrough island.
//
// Used to route a chunk-built modal/slot body through a React root WITHOUT
// hand-porting the (often huge, inline-value-interpolated, signature-pad /
// autosave-wired) form markup to JSX. React renders the chunk's exact HTML via
// dangerouslySetInnerHTML — which uses innerHTML under the hood, so inline
// onclick/onchange/oninput handlers AND inline <style> blocks survive and work
// exactly as before. The chunk keeps 100% of its logic (edit-prepopulation via
// interpolated value=, post-render signature-pad binding, autosave debounce,
// conditional show/hide, save handlers). This is the safe, behavior-identical
// way to put every modal render path on React; it also establishes the island
// boundary for a future incremental JSX componentization.
//
// Mounted with flushSync (see main.jsx mountModalContent) so the DOM is
// populated synchronously before the chunk's post-render wiring (getElementById)
// runs — eliminating the React-commit race.
import React, { useEffect } from 'react';

export function ModalContentIsland({ html = '', onReady }) {
    try { window.__REACT_MODAL_STATE = 'ready'; } catch (_) { /* noop */ }

    useEffect(() => {
        if (typeof onReady === 'function') {
            try { onReady(); } catch (_) { /* noop */ }
        }
    }, [onReady]);

    return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
