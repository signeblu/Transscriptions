# SimpleTranscription

A simple Node.js CLI that transcribes folders of `.wav`, `.mp3`, `.mp4`, and
`.mov` files using the [LiteLLM](https://litellm.stream.cavi.au.dk) gateway and
the `cavi/faster-whisper-large-v3` model.

The model runs locally on a server at CAVI and is hereby safe to use for interview data etc. 

## Requirements

- Node.js ≥ 18 (uses the built-in `fetch`, `FormData`, `Blob`, and `node:test`)
- `ffmpeg` on `PATH` (used to extract audio from video files)

> Don't have ffmpeg? See this guide:
> [FFmpeg Installation Guide for Windows, macOS, and Linux](https://github.com/oop7/ffmpeg-install-guide#readme)

- `LITELLM_API_KEY` environment variable

> Not sure how to set an environment variable? See this guide
> covering macOS, Linux, and Windows:
> [Environment Variables in Windows/macOS/Linux](https://www3.ntu.edu.sg/home/ehchua/programming/howto/Environment_Variables.html)

## Usage

```sh
LITELLM_API_KEY=... node simpletranscribe.js <folder> [options]
```

For each supported file in `<folder>` (top-level only), a transcription file
is written next to it with the same basename — e.g. `clip.mp4` → `clip.txt`.

### Options

| Flag | Description |
|------|-------------|
| `--srt` | Output `.srt` (SubRip) with timestamps instead of `.txt` |
| `--txt` | Output plain text (default) |
| `--overwrite`, `-y` | Overwrite existing transcription files without asking |
| `--skip-existing`, `-n` | Skip files whose transcription already exists |
| `--concurrency N`, `-c N` | Concurrent transcriptions across files (default: 4) |
| `--language CODE`, `-l CODE` | Language hint forwarded to the API (e.g. `en`, `fr`, `da`) |
| `--chunk-seconds N` | Chunk length in seconds for long files (default: 60) |
| `--chunk-overlap S` | Overlap between chunks in seconds (default: 1) |
| `--chunk-concurrency N` | Parallel chunks per file (default: 4) |
| `--request-timeout N` | Per-request timeout in seconds (default: 180) |
| `--no-chunk` | Disable chunking; upload the whole file in one request |
| `--help`, `-h` | Show help |

If a transcription already exists and neither `--overwrite` nor
`--skip-existing` is given, the tool prompts interactively
(`y` / `N` / `a` = overwrite all / `s` = skip all).

### Chunking

Files longer than `--chunk-seconds` (default 60 s) are automatically split
with ffmpeg, transcribed in parallel chunks (`--chunk-concurrency`, default 4),
and stitched back together. A small leading overlap (`--chunk-overlap`,
default 1 s) is dropped from each non-first chunk to avoid duplicate words at
the boundary.

Each request is bounded by `--request-timeout` (default 180 s) so that a
hanging connection is aborted and retried instead of stalling forever.

While a chunked transcription is running, a partial result is continuously
flushed to `<name>.txt.partial` (or `.srt.partial`) next to the source so you
can `tail -f` it. The partial file is removed once the final transcription is
written.

### Environment

| Variable | Default                             | Purpose |
|----------|-------------------------------------|---------|
| `LITELLM_API_KEY` | *(placeholder)*                     | Bearer token |
| `LITELLM_API_BASE` | `https://litellm.stream.cavi.au.dk` | API base URL |
| `LITELLM_MODEL` | `cavi/faster-whisper-large-v3`      | Model name |

## Tests

```sh
npm run test:unit          # offline, no API key needed
npm run test:integration   # requires LITELLM_API_KEY and network access
npm test                   # both
```

Integration tests download small public-domain speech samples (Open Speech
Repository, Harvard sentences in English, French, and Chinese) into
`test/cache/` and exercise WAV, MP3, MP4, and MOV inputs as well as `.txt` and
`.srt` output.
