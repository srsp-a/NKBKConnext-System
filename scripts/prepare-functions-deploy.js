/**

 * ก่อน firebase deploy — คัดลอก monitor-api + line-webhook เข้า functions/ และ npm install

 * (Cloud Build ไม่เห็นโฟลเดอร์นอก functions/)

 */

const { execSync } = require('child_process');

const fs = require('fs');

const path = require('path');



const root = path.join(__dirname, '..');

const functionsDir = path.join(root, 'functions');

const lineSrc = path.join(root, '..', 'Github', 'V2', 'line-webhook');



function copyDir(from, to) {

  fs.rmSync(to, { recursive: true, force: true });

  fs.cpSync(from, to, {

    recursive: true,

    filter: (srcPath) => {

      const rel = path.relative(from, srcPath);

      if (!rel) return true;

      if (rel === 'node_modules') return false;

      if (rel === '.env') return false;

      if (rel === 'attendance_notify_sent.json') return false;

      return true;

    }

  });

}



const monitorSrc = path.join(root, 'monitor-api');

const monitorDest = path.join(functionsDir, 'monitor-api');

const lineDest = path.join(functionsDir, 'line-webhook');



copyDir(monitorSrc, monitorDest);

console.log('[prepare-functions-deploy] copied monitor-api -> functions/monitor-api');

const libSrc = path.join(root, 'lib');
const libDest = path.join(functionsDir, 'lib');
fs.mkdirSync(libDest, { recursive: true });
for (const name of ['nkbk-ai.js', 'nkbk-ai-routes.js']) {
  fs.copyFileSync(path.join(libSrc, name), path.join(libDest, name));
}
console.log('[prepare-functions-deploy] copied lib/nkbk-ai*.js -> functions/lib');



if (!fs.existsSync(lineSrc)) {

  console.error('[prepare-functions-deploy] ไม่พบ', lineSrc);

  process.exit(1);

}

copyDir(lineSrc, lineDest);

console.log('[prepare-functions-deploy] copied line-webhook -> functions/line-webhook');



execSync('npm install', { cwd: monitorDest, stdio: 'inherit' });

execSync('npm install', { cwd: lineDest, stdio: 'inherit' });

execSync('npm install', { cwd: functionsDir, stdio: 'inherit' });

console.log('[prepare-functions-deploy] OK');

