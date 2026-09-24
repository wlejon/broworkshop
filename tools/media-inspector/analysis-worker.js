// analysis-worker.js — bro.media decodes off the UI thread. bro.media.peaks
// and .thumbnails are synchronous whole-span decodes, and bro installs
// bro.media in worker realms for exactly this.
//
// Request { type: 'analyze', path, peaks: {...} | null, thumbs: {...} | null }
// -> { type: 'analysis', peaks, strip } (null where the file has no such
// track or the span is empty). Arrays are copied back, not transferred (see
// ENGINE-ISSUES.md: a view whose buffer is in the transfer list fails).

import { serveWorker } from "/lib/kit/worker-rpc.js";

serveWorker({
    analyze(msg) {
        if (!bro.media || !bro.media.available) throw new Error('bro.media is not available in this build');
        return {
            type: 'analysis',
            peaks: msg.peaks ? bro.media.peaks(msg.path, msg.peaks) : null,
            strip: msg.thumbs ? bro.media.thumbnails(msg.path, msg.thumbs) : null,
        };
    },
});
