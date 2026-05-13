#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawn } = require('child_process');

const AUDIO_EXTS = new Set(['.wav', '.mp3']);
const VIDEO_EXTS = new Set(['.mp4', '.mov']);
const SUPPORTED_EXTS = new Set([...AUDIO_EXTS, ...VIDEO_EXTS]);

const DEFAULT_API_BASE = 'https://litellm.stream.cavi.au.dk';
const DEFAULT_MODEL = 'cavi/faster-whisper-large-v3';
const DEFAULT_CHUNK_SECONDS = 60;
const DEFAULT_CHUNK_OVERLAP = 1;
const DEFAULT_CHUNK_CONCURRENCY = 4;
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;

function parseArgs(argv) {
  const args = {
    folder: null,
    format: 'txt',
    overwrite: null,
    concurrency: 4,
    language: null,
    chunkSeconds: DEFAULT_CHUNK_SECONDS,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    chunkConcurrency: DEFAULT_CHUNK_CONCURRENCY,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    noChunk: false,
    help: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--srt') args.format = 'srt';
    else if (a === '--txt') args.format = 'txt';
    else if (a === '--overwrite' || a === '-y') args.overwrite = true;
    else if (a === '--skip-existing' || a === '-n') args.overwrite = false;
    else if (a === '--concurrency' || a === '-c') {
      args.concurrency = parseInt(argv[++i], 10) || 4;
    } else if (a === '--language' || a === '-l') {
      args.language = argv[++i];
    } else if (a === '--chunk-seconds') {
      args.chunkSeconds = parseInt(argv[++i], 10) || DEFAULT_CHUNK_SECONDS;
    } else if (a === '--chunk-overlap') {
      args.chunkOverlap = Number(argv[++i]);
      if (!isFinite(args.chunkOverlap) || args.chunkOverlap < 0) args.chunkOverlap = DEFAULT_CHUNK_OVERLAP;
    } else if (a === '--no-chunk') {
      args.noChunk = true;
    } else if (a === '--chunk-concurrency') {
      args.chunkConcurrency = parseInt(argv[++i], 10) || DEFAULT_CHUNK_CONCURRENCY;
    } else if (a === '--request-timeout') {
      const v = parseInt(argv[++i], 10);
      args.requestTimeoutMs = (isFinite(v) && v > 0) ? v * 1000 : DEFAULT_REQUEST_TIMEOUT_MS;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      rest.push(a);
    }
  }
  args.folder = rest[0] || null;
  return args;
}

function printHelp() {
  console.log(`Usage: simpletranscribe.js <folder> [options]

Transcribes .wav, .mp3, .mp4, .mov files in <folder> (top-level only) and
writes a transcription file next to each source.

Long files are automatically split into chunks (default ${DEFAULT_CHUNK_SECONDS} s, ${DEFAULT_CHUNK_OVERLAP} s overlap)
to avoid gateway/proxy timeouts on long uploads or long inference runs.

Options:
  --srt                Output .srt with timestamps (default: .txt)
  --txt                Output plain text (default)
  --overwrite, -y      Overwrite existing transcription files without asking
  --skip-existing, -n  Skip files whose transcription already exists
  --concurrency, -c N  Concurrent transcriptions across files (default: 4)
  --language, -l CODE  Language hint forwarded to the API (e.g. en, fr, da)
  --chunk-seconds N    Chunk length in seconds (default: ${DEFAULT_CHUNK_SECONDS})
  --chunk-overlap S    Overlap between chunks in seconds (default: ${DEFAULT_CHUNK_OVERLAP})
  --chunk-concurrency N  Parallel chunks per file (default: ${DEFAULT_CHUNK_CONCURRENCY})
  --request-timeout N  Per-request timeout in seconds (default: ${DEFAULT_REQUEST_TIMEOUT_MS / 1000})
  --no-chunk           Disable chunking; upload the whole file in one request
  --help, -h           Show this help

Environment:
  LITELLM_API_KEY      API key (required)
  LITELLM_API_BASE     API base URL (default: ${DEFAULT_API_BASE})
  LITELLM_MODEL        Model name (default: ${DEFAULT_MODEL})
`);
}

async function listMediaFiles(folder) {
  const entries = await fsp.readdir(folder, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && SUPPORTED_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(folder, e.name))
    .sort();
}

function outputPathFor(filePath, format) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  return path.join(dir, `${base}.${format === 'srt' ? 'srt' : 'txt'}`);
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDuration(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function parseFfmpegTime(str) {
  const m = /(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(str);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function makeReporter(name, { singleLine } = {}) {
  const useTTY = singleLine && process.stdout.isTTY;
  let lastLen = 0;
  function clear() {
    if (useTTY && lastLen > 0) {
      process.stdout.write('\r' + ' '.repeat(lastLen) + '\r');
      lastLen = 0;
    }
  }
  return {
    update(msg) {
      const line = `→ ${name}: ${msg}`;
      if (useTTY) {
        const pad = Math.max(0, lastLen - line.length);
        process.stdout.write('\r' + line + ' '.repeat(pad));
        lastLen = line.length;
      } else {
        console.log(line);
      }
    },
    log(msg) {
      clear();
      console.log(`  ${name}: ${msg}`);
    },
    done(msg) {
      clear();
      console.log(`\u2713 ${name}${msg ? ' \u2192 ' + msg : ''}`);
    },
    fail(msg) {
      clear();
      console.error(`\u2717 ${name}: ${msg}`);
    },
    clear,
  };
}

async function probeDuration(filePath) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const n = Number(out.trim());
      resolve(isFinite(n) && n > 0 ? n : null);
    });
  });
}

async function extractAudio(inputPath, onProgress) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'simpletranscribe-'));
  const out = path.join(tmpDir, 'audio.mp3');
  let duration = null;
  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '64k',
      '-progress', 'pipe:1',
      '-nostats',
      out,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let errTail = '';
    ff.stderr.on('data', (d) => {
      const s = d.toString();
      errTail = (errTail + s).slice(-2000);
      if (duration == null) {
        const m = /Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(s);
        if (m) duration = parseFfmpegTime(m[1]);
      }
    });
    ff.stdout.on('data', (d) => {
      if (!onProgress) return;
      const lines = d.toString().split(/\r?\n/);
      for (const line of lines) {
        const m = /^out_time=(.+)$/.exec(line.trim());
        if (m) {
          const t = parseFfmpegTime(m[1]);
          if (t != null) onProgress({ time: t, duration });
        }
      }
    });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${errTail.slice(-400)}`));
    });
  });
  if (duration == null) duration = await probeDuration(out);
  return { audioPath: out, duration, cleanup: () => fsp.rm(tmpDir, { recursive: true, force: true }) };
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  return 'application/octet-stream';
}

// Plan chunk boundaries. Returns an array describing each chunk as:
//   { index, absStart, absEnd, audioStart, audioLength }
// where absStart..absEnd is the part of the source we OWN (used for dedup),
// and audioStart..audioStart+audioLength is the actual slice (includes
// `overlap` seconds of leading context for non-first chunks).
function planChunks(duration, chunkSeconds, overlap) {
  if (!isFinite(duration) || duration <= 0) return [];
  const chunks = [];
  let i = 0;
  while (i * chunkSeconds < duration) {
    const absStart = i * chunkSeconds;
    const absEnd = Math.min(duration, (i + 1) * chunkSeconds);
    const audioStart = i === 0 ? 0 : Math.max(0, absStart - overlap);
    const audioEnd = absEnd;
    chunks.push({
      index: i,
      absStart,
      absEnd,
      audioStart,
      audioLength: audioEnd - audioStart,
    });
    i++;
  }
  return chunks;
}

async function splitAudio(mp3Path, chunks, onProgress) {
  if (chunks.length <= 1) return { paths: [mp3Path], cleanup: async () => {} };
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'simpletranscribe-chunks-'));
  const paths = [];
  for (const c of chunks) {
    const outPath = path.join(tmpDir, `chunk-${String(c.index).padStart(4, '0')}.mp3`);
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', [
        '-y',
        '-ss', String(c.audioStart),
        '-t', String(c.audioLength),
        '-i', mp3Path,
        '-c', 'copy',
        outPath,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let errTail = '';
      ff.stderr.on('data', (d) => { errTail = (errTail + d.toString()).slice(-1500); });
      ff.on('error', reject);
      ff.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg split failed (${code}): ${errTail.slice(-400)}`));
      });
    });
    paths.push(outPath);
    if (onProgress) onProgress({ done: paths.length, total: chunks.length });
  }
  return { paths, cleanup: () => fsp.rm(tmpDir, { recursive: true, force: true }) };
}

// ---- SRT helpers ----
function fmtSrtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function parseSrtTime(str) {
  const m = /(\d+):(\d{2}):(\d{2})[,.](\d{3})/.exec(str);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function parseSrt(text) {
  const segs = [];
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (lines.length < 2) continue;
    let tIdx = 0;
    if (/^\d+$/.test(lines[0].trim())) tIdx = 1;
    const timing = lines[tIdx];
    const tm = /([\d:,.]+)\s*-->\s*([\d:,.]+)/.exec(timing);
    if (!tm) continue;
    const start = parseSrtTime(tm[1]);
    const end = parseSrtTime(tm[2]);
    const txt = lines.slice(tIdx + 1).join('\n').trim();
    if (txt) segs.push({ start, end, text: txt });
  }
  return segs;
}

function serializeSrt(segments) {
  const out = [];
  segments.forEach((seg, i) => {
    out.push(String(i + 1));
    out.push(`${fmtSrtTime(seg.start)} --> ${fmtSrtTime(seg.end)}`);
    out.push(seg.text);
    out.push('');
  });
  return out.join('\n');
}

// Offset segments and drop those that belong to the previous chunk's
// territory (the `overlap` leading window). For chunk 0, keep everything.
function offsetAndDedup(segments, chunk) {
  const result = [];
  for (const seg of segments) {
    const absStart = seg.start + chunk.audioStart;
    const absEnd = seg.end + chunk.audioStart;
    if (chunk.index > 0) {
      const mid = (absStart + absEnd) / 2;
      if (mid < chunk.absStart) continue;
    }
    result.push({ start: absStart, end: absEnd, text: seg.text.trim() });
  }
  return result;
}

function fmtClock(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Render an interview-style transcript: paragraphs grouped by pause length,
// each prefixed with a clock-time stamp. Sentences inside a paragraph are
// joined with a single space.
function formatTxtTranscript(segments, { paragraphGapSec = 1.2, maxParagraphSec = 30 } = {}) {
  if (!segments || segments.length === 0) return '';
  const paragraphs = [];
  let cur = { start: segments[0].start, parts: [] };
  let prevEnd = segments[0].start;
  for (const seg of segments) {
    const text = (seg.text || '').trim();
    if (!text) continue;
    const gap = seg.start - prevEnd;
    const span = seg.end - cur.start;
    if (cur.parts.length > 0 && (gap >= paragraphGapSec || span >= maxParagraphSec)) {
      paragraphs.push(cur);
      cur = { start: seg.start, parts: [] };
    }
    cur.parts.push(text);
    prevEnd = seg.end;
  }
  if (cur.parts.length > 0) paragraphs.push(cur);
  return paragraphs
    .map((p) => `[${fmtClock(p.start)}] ${p.parts.join(' ').replace(/\s+/g, ' ').trim()}`)
    .join('\n\n') + '\n';
}

function segmentsFromVerboseJson(json) {
  if (!json || !Array.isArray(json.segments)) return [];
  return json.segments.map((s) => ({
    start: Number(s.start) || 0,
    end: Number(s.end) || 0,
    text: String(s.text || '').trim(),
  }));
}

// ---- HTTP ----
async function postTranscription({ apiBase, apiKey, model, filePath, responseFormat, language, retries = 3, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, onProgress }) {
  const stat = await fsp.stat(filePath);
  const buf = await fsp.readFile(filePath);
  const filename = path.basename(filePath);
  const blob = new Blob([buf], { type: mimeFor(filePath) });
  const url = apiBase.replace(/\/$/, '') + '/v1/audio/transcriptions';
  const report = onProgress || (() => {});
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const form = new FormData();
    form.append('file', blob, filename);
    form.append('model', model);
    form.append('response_format', responseFormat);
    if (language) form.append('language', language);

    report({ phase: 'upload:start', attempt, retries, bytes: stat.size });
    const heartbeatStart = Date.now();
    const heartbeat = setInterval(() => {
      report({ phase: 'wait', elapsed: Math.floor((Date.now() - heartbeatStart) / 1000), attempt, retries });
    }, 5000);
    const ac = new AbortController();
    const timeoutHandle = requestTimeoutMs > 0
      ? setTimeout(() => ac.abort(new Error(`request timed out after ${Math.round(requestTimeoutMs / 1000)}s`)), requestTimeoutMs)
      : null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: ac.signal,
      });
      clearInterval(heartbeat);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (!res.ok) {
        const t = await res.text();
        const err = new Error(`HTTP ${res.status}: ${t.slice(0, 500)}`);
        if ((res.status >= 500 || res.status === 429) && attempt < retries) {
          lastErr = err;
          const delay = Math.min(30000, 2000 * 2 ** (attempt - 1));
          report({ phase: 'retry', attempt, retries, delay, reason: err.message });
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
      report({ phase: 'response:start' });
      const text = await res.text();
      report({ phase: 'done' });
      return text;
    } catch (err) {
      clearInterval(heartbeat);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const isAbort = err && (err.name === 'AbortError' || /aborted|timed out/i.test(err.message || ''));
      const reason = isAbort ? `timeout after ${Math.round(requestTimeoutMs / 1000)}s` : (err.message || String(err));
      if (attempt < retries) {
        lastErr = err;
        const delay = Math.min(30000, 2000 * 2 ** (attempt - 1));
        report({ phase: 'retry', attempt, retries, delay, reason });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Transcription failed after retries');
}

async function transcribeFile({
  apiBase, apiKey, model, filePath, format, language,
  chunkSeconds = DEFAULT_CHUNK_SECONDS,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
  noChunk = false,
  chunkConcurrency = DEFAULT_CHUNK_CONCURRENCY,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  onProgress, onPartial, retries = 3,
}) {
  const ext = path.extname(filePath).toLowerCase();
  let uploadPath = filePath;
  let cleanupExtract = null;
  let duration = null;
  const report = onProgress || (() => {});
  if (VIDEO_EXTS.has(ext)) {
    report({ phase: 'extract:start' });
    const r = await extractAudio(filePath, (p) => report({ phase: 'extract:progress', ...p }));
    uploadPath = r.audioPath;
    cleanupExtract = r.cleanup;
    duration = r.duration;
    report({ phase: 'extract:done' });
  } else {
    duration = await probeDuration(uploadPath);
  }

  try {
    const useChunking = !noChunk && duration && duration > chunkSeconds;
    if (!useChunking) {
      const stat = await fsp.stat(uploadPath);
      report({ phase: 'upload:prepare', bytes: stat.size });
      const body = await postTranscription({
        apiBase, apiKey, model,
        filePath: uploadPath,
        responseFormat: format === 'srt' ? 'srt' : 'verbose_json',
        language, retries, requestTimeoutMs, onProgress: report,
      });
      if (format === 'srt') return body;
      let segs;
      try {
        segs = segmentsFromVerboseJson(JSON.parse(body));
      } catch {
        // Fallback: server returned plain text — emit as one paragraph.
        return body.endsWith('\n') ? body : body + '\n';
      }
      return formatTxtTranscript(segs);
    }

    // Chunked path — splitAudio uses `-c copy` into .mp3, so the source must be mp3.
    // Normalize non-mp3 audio inputs (e.g. .wav) first.
    if (!cleanupExtract && path.extname(uploadPath).toLowerCase() !== '.mp3') {
      report({ phase: 'extract:start' });
      const r = await extractAudio(uploadPath, (p) => report({ phase: 'extract:progress', ...p }));
      uploadPath = r.audioPath;
      cleanupExtract = r.cleanup;
      if (r.duration) duration = r.duration;
      report({ phase: 'extract:done' });
    }
    const plan = planChunks(duration, chunkSeconds, chunkOverlap);
    report({ phase: 'chunk:plan', total: plan.length, duration, chunkSeconds, chunkOverlap });
    const split = await splitAudio(uploadPath, plan, (p) => report({ phase: 'chunk:split', ...p }));
    try {
      const allSegments = new Array(plan.length);
      const items = plan.map((c, i) => ({ chunk: c, path: split.paths[i] }));
      const startTimes = new Map();
      let completed = 0;
      let totalServerSec = 0;
      const overallStart = Date.now();
      const results = await runPool(items, chunkConcurrency, async (item) => {
        startTimes.set(item.chunk.index, Date.now());
        report({ phase: 'chunk:start', index: item.chunk.index, total: plan.length });
        const body = await postTranscription({
          apiBase, apiKey, model,
          filePath: item.path,
          responseFormat: 'verbose_json',
          language, retries, requestTimeoutMs,
          onProgress: (ev) => report({ phase: 'chunk:progress', index: item.chunk.index, total: plan.length, inner: ev }),
        });
        let segs;
        try {
          const json = JSON.parse(body);
          segs = segmentsFromVerboseJson(json);
        } catch {
          // Fallback: parse as SRT.
          segs = parseSrt(body);
        }
        allSegments[item.chunk.index] = offsetAndDedup(segs, item.chunk);
        completed += 1;
        const took = (Date.now() - (startTimes.get(item.chunk.index) || Date.now())) / 1000;
        totalServerSec += took;
        const remaining = plan.length - completed;
        // Estimate based on observed average per-chunk wall time, divided by
        // effective parallelism (cap at remaining chunks).
        const avg = totalServerSec / completed;
        const parallel = Math.min(chunkConcurrency, remaining || 1);
        const etaSec = remaining > 0 ? Math.ceil((remaining * avg) / parallel) : 0;
        const elapsed = Math.floor((Date.now() - overallStart) / 1000);
        if (onPartial) {
          // Flush whatever is contiguous from the start.
          const flat = [];
          for (let i = 0; i < allSegments.length; i++) {
            if (!allSegments[i]) break;
            flat.push(...allSegments[i]);
          }
          const partialText = format === 'srt'
            ? serializeSrt(flat)
            : formatTxtTranscript(flat);
          try { await onPartial(partialText, { completed, total: plan.length }); } catch {}
        }
        report({
          phase: 'chunk:done',
          index: item.chunk.index,
          total: plan.length,
          completed,
          remaining,
          avgSec: avg,
          etaSec,
          elapsedSec: elapsed,
        });
      });
      const failures = results.filter((r) => !r.ok);
      if (failures.length) {
        throw new Error(`chunk transcription failed: ${failures[0].error.message}`);
      }
      const merged = [].concat(...allSegments.filter(Boolean));
      if (format === 'srt') return serializeSrt(merged);
      return formatTxtTranscript(merged);
    } finally {
      if (split.cleanup) await split.cleanup().catch(() => {});
    }
  } finally {
    if (cleanupExtract) await cleanupExtract().catch(() => {});
  }
}

async function resolveConflicts(jobs, overwriteFlag) {
  const result = [];
  let mode = overwriteFlag; // true | false | null
  for (const job of jobs) {
    if (!(await exists(job.outPath))) { result.push(job); continue; }
    if (mode === true) { result.push(job); continue; }
    if (mode === false) {
      console.log(`Skipping (exists): ${path.basename(job.outPath)}`);
      continue;
    }
    const ans = await ask(
      `Output exists: ${path.basename(job.outPath)} — overwrite? [y/N/a=all/s=skip-all] `
    );
    if (ans === 'a' || ans === 'all') { mode = true; result.push(job); }
    else if (ans === 's' || ans === 'skip-all') {
      mode = false;
      console.log(`Skipping: ${path.basename(job.outPath)}`);
    } else if (ans === 'y' || ans === 'yes') {
      result.push(job);
    } else {
      console.log(`Skipping: ${path.basename(job.outPath)}`);
    }
  }
  return result;
}

async function runPool(items, concurrency, worker) {
  const results = [];
  let i = 0;
  const n = Math.max(1, Math.min(concurrency, items.length));
  const runners = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = { ok: true, value: await worker(items[idx], idx) };
      } catch (err) {
        results[idx] = { ok: false, error: err, item: items[idx] };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { printHelp(); return 0; }
  if (!args.folder) { printHelp(); return 1; }

  const apiKey = process.env.LITELLM_API_KEY;
  if (!apiKey) {
    console.error('Error: LITELLM_API_KEY is not set');
    return 2;
  }
  const apiBase = process.env.LITELLM_API_BASE || DEFAULT_API_BASE;
  const model = process.env.LITELLM_MODEL || DEFAULT_MODEL;

  const folder = path.resolve(args.folder);
  const stat = await fsp.stat(folder).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    console.error(`Error: not a directory: ${folder}`);
    return 2;
  }

  const files = await listMediaFiles(folder);
  if (files.length === 0) {
    console.log('No supported files found.');
    return 0;
  }

  let jobs = files.map((f) => ({ filePath: f, outPath: outputPathFor(f, args.format) }));
  jobs = await resolveConflicts(jobs, args.overwrite);
  if (jobs.length === 0) {
    console.log('Nothing to do.');
    return 0;
  }

  console.log(
    `Transcribing ${jobs.length} file(s) with model ${model} (concurrency=${args.concurrency})`
  );

  const singleLine = jobs.length === 1 || args.concurrency === 1;

  const results = await runPool(jobs, args.concurrency, async (job) => {
    const name = path.basename(job.filePath);
    const reporter = makeReporter(name, { singleLine });
    reporter.update('starting');
    // Aggregated chunk state for tidy parallel progress.
    const chunk = {
      total: 0,
      completed: 0,
      inFlight: new Map(), // index -> { phase, bytes, elapsed, attempt, retries }
      avgSec: 0,
      etaSec: 0,
      elapsedSec: 0,
    };
    function renderChunkLine(extra = '') {
      if (!chunk.total) return;
      const inflightTags = [...chunk.inFlight.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([idx, st]) => {
          let s = `#${idx + 1}`;
          if (st.phase === 'upload') s += ' up';
          else if (st.phase === 'wait') s += ` ${st.elapsed}s`;
          else if (st.phase === 'response') s += ' resp';
          else if (st.phase === 'retry') s += ` retry${st.attempt}`;
          return s;
        })
        .join(', ');
      const eta = chunk.completed > 0 && chunk.completed < chunk.total
        ? `ETA ${fmtDuration(chunk.etaSec)}`
        : '';
      const avg = chunk.completed > 0 ? `avg ${chunk.avgSec.toFixed(1)}s` : '';
      const parts = [
        `chunks ${chunk.completed}/${chunk.total}`,
        inflightTags && `[${inflightTags}]`,
        avg,
        eta,
        `elapsed ${fmtDuration(chunk.elapsedSec || 0)}`,
        extra,
      ].filter(Boolean);
      reporter.update(parts.join(' • '));
    }
    const onProgress = (ev) => {
      switch (ev.phase) {
        case 'extract:start':
          reporter.update('extracting audio…');
          break;
        case 'extract:progress': {
          if (ev.duration && ev.duration > 0) {
            const pct = Math.min(100, (ev.time / ev.duration) * 100);
            reporter.update(`extracting audio ${fmtDuration(ev.time)} / ${fmtDuration(ev.duration)} (${pct.toFixed(1)}%)`);
          } else {
            reporter.update(`extracting audio ${fmtDuration(ev.time)}`);
          }
          break;
        }
        case 'extract:done':
          reporter.update('audio extracted');
          break;
        case 'chunk:plan':
          chunk.total = ev.total;
          reporter.log(`split into ${ev.total} chunk(s) of ${ev.chunkSeconds}s (duration ${fmtDuration(ev.duration)})`);
          renderChunkLine();
          break;
        case 'chunk:split':
          reporter.update(`splitting chunks ${ev.done}/${ev.total}`);
          break;
        case 'chunk:start':
          chunk.inFlight.set(ev.index, { phase: 'upload', elapsed: 0, attempt: 1 });
          renderChunkLine();
          break;
        case 'chunk:progress': {
          const inner = ev.inner || {};
          const st = chunk.inFlight.get(ev.index) || {};
          if (inner.phase === 'upload:start') {
            st.phase = 'upload';
            st.bytes = inner.bytes;
            st.attempt = inner.attempt;
            st.retries = inner.retries;
          } else if (inner.phase === 'wait') {
            st.phase = 'wait';
            st.elapsed = inner.elapsed;
            st.attempt = inner.attempt;
            st.retries = inner.retries;
          } else if (inner.phase === 'response:start') {
            st.phase = 'response';
          } else if (inner.phase === 'retry') {
            st.phase = 'retry';
            st.attempt = inner.attempt;
            st.retries = inner.retries;
          }
          chunk.inFlight.set(ev.index, st);
          renderChunkLine();
          break;
        }
        case 'chunk:done':
          chunk.inFlight.delete(ev.index);
          chunk.completed = ev.completed;
          chunk.avgSec = ev.avgSec;
          chunk.etaSec = ev.etaSec;
          chunk.elapsedSec = ev.elapsedSec;
          renderChunkLine();
          break;
        case 'upload:prepare':
          reporter.update(`preparing upload (${fmtBytes(ev.bytes)})`);
          break;
        case 'upload:start':
          reporter.update(`uploading ${fmtBytes(ev.bytes)}${ev.attempt > 1 ? ` (attempt ${ev.attempt}/${ev.retries})` : ''}…`);
          break;
        case 'wait':
          reporter.update(`waiting for server response… (${ev.elapsed}s elapsed${ev.attempt > 1 ? `, attempt ${ev.attempt}/${ev.retries}` : ''})`);
          break;
        case 'response:start':
          reporter.update('receiving response…');
          break;
        case 'retry':
          reporter.update(`network error, retrying in ${Math.round(ev.delay / 1000)}s (attempt ${ev.attempt}/${ev.retries}): ${ev.reason}`);
          break;
        case 'done':
          break;
      }
    };
    try {
      const text = await transcribeFile({
        apiBase, apiKey, model,
        filePath: job.filePath,
        format: args.format,
        language: args.language,
        chunkSeconds: args.chunkSeconds,
        chunkOverlap: args.chunkOverlap,
        chunkConcurrency: args.chunkConcurrency,
        requestTimeoutMs: args.requestTimeoutMs,
        noChunk: args.noChunk,
        onProgress,
        onPartial: async (text) => {
          await fsp.writeFile(job.outPath + '.partial', text);
        },
      });
      await fsp.writeFile(job.outPath, text);
      await fsp.unlink(job.outPath + '.partial').catch(() => {});
      reporter.done(path.basename(job.outPath));
      return job.outPath;
    } catch (err) {
      reporter.fail(err && err.message ? err.message : String(err));
      throw err;
    }
  });

  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    console.error(`\n${failures.length} file(s) failed:`);
    for (const f of failures) {
      console.error(`  ✗ ${path.basename(f.item.filePath)}: ${f.error.message}`);
    }
    return 1;
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((err) => {
      console.error('Fatal:', err && err.message ? err.message : err);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  printHelp,
  listMediaFiles,
  outputPathFor,
  extractAudio,
  probeDuration,
  planChunks,
  splitAudio,
  parseSrt,
  serializeSrt,
  fmtSrtTime,
  parseSrtTime,
  fmtClock,
  formatTxtTranscript,
  offsetAndDedup,
  segmentsFromVerboseJson,
  transcribeFile,
  resolveConflicts,
  runPool,
  main,
  SUPPORTED_EXTS,
  AUDIO_EXTS,
  VIDEO_EXTS,
  DEFAULT_API_BASE,
  DEFAULT_MODEL,
  DEFAULT_CHUNK_SECONDS,
  DEFAULT_CHUNK_OVERLAP,
};
