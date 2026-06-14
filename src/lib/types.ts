export type TesterStatus = "prospect" | "invited" | "active" | "inactive";
export type SessionStatus = "scheduled" | "completed" | "no_show" | "canceled";

export const TESTER_STATUSES: TesterStatus[] = [
  "prospect",
  "invited",
  "active",
  "inactive",
];

// ── Feedback portal ────────────────────────────────────────────
export type FeedbackType = "bug" | "confusion" | "request";
export type FeedbackStatus =
  | "new"
  | "triaged"
  | "planned"
  | "shipped"
  | "declined";

export const FEEDBACK_TYPES: FeedbackType[] = ["bug", "confusion", "request"];
export const FEEDBACK_STATUSES: FeedbackStatus[] = [
  "new",
  "triaged",
  "planned",
  "shipped",
  "declined",
];

export interface Profile {
  id: string;
  email: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface Feedback {
  id: string;
  submitted_by: string;
  type: FeedbackType;
  body: string;
  screenshot_url: string | null;
  // Storage object path in the private 'screenshots' bucket (new uploads).
  // Legacy rows may still use screenshot_url instead.
  screenshot_path: string | null;
  status: FeedbackStatus;
  tags: string[];
  merged_into: string | null;
  created_at: string;
  updated_at: string;
  // Joined in via select("*, submitter:profiles(email)")
  submitter?: Pick<Profile, "email"> | null;
}

export interface FeedbackComment {
  id: string;
  feedback_id: string;
  author: string;
  body: string;
  created_at: string;
  // Joined in via select("*, author_profile:profiles(email)")
  author_profile?: Pick<Profile, "email"> | null;
}

// ── CRM ────────────────────────────────────────────────────────
export interface Tester {
  id: string;
  name: string;
  email: string;
  role: string | null;
  organization: string | null;
  status: TesterStatus;
  source: string | null;
  notes: string | null;
  owner: string;
  created_at: string;
}

export interface Session {
  id: string;
  tester_id: string;
  scheduled_at: string;
  status: SessionStatus;
  notes: string | null;
  owner: string;
  created_at: string;
  tester?: Pick<Tester, "id" | "name"> | null;
}
