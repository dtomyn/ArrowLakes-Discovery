// Helpers for building HTML strings safely. Many names in public/data come from crowd-edited
// sources (OpenStreetMap trails, waterfalls, shops, clinics) or from the visitor (shortlist
// notes), so anything that isn't a literal in this codebase goes through esc() before it
// reaches innerHTML, and any link taken from data goes through safeUrl().

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for use in HTML content or a quoted attribute. */
export const esc = (s: string | number | null | undefined) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** An http(s) URL from data, or null for anything else (javascript:, data:, relative paths…). */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:/i.test(s) ? s : `https://${s}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
