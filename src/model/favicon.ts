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

// What to draw in front of a group's or a timeline's name: its site's favicon
// if it has one, else its emoji, else nothing. One mark, never two — a row
// with both a site and an emoji would otherwise put two coloured things in
// front of a name that the whole rail styles identically on purpose.
//
// Pure and DOM-free like `faviconUrl` above, so the canvas engine, the rail
// and the mobile panes all decide this the same way rather than three times.
export type NameIcon = { kind: "favicon"; url: string } | { kind: "emoji"; emoji: string };

export function nameIcon(
  subject: { icon?: string; website?: string },
  sizePx: number,
): NameIcon | undefined {
  const url = subject.website === undefined ? undefined : faviconUrl(subject.website, sizePx);
  if (url !== undefined) return { kind: "favicon", url };
  const emoji = subject.icon?.trim();
  return emoji === undefined || emoji === "" ? undefined : { kind: "emoji", emoji };
}
