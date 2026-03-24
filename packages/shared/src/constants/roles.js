export const ROLES = [
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
];

export const ROLE_SLUGS = ROLES.map((r) => r.slug);

export const DEFAULT_ROLE = ROLES.find((r) => r.isDefault);

export function getRoleBySlug(slug) {
  return ROLES.find((r) => r.slug === slug);
}
