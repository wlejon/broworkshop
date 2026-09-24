// Plant Recipes entry: boot the kit and mount the panel. Everything else is
// in lab.js, which tests import (an entry module imported by a test is
// evaluated twice, see ENGINE-ISSUES.md).
import { boot } from "/lib/kit/index.js";
import { mountPanel } from "/app/lab.js";

const app = boot();
mountPanel((text, kind) => app.status.set(text, kind));
