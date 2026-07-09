// Unit test for /lib/markdown.js — HTML-escaping, the supported block/inline
// constructs, streaming tolerance, and link-scheme rejection. No model needed.
//   bro-headless ai/pi-agent tests/test_markdown.js

import { renderMarkdown } from "/lib/markdown.js";

function has(html, needle, msg) {
    assert(html.indexOf(needle) !== -1, (msg || "expected substring") + ": " + JSON.stringify(needle) + "\n  in: " + html);
}
function hasNot(html, needle, msg) {
    assert(html.indexOf(needle) === -1, (msg || "unexpected substring") + ": " + JSON.stringify(needle) + "\n  in: " + html);
}

// 1. HTML is escaped — raw markup can never reach the DOM.
{
    const h = renderMarkdown("<script>alert(1)</script>");
    has(h, "&lt;script&gt;", "angle brackets escaped");
    hasNot(h, "<script>", "no live script tag");
}

// 2. Inline code — content escaped, no emphasis inside.
{
    const h = renderMarkdown("call `a<b && *x*` now");
    has(h, '<code class="md-inline">a&lt;b &amp;&amp; *x*</code>', "inline code escaped + literal");
    hasNot(h, "<em>", "no emphasis inside inline code");
}

// 3. Bold / italic / strikethrough.
{
    const h = renderMarkdown("**b** and *i* and ~~s~~");
    has(h, "<strong>b</strong>", "bold");
    has(h, "<em>i</em>", "italic");
    has(h, "<del>s</del>", "strikethrough");
}

// 4. Fenced code block with a language, content escaped.
{
    const h = renderMarkdown("```js\nconst x = a < b;\n```");
    has(h, '<pre class="md-code" data-lang="js">', "fence with lang");
    has(h, "const x = a &lt; b;", "fence content escaped");
}

// 5. Streaming tolerance — an unterminated fence still renders as code.
{
    const h = renderMarkdown("```\nhalf a code block");
    has(h, '<pre class="md-code">', "unterminated fence still opens a code block");
    has(h, "half a code block", "unterminated fence keeps its content");
}

// 6. Lists.
{
    const ul = renderMarkdown("- one\n- two");
    has(ul, "<ul><li>one</li><li>two</li></ul>", "unordered list");
    const ol = renderMarkdown("1. one\n2. two");
    has(ol, "<ol><li>one</li><li>two</li></ol>", "ordered list");
}

// 7. Headings.
{
    has(renderMarkdown("# Title"), "<h1>Title</h1>", "h1");
    has(renderMarkdown("### Sub"), "<h3>Sub</h3>", "h3");
}

// 8. Links — allowed scheme renders an anchor.
{
    const h = renderMarkdown("see [docs](https://example.com/x?a=1&b=2)");
    has(h, '<a href="https://example.com/x?a=1&amp;b=2"', "http link href");
    has(h, ">docs</a>", "link text");
}

// 9. Links — javascript: is rejected and left literal (no anchor).
{
    const h = renderMarkdown("[x](javascript:alert(1))");
    hasNot(h, "<a ", "no anchor for javascript: url");
    hasNot(h, "javascript:alert(1)\"", "scheme not emitted as href");
}

// 10. Unbalanced emphasis degrades to literal (streaming a partial token).
{
    const h = renderMarkdown("this is **not closed");
    hasNot(h, "<strong>", "no strong tag for unbalanced **");
    has(h, "**not closed", "unbalanced ** stays literal");
}

console.log("test_markdown: all assertions passed");
