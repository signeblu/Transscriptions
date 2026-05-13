'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const {
  parseArgs,
  outputPathFor,
  listMediaFiles,
  SUPPORTED_EXTS,
  planChunks,
  parseSrt,
  serializeSrt,
  fmtSrtTime,
  parseSrtTime,
  offsetAndDedup,
  segmentsFromVerboseJson,
  fmtClock,
  formatTxtTranscript,
} = require('../simpletranscribe.js');

test('parseArgs: defaults', () => {
  const a = parseArgs(['/some/folder']);
  assert.equal(a.folder, '/some/folder');
  assert.equal(a.format, 'txt');
  assert.equal(a.overwrite, null);
  assert.equal(a.concurrency, 4);
  assert.equal(a.language, null);
});

test('parseArgs: --srt switches output format', () => {
  const a = parseArgs(['folder', '--srt']);
  assert.equal(a.format, 'srt');
});

test('parseArgs: --overwrite / --skip-existing', () => {
  assert.equal(parseArgs(['f', '--overwrite']).overwrite, true);
  assert.equal(parseArgs(['f', '-y']).overwrite, true);
  assert.equal(parseArgs(['f', '--skip-existing']).overwrite, false);
  assert.equal(parseArgs(['f', '-n']).overwrite, false);
});

test('parseArgs: --concurrency and --language', () => {
  const a = parseArgs(['f', '--concurrency', '8', '--language', 'da']);
  assert.equal(a.concurrency, 8);
  assert.equal(a.language, 'da');
});

test('parseArgs: --help', () => {
  assert.equal(parseArgs(['--help']).help, true);
});

test('SUPPORTED_EXTS contains wav, mp3, mp4, mov', () => {
  for (const e of ['.wav', '.mp3', '.mp4', '.mov']) {
    assert.ok(SUPPORTED_EXTS.has(e), `missing ${e}`);
  }
});

test('outputPathFor: .txt for default', () => {
  assert.equal(outputPathFor('/a/b/clip.mp4', 'txt'), '/a/b/clip.txt');
  assert.equal(outputPathFor('/a/b/clip.WAV', 'txt'), '/a/b/clip.txt');
});

test('outputPathFor: .srt when format=srt', () => {
  assert.equal(outputPathFor('/a/b/clip.mp3', 'srt'), '/a/b/clip.srt');
});

test('listMediaFiles: only top-level, supported extensions', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'st-test-'));
  try {
    await fsp.writeFile(path.join(dir, 'a.wav'), '');
    await fsp.writeFile(path.join(dir, 'b.MP3'), '');
    await fsp.writeFile(path.join(dir, 'c.mp4'), '');
    await fsp.writeFile(path.join(dir, 'd.mov'), '');
    await fsp.writeFile(path.join(dir, 'notes.txt'), 'hi');
    await fsp.writeFile(path.join(dir, 'song.flac'), '');
    await fsp.mkdir(path.join(dir, 'sub'));
    await fsp.writeFile(path.join(dir, 'sub', 'nested.wav'), '');

    const files = (await listMediaFiles(dir)).map((p) => path.basename(p)).sort();
    assert.deepEqual(files, ['a.wav', 'b.MP3', 'c.mp4', 'd.mov']);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('CLI: prints help and exits 0 with --help', async () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'simpletranscribe.js'), '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
});

test('CLI: errors when no folder given', async () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'simpletranscribe.js')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
});

test('parseArgs: chunking flags', () => {
  const a = parseArgs(['f', '--chunk-seconds', '120', '--chunk-overlap', '2']);
  assert.equal(a.chunkSeconds, 120);
  assert.equal(a.chunkOverlap, 2);
  assert.equal(a.noChunk, false);
  assert.equal(parseArgs(['f', '--no-chunk']).noChunk, true);
});

test('parseArgs: chunking defaults', () => {
  const a = parseArgs(['f']);
  assert.equal(a.chunkSeconds, 60);
  assert.equal(a.chunkOverlap, 1);
  assert.equal(a.noChunk, false);
});

test('planChunks: short audio yields single chunk with no overlap', () => {
  const chunks = planChunks(300, 600, 1);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].audioStart, 0);
  assert.equal(chunks[0].absStart, 0);
  assert.equal(chunks[0].absEnd, 300);
});

test('planChunks: splits with leading overlap on non-first chunks', () => {
  const chunks = planChunks(1500, 600, 1);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[0], { index: 0, absStart: 0, absEnd: 600, audioStart: 0, audioLength: 600 });
  assert.equal(chunks[1].index, 1);
  assert.equal(chunks[1].absStart, 600);
  assert.equal(chunks[1].audioStart, 599); // 1 s overlap
  assert.equal(chunks[1].audioLength, 1200 - 599);
  assert.equal(chunks[2].absEnd, 1500);
  assert.equal(chunks[2].audioStart, 1199);
  assert.equal(chunks[2].audioLength, 1500 - 1199);
});

test('fmtSrtTime / parseSrtTime round-trip', () => {
  const t = 3723.456;
  const s = fmtSrtTime(t);
  assert.equal(s, '01:02:03,456');
  const back = parseSrtTime(s);
  assert.ok(Math.abs(back - t) < 0.002);
});

test('parseSrt / serializeSrt round-trip', () => {
  const src = '1\n00:00:01,000 --> 00:00:02,500\nHello world\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond line\n';
  const segs = parseSrt(src);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].text, 'Hello world');
  assert.equal(segs[1].start, 3);
  const out = serializeSrt(segs);
  const reparsed = parseSrt(out);
  assert.equal(reparsed.length, 2);
  assert.equal(reparsed[1].text, 'Second line');
});

test('offsetAndDedup: chunk 0 keeps everything', () => {
  const chunk = { index: 0, absStart: 0, absEnd: 600, audioStart: 0, audioLength: 600 };
  const segs = [{ start: 0, end: 1, text: 'a' }, { start: 5, end: 6, text: 'b' }];
  const out = offsetAndDedup(segs, chunk);
  assert.equal(out.length, 2);
  assert.equal(out[0].start, 0);
  assert.equal(out[1].start, 5);
});

test('offsetAndDedup: non-first chunk drops overlap region and offsets timestamps', () => {
  const chunk = { index: 1, absStart: 600, absEnd: 1200, audioStart: 599, audioLength: 601 };
  // Local timestamps relative to chunk start. A segment at local 0..0.8 lies
  // inside the 1 s overlap (mid < absStart=600 after offset).
  const segs = [
    { start: 0, end: 0.8, text: 'overlap-only' },
    { start: 1.2, end: 3.0, text: 'first-real' },
    { start: 4.0, end: 6.0, text: 'second-real' },
  ];
  const out = offsetAndDedup(segs, chunk);
  assert.equal(out.length, 2);
  assert.equal(out[0].text, 'first-real');
  assert.equal(out[0].start, 599 + 1.2);
  assert.equal(out[1].start, 599 + 4.0);
});

test('segmentsFromVerboseJson: extracts start/end/text', () => {
  const json = {
    segments: [
      { start: 0.0, end: 3.06, text: ' The birch canoe slid on the smooth planks.' },
      { start: 4.0, end: 6.26, text: ' Glue the sheet to the dark blue background.' },
    ],
  };
  const segs = segmentsFromVerboseJson(json);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].text, 'The birch canoe slid on the smooth planks.');
  assert.equal(segs[1].end, 6.26);
});

test('fmtClock: short and long durations', () => {
  assert.equal(fmtClock(0), '00:00');
  assert.equal(fmtClock(65), '01:05');
  assert.equal(fmtClock(3725), '01:02:05');
});

test('formatTxtTranscript: groups segments into timestamped paragraphs at pauses', () => {
  const segs = [
    { start: 0.0, end: 3.0, text: 'Hello there.' },
    { start: 3.1, end: 5.0, text: 'How are you?' },
    { start: 12.0, end: 14.5, text: 'I am well, thanks.' },
    { start: 14.7, end: 17.0, text: 'And you?' },
  ];
  const out = formatTxtTranscript(segs, { paragraphGapSec: 2 });
  const lines = out.split('\n');
  assert.equal(lines[0], '[00:00] Hello there. How are you?');
  assert.equal(lines[1], '');
  assert.equal(lines[2], '[00:12] I am well, thanks. And you?');
  assert.ok(out.endsWith('\n'));
});

test('formatTxtTranscript: timestamps use HH:MM:SS past one hour', () => {
  const segs = [
    { start: 0, end: 1, text: 'start' },
    { start: 3700, end: 3701, text: 'much later' },
  ];
  const out = formatTxtTranscript(segs, { paragraphGapSec: 2 });
  assert.match(out, /\[00:00\] start/);
  assert.match(out, /\[01:01:40\] much later/);
});

test('formatTxtTranscript: empty input yields empty string', () => {
  assert.equal(formatTxtTranscript([]), '');
});

test('formatTxtTranscript: breaks paragraphs after maxParagraphSec even without long pause', () => {
  const segs = [];
  for (let i = 0; i < 20; i++) {
    segs.push({ start: i * 3, end: i * 3 + 2.9, text: `s${i}.` });
  }
  const out = formatTxtTranscript(segs, { paragraphGapSec: 2, maxParagraphSec: 15 });
  const stamps = out.match(/\[\d{2}:\d{2}\]/g) || [];
  assert.ok(stamps.length >= 3, `expected at least 3 timestamped paragraphs, got ${stamps.length}`);
});

test('CLI: errors when LITELLM_API_KEY missing', async () => {
  const { spawnSync } = require('node:child_process');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'st-test-'));
  try {
    const env = { ...process.env };
    delete env.LITELLM_API_KEY;
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'simpletranscribe.js'), dir], { encoding: 'utf8', env });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /LITELLM_API_KEY/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
