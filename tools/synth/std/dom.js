// dom.js — small DOM helpers + signal bindings (std lib)
//
// Replaces the per-app `getElementById`/`createElement`/`innerHTML` churn with
// terse query + element-builder helpers, plus a handful of bind* functions that
// wire signals to the DOM declaratively. Depends only on ./signal.js, so the
// whole std/ folder moves as a unit.

import { effect } from "/std/signal.js";

/// querySelector / querySelectorAll (the latter as a real array).
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/// Add an event listener; returns a function that removes it.
export function on(target, event, handler, opts) {
    target.addEventListener(event, handler, opts);
    return () => target.removeEventListener(event, handler, opts);
}

/// Remove all children of a node.
export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

function appendChild(parent, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
        for (const c of child) appendChild(parent, c);
    } else if (typeof child === "object" && child.nodeType) {
        // Duck-typed DOM node (bro exposes no global `Node` constructor).
        parent.appendChild(child);
    } else {
        parent.appendChild(document.createTextNode(String(child)));
    }
}

/// Build an element. `props` keys: `class`/`className`, `style` (object),
/// `dataset` (object), `on*` (event handlers), otherwise a DOM property if one
/// exists (value, textContent, ...) or an attribute. Children may be nodes,
/// strings, arrays, or null/false (skipped).
///
///   el("button", { class: "btn", onClick: save }, "Save")
export function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
        for (const key in props) {
            const v = props[key];
            if (key === "class" || key === "className") {
                node.className = v;
            } else if (key === "style" && v && typeof v === "object") {
                Object.assign(node.style, v);
            } else if (key === "dataset" && v && typeof v === "object") {
                Object.assign(node.dataset, v);
            } else if (key.startsWith("on") && typeof v === "function") {
                node.addEventListener(key.slice(2).toLowerCase(), v);
            } else if (key in node) {
                node[key] = v;
            } else {
                node.setAttribute(key, v);
            }
        }
    }
    appendChild(node, children);
    return node;
}

// --- signal bindings -------------------------------------------------------
// Each takes a zero-arg accessor (a signal or computed) and keeps a piece of
// the DOM in sync with it. Returns the effect's dispose function.

/// Keep `node.textContent` in sync with `accessor()`.
export function bindText(node, accessor) {
    return effect(() => { node.textContent = String(accessor()); });
}

/// Toggle `className` on `node` based on the boolean `accessor()`.
export function bindClass(node, className, accessor) {
    return effect(() => { node.classList.toggle(className, !!accessor()); });
}

/// Keep an attribute (or, for known properties, the property) in sync.
export function bindAttr(node, name, accessor) {
    return effect(() => {
        const v = accessor();
        if (name in node) node[name] = v;
        else node.setAttribute(name, v);
    });
}

/// Show/hide via `style.display` based on the boolean `accessor()`.
export function bindShow(node, accessor) {
    return effect(() => { node.style.display = accessor() ? "" : "none"; });
}
