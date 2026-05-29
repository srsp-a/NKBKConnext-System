'use strict';

const fs = require('fs');
const path = require('path');

const CMS_DIR = path.join(__dirname, '..', 'public-cms');
const MARKER = 'googletagmanager.com/gtag/js?id=G-DFHZN01J6L';
const SNIPPET = `  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-DFHZN01J6L"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-DFHZN01J6L');
  </script>
`;

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
}

const files = [];
walk(CMS_DIR, files);

for (const fp of files) {
  let html = fs.readFileSync(fp, 'utf8');
  if (html.includes(MARKER)) {
    console.log('skip', path.relative(CMS_DIR, fp));
    continue;
  }
  const needle = '<meta name="viewport" content="width=device-width, initial-scale=1" />';
  if (!html.includes(needle)) {
    console.warn('no viewport', path.relative(CMS_DIR, fp));
    continue;
  }
  html = html.replace(needle, needle + '\n' + SNIPPET.trimEnd());
  fs.writeFileSync(fp, html, 'utf8');
  console.log('inject', path.relative(CMS_DIR, fp));
}

console.log('done');
