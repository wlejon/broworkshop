// audio.js — SFX layer over lib/audio (SFX).
var A = A || {};

A.Audio = {
    init: function() { SFX.init(); },
    sfxFire:        function() { SFX.tone(880, 0.08, "square", 0.3); },
    sfxBangLarge:   function() { SFX.noise(0.4,  0.9, 120); },
    sfxBangMed:     function() { SFX.noise(0.25, 0.8, 180); },
    sfxBangSmall:   function() { SFX.noise(0.15, 0.7, 260); },
    sfxShipExplode: function() {
        SFX.noise(0.7, 1.0, 80);
        setTimeout(function() { SFX.noise(0.3, 0.6, 150); }, 120);
    },
    sfxMenuMove:   function() { SFX.tone(400, 0.03, "sine",   0.3); },
    sfxMenuSelect: function() { SFX.tone(600, 0.08, "square", 0.4); },
    sfxExtraLife:  function() { SFX.sequence([[523,0.08,"square",0.6],[659,0.08,"square",0.6],[784,0.12,"square",0.7]]); },
    sfxWave:       function() { SFX.tone(330, 0.15, "triangle", 0.6); },
};
