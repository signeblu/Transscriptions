# Simple AI transcription

## Functionality
- Should use node.js
- CLI: `simpletranscribe.js <myfolder> [options]`
- Transcribes a folder of `.wav`, `.mp3`, `.mp4`, `.mov` files (top-level only, no recursion)
- Creates a transcription file next to each source file with the same basename
  (e.g. `clip.mp4` → `clip.txt`)
- Uses the model `cavi/faster-whisper-large-v3` on `https://litellm.stream.cavi.au.dk`
  (OpenAI-compatible `/v1/audio/transcriptions` endpoint)
- Uses the environment variable `LITELLM_API_KEY` for authentication
- Should be implemented in a simple straightforward manner

## Behavior / Options
- **Video inputs (`.mp4`, `.mov`)**: audio is extracted with `ffmpeg` to a temporary
  file before being uploaded (ffmpeg is a required external dependency).
- **Output format**:
  - Default: plain `.txt` (human-readable, no timestamps)
  - `--srt` option produces SubRip `.srt` with timestamps
- **Existing transcription files**: prompt the user whether to overwrite.
  Flags `--overwrite`/`-y` and `--skip-existing`/`-n` bypass the prompt.
  The interactive prompt also accepts `a` (overwrite all) and `s` (skip all).
- **Concurrency**: files are processed concurrently (default 4, `--concurrency N`).
- **Language**: optional `--language CODE` (e.g. `en`, `da`) hint forwarded to the API.

## Environment variables
- `LITELLM_API_KEY` (required) — API key.
- `LITELLM_API_BASE` (optional) — override API base URL.
- `LITELLM_MODEL` (optional) — override model name.

## Testing
- A test suite must exercise the tool against multiple languages and both
  `.wav` and `.mp3` inputs. Sample audio is sourced from the public web during
  test setup (cached locally).
