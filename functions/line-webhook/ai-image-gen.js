/**
 * LINE AI — สร้างรูป (OpenAI) + อัปโหลด Firebase Storage สำหรับส่งใน LINE
 */
const https = require('https');
const http = require('http');
const crypto = require('crypto');

function configFromLineCfg(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    model: c.model || 'gpt-4o-mini',
    imageModel: c.imageModel || 'gpt-image-2',
    responsesModel: c.responsesModel || c.model || 'gpt-5.5',
    imageQuality: c.imageQuality || 'medium'
  };
}

function wantsImageGeneration(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    /(?:สร้าง|วาด|generate|draw|make|design|ออกแบบ).{0,32}(?:รูป|ภาพ|image|picture|photo|poster|logo|illustration|icon|infographic|อินโฟ|กราฟิก)/i.test(t) ||
    /(?:รูป|ภาพ|image|picture|infographic|อินโฟกราฟิก).{0,32}(?:สร้าง|วาด|generate|draw|make|design|ออกแบบ)/i.test(t) ||
    /^\/(?:image|img|pic)\b/i.test(t)
  );
}

function wantsLineImageGeneration(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (
    /(?:สร้าง|ทำ).{0,16}(?:รูป|ภาพ).{0,8}ไม่ได้|(?:ไม่|ไม่ได้).{0,12}(?:สร้าง|ทำ).{0,12}(?:รูป|ภาพ)|สร้าง(?:รูป|ภาพ)?ไม่/i.test(
      t
    )
  ) {
    return false;
  }
  if (wantsImageGeneration(t)) return true;
  return (
    /(?:ทำ|ส่ง|เอา|give|make).{0,20}(?:เป็นภาพ|เป็นรูป|ภาพมา|รูปมา|มาเป็นภาพ|มาเป็นรูป)/i.test(t) ||
    /^(?:โอเค|ok|okay)[^\n]{0,40}(?:ภาพ|รูป)/i.test(t)
  );
}

function extractImagePrompt(text) {
  const t = String(text || '').trim();
  return t.replace(/^\/(?:image|img|pic)\s*/i, '').trim() || t;
}

function buildImagePromptFromMessage(text, lastContext) {
  const t = String(text || '').trim();
  if (t.length > 180) {
    return (
      'Create a professional infographic or poster in Thai cooperative style. ' +
      'Clear layout, readable Thai text labels, modern design. Content:\n' +
      t.slice(0, 2500)
    );
  }
  const isFollowUp =
    t.length < 160 &&
    /(?:ทำ|ส่ง|เอา|โอเค|ok|สร้าง).{0,24}(?:เป็นภาพ|เป็นรูป|ภาพ|รูป)/i.test(t);
  const ctx = lastContext && typeof lastContext === 'object' ? lastContext : null;
  const source =
    (ctx && ctx.lastAssistantText) ||
    (ctx && ctx.lastUserText) ||
    '';
  if (isFollowUp && source) {
    return (
      'Create a professional infographic or poster image in Thai cooperative style. ' +
      'Use clear layout, readable Thai text where appropriate, green-blue-white palette. Content:\n' +
      String(source).slice(0, 2500)
    );
  }
  const base = extractImagePrompt(t);
  if (/infographic|อินโฟ|กราฟิก/i.test(base)) {
    return (
      'Professional infographic poster, modern flat design, Thai text labels, green-blue-white theme: ' +
      base.slice(0, 1500)
    );
  }
  return base.slice(0, 2000);
}

function callOpenAIChat(apiKey, model, messages, maxTokens, timeoutMs) {
  if (!apiKey || !String(apiKey).trim()) {
    return Promise.reject(new Error('OpenAI API Key not configured'));
  }
  const body = JSON.stringify(
    (() => {
      const m = model || 'gpt-4o-mini';
      const limit = Math.min(1200, Math.max(256, parseInt(maxTokens, 10) || 700));
      const payload = { model: m, messages };
      if (/^gpt-5|^o[0-9]/i.test(m)) payload.max_completion_tokens = limit;
      else {
        payload.max_tokens = limit;
        payload.temperature = 0.7;
      }
      return payload;
    })()
  );
  const timeout = Math.max(8000, parseInt(timeoutMs, 10) || 25000);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + String(apiKey).trim(),
          'Content-Length': Buffer.byteLength(body, 'utf8')
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          try {
            const j = JSON.parse(data || '{}');
            if (res.statusCode >= 400) {
              return reject(new Error((j.error && j.error.message) || data.slice(0, 200) || 'OpenAI error'));
            }
            const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
            if (!reply) return reject(new Error('Empty response from OpenAI'));
            resolve(String(reply).trim());
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.setTimeout(timeout, () => req.destroy(new Error('OpenAI chat timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function enhancePromptFromContext(apiKey, config, userText, contextText) {
  const source = String(contextText || '').trim();
  const hint = String(userText || '').trim();
  if (!source) return buildImagePromptFromMessage(hint, { lastAssistantText: source });
  const messages = [
    {
      role: 'system',
      content:
        'Convert Thai cooperative/organization content into ONE English image-generation prompt for a professional infographic poster. ' +
        'Include layout, green-blue-white palette, and key Thai text labels to render. Output ONLY the prompt, max 900 characters.'
    },
    {
      role: 'user',
      content: `User request: ${hint || 'make this into an image'}\n\nContent to visualize:\n${source.slice(0, 3500)}`
    }
  ];
  const model = (config && config.model) || 'gpt-4o-mini';
  const out = await callOpenAIChat(apiKey, model, messages, 900, 25000);
  return String(out || '').trim().slice(0, 900) || buildImagePromptFromMessage(hint, { lastAssistantText: source });
}

function openaiJsonPost(apiKey, apiPath, body, timeoutMs) {
  if (!apiKey || !String(apiKey).trim()) {
    return Promise.reject(new Error('OpenAI API Key not configured'));
  }
  const payload = JSON.stringify(body);
  const timeout = Math.max(15000, parseInt(timeoutMs, 10) || 90000);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.openai.com',
        port: 443,
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + String(apiKey).trim(),
          'Content-Length': Buffer.byteLength(payload, 'utf8')
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          try {
            const j = JSON.parse(data || '{}');
            if (res.statusCode >= 400) {
              return reject(new Error((j.error && j.error.message) || data.slice(0, 300) || 'OpenAI error'));
            }
            resolve(j);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.setTimeout(timeout, () => {
      req.destroy(new Error('OpenAI timeout'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function extractImagesFromResponse(j) {
  const outputs = Array.isArray(j && j.output) ? j.output : [];
  const images = [];
  for (const o of outputs) {
    if (!o) continue;
    if (o.type === 'image_generation_call' && o.result) {
      const b64 = typeof o.result === 'string' ? o.result : o.result.b64 || o.result.data || '';
      if (b64) images.push({ mime: 'image/png', b64 });
    }
  }
  return images;
}

function isGptImageModel(model) {
  return /^gpt-image|^chatgpt-image/i.test(String(model || '').trim());
}

async function generateImageSimple(apiKey, config, prompt, timeoutMs, opts) {
  const model = config.imageModel || 'gpt-image-2';
  const fastOnly = !!(opts && opts.fastOnly);
  const body = { model, prompt, n: 1, size: '1024x1024' };
  if (isGptImageModel(model)) {
    body.quality = fastOnly ? 'low' : config.imageQuality || 'medium';
    body.output_format = 'png';
  } else {
    body.response_format = 'b64_json';
  }
  const j = await openaiJsonPost(apiKey, '/v1/images/generations', body, timeoutMs || 150000);
  const data = Array.isArray(j.data) ? j.data : [];
  const images = [];
  for (const d of data) {
    if (d && d.b64_json) images.push({ mime: 'image/png', b64: d.b64_json });
  }
  if (!images.length) throw new Error('สร้างรูปไม่สำเร็จ');
  return images;
}

async function generateImageResponses(apiKey, config, prompt, timeoutMs) {
  const model = config.responsesModel || 'gpt-5.5';
  const j = await openaiJsonPost(
    apiKey,
    '/v1/responses',
    {
      model,
      input: prompt,
      tools: [{ type: 'image_generation', quality: 'medium' }]
    },
    timeoutMs || 60000
  );
  const images = extractImagesFromResponse(j);
  if (!images.length) throw new Error('ไม่ได้รับรูปจาก OpenAI');
  return images;
}

async function generateImages(apiKey, config, prompt, opts) {
  const fastOnly = !!(opts && opts.fastOnly);
  const simpleTimeout = fastOnly ? 150000 : 180000;
  let simpleErr = null;
  try {
    return await generateImageSimple(apiKey, config, prompt, simpleTimeout, opts);
  } catch (e) {
    simpleErr = e;
  }
  if (fastOnly) throw simpleErr;
  try {
    return await generateImageResponses(apiKey, config, prompt, 90000);
  } catch (e) {
    throw simpleErr;
  }
}

const STORAGE_PROJECT_ID = 'admin-panel-nkbkcoop-cbf10';
const STORAGE_BUCKET_CANDIDATES = [
  process.env.FIREBASE_STORAGE_BUCKET,
  process.env.GCLOUD_STORAGE_BUCKET,
  `${STORAGE_PROJECT_ID}.firebasestorage.app`,
  `${STORAGE_PROJECT_ID}.appspot.com`
].filter(Boolean);

let _storageBucket = null;

function getStorageBucket() {
  if (_storageBucket) return _storageBucket;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: STORAGE_PROJECT_ID,
        storageBucket: STORAGE_BUCKET_CANDIDATES[0]
      });
    }
    for (const name of STORAGE_BUCKET_CANDIDATES) {
      try {
        const bucket = admin.storage().bucket(name);
        _storageBucket = bucket;
        console.log('[ai-image-gen] storage bucket:', name);
        return bucket;
      } catch (_) {}
    }
    _storageBucket = admin.storage().bucket();
    return _storageBucket;
  } catch (e) {
    console.warn('[ai-image-gen] Storage init failed:', e.message);
    return null;
  }
}

async function uploadPngAndGetUrl(b64) {
  const bucket = getStorageBucket();
  if (!bucket) throw new Error('Firebase Storage ไม่พร้อม');
  const id = crypto.randomBytes(12).toString('hex');
  const filePath = `line-ai-images/${id}.png`;
  const file = bucket.file(filePath);
  const buf = Buffer.from(b64, 'base64');
  const token = crypto.randomBytes(16).toString('hex');
  await file.save(buf, {
    metadata: {
      contentType: 'image/png',
      cacheControl: 'public, max-age=604800',
      metadata: {
        firebaseStorageDownloadTokens: token
      }
    },
    resumable: false
  });
  const encoded = encodeURIComponent(filePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
  console.log('[ai-image-gen] uploaded', filePath, 'bytes=', buf.length);
  return url;
}

module.exports = {
  configFromLineCfg,
  wantsLineImageGeneration,
  buildImagePromptFromMessage,
  enhancePromptFromContext,
  generateImages,
  uploadPngAndGetUrl
};
