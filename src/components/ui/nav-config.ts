// App navigation configuration.
// No React or browser dependencies — safe to import in node:test.

export type AppNavItem = {
  href: string;
  label: string;
  match: "exact" | "startsWith";
};

export const PRIMARY_NAV: readonly AppNavItem[] = [
  { href: "/dashboard", label: "Dashboard", match: "exact" },
  { href: "/rules", label: "Trading Plan", match: "exact" },
];

export const MORE_NAV: readonly AppNavItem[] = [
  { href: "/alerts", label: "Alerts", match: "exact" },
  { href: "/settings", label: "Settings", match: "exact" },
  { href: "/onboarding", label: "Setup guide", match: "exact" },
];

export const ALL_NAV: readonly AppNavItem[] = [...PRIMARY_NAV, ...MORE_NAV];

// Link target for the "Add account" action on the Dashboard.
// Routes directly to the broker connect flow so users never need to
// visit the Broker connections settings page just to add an account.
export const ADD_ACCOUNT_HREF = "/accounts/connect/tradovate";
