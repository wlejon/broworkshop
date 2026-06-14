// storage.js — settings + per-mode high-score tables using apps/lib StorageLib.
'use strict';
import { Storage as StorageLib } from "/lib/storage.js";

export const Storage = (function () {
    var settingsStore = StorageLib.create('blockpop');
    var defaults = {
        sfxVol: 80,
        musicVol: 60,
        riseSpeed: 10, // tenths (1.0x default)
        colorBlind: false
    };
    var settings = settingsStore.load(defaults);

    var classicHS = StorageLib.highscores('blockpop:classic', 10);
    var sprintHS  = StorageLib.highscores('blockpop:sprint', 10, { field: 'time', ascending: true });
    var puzzleHS  = StorageLib.highscores('blockpop:puzzle', 10);

    function save() { settingsStore.save(); }

    return {
        settings: settings,
        save: save,
        load: function () { return settingsStore.load(defaults); },
        hs: function (mode) {
            if (mode === 'sprint') return sprintHS;
            if (mode === 'puzzle') return puzzleHS;
            return classicHS;
        },
        qualifies: function (mode, value) { return this.hs(mode).qualifies(value); },
        add: function (mode, entry) { return this.hs(mode).add(entry); },
        list: function (mode) { return this.hs(mode).list(); }
    };
})();
