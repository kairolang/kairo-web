/**
 * Build-time Kairo TextMate grammar for Shiki (<Code lang={...}>).
 * Fetched once per build and shared by the landing components; falls back
 * to 'rust' highlighting when the grammar can't be fetched.
 */
const GRAMMAR_URL =
  'https://raw.githubusercontent.com/kairolang/kairo-lsp/lsp-v1/public/syntaxes/kairo.tmLanguage.json';

let cached: Promise<any> | null = null;

export function getKairoLang(): Promise<any> {
  if (!cached) {
    cached = (async () => {
      try {
        const res = await fetch(GRAMMAR_URL);
        if (res.ok) return await res.json();
      } catch {}
      return 'rust';
    })();
  }
  return cached;
}

/** Shiki language for a filename: .k/.kro → Kairo grammar, otherwise the extension. */
export async function langFor(filename: string): Promise<any> {
  const ext = filename.split('.').pop() ?? 'txt';
  return ext === 'k' || ext === 'kro' ? getKairoLang() : ext;
}
