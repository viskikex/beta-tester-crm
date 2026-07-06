import type { Database } from "./database";

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

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

export function toFeedbackType(value: string): FeedbackType {
  switch (value) {
    case "bug":
    case "confusion":
    case "request":
      return value;
    default:
      throw new Error(`Invalid feedback type: ${value}`);
  }
}

export function toFeedbackStatus(value: string): FeedbackStatus {
  switch (value) {
    case "new":
    case "triaged":
    case "planned":
    case "shipped":
    case "declined":
      return value;
    default:
      throw new Error(`Invalid feedback status: ${value}`);
  }
}

export function toTesterStatus(value: string): TesterStatus {
  switch (value) {
    case "prospect":
    case "invited":
    case "active":
    case "inactive":
      return value;
    default:
      throw new Error(`Invalid tester status: ${value}`);
  }
}

export function toSessionStatus(value: string): SessionStatus {
  switch (value) {
    case "scheduled":
    case "completed":
    case "no_show":
    case "canceled":
      return value;
    default:
      throw new Error(`Invalid session status: ${value}`);
  }
}


export interface Profile {
  id: string;
  email: string | null;
  is_admin: boolean;
  created_at: string;
}

export type Feedback = Tables<"feedback"> & {
  // Joined in via select("*, submitter:profiles(email)")
  submitter?: Pick<Profile, "email"> | null;
};

export type FeedbackComment = Tables<"feedback_comments"> & {
  // Joined in via select("*, author_profile:profiles(email)")
  author_profile?: Pick<Profile, "email"> | null;
};

// ── CRM ────────────────────────────────────────────────────────
export type Tester = Tables<"testers">;

export type Session = Tables<"sessions"> & {
  tester?: Pick<Tester, "id" | "name"> | null;
};
