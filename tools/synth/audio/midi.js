// audio/midi.js — a hardware MIDI keyboard playing the synth.
//
// broaudio's MidiInput queues messages on a background thread; pump() (once
// a frame) dispatches them. Notes go through the player, like the on-screen
// piano, so they light keys and follow the selected layer; the mod wheel
// (CC 1) feeds the ModMatrix 'modwheel' source. inject() feeds raw bytes as
// if from a port: tests use it, and it works with no device at all.

export function createMidi(ctx, player) {
    const input = ctx && ctx.createMidiInput ? ctx.createMidiInput() : null;
    const mm = ctx ? ctx.getModMatrix() : null;
    let port = -1, received = 0;

    if (input) {
        input.onRawEvent((ev) => {
            received++;
            if (ev.type === 'noteon' && ev.data2 > 0) player.noteOn(ev.data1, ev.data2 / 127);
            else if (ev.type === 'noteoff' || ev.type === 'noteon') player.noteOff(ev.data1);
            else if (ev.type === 'controlchange' && ev.data1 === 1 && mm) mm.setModWheel(ev.data2 / 127);
        });
    }

    return {
        get supported() { return !!input; },
        /** [{ index, name }] of the ports present now. */
        ports() { return input ? input.availablePorts() : []; },
        /** Open a port by index (-1 closes). Returns whether one is open. */
        open(index) {
            if (!input) return false;
            if (input.isOpen) input.close();
            port = -1;
            if (index >= 0 && input.open(index)) port = index;
            return port >= 0;
        },
        get port() { return port; },
        get received() { return received; },
        inject(bytes) { return input ? input.injectMessage(bytes) : false; },
        pump() { if (input) input.processEvents(); },
    };
}
