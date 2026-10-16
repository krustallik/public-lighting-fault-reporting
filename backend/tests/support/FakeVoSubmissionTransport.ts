import {
  VoSubmissionTransportError,
  type CanonicalVoReportDraft,
  type VoSubmissionTransport,
} from '../../src/integrations/ausemio/voSubmissionBoundary.js';

export type FakeVoSubmissionTransportBehavior = 'returned' | 'rejected' | 'timed_out' | 'ambiguous';

/** Test-only port: records in-memory calls and never opens a network connection. */
export class FakeVoSubmissionTransport implements VoSubmissionTransport {
  readonly received: CanonicalVoReportDraft[] = [];

  constructor(private readonly behavior: FakeVoSubmissionTransportBehavior) {}

  async submit(draft: CanonicalVoReportDraft): Promise<void> {
    this.received.push(draft);
    if (this.behavior === 'returned') return;
    const kind = this.behavior === 'rejected' ? 'transport_rejected' : this.behavior;
    throw new VoSubmissionTransportError(kind);
  }
}
