// main.js — entry point. Tests import app.js (and read `synth`), never this
// file: importing a page's entry module boots it a second time.
import { start } from "/app/app.js";

start();
