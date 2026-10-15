# Task 11b report
Implemented: auto-release removed (shouldAutoRelease, block, env var, .env.example, comments); response status always SUBMISSION_STATUS; unused imports canRelease/releaseRxCase removed (auditService, env, summariseLines still used).
ADMIN_NOTIFICATION_EMAIL: env parses comma list -> array of valid emails (undefined when blank; invalid entry fails boot). deliver() now accepts string|array for to/bcc, sanitises each address then joins with ", " (one Mailgun message). All 3 sites (approval request, autopay bcc, rx notice) pass the array. stagingRewrite untouched (still replaces to, drops bcc; subject shows joined list).
Copy: "before this case can be released to the lab".
Tests: replaced shouldAutoRelease test and rx-release auto-release test; new env.admin-email.test.js, email-admin-list.test.js. pnpm test: api 944/944, web 166, shared 73. web build OK. grep clean except the absence-asserting test.
Concern: the brief names POST /rx/cases, but the handler with the release block and arrival email is POST /rx/form-submissions (the /rx/cases handler at ~line 51 had neither); tests target form-submissions. /rx/cases sends no arrival email (pre-existing, untouched).
