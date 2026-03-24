#!/usr/bin/env node

/**
 * Setup script — reads project.config.js and rewrites all static files
 * that can't dynamically import the config at runtime.
 *
 * Usage: pnpm setup (or node scripts/setup.js)
 *
 * What it does:
 * 1. Replaces @my-app/ namespace with @{project.name}/ across all package.json and source files
 * 2. Rewrites root package.json name
 * 3. Rewrites docker-compose.yml DB name
 * 4. Rewrites .github/workflows/ci.yml DB name + URL
 * 5. Rewrites .github/workflows/deploy.yml image name + region
 * 6. Rewrites .env.example DB URL + email from
 * 7. Rewrites apps/web/index.html title
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");

// Import project config
const { default: project } = await import(join(ROOT, "project.config.js"));

const OLD_NAMESPACE = "@my-app/";
const NEW_NAMESPACE = `@${project.name}/`;
const OLD_DB_NAME = "myapp";
const NEW_DB_NAME = project.name.replace(/-/g, "_");
const OLD_IMAGE_NAME = "my-app-api";
const NEW_IMAGE_NAME = `${project.name}-api`;
const OLD_REGION = "us-central1";
const NEW_REGION = project.infra.region;

// Formats the project name as a title (my-app → My App)
function toTitle(name) {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function readFile(relPath) {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

function writeFile(relPath, content) {
  writeFileSync(join(ROOT, relPath), content, "utf-8");
  console.log(`  ✓ ${relPath}`);
}

// ─── 1. Namespace replacement across all relevant files ──────────────────────

const NAMESPACE_EXTENSIONS = new Set([".json", ".js", ".jsx", ".ts", ".tsx"]);

function walkDir(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "pnpm-lock.yaml") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkDir(full, files);
    } else if (NAMESPACE_EXTENSIONS.has(extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

if (OLD_NAMESPACE !== NEW_NAMESPACE) {
  console.log(`\nReplacing namespace ${OLD_NAMESPACE} → ${NEW_NAMESPACE}`);
  const files = walkDir(ROOT);
  let count = 0;
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    if (content.includes(OLD_NAMESPACE)) {
      writeFileSync(file, content.replaceAll(OLD_NAMESPACE, NEW_NAMESPACE), "utf-8");
      const rel = file.slice(ROOT.length + 1);
      console.log(`  ✓ ${rel}`);
      count++;
    }
  }
  console.log(`  ${count} files updated`);
} else {
  console.log("\nNamespace unchanged, skipping.");
}

// ─── 2. Root package.json name ───────────────────────────────────────────────

console.log("\nUpdating root package.json");
const rootPkg = JSON.parse(readFile("package.json"));
rootPkg.name = project.name;
writeFile("package.json", JSON.stringify(rootPkg, null, 2) + "\n");

// ─── 3. docker-compose.yml ──────────────────────────────────────────────────

console.log("\nUpdating docker-compose.yml");
let dc = readFile("docker-compose.yml");
dc = dc.replaceAll(`POSTGRES_DB: ${OLD_DB_NAME}`, `POSTGRES_DB: ${NEW_DB_NAME}`);
dc = dc.replaceAll(
  `postgresql://postgres:postgres@postgres:5432/${OLD_DB_NAME}`,
  `postgresql://postgres:postgres@postgres:5432/${NEW_DB_NAME}`
);
writeFile("docker-compose.yml", dc);

// ─── 4. .github/workflows/ci.yml ───────────────────────────────────────────

console.log("\nUpdating .github/workflows/ci.yml");
let ci = readFile(".github/workflows/ci.yml");
ci = ci.replaceAll(`POSTGRES_DB: ${OLD_DB_NAME}_test`, `POSTGRES_DB: ${NEW_DB_NAME}_test`);
ci = ci.replaceAll(
  `postgresql://postgres:postgres@localhost:5432/${OLD_DB_NAME}_test`,
  `postgresql://postgres:postgres@localhost:5432/${NEW_DB_NAME}_test`
);
writeFile(".github/workflows/ci.yml", ci);

// ─── 5. .github/workflows/deploy.yml ───────────────────────────────────────

console.log("\nUpdating .github/workflows/deploy.yml");
let deploy = readFile(".github/workflows/deploy.yml");
deploy = deploy.replaceAll(OLD_IMAGE_NAME, NEW_IMAGE_NAME);
deploy = deploy.replaceAll(`--region ${OLD_REGION}`, `--region ${NEW_REGION}`);
writeFile(".github/workflows/deploy.yml", deploy);

// ─── 6. .env.example ────────────────────────────────────────────────────────

console.log("\nUpdating .env.example");
let envExample = readFile(".env.example");
envExample = envExample.replaceAll(
  `postgresql://postgres:postgres@localhost:5432/${OLD_DB_NAME}`,
  `postgresql://postgres:postgres@localhost:5432/${NEW_DB_NAME}`
);
envExample = envExample.replaceAll(
  `EMAIL_FROM=noreply@${OLD_DB_NAME}.com`,
  `EMAIL_FROM=noreply@${project.domain}`
);
writeFile(".env.example", envExample);

// ─── 7. apps/web/index.html ────────────────────────────────────────────────

console.log("\nUpdating apps/web/index.html");
let html = readFile("apps/web/index.html");
html = html.replace(/<title>.*<\/title>/, `<title>${toTitle(project.name)}</title>`);
writeFile("apps/web/index.html", html);

console.log("\n✅ Setup complete. You can now run: pnpm install\n");
