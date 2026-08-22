import type { SessionEvent } from "@agent-land/contracts";

export type { SessionEvent };

export type SequencedEvent = { seq: number; event: SessionEvent };

export type SequencedEventStream = {
  subscribe(handler: (e: SequencedEvent) => void): () => void;
};
