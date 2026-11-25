// The city's destruction stepped off the main thread (lib/city/destruction_worker.js).
import { SITE } from "./site.js";
import { serveDestruction } from "/lib/city/destruction_worker.js";
serveDestruction(SITE);
