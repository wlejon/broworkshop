// Earth's entry: app.js imports a world as worlds/<name>.js, since bronze's
// dynamic import resolves a template of one folder's files
// (`/app/worlds/${name}.js`), not a path into a folder named by it.
export { default } from "/app/worlds/earth/world.js";
