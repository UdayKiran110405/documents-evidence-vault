import {
  LayoutDashboard,
  Files,
  ArchiveRestore,
  ShieldCheck,
  Globe,
  History,
  Lock,
  BarChart3,
} from "lucide-react";

import { ROUTES, USER_ROLES } from "../config/constants";

export const SIDEBAR_GROUPS = [
  {
    group: "OPERATIONS",
    items: [
      {
        label: "Command Center",
        path: ROUTES.DASHBOARD,
        icon: LayoutDashboard,
      },
      {
        label: "Evidence Vault",
        path: ROUTES.DOCUMENTS,
        icon: Files,
      },
      {
        label: "Retention & Trash",
        path: ROUTES.TRASH,
        icon: ArchiveRestore,
      },
    ],
  },
  {
    group: "RESILIENCE",
    items: [
      {
        label: "DR Drill Studio",
        path: ROUTES.RECOVERY,
        icon: ShieldCheck,
        roles: [USER_ROLES.ADMIN, USER_ROLES.OPERATOR],
      },
      {
        label: "Multi-Region Sync",
        path: ROUTES.REPLICATION,
        icon: Globe,
      },
    ],
  },
  {
    group: "GOVERNANCE",
    items: [
      {
        label: "Audit Ledger",
        path: ROUTES.AUDIT,
        icon: History,
        roles: [USER_ROLES.ADMIN, USER_ROLES.AUDITOR],
      },
      {
        label: "IAM & RBAC Matrix",
        path: ROUTES.ACCESS_CONTROL,
        icon: Lock,
      },
    ],
  },
  {
    group: "ANALYTICS",
    items: [
      {
        label: "Snowflake & BI Hub",
        path: ROUTES.ANALYTICS,
        icon: BarChart3,
        roles: [USER_ROLES.ADMIN, USER_ROLES.AUDITOR],
      },
    ],
  },
];
