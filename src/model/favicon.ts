// Favicon URLs via Google's favicon service — no API key, no backend. Pure and
// DOM-free so both the canvas engine and DetailPanel can share it.

export function faviconUrl(website: string, sizePx: number): string | undefined {
  const trimmed = website.trim();
  if (trimmed === "") return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const { hostname } = new URL(withScheme);
    if (!hostname) return undefined;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${sizePx}`;
  } catch {
    return undefined;
  }
}
