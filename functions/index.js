/**

 * Firebase Cloud Functions — NKBK

 * Phase 1: monitorApi — monitor-api.nkbkcoop.com

 * Phase 2: lineApi + cron — api-line.nkbkcoop.com

 */



const { onRequest } = require('firebase-functions/v2/https');

const { onSchedule } = require('firebase-functions/v2/scheduler');

const { setGlobalOptions } = require('firebase-functions/v2');



setGlobalOptions({

  region: 'asia-southeast1',

  maxInstances: 20

});



// --- Monitor API (Phase 1) ---

process.env.SKIP_HTTP_LISTEN = '1';

process.env.MONITOR_API_BASE_PATH = '';

process.env.MONITOR_API_NO_AUTO_STRIP = '1';

process.env.MONITOR_PUBLIC_ORIGIN =

  process.env.MONITOR_PUBLIC_ORIGIN || 'https://monitor-api.nkbkcoop.com';



const monitorApp = require('./monitor-api/server');



exports.monitorApi = onRequest(

  {

    invoker: 'public',

    cors: true,

    memory: '512MiB',

    timeoutSeconds: 120,

    secrets: [

      'MONITOR_SYSTEM_UPLOAD_SECRET',

      'MONITOR_SYSTEM_PUBLIC_READ_KEY',

      'LINE_LOGIN_CHANNEL_ID',

      'LINE_LOGIN_CHANNEL_SECRET'

    ]

  },

  monitorApp

);



// --- LINE / API หลัก (Phase 2) ---

const line = require('./line-webhook/server');



async function lineHttpHandler(req, res) {

  await line.ensureBootstrapped();

  if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {

    await line.bufferRequestBody(req);

  }

  line.server.emit('request', req, res);

}



exports.lineApi = onRequest(

  {

    invoker: 'public',

    cors: true,

    memory: '1GiB',

    timeoutSeconds: 120,

    minInstances: 1,

    secrets: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_EMAIL_API_TOKEN']

  },

  lineHttpHandler

);



const cronOpts = {

  region: 'asia-southeast1',

  timeZone: 'Asia/Bangkok',

  memory: '512MiB',

  timeoutSeconds: 300

};



exports.lineCronAttendanceNotify = onSchedule(

  { ...cronOpts, schedule: 'every 1 minutes' },

  async () => {

    await line.ensureBootstrapped();

    await line.runAttendanceNotify();

  }

);



exports.lineCronAttendanceScan = onSchedule(

  { ...cronOpts, schedule: 'every 1 minutes' },

  async () => {

    await line.ensureBootstrapped();

    await line.runAttendanceScanNotifyQueue();

  }

);



exports.lineCronAttendanceAutoFetch = onSchedule(

  { ...cronOpts, schedule: 'every 2 minutes' },

  async () => {

    await line.ensureBootstrapped();

    await line.runAttendanceAutoFetchServer();

  }

);


