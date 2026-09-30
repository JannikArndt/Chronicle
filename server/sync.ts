// Pulls, pushes, and who hears about what.
//
// The broadcast rule is one function, `whileWatching`: before a change to an
// owner's records or grants, note what every connected account that could be
// affected can see; after it, send each of them the difference. Content edits,
// publishing, un-publishing, moves in and out of a shared group, new grants
// and revocations all come out of that one comparison — there is no separate
// code path for any of them to get wrong.

import { indexRecords } from "./access";
import { toStruct, toWire } from "./records";
import type { Hub } from "./hub";
import type { RecordStore } from "./records";
import type { Access, PersonRef, PushRecord, PushResult, WireRecord } from "../src/sync/protocol";

export interface Names {
  nameOf(accountId: string): string;
}

export class SyncService {
  constructor(
    private readonly store: RecordStore,
    private readonly hub: Hub,
    private readonly names: Names,
  ) {}

  pull(viewer: string): { records: WireRecord[]; people: PersonRef[] } {
    const owners = [viewer, ...this.store.ownersGrantingTo(viewer).filter((owner) => owner !== viewer)];
    const records = owners.flatMap((owner) => this.store.visibleRecords(viewer, owner));
    const present = new Set(records.map((record) => record.owner));
    return { records, people: [...present].map((id) => ({ id, name: this.names.nameOf(id) })) };
  }

  push(writer: string, records: PushRecord[], originConnection?: string): PushResult[] {
    const byOwner = new Map<string, PushRecord[]>();
    const results: PushResult[] = [];
    for (const record of records) {
      if (typeof record?.owner !== "string") {
        results.push({ id: String(record?.id), ok: false, reason: "missing owner" });
        continue;
      }
      const list = byOwner.get(record.owner);
      if (list === undefined) byOwner.set(record.owner, [record]);
      else list.push(record);
    }
    for (const [owner, batch] of byOwner) {
      if (owner !== writer && this.store.grantsFrom(owner, writer).length === 0) {
        results.push(...batch.map((record) => ({ id: record.id, ok: false, reason: "you cannot edit this" })));
        continue;
      }
      let subjectsRemoved = false;
      const touched = new Set(batch.map((record) => record.id));
      // Before the push: a delete can take a grant with it, and the person
      // who held it is exactly who needs telling.
      const granteesBefore = this.store.granteesOf(owner);
      this.whileWatching(
        owner,
        () => {
          const applied = this.store.applyPush(writer, owner, batch, Date.now());
          subjectsRemoved = applied.subjectsRemoved;
          results.push(...applied.results);
        },
        { touched, originConnection },
      );
      if (subjectsRemoved) {
        for (const account of [owner, ...granteesBefore]) this.hub.send(account, { type: "social" });
      }
    }
    return results;
  }

  // Run `change` against one owner's data and send every connected account
  // that could be affected exactly what it changed for them. `touched` are
  // records whose content changed without their visibility changing — those
  // are resent even though the access comparison alone would not notice them.
  // `extraViewers` covers accounts that lose their only grant inside `change`
  // and so are no longer among the owner's grantees afterwards.
  whileWatching(
    owner: string,
    change: () => void,
    options: { touched?: Set<string>; originConnection?: string; extraViewers?: string[] } = {},
  ): void {
    const viewers = new Set(
      [owner, ...this.store.granteesOf(owner), ...(options.extraViewers ?? [])].filter((account) =>
        this.hub.isOnline(account),
      ),
    );
    const before = new Map<string, Map<string, Access>>();
    if (viewers.size > 0) {
      const index = this.store.liveIndex(owner);
      for (const viewer of viewers) before.set(viewer, this.store.accessMap(viewer, owner, index));
    }

    change();
    if (viewers.size === 0) return;

    const records = this.store.liveRecords(owner);
    const byId = new Map(records.map((record) => [record.id, record]));
    const index = indexRecords(records.map(toStruct));
    const touched = options.touched ?? new Set<string>();

    for (const viewer of viewers) {
      const was = before.get(viewer)!;
      const now = this.store.accessMap(viewer, owner, index);
      const changed: WireRecord[] = [];
      for (const [id, access] of now) {
        if (was.get(id) !== access || touched.has(id)) changed.push(toWire(byId.get(id)!, access));
      }
      const gone = [...was.keys()].filter((id) => !now.has(id));
      if (changed.length > 0) this.hub.send(viewer, { type: "records", records: changed }, options.originConnection);
      if (gone.length > 0) this.hub.send(viewer, { type: "gone", ids: gone }, options.originConnection);
    }
  }
}
