export const APP_CONFIG = {
  APP_NAME: "EvidenceVault",
  APP_DESCRIPTION: "Multi-Region Document Evidence Vault & Recovery Drill",
  API_BASE_URL: "/api",
  DEFAULT_PAGE_SIZE: 10,
  RTO_TARGET_SECONDS: 5.0,
  RPO_TARGET_SECONDS: 900.0,
};

export const USER_ROLES = {
  ADMIN: "ROLE_ADMIN",
  OPERATOR: "ROLE_OPERATOR",
  AUDITOR: "ROLE_AUDITOR",
};

export const DOCUMENT_CATEGORIES = [
  { value: "GENERAL", label: "General" },
  { value: "CONTRACT", label: "Contract" },
  { value: "INVOICE", label: "Invoice" },
  { value: "LEGAL", label: "Legal" },
  { value: "FINANCIAL", label: "Financial" },
  { value: "OTHER", label: "Other" },
];

export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  DASHBOARD: "/dashboard",
  DOCUMENTS: "/documents",
  TRASH: "/trash",
  RECOVERY: "/recovery",
  REPLICATION: "/replication",
  AUDIT: "/audit",
  ACCESS_CONTROL: "/access-control",
  ANALYTICS: "/analytics",
};