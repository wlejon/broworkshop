// The VCB (value control box): SketchUp's precision input. While a tool drag
// or click-chain runs, typing a number (or "W,H") and Enter commits it at that
// exact value; after a push/pull, typing a distance re-applies it.
//
// MeasureBox (tools/measure-box.js) is the key/parse state machine; this is
// the panel and the routing to the current tool. A tool takes part through
// an optional `vcb` object:
//
//   vcb: { pair: bool,           // "W,H" instead of one number
//          live(value),          // buffer changed and parses: preview it
//          commit(value) }       // Enter with a valid buffer
//
// consulted only while that tool is busy(). Esc cancels its gesture.

import { MeasureBox } from "../tools/measure-box.js";

/** ed: { tools, redoLast(distance) }. el: the panel element. */
export function createVcb(ed, el) {
    const st = MeasureBox.createState();

    // The tool whose gesture is in progress (normally the current one).
    const target = () => {
        if (!ed.tools) return null;
        for (const n of ed.tools.names) {
            const t = ed.tools.get(n);
            if (t.vcb && t.busy && t.busy()) return t;
        }
        return null;
    };
    const parse = (pair) => pair ? MeasureBox.parseValuePair(st.buffer) : MeasureBox.parseValue(st.buffer);

    const vcb = {
        state: st,

        render() {
            if (!st.active) { el.hidden = true; return; }
            el.hidden = false;
            const pair = !!st.pairMode;
            let hint;
            if (pair) hint = 'Type <b>W,H</b> + Enter for exact size · Esc cancel';
            else if (st.lastOp && !target()) hint = 'Type distance + Enter to re-extrude · Esc to dismiss';
            else hint = 'Type exact distance + Enter · Esc cancel';
            el.innerHTML =
                '<div class="vcb-label">' + (pair ? 'Dimensions' : 'Distance') + '</div>' +
                '<div><span class="vcb-value">' + (st.buffer || '&mdash;') + '</span>' +
                '<span class="vcb-caret"></span></div>' +
                '<div class="vcb-hint">' + hint + '</div>';
        },

        /** Arm for a new gesture (single number, or "W,H" with pair). */
        open(pair) {
            MeasureBox.clearLastOp(st);
            MeasureBox.clear(st);
            MeasureBox.setPairMode(st, !!pair);
            MeasureBox.setActive(st, true);
            vcb.render();
        },

        /** Gesture over: hide, keeping any re-apply offer already cleared. */
        close() {
            MeasureBox.clear(st);
            MeasureBox.setPairMode(st, false);
            MeasureBox.setActive(st, false);
            vcb.render();
        },

        /** Hide and forget the re-apply offer. */
        dismiss() {
            MeasureBox.clearLastOp(st);
            vcb.close();
        },

        /** After a push/pull: offer to re-apply it at a typed distance. */
        offerRedo(op) {
            MeasureBox.clear(st);
            MeasureBox.setPairMode(st, false);
            MeasureBox.setLastOp(st, op);
            MeasureBox.setActive(st, true);
            vcb.render();
        },

        /** The buffer as a single number, or null. */
        value() { return MeasureBox.parseValue(st.buffer); },

        /** Feed a key; true when the VCB consumed it. */
        key(key) {
            if (!st.active) return false;
            const action = MeasureBox.feedKey(st, key);
            if (action === 'ignored') return false;
            const tool = target();
            if (action === 'append') {
                vcb.render();
                if (tool) {
                    const v = parse(tool.vcb.pair);
                    if (v !== null) tool.vcb.live(v);
                }
            } else if (action === 'commit') {
                if (tool) {
                    tool.vcb.commit(parse(tool.vcb.pair));
                } else if (st.lastOp) {
                    const v = vcb.value();
                    MeasureBox.clear(st);
                    vcb.render();
                    ed.redoLast(v);
                }
            } else if (action === 'cancel') {
                if (tool) tool.cancel();
                else vcb.dismiss();
                vcb.render();
            }
            return true;
        },
    };
    return vcb;
}
