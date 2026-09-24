// Node Forge's node-type registry. Each file in nodes/ defines its type here;
// nodes/index.js imports them all.

import { NodeTypes } from "/lib/kit/nodegraph.js";

export const types = new NodeTypes({
    compat: { 'audio-buffer': ['audio-buffer'] },
});
