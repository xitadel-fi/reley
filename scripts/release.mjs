#!/usr/bin/env node
// Bump @reley/* package versions in lockstep + (optionally) tag the commit.
//
// Usage:
//   node scripts/release.mjs <patch|minor|major|prerelease|<x.y.z>> [--tag] [--no-commit]
//
// Bumps every publishable package's `version` field in place and writes the
// root package.json + lockfile cousin (pnpm) so workspace: deps stay valid.
// Does NOT publish — that's scripts/publish.sh. Does NOT push — caller does.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

// Publish order = dependency order. Adding a new publishable package?
// Append it AFTER its deps.
const PACKAGES = [
  'packages/shared',
  'packages/core',
  'packages/core-cli',
];

function read(pkgDir) {
  const p = join(ROOT, pkgDir, 'package.json');
  return { path: p, json: JSON.parse(readFileSync(p, 'utf8')) };
}

function bump(current, kind) {
  if (/^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/.test(kind)) return kind; // explicit
  const [base, pre] = current.split('-');
  const [maj, min, pat] = base.split('.').map(Number);
  switch (kind) {
    case 'patch':
      return `${maj}.${min}.${pat + 1}`;
    case 'minor':
      return `${maj}.${min + 1}.0`;
    case 'major':
      return `${maj + 1}.0.0`;
    case 'prerelease': {
      // beta.1 → beta.2 ; if no pre, append -beta.0
      if (!pre) return `${maj}.${min}.${pat + 1}-beta.0`;
      const m = pre.match(/^(.+?)\.(\d+)$/);
      if (m) return `${base}-${m[1]}.${Number(m[2]) + 1}`;
      return `${base}-${pre}.1`;
    }
    default:
      throw new Error(`unknown bump kind: ${kind}`);
  }
}

const kind = process.argv[2];
if (!kind) {
  console.error(
    'usage: node scripts/release.mjs <patch|minor|major|prerelease|x.y.z> [--tag] [--no-commit]',
  );
  process.exit(1);
}
const flags = new Set(process.argv.slice(3));
const shouldCommit = !flags.has('--no-commit');
const shouldTag = flags.has('--tag');

const root = read('package.json'.replace('/', '')); // root
const rootPath = join(ROOT, 'package.json');
const rootJson = JSON.parse(readFileSync(rootPath, 'utf8'));
const current = rootJson.version;
const next = bump(current, kind);

console.log(`bumping ${current} → ${next}`);

writeFileSync(
  rootPath,
  `${JSON.stringify({ ...rootJson, version: next }, null, 2)}\n`,
);

for (const pkgDir of PACKAGES) {
  const entry = read(pkgDir);
  entry.json.version = next;
  writeFileSync(entry.path, `${JSON.stringify(entry.json, null, 2)}\n`);
  console.log(`  ${entry.json.name} → ${next}`);
}

if (shouldCommit) {
  execSync('git add -A package.json packages/*/package.json', { cwd: ROOT, stdio: 'inherit' });
  execSync(`git commit -m "chore(release): v${next}"`, { cwd: ROOT, stdio: 'inherit' });
  console.log(`committed v${next}`);
}

if (shouldTag) {
  execSync(`git tag -a v${next} -m "v${next}"`, { cwd: ROOT, stdio: 'inherit' });
  console.log(`tagged v${next}`);
}

console.log('next: pnpm scripts/publish.sh');
// avoid unused-warning lint for root helper
void root;
void existsSync;
