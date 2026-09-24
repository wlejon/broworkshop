// Node Forge — boot. The page lives in forge.js; tests use globalThis.nodeForge.

import { mountForge } from "./forge.js";

globalThis.nodeForge = mountForge();
