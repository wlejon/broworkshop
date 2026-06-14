// storage.js — single high score via lib/storage.
import { Storage as StorageLib } from "/lib/storage.js";
export const Storage = StorageLib.highScoreOnly("chomper");
