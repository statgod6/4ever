import apiClient from './client'

/**
 * Consent API — mirrors the backend Consent model. Each kind has a version
 * string (semantic date, e.g. "2026-05-01") so we can re-prompt users when
 * legal terms change without losing the audit trail of past acceptances.
 *
 * Enforcement on the backend is currently soft-gated behind CONSENT_ENFORCE;
 * this client is ready so we can flip enforcement on once the onboarding flow
 * ships every user through the acceptance screen.
 */

export type ConsentKind =
  | 'privacy_policy'
  | 'terms_of_service'
  | 'ai_disclosure'
  | 'age_confirmation'

export interface ConsentStatus {
  /** Map of kind → { version, acceptedAt } for the most recent acceptance. */
  accepted: Partial<Record<ConsentKind, { version: string; acceptedAt: string }>>
  /** The versions the backend currently requires. */
  currentVersions: Record<ConsentKind, string>
  /** Kinds the user still needs to accept (empty array means fully consented). */
  missing: ConsentKind[]
  /** True iff missing is empty. */
  isComplete: boolean
}

export const consentApi = {
  /** Fetch current consent status. Mobile calls this on launch. */
  getStatus: async (): Promise<ConsentStatus> => {
    const res = await apiClient.get('/consent')
    return res.data
  },

  /**
   * Record acceptance of one or more consent kinds at the current version.
   * Passing an array of kinds batches them into a single request (cheaper).
   */
  accept: async (
    kind: ConsentKind | ConsentKind[],
    version?: string,
  ): Promise<{ recorded: Array<{ kind: string; version: string; acceptedAt: string }>; status: ConsentStatus }> => {
    const res = await apiClient.post('/consent', { kind, version })
    return res.data
  },
}
