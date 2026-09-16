// Identifies the deployed build. Vercel sets VERCEL_GIT_COMMIT_SHA at build
// time. The display compares this against the value it loaded with and
// reloads itself when a new deploy ships, so long-running TVs don't keep
// executing stale JavaScript for days.
export const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
  "dev";
