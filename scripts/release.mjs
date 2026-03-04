#!/usr/bin/env node

/**
 * Release helper — bumps version in package.json + tauri.conf.json,
 * commits, tags, and pushes so GitHub Actions builds the release.
 *
 * Usage:
 *   node scripts/release.mjs patch   # 0.1.0 → 0.1.1
 *   node scripts/release.mjs minor   # 0.1.0 → 0.2.0
 *   node scripts/release.mjs major   # 0.1.0 → 1.0.0
 *   node scripts/release.mjs 1.2.3   # explicit version
 */

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const PKG_PATH = resolve(root, "package.json");
const TAURI_PATH = resolve(root, "src-tauri/tauri.conf.json");

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function bump(current, type) {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (type) {
    case "major": return `${major + 1}.0.0`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "patch": return `${major}.${minor}.${patch + 1}`;
    default:
      // Treat as explicit version if it looks like semver
      if (/^\d+\.\d+\.\d+$/.test(type)) return type;
      console.error(`Unknown bump type: ${type}`);
      console.error("Usage: node scripts/release.mjs [patch|minor|major|x.y.z]");
      process.exit(1);
  }
}

function run(cmd) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

// --- Main ---

const bumpType = process.argv[2] || "patch";
const pkg = readJSON(PKG_PATH);
const tauri = readJSON(TAURI_PATH);

const oldVersion = pkg.version;
const newVersion = bump(oldVersion, bumpType);

console.log(`\n🔖 Bumping version: ${oldVersion} → ${newVersion}\n`);

// Update both files
pkg.version = newVersion;
writeJSON(PKG_PATH, pkg);

tauri.version = newVersion;
writeJSON(TAURI_PATH, tauri);

console.log(`  ✅ Updated package.json`);
console.log(`  ✅ Updated tauri.conf.json\n`);

// Git commit, tag, push
run(`git add package.json src-tauri/tauri.conf.json`);
run(`git commit -m "release: v${newVersion}"`);
run(`git tag v${newVersion}`);
run(`git push`);
run(`git push --tags`);

console.log(`\n🚀 Release v${newVersion} tagged and pushed!`);
console.log(`   GitHub Actions will now build and publish the release.\n`);
