// The planet's shader sources: its .bk files, read from the app's folder,
// and modules of the constants a shader shares with the JS that lays out
// its buffers and meshes.
const fs = require('fs');

// The text of the app's file at `path`.
export const readApp = (path) => fs.readFileSync(bro.resolvePath('/app/' + path), 'utf-8');

// Where the app's modules live: planet::name is name.bk in the core's
// folder or the active world's (setWorld), the core's first.
const MODULE_DIRS = ['core', 'worlds/earth'];
export function setWorld(name) {
    MODULE_DIRS[1] = 'worlds/' + name;
}
export const worldDir = () => MODULE_DIRS[1];

// The app-relative path of a .bk file: a path as given, or a file name
// alone found in the core's folder or the world's.
export function sourcePath(file) {
    if (file.includes('/')) return file;
    for (const dir of MODULE_DIRS) {
        const path = dir + '/' + file;
        if (fs.existsSync(bro.resolvePath('/app/' + path))) return path;
    }
    return file;
}
// The module name a .bk file is imported by: planet::<its name>.
export const moduleName = (path) => 'planet::' + path.slice(path.lastIndexOf('/') + 1).replace(/\.bk$/, '');

export function modulePath(name) {
    const path = sourcePath(name.slice('planet::'.length) + '.bk');
    return path.includes('/') ? path : null;
}

if (typeof bro !== 'undefined' && bro.kernel && typeof bro.kernel.resolve === 'function') {
    bro.kernel.resolve((name) => {
        if (typeof name === 'string' && name.startsWith('planet::')) {
            const path = modulePath(name);
            return path ? readApp(path) : undefined;
        }
        return undefined;
    });
}

const f32 = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const literal = (type, x) => {
    if (type === 'f32') return f32(x);
    if (type === 'i32') return String(Math.trunc(x));
    if (type === 'u32') return `${Math.trunc(x)}u`;
    if (type === 'bool') return x ? 'true' : 'false';
    return `${type}(${x.map(f32).join(', ')})`;   // a vector of f32
};

// A brokernel module of constants: `name` and each constant's type and
// value, { N: ['i32', 512], FAR: ['f32', 1900], RAGGED: ['bool', true],
// WAVE_K: ['vec4<f32>', [[...], ...]] } (an array of vectors when the value
// is a list of lists). The shader's code stays in its .bk file and imports
// these by name.
export function constants(name, decls) {
    let src = `module ${name};\n`;
    for (const [key, [type, value]] of Object.entries(decls)) {
        if (Array.isArray(value) && Array.isArray(value[0])) {
            src += `pub const ${key}: array<${type}, ${value.length}> = [\n    ${value.map((v) => literal(type, v)).join(',\n    ')}\n];\n`;
        } else {
            src += `pub const ${key}: ${type} = ${literal(type, value)};\n`;
        }
    }
    if (typeof bro !== 'undefined' && bro.kernel && typeof bro.kernel.registerModule === 'function') {
        bro.kernel.registerModule(name, src);
    }
    return src;
}
