'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawnSync } = require('node:child_process');

const {
  ensureSample,
  ensureMp3FromWav,
  ensureMp4FromWav,
  ensureMovFromWav,
  ensureLongMp3,
} = require('./fixtures.js');

const HAS_KEY = !!process.env.LITELLM_API_KEY;
const SCRIPT = path.join(__dirname, '..', 'simpletranscribe.js');

function skipIfNoKey(t) {
  if (!HAS_KEY) {
    t.skip('LITELLM_API_KEY not set; skipping network integration test');
    return true;
  }
  return false;
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    input: opts.input || '',
    timeout: opts.timeout || 5 * 60 * 1000,
  });
}

async function stageFolder(files) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'st-it-'));
  for (const [name, src] of files) {
    await fsp.copyFile(src, path.join(dir, name));
  }
  return dir;
}

test('integration: transcribe English .wav to .txt', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('english_wav');
  const dir = await stageFolder([['english.wav', s.path]]);
  try {
    const r = runCli([dir, '--language', s.language, '--overwrite']);
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const txt = await fsp.readFile(path.join(dir, 'english.txt'), 'utf8');
    const lower = txt.toLowerCase();
    assert.ok(s.expectAny.some((w) => lower.includes(w.toLowerCase())),
      `expected one of ${s.expectAny.join(',')} in: ${txt}`);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('integration: transcribe French .wav to .txt', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('french_wav');
  const dir = await stageFolder([['french.wav', s.path]]);
  try {
    const r = runCli([dir, '--language', s.language, '--overwrite']);
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const txt = await fsp.readFile(path.join(dir, 'french.txt'), 'utf8');
    const lower = txt.toLowerCase();
    assert.ok(s.expectAny.some((w) => lower.includes(w.toLowerCase())),
      `expected a common French word in: ${txt}`);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('integration: transcribe Chinese .wav to .txt', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('chinese_wav');
  const dir = await stageFolder([['chinese.wav', s.path]]);
  try {
    const r = runCli([dir, '--language', s.language, '--overwrite']);
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const txt = await fsp.readFile(path.join(dir, 'chinese.txt'), 'utf8');
    assert.ok(s.expectAny.some((c) => txt.includes(c)),
      `expected a common Chinese character in: ${txt}`);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('integration: transcribe .mp3 to .txt', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('english_wav');
  const mp3 = await ensureMp3FromWav(s.path);
  const dir = await stageFolder([['english.mp3', mp3]]);
  try {
    const r = runCli([dir, '--language', s.language, '--overwrite']);
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const txt = await fsp.readFile(path.join(dir, 'english.txt'), 'utf8');
    assert.ok(txt.trim().length > 0);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('integration: transcribe .mp4 video to .txt (ffmpeg extraction)', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('english_wav');
  const mp4 = await ensureMp4FromWav(s.path);
  const dir = await stageFolder([['clip.mp4', mp4]]);
  try {
    const r = runCli([dir, '--language', s.language, '--overwrite']);
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const txt = await fsp.readFile(path.join(dir, 'clip.txt'), 'utf8');
    assert.ok(txt.trim().length > 0);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('integration: transcribe .mov video to .txt (ffmpeg extraction)', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('english_wav');
  const mov = await ensureMovFromWav(s.path);
  const dir = await stageFolder([['clip.mov', mov]]);
  try {
    const r = runCli([dir, '--language', s.language, '--overwrite']);
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const txt = await fsp.readFile(path.join(dir, 'clip.txt'), 'utf8');
    assert.ok(txt.trim().length > 0);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('integration: --srt produces SubRip output', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('english_wav');
  const dir = await stageFolder([['english.wav', s.path]]);
  try {
    const r = runCli([dir, '--srt', '--language', s.language, '--overwrite']);
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const srt = await fsp.readFile(path.join(dir, 'english.srt'), 'utf8');
    assert.match(srt, /-->/);
    assert.match(srt, /\d{2}:\d{2}:\d{2}[,.]\d{3}/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('integration: --skip-existing leaves existing transcription untouched', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('english_wav');
  const dir = await stageFolder([['english.wav', s.path]]);
  try {
    const sentinel = 'SENTINEL_DO_NOT_OVERWRITE';
    await fsp.writeFile(path.join(dir, 'english.txt'), sentinel);
    const r = runCli([dir, '--skip-existing']);
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const after = await fsp.readFile(path.join(dir, 'english.txt'), 'utf8');
    assert.equal(after, sentinel);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('integration: --overwrite replaces existing transcription', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('english_wav');
  const dir = await stageFolder([['english.wav', s.path]]);
  try {
    await fsp.writeFile(path.join(dir, 'english.txt'), 'STALE');
    const r = runCli([dir, '--overwrite', '--language', s.language]);
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const after = await fsp.readFile(path.join(dir, 'english.txt'), 'utf8');
    assert.notEqual(after.trim(), 'STALE');
    assert.ok(after.trim().length > 0);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('integration: .txt output includes timestamped paragraphs', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('english_wav');
  const dir = await stageFolder([['english.wav', s.path]]);
  try {
    const r = runCli([dir, '--language', s.language, '--overwrite']);
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const txt = await fsp.readFile(path.join(dir, 'english.txt'), 'utf8');
    assert.match(txt, /^\[\d{2}:\d{2}(?::\d{2})?\]\s+\S/m,
      `expected a [MM:SS] or [HH:MM:SS] timestamp prefix in: ${txt}`);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('integration: chunking transcribes a long file in multiple chunks (.txt)', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('english_wav');
  // Source sample is ~33 s; 4 repeats ≈ ~132 s. With --chunk-seconds 60 we
  // get 3 chunks, exercising the chunking + stitching path.
  const longMp3 = await ensureLongMp3(s.path, 4, 'english-long.mp3');
  const dir = await stageFolder([['long.mp3', longMp3]]);
  try {
    const r = runCli([dir, '--language', s.language, '--overwrite', '--chunk-seconds', '60'], { timeout: 10 * 60 * 1000 });
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.match(r.stdout + r.stderr, /chunks\s+\d+\//i, 'expected chunked progress output');
    const txt = await fsp.readFile(path.join(dir, 'long.txt'), 'utf8');
    assert.ok(txt.trim().length > 0);
    const lower = txt.toLowerCase();
    // The sample repeats, so the keyword should appear multiple times.
    const count = (lower.match(/birch/g) || []).length;
    assert.ok(count >= 2, `expected 'birch' to appear at least twice, got ${count} in: ${txt}`);
    // Chunked .txt must also be timestamped.
    assert.match(txt, /^\[\d{2}:\d{2}(?::\d{2})?\]/m,
      `expected chunked .txt to have [MM:SS] paragraph stamps: ${txt.slice(0, 200)}`);
    // Partial file should be cleaned up after success.
    const partial = await fsp.stat(path.join(dir, 'long.txt.partial')).catch(() => null);
    assert.equal(partial, null, 'expected .partial file to be removed on success');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('integration: chunking produces a valid SRT spanning the full duration', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('english_wav');
  const longMp3 = await ensureLongMp3(s.path, 4, 'english-long.mp3');
  const dir = await stageFolder([['long.mp3', longMp3]]);
  try {
    const r = runCli([dir, '--srt', '--language', s.language, '--overwrite', '--chunk-seconds', '60'], { timeout: 10 * 60 * 1000 });
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const srt = await fsp.readFile(path.join(dir, 'long.srt'), 'utf8');
    const { parseSrt } = require('../simpletranscribe.js');
    const segs = parseSrt(srt);
    assert.ok(segs.length >= 4, `expected several cues, got ${segs.length}`);
    // Cues should be monotonically increasing.
    for (let i = 1; i < segs.length; i++) {
      assert.ok(segs[i].start >= segs[i - 1].start - 0.001,
        `cue ${i} starts before previous (${segs[i].start} < ${segs[i - 1].start})`);
    }
    // Last cue should be well past the first chunk boundary (60 s).
    assert.ok(segs[segs.length - 1].end > 70,
      `expected SRT to span past 70 s, last end=${segs[segs.length - 1].end}`);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('integration: --no-chunk forces single upload even for long files', async (t) => {
  if (skipIfNoKey(t)) return;
  const s = await ensureSample('english_wav');
  const longMp3 = await ensureLongMp3(s.path, 4, 'english-long.mp3');
  const dir = await stageFolder([['long.mp3', longMp3]]);
  try {
    const r = runCli([dir, '--language', s.language, '--overwrite', '--no-chunk', '--chunk-seconds', '60'], { timeout: 10 * 60 * 1000 });
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.doesNotMatch(r.stdout + r.stderr, /chunk\s+1\//i, 'should not have chunked output');
    const txt = await fsp.readFile(path.join(dir, 'long.txt'), 'utf8');
    assert.ok(txt.trim().length > 0);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
