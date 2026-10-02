/**
 * shiki-code-hints.mjs
 *
 * Shiki transformer that marks the `const`s in a Kairo code block so the
 * reader can hover (or tap, or focus) one and see which question it answers.
 *
 * Opt in per block with `hints` in the fence info:
 *
 *   ```kairo hints
 *   var ptr: *const i32 = &x
 *   ```
 *
 * The code itself is not changed, so copy/paste and the generated llms files
 * are unaffected. Comments are never marked.
 *
 * Output HTML (on the `const` token):
 *   <span class="code-hint" tabindex="0"
 *         data-hint-title="..." data-hint-body="...">const</span>
 *
 * The marker and popover live in src/components/docs/CodeBlockEnhancer.astro.
 * Backticks in the title/body render as inline code.
 */

const HINTS = {
  pointee: {
    title: '`*const` locks the pointee',
    body:
      'Can I change the pointee? No. Whatever this `*` points at can be read through it, but not ' +
      'written. Whether the pointer itself can change is a separate question, answered by `var` or ' +
      '`const` at the start of the declaration.',
  },
  pointer: {
    title: '`const` locks the pointer',
    body:
      'Can I change the pointer? No. This name always points at the same place. Whether the ' +
      'pointee can change is a separate question, answered by `*T` or `*const T` in the type.',
  },
  value: {
    title: '`const` locks the value',
    body:
      'Can I change this? No. It cannot be reassigned, and only `const self` methods can be called ' +
      'on it. A plain value is one thing, so this is the only `const` it takes.',
  },
  receiver: {
    title: '`const self` locks the receiver',
    body:
      'Can this method change the object it is called on? No (apart from `mutable` members). That ' +
      'promise is what lets it be called through a `*const T` or on a `const` object.',
  },
};

// Each rule captures the text before the `const` to mark in group 1.
const RULES = [
  { kind: 'pointee',  re: /(\*\s*)const\b/g },
  { kind: 'receiver', re: /(\(\s*)const\s+self\b/g },
  { kind: 'pointer',  re: /^(\s*(?:(?:pub|priv|prot|static)\s+)*)const\s+[A-Za-z_]\w*\s*:\s*(?:unsafe\s+)?\*/g },
  { kind: 'value',    re: /^(\s*(?:(?:pub|priv|prot|static)\s+)*)const\s+[A-Za-z_]\w*\s*(?::(?!\s*(?:unsafe\s+)?\*)|=)/g },
];

export default function codeHints() {
  return {
    name: 'kairo-code-hints',
    preprocess(code, options) {
      const meta = this.options.meta?.__raw ?? '';
      if (!/(^|\s)hints(\s|$)/.test(meta)) return;

      options.decorations ||= [];
      let offset = 0;
      for (const line of code.split('\n')) {
        const comment = line.indexOf('//');
        const src = comment === -1 ? line : line.slice(0, comment);
        for (const { kind, re } of RULES) {
          for (const m of src.matchAll(re)) {
            const start = offset + m.index + m[1].length;
            options.decorations.push({
              start,
              end: start + 'const'.length,
              properties: {
                class: 'code-hint',
                tabindex: '0',
                'data-hint-title': HINTS[kind].title,
                'data-hint-body': HINTS[kind].body,
              },
            });
          }
        }
        offset += line.length + 1;
      }
    },
  };
}
