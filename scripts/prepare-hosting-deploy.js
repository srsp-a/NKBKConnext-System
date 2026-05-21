/**
 * คัดลอก static จาก Github/V2 → hosting-dist/<target>
 * รวม shared/auth-tracker.js สำหรับหน้าที่อ้าง /shared/
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const configPath = path.join(root, 'hosting-sites.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const v2Root = path.resolve(root, config.v2Root);
const outRoot = path.join(root, 'hosting-dist');

if (!fs.existsSync(v2Root)) {
  console.error('[prepare-hosting-deploy] ไม่พบ V2:', v2Root);
  process.exit(1);
}

const sharedSrc = path.join(v2Root, 'shared');

function copyDir(from, to, filterFn) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    filter: (srcPath) => {
      const rel = path.relative(from, srcPath);
      if (!rel) return true;
      if (rel === 'node_modules' || rel.startsWith('node_modules' + path.sep)) return false;
      if (rel === '.git' || rel.startsWith('.git' + path.sep)) return false;
      if (filterFn && !filterFn(srcPath, rel)) return false;
      return true;
    }
  });
}

function copyShared(destDir) {
  if (!fs.existsSync(sharedSrc)) return;
  const dest = path.join(destDir, 'shared');
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(sharedSrc, dest, { recursive: true });
}

for (const site of config.sites) {
  if (site.itSrc) {
    console.log('[prepare-hosting-deploy]', site.target, 'skip (IT repo:', site.itSrc + ')');
    continue;
  }

  const dest = path.join(outRoot, site.target);
  fs.rmSync(dest, { recursive: true, force: true });

  if (site.portalFromAdmin) {
    const portalSrc = path.join(v2Root, 'admin', 'portal');
    const adminSrc = path.join(v2Root, 'admin');
    if (!fs.existsSync(portalSrc)) {
      console.error('[prepare-hosting-deploy] ไม่พบ portal:', portalSrc);
      process.exit(1);
    }
    copyDir(portalSrc, dest);
    for (const extra of ['tailwind-output.css', 'tailwind-output.css.map']) {
      const f = path.join(adminSrc, extra);
      if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dest, extra));
    }
    if (site.shared) copyShared(dest);
    const portalIndex = path.join(dest, 'index.html');
    if (fs.existsSync(portalIndex)) {
      let html = fs.readFileSync(portalIndex, 'utf8');
      html = html.replace(/\.\.\/tailwind-output\.css/g, './tailwind-output.css');
      fs.writeFileSync(portalIndex, html);
    }
    console.log('[prepare-hosting-deploy]', site.target, '<- admin/portal (+ assets)');
    continue;
  }

  const srcDir = path.join(v2Root, site.src || '.');
  if (!fs.existsSync(srcDir)) {
    console.error('[prepare-hosting-deploy] ไม่พบ', srcDir);
    process.exit(1);
  }

  if (site.srcOnly && Array.isArray(site.srcOnly)) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of site.srcOnly) {
      const f = path.join(srcDir, name);
      if (!fs.existsSync(f)) {
        console.error('[prepare-hosting-deploy] ไม่พบไฟล์', f);
        process.exit(1);
      }
      fs.copyFileSync(f, path.join(dest, name));
    }
  } else {
    copyDir(srcDir, dest);
  }

  if (site.shared) copyShared(dest);
  console.log('[prepare-hosting-deploy]', site.target, '<-', site.src || '.');
}

console.log('[prepare-hosting-deploy] OK ->', outRoot);
