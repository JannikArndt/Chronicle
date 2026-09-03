// The one mark in front of a group's or a timeline's name: its site's favicon
// if it has one, its emoji otherwise. The choice itself lives in the pure
// `nameIcon()` (src/model/favicon.ts) so the canvas engine makes it the same
// way; this is only the DOM half.
//
// A favicon that fails to load falls back to the emoji rather than leaving a
// broken-image gap — the site may be gone, or offline, and a name that loses
// its mark for the afternoon is worse than one that keeps its emoji.

import { useEffect, useState } from "react";
import { nameIcon } from "../model/favicon";

export const NAME_ICON_SIZE_PX = 16;

export function NameIcon({
  subject,
  size = NAME_ICON_SIZE_PX,
}: {
  subject: { icon?: string; website?: string };
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const resolved = nameIcon(subject, size);
  // A new site is a new chance to load — otherwise editing the field after one
  // failure leaves the favicon permanently switched off for that row.
  useEffect(() => setFailed(false), [subject.website]);

  if (resolved === undefined) return null;
  if (resolved.kind === "favicon" && !failed) {
    return (
      <img
        className="row-icon row-favicon"
        src={resolved.url}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
      />
    );
  }
  const emoji = subject.icon?.trim();
  if (emoji === undefined || emoji === "") return null;
  return <span className="row-icon">{emoji}</span>;
}
