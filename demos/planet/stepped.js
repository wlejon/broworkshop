// Work too big for one frame's spare GPU time, split into steps run beside
// the frames (bro.kernel.background), a step a frame: a whole tree field
// (5.6 ms of GPU work) beside one frame slowed its draws by 3 ms, where a
// sixteenth of it hides in the frame's idle time. Background jobs run in
// order, so the last step done is all of them done.
//
// stepped(steps, onDone): `steps` functions that each record a few
// dispatches; advance() each frame starts the next step, or once all are
// started and the last is done calls onDone (once) and returns true.
export function stepped(steps, onDone) {
    let last = null, finished = false;
    return {
        advance() {
            if (finished) return true;
            if (steps.length) {
                last = bro.kernel.background(steps.shift());
                return false;
            }
            if (last && !last.done) return false;
            finished = true;
            onDone();
            return true;
        },
    };
}
