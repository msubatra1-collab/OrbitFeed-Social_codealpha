'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const LOCAL_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
const SIGNATURES = [
  { ext: 'jpg', mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: 'webp', mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], webp: true },
  { ext: 'gif', mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] }
];

function detectImage(buffer) {
  const match = SIGNATURES.find((item) => item.bytes.every((byte, index) => buffer[index] === byte) && (!item.webp || buffer.toString('ascii', 8, 12) === 'WEBP'));
  if (!match) {
    const error = new Error('Upload a valid JPEG, PNG, WebP, or GIF image.');
    error.status = 415;
    error.code = 'unsupported_image';
    throw error;
  }
  return match;
}

async function storeImage(userId, buffer) {
  const type = detectImage(buffer);
  const filename = `${crypto.randomUUID()}.${type.ext}`;
  const key = `orbitfeed/${String(userId)}/${filename}`;
  const apiUrl = process.env.MANUS_API_URL;
  const apiKey = process.env.MANUS_API_KEY;

  if (apiUrl && apiKey) {
    const presignUrl = new URL('/v1/storage/presign/put', apiUrl);
    presignUrl.searchParams.set('path', key);
    const presignResponse = await fetch(presignUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    const presignBody = await presignResponse.json().catch(() => ({}));
    if (!presignResponse.ok || !presignBody.url) throw new Error(`Platform storage upload URL unavailable (HTTP ${presignResponse.status}).`);
    const uploadResponse = await fetch(presignBody.url, { method: 'PUT', headers: { 'Content-Type': type.mime }, body: buffer });
    if (!uploadResponse.ok) throw new Error(`Platform storage upload failed (HTTP ${uploadResponse.status}).`);
    return { key, url: `/manus-storage/${key}`, mime: type.mime };
  }

  if (process.env.NODE_ENV === 'production') throw new Error('Durable platform image storage is unavailable in this runtime.');
  await fs.mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(LOCAL_UPLOAD_DIR, filename), buffer, { flag: 'wx', mode: 0o640 });
  return { key: filename, url: `/media/${filename}`, mime: type.mime };
}

async function resolveLocalMedia(filename) {
  if (!/^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/.test(filename)) return null;
  const fullPath = path.join(LOCAL_UPLOAD_DIR, filename);
  try { await fs.access(fullPath); return fullPath; } catch { return null; }
}

module.exports = { storeImage, detectImage, resolveLocalMedia };
