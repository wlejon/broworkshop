// Neural Playground boot. Tests import playground.js / model/*, never this file.

import { boot } from "/lib/kit/app.js";
import { mountPlayground } from "./playground.js";

const app = boot();
globalThis.neuralPlayground = mountPlayground(app.status);
