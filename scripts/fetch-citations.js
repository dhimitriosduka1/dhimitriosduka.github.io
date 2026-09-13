#!/usr/bin/env node
// Fetches citation counts from OpenAlex and writes them to a static JSON file
// so the site can read them same-origin.
//
// A paper often has several OpenAlex records (preprint, proceedings version,
// duplicates), and citations split across them. Instead of summing the
// per-record counts — which would double-count a work citing more than one
// record — we resolve every record for a paper and ask OpenAlex for the number
// of distinct works citing any of them.

const fs = require('fs');
const path = require('path');

// Identifies us to OpenAlex's polite pool, which gets faster, more reliable
// service than anonymous requests.
const MAILTO = 'duka.dhimitrios1@gmail.com';

const PAPERS = [
  {
    key: 'temo',
    title: 'TeMo: Temperature Modulation for Multimodal Contrastive Learning',
  },
  {
    key: 'mmts',
    title: 'MM-TS: Multi-Modal Temperature and Margin Schedules for Contrastive Learning with Long-Tail Data',
  },
];

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'citations.json');

async function openAlex(endpoint, params) {
  const url = new URL(`https://api.openalex.org/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('mailto', MAILTO);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }
  return res.json();
}

// OpenAlex title search is fuzzy, so we keep only records whose title actually
// matches the one we configured.
function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function fetchRecordIds(title) {
  const data = await openAlex('works', {
    filter: `title.search:${title}`,
    select: 'id,display_name',
    per_page: '50',
  });

  const wanted = normalizeTitle(title);
  return data.results
    .filter((work) => normalizeTitle(work.display_name || '') === wanted)
    // The cites: filter takes bare work IDs, not full OpenAlex URLs.
    .map((work) => work.id.replace('https://openalex.org/', ''));
}

async function fetchCitationCount(title) {
  const recordIds = await fetchRecordIds(title);
  if (recordIds.length === 0) {
    throw new Error('no matching OpenAlex records');
  }

  const data = await openAlex('works', {
    filter: `cites:${recordIds.join('|')}`,
    select: 'id',
    per_page: '1',
  });

  return { citationCount: data.meta.count, recordIds };
}

function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  // Start from the previous results so a transient failure for one paper keeps
  // its last known count instead of dropping the badge.
  const stats = readExisting();

  for (const paper of PAPERS) {
    try {
      const { citationCount, recordIds } = await fetchCitationCount(paper.title);
      stats[paper.key] = {
        citationCount,
        openAlexIds: recordIds,
        updatedAt: new Date().toISOString(),
      };
      console.log(`${paper.key}: ${citationCount} citations (${recordIds.length} record(s))`);
    } catch (err) {
      console.error(`Failed to fetch citations for ${paper.key}:`, err.message);
      process.exitCode = 1;
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(stats, null, 2) + '\n');
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
