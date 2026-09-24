// The conversation transcript, on the shared chat styles (lib/kit/chat.css):
// a "You" row per utterance (a live partial while Whisper streams), and a
// "Bro" row per reply whose text arrives in two layers: `.pending` (streamed
// from the LM, not spoken yet) and `.word` spans (handed to TTS; the one
// being voiced gets `.speaking` from playback.js).

import { h } from "/lib/kit/dom.js";

export function voiceTranscript(el) {
    let partial = null;                 // the live "You" row while STT streams
    let spoken = null, pending = null;  // the current reply's two layers
    let fullText = '', finalizedLen = 0;

    const scroll = () => { el.scrollTop = el.scrollHeight; };
    const dropHint = () => { const hint = el.querySelector('.chat-hint'); if (hint) hint.remove(); };
    function row(who, label, ...body) {
        dropHint();
        const r = h('div.chat-row.' + who, null, h('span.chat-who', null, label), h('div.chat-body', null, ...body));
        el.appendChild(r);
        scroll();
        return r;
    }

    return {
        /** A finished user utterance. */
        you(text) { this.clearPartial(); row('you', 'You', text); },
        /** Live STT text for the utterance being transcribed. */
        partial(text) {
            if (!partial) partial = row('you.partial', 'You', h('span.pending'));
            partial.querySelector('.pending').textContent = text;
            scroll();
        },
        clearPartial() { if (partial) partial.remove(); partial = null; },

        /** Open a reply row. */
        startReply() {
            spoken = h('span.spoken');
            pending = h('span.pending');
            row('agent', 'Bro', spoken, pending);
            fullText = ''; finalizedLen = 0;
        },
        /** The reply's full streamed text so far (cleaned). */
        setText(text) {
            fullText = text;
            if (pending) pending.textContent = fullText.slice(finalizedLen);
            scroll();
        },
        /**
         * Move a sentence from pending to spoken: one `.word` span per word.
         * `consumed` = reply length covered once this sentence is spoken.
         */
        finalize(textWords, consumed) {
            if (!spoken) this.startReply();
            const els = textWords.map((w) => {
                const span = h('span.word', null, w);
                spoken.appendChild(span);
                spoken.appendChild(document.createTextNode(' '));
                return span;
            });
            finalizedLen = consumed;
            this.setText(fullText);
            return els;
        },
        /** Drop the unspoken tail (interrupted turn). */
        cutPending() { if (pending) pending.textContent = ''; },
        get text() { return fullText; },
        el,
    };
}
