#!/usr/bin/env node
/**
 * cc-focus — Are you spreading too thin across projects?
 *
 * Measures project scatter per week: how many different projects
 * you used Claude Code in. Low scatter = deep focus. High scatter = exploration.
 *
 * Trend: are you converging (getting more focused) or diverging (spreading)?
 *
 * Zero dependencies. Node.js 18+. ESM.
 *
 * Usage:
 *   npx cc-focus           # Last 8 weeks
 *   npx cc-focus --weeks=4 # Specific window
 *   npx cc-focus --json    # JSON output
 */

import { readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const MAX_SESSION_HOURS = 8;

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const helpFlag  = args.includes('--help') || args.includes('-h');
const jsonFlag  = args.includes('--json');
const weeksArg  = parseInt(args.find(a => a.startsWith('--weeks='))?.slice(8) ?? '8');
const nWeeks    = Math.min(Math.max(weeksArg, 2), 52);

if (helpFlag) {
  console.log(`cc-focus — Are you spreading too thin across projects?

USAGE
  npx cc-focus           # Last 8 weeks of project scatter
  npx cc-focus --weeks=4 # Specific window (2-52)
  npx cc-focus --json    # JSON output

OUTPUT
  Weekly project scatter: how many different projects you touched each week.
  Trend: converging (getting focused) vs diverging (spreading thin).
`);
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function readFirstLastLine(filePath) {
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    if (bytesRead === 0) return null;
    const firstChunk = buf.toString('utf8', 0, bytesRead);
    const nl = firstChunk.indexOf('\n');
    const firstLine = nl >= 0 ? firstChunk.substring(0, nl) : firstChunk;
    const fileStat = await fh.stat();
    const size = fileStat.size;
    if (size < 2) return { firstLine, lastLine: firstLine };
    const readSize = Math.min(65536, size);
    const tailBuf = Buffer.alloc(readSize);
    const { bytesRead: tb } = await fh.read(tailBuf, 0, readSize, size - readSize);
    const lines = tailBuf.toString('utf8', 0, tb).split('\n').filter(l => l.trim());
    return { firstLine, lastLine: lines[lines.length - 1] || firstLine };
  } finally { await fh.close(); }
}

function parseTimestamp(jsonLine) {
  try {
    const d = JSON.parse(jsonLine);
    const ts = d.timestamp || d.ts;
    if (ts) return new Date(ts);
  } catch {}
  return null;
}

// Decode ~/.claude/projects/<dirname> to a project label
// Format: -home-namakusa-projects-spell-cascade → "spell-cascade"
// We just want the last segment of the decoded path.
function decodeProjectDir(dirName) {
  // strip leading dash, replace dashes with slashes to get path
  // then take the last component
  // Note: this is approximate (path hyphens vs separator hyphens are ambiguous)
  // but the last component is reliably the project folder name
  const withSlashes = ('/' + dirName).replace(/-/g, '/');
  const parts = withSlashes.split('/').filter(Boolean);
  return parts[parts.length - 1] || dirName;
}

function weekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekKey(date) {
  return weekStart(date).toISOString().slice(0, 10);
}

// ── Compute date range ────────────────────────────────────────────────────────
const now = new Date();
const cutoff = new Date(now);
cutoff.setDate(cutoff.getDate() - nWeeks * 7);

// ── Scan sessions ─────────────────────────────────────────────────────────────
if (!jsonFlag) process.stdout.write('  Reading session data...\r');

const projectsDir = join(HOME, '.claude', 'projects');
// weekKey → { projects: Set<string>, sessions: number, hours: number }
const weekBuckets = {};

let projectDirs;
try { projectDirs = await readdir(projectsDir); } catch { projectDirs = []; }

for (const projDir of projectDirs) {
  const projPath = join(projectsDir, projDir);
  const ps = await stat(projPath).catch(() => null);
  if (!ps?.isDirectory()) continue;
  const projectLabel = decodeProjectDir(projDir);
  let files;
  try { files = await readdir(projPath); } catch { continue; }

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    const fp = join(projPath, file);
    const fs2 = await stat(fp).catch(() => null);
    if (!fs2 || fs2.size < 50) continue;
    try {
      const r = await readFirstLastLine(fp);
      if (!r) continue;
      const s = parseTimestamp(r.firstLine);
      const e = parseTimestamp(r.lastLine);
      if (!s || !e) continue;
      const durMs = e - s;
      if (durMs < 0 || durMs > 7 * 24 * 60 * 60 * 1000) continue;
      const durH = durMs / (1000 * 60 * 60);
      if (durH > MAX_SESSION_HOURS) continue;
      if (s < cutoff) continue;

      const k = weekKey(s);
      if (!weekBuckets[k]) weekBuckets[k] = { projects: new Set(), sessions: 0, hours: 0 };
      weekBuckets[k].projects.add(projectLabel);
      weekBuckets[k].sessions++;
      weekBuckets[k].hours += durH;
    } catch {}
  }
}

// ── Generate week slots ───────────────────────────────────────────────────────
const weeks = [];
let d = new Date(weekStart(cutoff));
while (d <= now) {
  weeks.push(d.toISOString().slice(0, 10));
  d = new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000);
}

const weekData = weeks.map(k => {
  const b = weekBuckets[k] || { projects: new Set(), sessions: 0, hours: 0 };
  return {
    weekStart: k,
    projectCount: b.projects.size,
    projects: [...b.projects].sort(),
    sessions: b.sessions,
    hours: Math.round(b.hours * 10) / 10,
  };
});

// ── Compute trend ─────────────────────────────────────────────────────────────
const activeWeeks = weekData.filter(w => w.sessions > 0);
let trend = 'insufficient data';
let trendDir = '';

if (activeWeeks.length >= 4) {
  const first2 = activeWeeks.slice(0, Math.floor(activeWeeks.length / 2));
  const last2  = activeWeeks.slice(Math.ceil(activeWeeks.length / 2));
  const avgFirst = first2.reduce((s, w) => s + w.projectCount, 0) / first2.length;
  const avgLast  = last2.reduce((s, w) => s + w.projectCount, 0) / last2.length;
  const pct = avgFirst > 0 ? ((avgLast - avgFirst) / avgFirst) * 100 : 0;
  if (pct > 15)       { trend = 'diverging (+' + Math.round(pct) + '%)';  trendDir = 'up'; }
  else if (pct < -15) { trend = 'converging (' + Math.round(pct) + '%)';  trendDir = 'down'; }
  else                { trend = 'stable ('   + (pct >= 0 ? '+' : '') + Math.round(pct) + '%)'; trendDir = 'flat'; }
}

// ── JSON output ───────────────────────────────────────────────────────────────
if (jsonFlag) {
  console.log(JSON.stringify({
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    weeks: nWeeks,
    trend,
    trendDir,
    weeklyFocus: weekData,
  }, null, 2));
  process.exit(0);
}

// ── Terminal output ───────────────────────────────────────────────────────────
process.stdout.write('\x1b[2K\r');

const bold   = '\x1b[1m';
const dim    = '\x1b[2m';
const reset  = '\x1b[0m';
const purple = '\x1b[35m';
const green  = '\x1b[32m';
const cyan   = '\x1b[36m';
const orange = '\x1b[33m';
const red    = '\x1b[31m';
const muted  = '\x1b[90m';

const maxProjects = Math.max(...weekData.map(w => w.projectCount), 1);
const BAR_WIDTH   = 20;

console.log(`\n${bold}  cc-focus${reset}${muted} — project scatter per week (last ${nWeeks} weeks)${reset}\n`);

console.log(`  ${muted}${'Week'.padEnd(12)} ${'Projects'.padStart(9)}  ${'Sessions'.padStart(9)}  ${'Hours'.padStart(6)}  Scatter${reset}`);
console.log(`  ${'─'.repeat(65)}`);

for (const w of weekData) {
  const date    = new Date(w.weekStart + 'T00:00:00Z');
  const label   = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const pc      = w.projectCount;
  const noData  = w.sessions === 0;

  // Color based on scatter level
  const barColor = noData ? muted
    : pc <= 2  ? green
    : pc <= 4  ? cyan
    : pc <= 7  ? orange
    : red;

  const barLen = noData ? 0 : Math.max(1, Math.round(pc / maxProjects * BAR_WIDTH));
  const bar    = noData
    ? dim + '░'.repeat(BAR_WIDTH) + reset
    : barColor + '█'.repeat(barLen) + muted + '░'.repeat(BAR_WIDTH - barLen) + reset;

  const focusLabel = noData ? muted + '— no sessions' + reset
    : pc === 1 ? green + bold + '1 project (deep focus)' + reset
    : pc <= 3  ? cyan  + `${pc} projects` + reset
    : pc <= 6  ? orange + `${pc} projects` + reset
    : red + bold + `${pc} projects (scattered)` + reset;

  const labelPad = label.padEnd(12);
  const pcStr    = noData ? muted + '—'.padStart(9) + reset : barColor + String(pc).padStart(9) + reset;
  const sessStr  = noData ? muted + '—'.padStart(9) + reset : String(w.sessions).padStart(9);
  const hStr     = noData ? muted + '—'.padStart(6) + reset : cyan + (w.hours.toFixed(1)).padStart(5) + 'h' + reset;

  console.log(`  ${labelPad} ${pcStr}  ${sessStr}  ${hStr}  ${bar}`);

  // Show project names if focused (<=3 projects)
  if (!noData && pc <= 4 && w.projects.length > 0) {
    console.log(`  ${' '.repeat(13)} ${muted}${w.projects.join(', ')}${reset}`);
  }
}

console.log(`  ${'─'.repeat(65)}\n`);

// Summary
const trendColor = trendDir === 'down' ? green
  : trendDir === 'up' ? red
  : cyan;

const avgProjectCount = activeWeeks.length > 0
  ? (activeWeeks.reduce((s, w) => s + w.projectCount, 0) / activeWeeks.length).toFixed(1)
  : '—';

const focusStyle = parseFloat(avgProjectCount) <= 2 ? green + 'Deep coder 🎯'
  : parseFloat(avgProjectCount) <= 4 ? cyan + 'Balanced builder 🧩'
  : parseFloat(avgProjectCount) <= 7 ? orange + 'Project juggler ⚡'
  : red + 'Context switcher 🌀';

console.log(`  ${bold}Summary${reset}`);
console.log(`    Avg projects/week  ${bold}${avgProjectCount}${reset}`);
console.log(`    Focus trend        ${bold}${trendColor}${trend}${reset}`);
console.log(`    Style              ${bold}${focusStyle}${reset}`);
console.log();
