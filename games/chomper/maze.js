// Chomper maze — the layout, walls, doors and pellets as plain data.
// Tiles: '#' wall · '.' pellet · 'o' power pellet · ' ' empty corridor ·
// '-' ghost-house door · 'T' tunnel mouth (the row wraps).

export const COLS = 28;
export const ROWS = 31;

export const LAYOUT = [
    "############################",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#o####.#####.##.#####.####o#",
    "#.####.#####.##.#####.####.#",
    "#..........................#",
    "#.####.##.########.##.####.#",
    "#.####.##.########.##.####.#",
    "#......##....##....##......#",
    "######.#####.##.#####.######",
    "######.#####.##.#####.######",
    "######.##..........##.######",
    "######.##.###--###.##.######",
    "######.##.#      #.##.######",
    "T     .   #      #   .     T",
    "######.##.#      #.##.######",
    "######.##.########.##.######",
    "######.##..........##.######",
    "######.##.########.##.######",
    "######.##.########.##.######",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#.####.#####.##.#####.####.#",
    "#o..##................##..o#",
    "###.##.##.########.##.##.###",
    "###.##.##.########.##.##.###",
    "#......##....##....##......#",
    "#.##########.##.##########.#",
    "#.##########.##.##########.#",
    "#..........................#",
    "############################",
];

export const PAC_SPAWN = { c: 13.5, r: 23 };
export const GHOST_HOUSE = { c: 13.5, r: 14 };
export const GHOST_DOOR = { c: 13.5, r: 12 };

/** A fresh maze: { grid (rows of tile chars), pellets left, total }. */
export function createMaze() {
    const grid = [];
    let pellets = 0;
    for (let r = 0; r < ROWS; r++) {
        const line = LAYOUT[r];
        const row = [];
        for (let c = 0; c < COLS; c++) {
            const ch = line.charAt(c) || " ";
            if (ch === "." || ch === "o") pellets++;
            row.push(ch);
        }
        grid.push(row);
    }
    return { grid, pellets, total: pellets };
}

/** Column through the side tunnel. */
export function wrapCol(c) {
    if (c < 0) return COLS + c;
    if (c >= COLS) return c - COLS;
    return c;
}

export function tileAt(m, c, r) {
    if (r < 0 || r >= ROWS) return "#";
    return m.grid[r][wrapCol(c)] || "#";
}

export function passableForPac(m, c, r) {
    const t = tileAt(m, c, r);
    return t !== "#" && t !== "-";
}

/** The door only opens for ghosts going home or leaving. */
export function passableForGhost(m, c, r, allowDoor) {
    const t = tileAt(m, c, r);
    if (t === "#") return false;
    return t !== "-" || !!allowDoor;
}

/** Eat what is on (c, r): returns '.' or 'o', or null. */
export function eatPelletAt(m, c, r) {
    if (r < 0 || r >= ROWS) return null;
    const row = m.grid[r];
    c = wrapCol(c);
    const t = row[c];
    if (t !== "." && t !== "o") return null;
    row[c] = " ";
    m.pellets--;
    return t;
}
