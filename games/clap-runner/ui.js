// ui.js — Clap Runner's always-on chrome: the acoustic telemetry strip
// (voice dot, energy bar, tone readout, gesture badge) and its buttons.

const $ = (id) => document.getElementById(id);

const BADGE = {
    jump: "JUMP",
    superJump: "SUPER JUMP",
    glide: "HOVER GLIDE",
    slide: "SLIDE DASH",
};

let badgeTimer = null;

/** Light the gesture badge with `text` for 300 ms. */
export function flashBadge(text) {
    const el = $("gestureBadge");
    if (!el) return;
    el.textContent = text;
    el.classList.add("fired");
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => el.classList.remove("fired"), 300);
}

export function badgeFor(action) { return BADGE[action] || null; }

/** Voice dot, energy bar and tone label from a detector telemetry frame. */
export function renderTelemetry(t) {
    $("vadDot").classList.toggle("active", !!t.vad);
    $("vuBar").style.width = Math.min(100, Math.round(t.energy * 100)) + "%";
    const tone = t.tonal && t.pitchHz > 0;
    $("toneDot").classList.toggle("active", tone);
    $("toneHzLabel").textContent = tone ? "TONE: " + t.pitchHz + " Hz" : "TONE: -- Hz";
}

/** state: "off" | "on" | "failed" */
export function setMicButton(state) {
    const b = $("btnMicToggle");
    b.textContent = state === "on" ? "Mic Active" : state === "failed" ? "Mic Failed" : "Enable Mic";
    b.classList.toggle("active", state === "on");
}

export function setMuteButton(muted) {
    const b = $("btnAudioMute");
    b.textContent = muted ? "Sound Off" : "Sound On";
}

/** Wire the strip's three buttons. */
export function bindButtons({ mic, settings, mute }) {
    $("btnMicToggle").addEventListener("click", mic);
    $("btnCalibrate").addEventListener("click", settings);
    $("btnAudioMute").addEventListener("click", mute);
}
