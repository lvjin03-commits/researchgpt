export const ACCOUNT_SECTION_IDS = [
  "overview",
  "profile",
  "points",
  "transactions",
  "orders",
  "security",
] as const;

export type AccountSectionId = (typeof ACCOUNT_SECTION_IDS)[number];

export const ACCOUNT_AUTHORITY_BY_CAPABILITY = {
  identity: "supabase_auth",
  profile: "profile_service",
  points: "point_billing_service",
  transactions: "point_billing_service",
  orders: "payment_service",
  sessions: "supabase_auth",
  closure: "account_lifecycle_service",
} as const;

export type AccountAuthority =
  (typeof ACCOUNT_AUTHORITY_BY_CAPABILITY)[keyof typeof ACCOUNT_AUTHORITY_BY_CAPABILITY];

export type AccountSummary = {
  userId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  points: {
    status: "available" | "unavailable";
    available: number | null;
    reserved: number | null;
  };
};
