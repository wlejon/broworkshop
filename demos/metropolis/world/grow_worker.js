// The city and its trees grown off the main thread (lib/city/city_worker.js).
import { SITE } from "./site.js";
import { serveGrow } from "/lib/city/city_worker.js";
serveGrow(SITE);
