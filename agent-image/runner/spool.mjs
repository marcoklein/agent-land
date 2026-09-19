/**
 * In-memory replay spool for the runner's unacknowledged events. A durable,
 * capped on-disk spool lands with P2's lifecycle reconcile; this keeps the
 * reconnect contract (replay from `resumeFromSeq`, trim to ack) testable now.
 */
export class Spool {
  constructor() {
    this.entries = [];
    this.lastAckedSeq = 0;
  }

  append(seq, event) {
    this.entries.push({ seq, event });
  }

  replayFrom(resumeFromSeq) {
    return this.entries.filter((e) => e.seq >= resumeFromSeq).map((e) => ({ seq: e.seq, event: e.event }));
  }

  trimTo(ackedSeq) {
    this.lastAckedSeq = Math.max(this.lastAckedSeq, ackedSeq);
    this.entries = this.entries.filter((e) => e.seq > ackedSeq);
  }

  get lastSeq() {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1].seq : this.lastAckedSeq;
  }
}
