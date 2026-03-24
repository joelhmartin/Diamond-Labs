export const ERROR_CODES = {
  // Auth
  INVALID_CREDENTIALS: { code: "INVALID_CREDENTIALS", status: 401, message: "Invalid email or password." },
  UNAUTHORIZED: { code: "UNAUTHORIZED", status: 401, message: "Authentication required." },
  FORBIDDEN: { code: "FORBIDDEN", status: 403, message: "You do not have permission to perform this action." },
  TOKEN_EXPIRED: { code: "TOKEN_EXPIRED", status: 401, message: "Token has expired." },
  TOKEN_INVALID: { code: "TOKEN_INVALID", status: 401, message: "Token is invalid." },
  REFRESH_TOKEN_INVALID: { code: "REFRESH_TOKEN_INVALID", status: 401, message: "Refresh token is invalid or expired." },
  MFA_REQUIRED: { code: "MFA_REQUIRED", status: 403, message: "Multi-factor authentication required." },
  MFA_INVALID_CODE: { code: "MFA_INVALID_CODE", status: 401, message: "Invalid MFA code." },
  ACCOUNT_LOCKED: { code: "ACCOUNT_LOCKED", status: 423, message: "Account is temporarily locked due to too many failed attempts." },

  // User
  EMAIL_ALREADY_EXISTS: { code: "EMAIL_ALREADY_EXISTS", status: 409, message: "A user with this email already exists." },
  USER_NOT_FOUND: { code: "USER_NOT_FOUND", status: 404, message: "User not found." },
  EMAIL_NOT_VERIFIED: { code: "EMAIL_NOT_VERIFIED", status: 403, message: "Please verify your email address." },
  USER_SUSPENDED: { code: "USER_SUSPENDED", status: 403, message: "Your account has been suspended." },
  INCORRECT_PASSWORD: { code: "INCORRECT_PASSWORD", status: 401, message: "Current password is incorrect." },

  // Account
  ACCOUNT_NOT_FOUND: { code: "ACCOUNT_NOT_FOUND", status: 404, message: "Account not found." },
  ACCOUNT_SLUG_TAKEN: { code: "ACCOUNT_SLUG_TAKEN", status: 409, message: "This account URL is already taken." },
  NOT_ACCOUNT_MEMBER: { code: "NOT_ACCOUNT_MEMBER", status: 403, message: "You are not a member of this account." },

  // Membership
  MEMBERSHIP_NOT_FOUND: { code: "MEMBERSHIP_NOT_FOUND", status: 404, message: "Membership not found." },
  ALREADY_MEMBER: { code: "ALREADY_MEMBER", status: 409, message: "User is already a member of this account." },
  CANNOT_REMOVE_OWNER: { code: "CANNOT_REMOVE_OWNER", status: 403, message: "Cannot remove the account owner." },
  CANNOT_CHANGE_OWNER_ROLE: { code: "CANNOT_CHANGE_OWNER_ROLE", status: 403, message: "Cannot change the owner's role." },

  // Invitation
  INVITATION_NOT_FOUND: { code: "INVITATION_NOT_FOUND", status: 404, message: "Invitation not found." },
  INVITATION_EXPIRED: { code: "INVITATION_EXPIRED", status: 410, message: "This invitation has expired." },
  INVITATION_ALREADY_ACCEPTED: { code: "INVITATION_ALREADY_ACCEPTED", status: 409, message: "This invitation has already been accepted." },
  INVITATION_ALREADY_EXISTS: { code: "INVITATION_ALREADY_EXISTS", status: 409, message: "An invitation for this email already exists." },

  // General
  VALIDATION_ERROR: { code: "VALIDATION_ERROR", status: 422, message: "Validation failed." },
  NOT_FOUND: { code: "NOT_FOUND", status: 404, message: "Resource not found." },
  RATE_LIMITED: { code: "RATE_LIMITED", status: 429, message: "Too many requests. Please try again later." },
  INTERNAL_ERROR: { code: "INTERNAL_ERROR", status: 500, message: "An internal error occurred." },
};
