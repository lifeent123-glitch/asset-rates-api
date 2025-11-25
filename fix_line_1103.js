import { readFileSync, writeFileSync } from 'fs';

const content = readFileSync('rates-api.js', 'utf-8');

// Fix: Error` → Error(`
const fixed = content.replace(
  'new Error`FX timeseries fetch failed:',
  'new Error(`FX timeseries fetch failed:'
);

writeFileSync('rates-api.js', fixed);
console.log('✅ Fixed: Error` → Error(`');
