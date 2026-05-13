# How to run SimpleTranscription on our own files

This guide explains how to set up the API key, convert unsupported audio files if needed, run the transcription script, and find the generated output files.

---

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

On Windows PowerShell, the equivalent command to list files is:

```powershell
dir
```

---

## 2. Set the API key

Before running the script, set the API key as an environment variable.

The script expects the key to be called:

```text
LITELLM_API_KEY
```

Do **not** paste the API key directly into `simpletranscribe.js`, and do **not** commit the API key to GitHub.

---

### macOS/Linux

In the same terminal window where you will run the script, run:

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

### Windows PowerShell

If you are using Windows PowerShell, run:

```powershell
$env:LITELLM_API_KEY="paste_your_api_key_here"
```

Example format:

```powershell
$env:LITELLM_API_KEY="sk-..."
```

Important:

- Use quotes around the key.
- Do not put spaces around `=`.
- This only sets the key for the current PowerShell window.

This is correct:

```powershell
$env:LITELLM_API_KEY="sk-..."
```

This is wrong:

```powershell
$env:LITELLM_API_KEY = "sk-..."
```

To check that the key is set:

```powershell
echo $env:LITELLM_API_KEY
```

If it prints the key, the environment variable is ready.

---

### Windows Command Prompt

If you are using the old Windows Command Prompt, also called `cmd`, run:

```cmd
set LITELLM_API_KEY=paste_your_api_key_here
```

Example format:

```cmd
set LITELLM_API_KEY=sk-...
```

To check that the key is set:

```cmd
echo %LITELLM_API_KEY%
```

Most people on Windows should use **PowerShell** unless they specifically know they are using Command Prompt.

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

## 4. Convert unsupported audio files if needed

Some audio files are not supported directly by the script.

For example, iPhone Voice Memos are often saved as:

```text
.m4a
```

The script does **not** currently pick up `.m4a` files, so they should be converted to `.mp3` or `.wav` first.

Usually, `.mp3` is the easiest choice because the file size is smaller than `.wav`.

---

### Check if `ffmpeg` is installed

The easiest way to convert audio files is with `ffmpeg`.

Check if you have it installed:

```bash
ffmpeg -version
```

On Windows PowerShell:

```powershell
ffmpeg -version
```

If you see version information, `ffmpeg` is installed.

If the command fails, install `ffmpeg` first.

---

### Convert one `.m4a` file to `.mp3`

macOS/Linux:

```bash
ffmpeg -i "my-voice-memo.m4a" "my-voice-memo.mp3"
```

Windows PowerShell:

```powershell
ffmpeg -i "my-voice-memo.m4a" "my-voice-memo.mp3"
```

After this, put the `.mp3` file in your transcription folder.

Example:

```text
my-audio-files/
  my-voice-memo.mp3
```

Then run the transcription script:

```bash
node simpletranscribe.js ./my-audio-files --language da --overwrite
```

---

### Convert one `.m4a` file to `.wav`

macOS/Linux:

```bash
ffmpeg -i "my-voice-memo.m4a" "my-voice-memo.wav"
```

Windows PowerShell:

```powershell
ffmpeg -i "my-voice-memo.m4a" "my-voice-memo.wav"
```

`.wav` also works, but the files are usually larger than `.mp3`.

---

### Convert all `.m4a` files in a folder to `.mp3`

If you have many iPhone Voice Memo files, put them all in one folder first.

#### macOS/Linux

Go into the folder:

```bash
cd path/to/voice-memos
```

Then run:

```bash
for f in *.m4a; do ffmpeg -i "$f" "${f%.m4a}.mp3"; done
```

Example:

```bash
cd ~/Downloads/voice-memos
for f in *.m4a; do ffmpeg -i "$f" "${f%.m4a}.mp3"; done
```

#### Windows PowerShell

Go into the folder:

```powershell
cd path\to\voice-memos
```

Then run:

```powershell
Get-ChildItem *.m4a | ForEach-Object {
  ffmpeg -i $_.Name "$($_.BaseName).mp3"
}
```

After conversion, the folder will contain both the original `.m4a` files and the new `.mp3` files.

Example:

```text
voice-memos/
  interview.m4a
  interview.mp3
  meeting.m4a
  meeting.mp3
```

The script will ignore the `.m4a` files and transcribe the `.mp3` files.

---

## 5. Run the transcription script

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

On Windows PowerShell, the command is the same:

```powershell
node simpletranscribe.js ./my-audio-files --language da --overwrite
```

---

## 6. Find the output files

The transcription output is saved next to the original file.

Example:

```text
my-audio-files/interview.mp4     ->  my-audio-files/interview.txt
my-audio-files/meeting.mp3       ->  my-audio-files/meeting.txt
my-audio-files/voice-note.wav    ->  my-audio-files/voice-note.txt
my-audio-files/my-voice-memo.mp3 ->  my-audio-files/my-voice-memo.txt
```

So after running the script, look inside the same folder where the original audio/video file is.

You can check in terminal with:

```bash
ls my-audio-files
```

On Windows PowerShell:

```powershell
dir my-audio-files
```

---

## 7. Output as subtitles instead of plain text

By default, the script creates `.txt` files.

If you want subtitles with timestamps, use `--srt`:

```bash
node simpletranscribe.js ./my-audio-files --language da --srt --overwrite
```

On Windows PowerShell:

```powershell
node simpletranscribe.js ./my-audio-files --language da --srt --overwrite
```

Example output:

```text
my-audio-files/interview.mp4 -> my-audio-files/interview.srt
```

---

## 8. What `--overwrite` means

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

## 9. Running tests is different from transcribing your own files

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

## 10. Common commands

### Danish transcription to `.txt` on macOS/Linux

```bash
export LITELLM_API_KEY="sk-..."
node simpletranscribe.js ./my-audio-files --language da --overwrite
```

### Danish transcription to `.txt` on Windows PowerShell

```powershell
$env:LITELLM_API_KEY="sk-..."
node simpletranscribe.js ./my-audio-files --language da --overwrite
```

### English transcription to `.txt` on macOS/Linux

```bash
export LITELLM_API_KEY="sk-..."
node simpletranscribe.js ./my-audio-files --language en --overwrite
```

### English transcription to `.txt` on Windows PowerShell

```powershell
$env:LITELLM_API_KEY="sk-..."
node simpletranscribe.js ./my-audio-files --language en --overwrite
```

### Danish transcription to `.srt`

```bash
node simpletranscribe.js ./my-audio-files --language da --srt --overwrite
```

### Skip files that already have transcripts

```bash
node simpletranscribe.js ./my-audio-files --language da --skip-existing
```

### Convert one iPhone Voice Memo `.m4a` file to `.mp3`

```bash
ffmpeg -i "my-voice-memo.m4a" "my-voice-memo.mp3"
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

## 11. Troubleshooting

### Error: `LITELLM_API_KEY is not set`

The API key has not been set in the current terminal window.

On macOS/Linux, run:

```bash
export LITELLM_API_KEY="sk-..."
```

On Windows PowerShell, run:

```powershell
$env:LITELLM_API_KEY="sk-..."
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

If your files are `.m4a`, convert them to `.mp3` first:

```bash
ffmpeg -i "my-voice-memo.m4a" "my-voice-memo.mp3"
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

### `.m4a` files from iPhone Voice Memos do not work

The script does not currently transcribe `.m4a` files directly.

Convert them to `.mp3` first:

```bash
ffmpeg -i "voice-memo.m4a" "voice-memo.mp3"
```

Then run:

```bash
node simpletranscribe.js ./my-audio-files --language da --overwrite
```

---

## 12. Full example from start to finish on macOS/Linux

```bash
cd path/to/simpletranscription

export LITELLM_API_KEY="sk-..."

mkdir my-audio-files
# Put interview.mp4, voice-memo.mp3, or another supported file into my-audio-files

node simpletranscribe.js ./my-audio-files --language da --overwrite

ls my-audio-files
```

Expected result:

```text
interview.mp4
interview.txt
```

---

## 13. Full example from start to finish on Windows PowerShell

```powershell
cd path\to\simpletranscription

$env:LITELLM_API_KEY="sk-..."

mkdir my-audio-files
# Put interview.mp4, voice-memo.mp3, or another supported file into my-audio-files

node simpletranscribe.js ./my-audio-files --language da --overwrite

dir my-audio-files
```

Expected result:

```text
interview.mp4
interview.txt
```

---

## 14. Full example with an iPhone Voice Memo

Suppose you have this file:

```text
voice-memo.m4a
```

First convert it to `.mp3`:

```bash
ffmpeg -i "voice-memo.m4a" "voice-memo.mp3"
```

Then put `voice-memo.mp3` inside your transcription folder:

```text
my-audio-files/
  voice-memo.mp3
```

Run:

```bash
node simpletranscribe.js ./my-audio-files --language da --overwrite
```

Expected result:

```text
my-audio-files/
  voice-memo.mp3
  voice-memo.txt
```
