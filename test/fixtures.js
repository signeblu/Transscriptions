'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

const CACHE_DIR = path.join(__dirname, 'cache');

// Public-domain "Open Speech Repository" samples — Harvard sentences in
// multiple languages. Direct .wav URLs.
const SAMPLES = {
  english_wav: {
    url: 'http://www.voiptroubleshooter.com/open_speech/american/OSR_us_000_0010_8k.wav',
    file: 'english.wav',
    language: 'en',
    // Some words/phrases known to appear in Harvard List 1 (OSR_us_000_0010).
    // We pick simple high-probability words to keep the assertions robust.
    expectAny: ['birch', 'canoe', 'glue', 'smooth', 'planks'],
  },
  french_wav: {
    url: 'http://www.voiptroubleshooter.com/open_speech/french/OSR_fr_000_0041_8k.wav',
    file: 'french.wav',
    language: 'fr',
    expectAny: ['le', 'la', 'les', 'de', 'et', 'un', 'une'],
  },
  chinese_wav: {
    url: 'http://www.voiptroubleshooter.com/open_speech/chinese/OSR_cn_000_0072_8k.wav',
    file: 'chinese.wav',
    language: 'zh',
    // Very common Chinese characters; at least one should appear.
    expectAny: ['的', '了', '一', '是', '不', '我', '人'],
  },
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed ${res.statusCode} for ${url}`));
        return;
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function ensureSample(key) {
  const s = SAMPLES[key];
  if (!s) throw new Error(`Unknown sample: ${key}`);
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  const dest = path.join(CACHE_DIR, s.file);
  try {
    const st = await fsp.stat(dest);
    if (st.size > 1000) return { ...s, path: dest };
  } catch {}
  await download(s.url, dest);
  return { ...s, path: dest };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${err.slice(-400)}`));
    });
  });
}

async function ensureMp3FromWav(wavPath) {
  const mp3 = wavPath.replace(/\.wav$/, '.mp3');
  try { const s = await fsp.stat(mp3); if (s.size > 1000) return mp3; } catch {}
  await runFfmpeg(['-i', wavPath, '-codec:a', 'libmp3lame', '-qscale:a', '5', mp3]);
  return mp3;
}

async function ensureMp4FromWav(wavPath) {
  const mp4 = wavPath.replace(/\.wav$/, '.mp4');
  try { const s = await fsp.stat(mp4); if (s.size > 1000) return mp4; } catch {}
  // Black 320x240 video with the audio track baked in.
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=10',
    '-i', wavPath,
    '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-tune', 'stillimage',
    '-c:a', 'aac', '-b:a', '64k',
    mp4,
  ]);
  return mp4;
}

async function ensureMovFromWav(wavPath) {
  const mov = wavPath.replace(/\.wav$/, '.mov');
  try { const s = await fsp.stat(mov); if (s.size > 1000) return mov; } catch {}
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=10',
    '-i', wavPath,
    '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k',
    '-f', 'mov',
    mov,
  ]);
  return mov;
}

// Build a long mp3 by repeating a short sample N times. Used to test the
// chunking path without needing a real >10 min recording.
async function ensureLongMp3(wavPath, repeats, outName) {
  const out = path.join(CACHE_DIR, outName);
  try { const s = await fsp.stat(out); if (s.size > 1000) return out; } catch {}
  // First normalise the source to a stable mp3.
  const baseMp3 = await ensureMp3FromWav(wavPath);
  const listPath = path.join(CACHE_DIR, `${outName}.list`);
  const lines = [];
  for (let i = 0; i < repeats; i++) lines.push(`file '${baseMp3.replace(/'/g, "'\\''")}'`);
  await fsp.writeFile(listPath, lines.join('\n'));
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', out]);
  await fsp.unlink(listPath).catch(() => {});
  return out;
}

module.exports = {
  SAMPLES,
  CACHE_DIR,
  ensureSample,
  ensureMp3FromWav,
  ensureMp4FromWav,
  ensureMovFromWav,
  ensureLongMp3,
};
