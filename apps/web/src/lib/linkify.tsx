import React from 'react';

// URLs http/https até o primeiro espaço ou '<'.
const URL_RE = /(https?:\/\/[^\s<]+)/gi;

export type LinkToken = { type: 'text' | 'url'; value: string };

/**
 * Quebra um texto em segmentos de texto e URLs (http/https).
 * Pontuação final comum (. , ; : ! ? ) ] } ' ") não é engolida pela URL.
 * Função pura — base testável do `linkify`.
 */
export function tokenizeLinks(text: string): LinkToken[] {
  const tokens: LinkToken[] = [];
  if (!text) return tokens;
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const matched = m[0];
    let url = matched;
    let trailing = '';
    const trail = /[.,;:!?)\]}'"]+$/.exec(url);
    if (trail) {
      trailing = trail[0];
      url = url.slice(0, -trailing.length);
    }
    if (start > last) tokens.push({ type: 'text', value: text.slice(last, start) });
    tokens.push({ type: 'url', value: url });
    if (trailing) tokens.push({ type: 'text', value: trailing });
    last = start + matched.length;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens;
}

/** Renderiza o texto com as URLs como links clicáveis (abrem em nova aba). */
export function linkify(text: string): React.ReactNode {
  const tokens = tokenizeLinks(text);
  if (tokens.length === 0) return text;
  return tokens.map((t, i) =>
    t.type === 'url' ? (
      <a
        key={i}
        href={t.value}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--ammoc-green-700)', textDecoration: 'underline', wordBreak: 'break-all' }}
      >
        {t.value}
      </a>
    ) : (
      <React.Fragment key={i}>{t.value}</React.Fragment>
    ),
  );
}

/**
 * URL que força o download do arquivo no Supabase Storage (Content-Disposition:
 * attachment) via o parâmetro `?download`. Funciona mesmo sendo origem diferente.
 */
export function downloadHref(url: string): string {
  return url + (url.includes('?') ? '&' : '?') + 'download';
}
