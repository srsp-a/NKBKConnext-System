/** สร้าง hosting entries ใน firebase.json จาก hosting-sites.config.json */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const firebasePath = path.join(root, 'firebase.json');
const config = JSON.parse(fs.readFileSync(path.join(root, 'hosting-sites.config.json'), 'utf8'));
const block = JSON.parse(fs.readFileSync(path.join(__dirname, 'hosting-static-block.json'), 'utf8'));

const firebase = JSON.parse(fs.readFileSync(firebasePath, 'utf8'));
const apiTargets = new Set(['monitor', 'line']);
const kept = firebase.hosting.filter((h) => apiTargets.has(h.target));

const staticHosting = config.sites.map((site) => ({
  target: site.target,
  public: `hosting-dist/${site.target}`,
  ...block
}));

firebase.hosting = [...kept, ...staticHosting];
fs.writeFileSync(firebasePath, JSON.stringify(firebase, null, 2) + '\n');
console.log('[merge-firebase-hosting] hosting targets:', firebase.hosting.map((h) => h.target).join(', '));
