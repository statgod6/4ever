import { IsString, IsIn, MaxLength, IsOptional, IsUUID } from 'class-validator';

/**
 * POST /api/support/report body.
 *
 * Keep the shape tiny on purpose — no attachments, no rich metadata — because
 * this endpoint is a launch-minimum abuse / bug channel that lands in the
 * structured logs. A dedicated DB-backed queue can be added later without
 * changing the wire format.
 */
export class SupportReportDto {
  @IsString()
  @IsIn(['abuse', 'bug', 'feature', 'privacy', 'other'])
  category!: 'abuse' | 'bug' | 'feature' | 'privacy' | 'other';

  @IsString()
  @MaxLength(4000)
  message!: string;

  /**
   * Optional — the user-id being reported for abuse. We don't reveal whether
   * the id maps to a real account; we just record it for ops review.
   */
  @IsOptional()
  @IsUUID()
  targetUserId?: string;
}
