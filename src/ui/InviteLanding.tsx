// Redeeming an invite link — plans/sharing-feature-design.md §D5.
//
// The token arrives in the URL fragment (`#/invite/<token>`) rather than the
// query string: a fragment is never sent to a server in a request line or a
// Referer header, so the capability does not end up in an access log on the way
// past. It is stripped from the address bar as soon as it has been read.

import { useEffect, useState } from "react";
import { redeemInviteToken, requestMagicLink } from "../sharing/sync";
import { useAppState } from "../state/store";

const INVITE_HASH = /^#\/invite\/(.+)$/;

export function readInviteToken(hash: string): string | null {
  return INVITE_HASH.exec(hash)?.[1] ?? null;
}

export function InviteLanding({ token, onDone }: { token: string; onDone: () => void }) {
  const session = useAppState((s) => s.sharing.session);
  const configured = useAppState((s) => s.sharing.configured);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [outcome, setOutcome] = useState<"pending" | "accepted" | "failed">("pending");
  const [error, setError] = useState<string | null>(null);

  // Redeem as soon as there is somebody to redeem it for. A visitor who follows
  // the link before signing in lands here, signs in, comes back to the same URL
  // and this fires on the return trip.
  useEffect(() => {
    if (session === undefined || outcome !== "pending") return;
    void redeemInviteToken(token).then(
      () => setOutcome("accepted"),
      (reason: unknown) => {
        setOutcome("failed");
        setError(reason instanceof Error ? reason.message : "This invite link is not valid.");
      },
    );
  }, [session, token, outcome]);

  if (!configured) {
    return (
      <Shell onDone={onDone}>
        <p>This copy of Chronicle has no sharing backend configured, so the invite can’t be accepted here.</p>
      </Shell>
    );
  }

  if (outcome === "accepted") {
    return (
      <Shell onDone={onDone}>
        <p>Invite accepted — their shared timelines now appear alongside your own.</p>
      </Shell>
    );
  }

  if (outcome === "failed") {
    return (
      <Shell onDone={onDone}>
        <p>{error}</p>
        <p className="hint">Invite links expire after 30 days and can only be used once.</p>
      </Shell>
    );
  }

  if (session !== undefined) {
    return (
      <Shell onDone={onDone}>
        <p>Accepting the invite…</p>
      </Shell>
    );
  }

  return (
    <Shell onDone={onDone}>
      <p>You’ve been invited to see someone’s timelines.</p>
      <p className="hint">
        Sign in to accept. Your own Chronicle stays on this device — accepting an invite doesn’t
        share anything of yours back.
      </p>
      {sent ? (
        <p className="note">Check your inbox, then open the link on this device.</p>
      ) : (
        <>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button
            type="button"
            className="menu-item"
            disabled={email.trim() === ""}
            onClick={() => void requestMagicLink(email.trim()).then(() => setSent(true))}
          >
            ✉️ Email me a sign-in link
          </button>
        </>
      )}
    </Shell>
  );
}

function Shell({ children, onDone }: { children: React.ReactNode; onDone: () => void }) {
  return (
    <div className="assistant-overlay">
      <div className="invite-landing">
        <h2>Chronicle</h2>
        {children}
        <button type="button" className="small-button" onClick={onDone}>
          Close
        </button>
      </div>
    </div>
  );
}
