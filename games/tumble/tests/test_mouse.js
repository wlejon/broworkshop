// Tumble mouse building through the engine's input path: hover a floor cell,
// left-click places the selected piece, right-click removes it.
import { check, eq, frames, q, shot } from "/lib/kit/test.js";

frames(6);
const T = window.__tumble;
T.startLevel(3); // Springboard
frames(4);
T.select("block");

// A screen point down the centre line whose floor cell takes a block.
const r = q("#view").getBoundingClientRect();
const x = r.left + r.width / 2;
let y = null;
for (let yy = r.bottom - 10; yy > r.top && y == null; yy -= 10) {
    const c = T.cellAt(x, yy);
    if (c && c.free) y = yy;
}
check(y != null, "a placeable cell on the centre line");

mouseMove(x, y);
frames(2);
shot("hover");
click(x, y, 0);
frames(2);
eq(T.snapshot().placed, 1, "left click places a block");
click(x, y, 0);
frames(2);
eq(T.snapshot().placed, 1, "clicking an occupied cell does not stack");
click(x, y, 2);
frames(2);
eq(T.snapshot().placed, 0, "right click removes it");

console.log("tumble mouse ok");
