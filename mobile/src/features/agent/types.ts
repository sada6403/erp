import type { AgentMemberDto, CommissionResponse, CommissionRowDto } from '@contracts/agent';
import type { AgentDashboardExtras } from '@/api/localTypes';

/** Dashboard extras the server may send beyond the v1.0 contract. Every field is optional: absent = not rendered. */
export interface AgentExtras extends AgentDashboardExtras {
  rank_detail?: string | null;
  smartbuy_members?: number | null;
  cod_to_collect?: number | null;
  badge_hints?: string[] | null;
}

export interface CommissionRowView extends CommissionRowDto {
  /** Short explanation line under the source (e.g. "Rs 250 base + Rs 50 OTP bonus per drop"). */
  detail?: string | null;
  /** Dot colour hint: green | gold | blue. */
  color?: string | null;
}

export interface CommissionView extends Omit<CommissionResponse, 'rows'> {
  title?: string | null;
  rows: CommissionRowView[];
}

export interface MemberView extends AgentMemberDto {
  weekly_amount?: number | null;
}

export interface PrinterInfo {
  name: string;
  title: string;
  connected: boolean;
}
