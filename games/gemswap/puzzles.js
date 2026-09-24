// Gemswap puzzle layouts: 8 rows x 8 codes. "F3" = frozen color 3,
// "3" = color 3, "" = random. Clear every frozen gem to advance.
// Six hand-drawn patterns, then procedural boards up to PUZZLE_COUNT.

import { seededRandom } from "/lib/arcade/random.js";

const PUZZLE_COUNT = 20;
const _ = "";

const HAND = [
    // 1 — frame
    [
        ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F1"],
        ["F2", _, _, _, _, _, _, "F2"],
        ["F3", _, _, _, _, _, _, "F3"],
        ["F4", _, _, _, _, _, _, "F4"],
        ["F5", _, _, _, _, _, _, "F5"],
        ["F6", _, _, _, _, _, _, "F6"],
        ["F7", _, _, _, _, _, _, "F7"],
        ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F1"],
    ],
    // 2 — diagonal
    [
        ["F1", _, _, _, _, _, _, _],
        [_, "F2", _, _, _, _, _, _],
        [_, _, "F3", _, _, _, _, _],
        [_, _, _, "F4", _, _, _, _],
        [_, _, _, _, "F5", _, _, _],
        [_, _, _, _, _, "F6", _, _],
        [_, _, _, _, _, _, "F7", _],
        [_, _, _, _, _, _, _, "F1"],
    ],
    // 3 — checker
    [
        ["F1", _, "F2", _, "F3", _, "F4", _],
        [_, "F5", _, "F6", _, "F7", _, "F1"],
        ["F2", _, "F3", _, "F4", _, "F5", _],
        [_, "F6", _, "F7", _, "F1", _, "F2"],
        ["F3", _, "F4", _, "F5", _, "F6", _],
        [_, "F7", _, "F1", _, "F2", _, "F3"],
        ["F4", _, "F5", _, "F6", _, "F7", _],
        [_, "F1", _, "F2", _, "F3", _, "F4"],
    ],
    // 4 — middle box
    [
        [_, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _],
        [_, _, "F1", "F2", "F3", "F4", _, _],
        [_, _, "F2", _, _, "F5", _, _],
        [_, _, "F3", _, _, "F6", _, _],
        [_, _, "F4", "F5", "F6", "F7", _, _],
        [_, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _],
    ],
    // 5 — corners
    [
        ["F1", "F2", _, _, _, _, "F3", "F4"],
        ["F2", _, _, _, _, _, _, "F5"],
        [_, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _],
        [_, _, _, _, _, _, _, _],
        ["F6", _, _, _, _, _, _, "F7"],
        ["F7", "F1", _, _, _, _, "F2", "F3"],
    ],
    // 6 — plus
    [
        [_, _, _, "F1", "F2", _, _, _],
        [_, _, _, "F3", "F4", _, _, _],
        [_, _, _, "F5", "F6", _, _, _],
        ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F1"],
        ["F2", "F3", "F4", "F5", "F6", "F7", "F1", "F2"],
        [_, _, _, "F7", "F1", _, _, _],
        [_, _, _, "F2", "F3", _, _, _],
        [_, _, _, "F4", "F5", _, _, _],
    ],
];

/** Scattered frozen gems; density rises in steps of 5%. */
function procedural(i) {
    const rand = seededRandom(1000 + i);
    const density = 0.15 + (i % 4) * 0.05;
    const rows = [];
    for (let r = 0; r < 8; r++) {
        const row = [];
        for (let c = 0; c < 8; c++) {
            const color = 1 + Math.floor(rand() * 7);
            row.push(rand() < density ? "F" + color : String(color));
        }
        rows.push(row);
    }
    return rows;
}

const ALL = HAND.slice();
for (let i = ALL.length; i < PUZZLE_COUNT; i++) ALL.push(procedural(i));

export const Puzzles = {
    count: () => ALL.length,
    get: (i) => ALL[i % ALL.length],
};
