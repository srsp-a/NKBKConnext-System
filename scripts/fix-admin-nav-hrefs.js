const fs = require('fs');
const path = require('path');
const indexPath = path.join(__dirname, '../../Github/V2/admin/index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(
  /data-section="dashboard" href="#dashboard"/,
  'data-section="dashboard" href="/"'
);
html = html.replace(
  /(<a class="nav-item[^"]*" data-section="([a-z0-9_]+)") href="#\2"/g,
  (_, anchor, section) => (section === 'dashboard' ? `${anchor} href="/"` : `${anchor} href="/${section}"`)
);
fs.writeFileSync(indexPath, html);
console.log('[fix-admin-nav-hrefs] updated', indexPath);
