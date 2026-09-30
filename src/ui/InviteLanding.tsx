// Redeeming an invite link (`#/invite/<token>`) — plans/v2-server-design.md §5.
//
// The token arrives in the URL fragment, which is never sent to a server in
// a request line or a Referer header, and App strips it from the address bar
// as soon as it has been read. It goes to the server only in a request body.
//
// Someone following an invite usually has no account yet: they see who
// invited them to what, create an account in the same card, and the invite
// is redeemed straight after.

import { useEffect, useState } from "react";
import { previewInvite, redeemInvite } from "../sync/engine";
import { useAppState } from "../state/store";
import { SignInForm } from "./SignInForm";
import type { InvitePreview } from "../sync/protocol";

const INVITE_HASH = /^#\/invite\/([A-Za-z0-9_-]+)$/;
const VIEW_HASH = /^#\/view\/([A-Za-z0-9_-]+)$/;

export function readInviteToken(hash: string): string | null {
  return INVITE_HASH.exec(hash)?.[1] ?? null;
}

export function readPublicLinkToken(hash: string): string | null {
  return VIEW_HASH.exec(hash)?.[1] ?? null;
}

function describe(preview: InvitePreview): string {
  const who = preview.inviter.name;
  if (preview.subject === null) return `${who} would like to connect with you on Chronicle.`;
  const verb = preview.role === "editor" ? "fill in" : "see";
  if (preview.subject.kind === "all") return `${who} invites you to ${verb} the timelines they publish.`;
  const what = preview.subject.label === "" ? `a ${preview.subject.kind === "group" ? "group" : "timeline"}` : `“${preview.subject.label}”`;
  return `${who} invites you to ${verb} ${what}.`;
}

export function InviteLanding({ token, onDone }: { token: string; onDone: () => void }) {
  const signedIn = useAppState((s) => s.sync.account !== undefined && !s.sync.sessionExpired);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "accepting" | "accepted" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    previewInvite(token).then(
      (result) => {
        setPreview(result);
        setState("ready");
      },
      (reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "This invite link does not work.");
        setState("failed");
      },
    );
  }, [token]);

  const accept = () => {
    setState("accepting");
    redeemInvite(token).then(
      () => setState("accepted"),
      (reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "This invite link does not work.");
        setState("failed");
      },
    );
  };

  return (
    <div className="assistant-overlay">
      <div className="invite-landing">
        <h2>Chronicle</h2>
        {state === "loading" && <p>Opening the invite…</p>}
        {state === "failed" && <p>{error}</p>}
        {preview !== null && state !== "failed" && <p>{describe(preview)}</p>}
        {state === "ready" && preview !== null && signedIn && (
          <button type="button" className="small-button small-button-primary" onClick={accept}>
            Accept
          </button>
        )}
        {state === "ready" && preview !== null && !signedIn && (
          <>
            <p className="hint">
              Accepting connects you with {preview.inviter.name}. Nothing of yours is shared back unless you
              share it.
            </p>
            <SignInForm initialMode="signup" submitSuffix=" and accept" onSignedIn={accept} />
          </>
        )}
        {state === "accepting" && <p>Accepting…</p>}
        {state === "accepted" && preview !== null && (
          <p>
            Done — you are connected with {preview.inviter.name}
            {preview.subject === null ? "." : ", and what they shared now appears with your own timelines."}
          </p>
        )}
        <button type="button" className="small-button" onClick={onDone}>
          {state === "accepted" ? "Go to my timelines" : "Close"}
        </button>
      </div>
    </div>
  );
}
