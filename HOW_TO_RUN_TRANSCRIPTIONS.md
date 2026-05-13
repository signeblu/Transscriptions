# How to run SimpleTranscription on our own files

This guide explains how to set up the API key, run the transcription script, and find the generated output files.

## 1. Open the project terminal

Open a terminal in the project folder, for example:

```bash
cd path/to/simpletranscription
```

You should be in the folder that contains:

```text
simpletranscribe.js
package.json
README.md
test/
```

You can check this by running:

```bash
ls
```

If you see `simpletranscribe.js`, you are in the right folder.

---

## 2. Set the API key

Before running the script, set the API key as an environment variable.

On macOS/Linux:

```bash
export LITELLM_API_KEY="paste_your_api_key_here"
```

Example format:

```bash
export LITELLM_API_KEY="sk-..."
```

Important:

- Use quotes around the key.
- Do not put spaces around `=`.
- Do not paste the API key directly into `simpletranscribe.js`.
- Do not commit the API key to GitHub.
- The key only stays active in the current terminal window.

This is correct:

```bash
export LITELLM_API_KEY="sk-..."
```

This is wrong:

```bash
export LITELLM_API_KEY = "sk-..."
```

To check that the key is set:

```bash
echo $LITELLM_API_KEY
```

If it prints the key, the environment variable is ready.

---

## 3. Put your audio/video files in a folder

Create a folder for the files you want to transcribe:

```bash
mkdir my-audio-files
```

Put your files inside that folder.

Supported file types:

```text
.wav
.mp3
.mp4
.mov
```

Example folder:

```text
my-audio-files/
  interview.mp4
  meeting.mp3
  voice-note.wav
```

The script only looks at files directly inside the folder. It does not search inside subfolders.

---

## 4. Run the transcription script

Run:

```bash
node simpletranscribe.js ./my-audio-files --language da --overwrite
```

For Danish audio, use:

```bash
node simpletranscribe.js ./my-audio-files --language da --overwrite
```

For English audio, use:

```bash
node simpletranscribe.js ./my-audio-files --language en --overwrite
```

If you do not know the language, you can leave out `--language`:

```bash
node simpletranscribe.js ./my-audio-files --overwrite
```

---

## 5. Find the output files

The transcription output is saved next to the original file.

Example:

```text
my-audio-files/interview.mp4  ->  my-audio-files/interview.txt
my-audio-files/meeting.mp3    ->  my-audio-files/meeting.txt
my-audio-files/voice-note.wav ->  my-audio-files/voice-note.txt
```

So after running the script, look inside the same folder where the original audio/video file is.

You can check in terminal with:

```bash
ls my-audio-files
```

---

## 6. Output as subtitles instead of plain text

By default, the script creates `.txt` files.

If you want subtitles with timestamps, use `--srt`:

```bash
node simpletranscribe.js ./my-audio-files --language da --srt --overwrite
```

Example output:

```text
my-audio-files/interview.mp4 -> my-audio-files/interview.srt
```

---

## 7. What `--overwrite` means

If a transcription file already exists, the script normally asks whether to overwrite it.

Using `--overwrite` means it will replace old transcription files automatically:

```bash
node simpletranscribe.js ./my-audio-files --language da --overwrite
```

If you do not want to overwrite existing files, use:

```bash
node simpletranscribe.js ./my-audio-files --language da --skip-existing
```

or:

```bash
node simpletranscribe.js ./my-audio-files --language da -n
```

---

## 8. Running tests is different from transcribing your own files

This command runs the test suite:

```bash
npm test
```

The tests check that the tool works, but they create temporary folders for test audio files.

That means the output files from `npm test` are not saved in your project folder permanently. The test files are cleaned up after the tests pass.

To create an actual transcript you can use, you must run:

```bash
node simpletranscribe.js ./my-audio-files --language da --overwrite
```

---

## 9. Common commands

### Danish transcription to `.txt`

```bash
export LITELLM_API_KEY="sk-..."
node simpletranscribe.js ./my-audio-files --language da --overwrite
```

### English transcription to `.txt`

```bash
export LITELLM_API_KEY="sk-..."
node simpletranscribe.js ./my-audio-files --language en --overwrite
```

### Danish transcription to `.srt`

```bash
export LITELLM_API_KEY="sk-..."
node simpletranscribe.js ./my-audio-files --language da --srt --overwrite
```

### Skip files that already have transcripts

```bash
node simpletranscribe.js ./my-audio-files --language da --skip-existing
```

### Run all tests

```bash
npm test
```

### Run only integration tests

```bash
npm run test:integration
```

### Run only unit tests

```bash
npm run test:unit
```

---

## 10. Troubleshooting

### Error: `LITELLM_API_KEY is not set`

The API key has not been set in the current terminal window.

Run:

```bash
export LITELLM_API_KEY="sk-..."
```

Then run the transcription command again in the same terminal.

---

### No supported files found

The folder does not contain any supported files.

Make sure your folder contains one of these:

```text
.wav
.mp3
.mp4
.mov
```

Also make sure the files are directly inside the folder, not hidden in a subfolder.

---

### Output file is missing

Check that you are looking in the same folder as the original media file.

For example, if you ran:

```bash
node simpletranscribe.js ./my-audio-files --language da --overwrite
```

then the output should be inside:

```text
my-audio-files/
```

The output will have the same name as the original file, but with `.txt` or `.srt`.

---

### Video files do not work

Video files need `ffmpeg` installed.

Check if `ffmpeg` is available:

```bash
ffmpeg -version
```

If that command fails, install `ffmpeg` first.

---

## 11. Full example from start to finish

```bash
cd path/to/simpletranscription

export LITELLM_API_KEY="sk-..."

mkdir my-audio-files
# Put interview.mp4 or another supported file into my-audio-files

node simpletranscribe.js ./my-audio-files --language da --overwrite

ls my-audio-files
```

Expected result:

```text
interview.mp4
interview.txt
```
