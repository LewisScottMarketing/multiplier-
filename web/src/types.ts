import type { Campaign } from '@shared/schema';
import type { FieldInfo } from '@shared/fields';
import type { LintIssue } from '@shared/lint';

export type { Campaign, LintIssue, FieldInfo };

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface CampaignSummary {
  id: string;
  name: string;
  slug: string;
  status: 'draft' | 'live' | 'archived';
  updated_at: number;
  created_at: number;
  has_document: boolean;
  source_type: string | null;
  headline: string;
  brand: string;
  prospects: number;
  viewed: number;
  submissions: number;
}

export interface CampaignDetail {
  campaign: Campaign;
  custom_fields: string[];
  standard_fields: FieldInfo[];
  issues: LintIssue[];
  ai_available: boolean;
  public_url: string;
}

export interface Engagement {
  stage: 'new' | 'opened' | 'engaged' | 'converted';
  views: number;
  clicks: number;
  downloads: number;
  submissions: number;
  engaged_seconds: number;
  score: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

export interface ProspectItem {
  id: string;
  campaign_id: string;
  external_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  job_title: string | null;
  seniority: string | null;
  department: string | null;
  url: string;
  pdf_url: string | null;
  cover_url: string | null;
  stage: Engagement['stage'];
  engagement: Engagement;
  data: Record<string, unknown>;
  created_at: string;
}

export interface TimelineEvent {
  id: number;
  type: 'hit' | 'view' | 'engaged' | 'click' | 'download' | 'submit' | 'booked';
  props: Record<string, unknown>;
  is_bot: boolean;
  created_at: number;
}

export interface Totals {
  prospects: number;
  opened: number;
  engaged: number;
  converted: number;
  clicks: number;
  downloads: number;
  submissions: number;
  avg_engaged_seconds: number;
}

export interface DayPoint {
  date: string;
  views: number;
  clicks: number;
  downloads: number;
  submissions: number;
}

export interface TopProspect {
  id: string;
  campaign_id: string;
  name: string;
  company: string | null;
  job_title: string | null;
  score: number;
  views: number;
  clicks: number;
  downloads: number;
  submissions: number;
  last_seen_at: number | null;
}

export interface ActivityItem {
  id: number;
  type: string;
  created_at: number;
  prospect_id: string | null;
  campaign_id: string;
  campaign_name: string;
  name: string;
  company: string | null;
  detail: string;
}

export interface SegmentRow {
  key: string;
  label: string;
  prospects: number;
  opened: number;
  converted: number;
}

export interface CampaignAnalytics {
  totals: Totals;
  funnel: Array<{ key: string; label: string; n: number }>;
  series: DayPoint[];
  top: TopProspect[];
  activity: ActivityItem[];
  segments: { departments: SegmentRow[]; seniority: SegmentRow[] };
  clicks: Array<{ block: string; slot: string; label: string; n: number }>;
  devices: { mobile: number; desktop: number };
  anonymous_views: number;
}

export interface Overview {
  campaigns: { live: number; total: number };
  totals: Totals;
  series: DayPoint[];
  top: TopProspect[];
  activity: ActivityItem[];
}

export interface WorkspaceSettings {
  name: string;
  domains: string[];
  sender: { name: string; role: string; avatar: string };
  scripts: { head: string; body_end: string };
}

export interface SettingsResponse {
  workspace: WorkspaceSettings;
  ai: { available: boolean; models: { smart: string; fast: string } };
  urls: { app: string; public: string };
  user: User;
  limits: { max_upload_mb: number };
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  campaign_id: string | null;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export interface WebhookInfo {
  id: string;
  name: string;
  kind: 'clay' | 'slack' | 'generic';
  url: string;
  auth_header: string | null;
  has_auth_value: boolean;
  has_secret: boolean;
  events: string[];
  campaign_id: string | null;
  active: boolean;
  created_at: number;
  stats: { pending: number; delivered: number; failed: number };
}

export interface AssetInfo {
  id: string;
  filename: string;
  url: string;
  meta: { width?: number; height?: number };
  created_at: number;
}
