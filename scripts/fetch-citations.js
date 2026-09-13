#!/usr/bin/env node
// Scrapes citation counts off the public Google Scholar profile and writes them
// to a static JSON file so the site can read them same-origin.
//
// Scholar is used rather than OpenAlex or Semantic Scholar because it indexes
// preprints and unpublished citing work the others miss — at the time of
// writing it was the only source that saw both citations of MM-TS.
//
// The trade-off is that Scholar has no API and blocks datacenter IPs with a
// CAPTCHA, which CI runners frequently hit. Every failure mode here therefore
// keeps the previous counts rather than writing a wrong (or zero) number: a
// blocked run leaves the site showing the last good values.

const fs = require('fs');
const path = require('path');

const SCHOLAR_USER = 'liM0_m8AAAAJ';

// Keys match the data-citations attributes in index.html. scholarId is the
// suffix of Scholar's citation_for_view parameter, which is stable per paper;
// title is the fallback if Scholar ever re-issues the id (it does this when it
// merges duplicate entries).
const PAPERS = [
  {
    key: 'temo',
    scholarId: 'qjMakFHDy7sC',
    title: 'TeMo: Temperature Modulation for Multimodal Contrastive Learning',
  },
  {
    key: 'mmts',
    scholarId: 'd1gkVwhDpl0C',
    title: 'MM-TS: Multi-Modal Temperature and Margin Schedules for Contrastive Learning with Long-Tail Data',
  },
];

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'citations.json');

async function fetchProfile() {
  const url = new URL('https://scholar.google.com/citations');
  url.searchParams.set('user', SCHOLAR_USER);
  url.searchParams.set('hl', 'en');
  url.searchParams.set('cstart', '0');
  url.searchParams.set('pagesize', '100');

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }

  const body = await res.text();
  if (/captcha|unusual traffic|not a robot/i.test(body)) {
    throw new Error('blocked by Scholar (CAPTCHA)');
  }
  return body;
}

function decodeEntities(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// One row per publication: title link, Scholar id, and the cited-by cell, which
// is empty rather than "0" for an uncited paper.
function parseRows(body) {
  return Array.from(body.matchAll(/<tr class="gsc_a_tr">(.*?)<\/tr>/gs)).map(([, row]) => {
    const id = row.match(/citation_for_view=[^:]+:([^&"]+)/);
    const title = row.match(/class="gsc_a_at"[^>]*>(.*?)<\/a>/s);
    const cites = row.match(/class="gsc_a_ac[^"]*"[^>]*>(.*?)<\/a>/s);
    return {
      id: id ? id[1] : null,
      title: title ? decodeEntities(title[1]) : '',
      citationCount: cites ? Number(decodeEntities(cites[1])) || 0 : 0,
    };
  });
}

function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  // Start from the previous results so a blocked or partial run keeps the last
  // known counts instead of dropping them to zero.
  const stats = readExisting();

  let rows;
  try {
    rows = parseRows(await fetchProfile());
  } catch (err) {
    console.error('Failed to fetch Scholar profile:', err.message);
    console.error('Keeping previously fetched counts.');
    process.exitCode = 1;
    return;
  }

  if (rows.length === 0) {
    console.error('No publications parsed — Scholar markup may have changed.');
    console.error('Keeping previously fetched counts.');
    process.exitCode = 1;
    return;
  }

  for (const paper of PAPERS) {
    const row =
      rows.find((r) => r.id === paper.scholarId) ||
      rows.find((r) => normalizeTitle(r.title) === normalizeTitle(paper.title));

    if (!row) {
      console.error(`No Scholar entry found for ${paper.key} — keeping previous count.`);
      process.exitCode = 1;
      continue;
    }

    stats[paper.key] = {
      citationCount: row.citationCount,
      scholarId: row.id,
      updatedAt: new Date().toISOString(),
    };
    console.log(`${paper.key}: ${row.citationCount} citations`);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(stats, null, 2) + '\n');
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
