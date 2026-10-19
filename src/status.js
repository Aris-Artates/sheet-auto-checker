#!/usr/bin/env node
/** Prints the latest result of every test row as one __SUMMARY__ line (used by the UI). */
import { loadStatus } from './sheet.js';
import { summaryLine } from './notify.js';

try {
  console.log(summaryLine({ kind: 'status', rows: await loadStatus() }));
} catch (e) {
  console.log(summaryLine({ kind: 'status', error: String(e.message || e) }));
}
