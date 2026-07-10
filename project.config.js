// ═══════════════════════════════════════════════════════════════
// PROJECT TOKENS — Edit once when cloning for a new project
// ═══════════════════════════════════════════════════════════════

const project = {
  name: "my-app",
  domain: "myapp.com",
  description: "Brief description of what this app does",

  // ── Infrastructure ──
  infra: {
    cloud: "gcp",
    database: "cloud-sql-postgres",
    hosting: "cloud-run",
    email: "resend",
    fileStorage: "gcs",
    cache: "redis",
    region: "us-central1",
  },

  // ── Auth Configuration ──
  auth: {
    provider: "custom",
    sessionStrategy: "jwt-httponly",
    jwtExpiry: "15m",
    refreshExpiry: "7d",
    mfaEnabled: true,
    oauthProviders: ["google"],
    passwordPolicy: {
      minLength: 12,
      requireUpper: true,
      requireNumber: true,
      requireSymbol: false,
      bcryptRounds: 12,
    },
    magicLinkEnabled: true,
  },

  // ── Multi-Tenancy & Roles ──
  tenancy: {
    model: "account-based",
    entityLabel: "Account",

    roles: [
      {
        slug: "owner",
        label: "Owner",
        description: "Full control. Can delete account, manage billing, transfer ownership.",
        isDefault: false,
        permissions: ["*"],
      },
      {
        slug: "admin",
        label: "Administrator",
        description: "Manages users, settings, and most resources. Cannot delete account or transfer ownership.",
        isDefault: false,
        permissions: [
          "users:read", "users:invite", "users:update", "users:remove",
          "roles:read", "roles:assign",
          "settings:read", "settings:update",
          "resources:*",
          "billing:read",
        ],
      },
      {
        slug: "manager",
        label: "Manager",
        description: "Can manage resources and view team members. Cannot change settings or billing.",
        isDefault: false,
        permissions: [
          "users:read",
          "resources:*",
          "reports:read", "reports:create",
        ],
      },
      {
        slug: "member",
        label: "Member",
        description: "Standard access. Can use features and manage own profile.",
        isDefault: true,
        permissions: [
          "resources:read", "resources:create", "resources:update",
          "profile:*",
        ],
      },
      {
        slug: "viewer",
        label: "View Only",
        description: "Read-only access to resources they are granted access to.",
        isDefault: false,
        permissions: [
          "resources:read",
          "profile:read", "profile:update",
        ],
      },
    ],

    multiAccountMembership: true,
    maxUsersPerAccount: null,
    nestedAccounts: false,
  },

  // ── API Configuration ──
  api: {
    prefix: "/api/v1",
    rateLimit: {
      window: "15m",
      maxRequests: 100,
      authRoutes: 20,
    },
    pagination: {
      defaultLimit: 25,
      maxLimit: 100,
    },
    cors: {
      // PLACEHOLDER fallback only. In production the operator MUST set the
      // CORS_ORIGINS env var to the real deployed frontend origin(s); it takes
      // precedence over this list. Localhost is handled by the dev branch in
      // apps/api/src/index.js and is stripped from the production allow-list.
      origins: ["https://myapp.com", "http://localhost:5173"],
    },
  },
};

export default project;
