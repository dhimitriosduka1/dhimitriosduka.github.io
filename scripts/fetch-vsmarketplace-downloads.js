#!/usr/bin/env node
// Fetches VS Code Marketplace download counts and writes them to a static
// JSON file so the site can read them same-origin (the marketplace's
// gallery API is not reliably CORS-fetchable from browsers).

const fs = require('fs');
const path = require('path');

const EXTENSION_IDS = ['DhimitriosDuka.slurm-cluster-manager'];

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'vsmarketplace-stats.json');

async function fetchDownloadCount(extensionId) {
  const res = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json;api-version=3.0-preview.1',
    },
    body: JSON.stringify({
      filters: [{ criteria: [{ filterType: 7, value: extensionId }] }],
      flags: 914,
    }),
  });

  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }

  const data = await res.json();
  const extension = data.results[0].extensions[0];
  const stats = extension.statistics;
  const downloadCount = stats.find((s) => s.statisticName === 'downloadCount');
  return Number(downloadCount && downloadCount.value) || 0;
}

async function main() {
  const stats = {};

  for (const extensionId of EXTENSION_IDS) {
    try {
      const downloadCount = await fetchDownloadCount(extensionId);
      stats[extensionId] = { downloadCount, updatedAt: new Date().toISOString() };
      console.log(`${extensionId}: ${downloadCount} downloads`);
    } catch (err) {
      console.error(`Failed to fetch stats for ${extensionId}:`, err.message);
      process.exitCode = 1;
    }
  }

  if (Object.keys(stats).length > 0) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(stats, null, 2) + '\n');
    console.log(`Wrote ${OUTPUT_PATH}`);
  }
}

main();
