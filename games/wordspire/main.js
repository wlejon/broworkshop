import { boot } from "/lib/arcade/shell.js";
import { game, installTestHooks } from "/app/game.js";
import { Dictionary } from "/app/dictionary.js";

const shell = boot(game, { width: 1000, height: 800 });
installTestHooks(shell);

// Show loading while the dictionary fetches, then title.
shell.switchTo("loading");
const status = document.getElementById("loading-status");
if (status) status.textContent = "Reading dictionary...";

Dictionary.load().then(function (n) {
    if (status) status.textContent = n + " words loaded.";
    shell.switchTo("title");
}).catch(function (err) {
    console.error("dictionary load failed:", err);
    if (status) status.textContent = "ERROR: " + (err.message || err);
    Dictionary._setWords([
        "cat", "dog", "eat", "run", "sun", "moon", "star", "stone", "word", "play",
        "game", "hello", "world", "tile", "chain", "board", "spire", "tower",
        "test", "type", "tone", "crate", "rate", "hate", "late", "plate",
    ]);
    shell.switchTo("title");
});
