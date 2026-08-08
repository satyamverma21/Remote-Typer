# Remote Typer — Project Context for Contributors

## Purpose

Remote Typer sends text from a controller computer to a receiver computer and types it using the receiver's keyboard. The receiver runs a Node.js/Express server and uses Nut.js for keyboard automation.

The main product goal is human-like rhythm: typing speed should vary primarily between words, not randomly on every character. Characters inside one word should normally arrive in a coherent burst. Long or complex words may contain one or two brief internal pauses.

## Repository structure

- `server.js` — receiver API, timing model, keyboard output, pause/resume/stop state.
- `index.html` — browser controller UI. It sends text and settings to the receiver.
- `README.md` — user-facing setup and API documentation.
- `package.json` — Node.js dependencies and `npm start` script.

## Running

```bash
npm install
npm start
```

The receiver listens on `0.0.0.0:5000` and prints its local IP. Open `index.html` on the controller computer and enter that IP address.

There is a three-second delay after `POST /type` starts so the user can focus the destination application.

## API

### `POST /type`

Request body:

```json
{
  "text": "Hello from Remote Typer!",
  "speed": 100,
  "variation": 40,
  "errorRate": 1
}
```

- `text`: required non-empty string.
- `speed`: `1`–`150`, interpreted as the baseline delay in milliseconds per character. Lower is faster; `1` is the fastest requested setting.
- `variation`: `0`–`100`, interpreted as word-rhythm variation. It is not a millisecond delay and must not be implemented as independent random jitter for every character.
- `errorRate`: `0`–`20` percent simulated errors.

The endpoint returns immediately with `{ success: true, status: "started" }`. It returns HTTP `409` if another typing operation is active.

### Control endpoints

- `POST /pause`
- `POST /resume`
- `POST /stop`
- `GET /status`

Typing state is process-local and supports one active typing job at a time. There is no job ID or multi-client coordination.

## Timing model

`buildTimingProfile()` creates one delay profile before typing begins:

1. Find contiguous word-like runs using Unicode letters and numbers.
2. Assign each word a coherent fast, normal, or slow rhythm state.
3. Interpolate both word tempo and the following word gap toward that state's targets using the requested variation percentage.
4. Add only small micro-variation inside a word.
5. For sufficiently long words, sometimes add an adaptive pause at a vowel/consonant-style chunk boundary.

`humanType()` then adds context-aware delays:

- spaces receive an explicit word gap;
- commas and semicolons receive shorter punctuation pauses;
- periods, exclamation marks, and question marks receive longer pauses;
- newlines and tabs use keyboard key events;
- occasional hesitation can occur after a word.

Important: Nut.js's default event delay is 300 ms. `server.js` explicitly sets both `keyboard.config.autoDelayMs` and the provider keyboard delay to `0`, because the application owns all timing. Do not reintroduce Nut.js's default delay unless the timing model is redesigned around it.

At `variation: 0`, user-controlled word tempo and gap differences collapse to a neutral multiplier. Higher values make fast, normal, and slow bursts increasingly distinct; `100` is the maximum and remains perceptible at low average speeds through state-dependent word gaps.

## Keyboard and Unicode behavior

Printable ASCII characters are sent through Nut.js directly. Characters outside printable ASCII use a clipboard-based fallback: place the character on the clipboard, press `Ctrl+V`, and always release `Ctrl` in a `finally` block.

This fallback exists because unsupported characters such as an en dash (`–`) can produce malformed native key events on some layouts/platforms. A malformed event previously caused text containing `–` to trigger browser shortcuts such as `Ctrl+S`.

The typing loop handles supplementary Unicode code points as one character while still indexing the timing profile correctly. Carriage returns in Windows newlines are ignored; newline and tab are emitted as actual key events.

The clipboard is currently not restored after a Unicode fallback. If clipboard preservation is added, it must not compromise reliable paste timing or Ctrl-key cleanup.

## Simulated errors

For alphanumeric characters, `errorRate` may cause a nearby wrong key to be typed, followed by a pause, Backspace, and correction pause. Punctuation and whitespace are not selected for simulated errors. The keyboard-neighbor map is defined in `getWrongCharacter()`.

## Optional Code Mode

`POST /type` accepts an optional `codeMode` object. If it is absent or disabled, the executor sends no additional keystrokes. When enabled, it dismisses GUI autocomplete before Enter/Tab (toggleable), selects editor-generated indentation with cleanup-safe `Shift+Home`, and lets the first source character type over that selection. It never deletes possibly empty indentation selections.

Modern-editor type-over is the default closer strategy. An opt-in fallback stack can move over auto-inserted brackets, with a separate best-effort option for quotes. The two closer strategies are mutually exclusive and validated at the API boundary. Escape-based autocomplete dismissal must be disabled for Vim, Neovim, and other modal editors because it exits insert mode.

Code Mode is blind and heuristic because Remote Typer cannot inspect the target editor. `verifiedMode` is reserved but currently rejected when enabled; clipboard-coordinated verification has not been implemented.

## Safety and limitations

- The server enables CORS and listens on all network interfaces.
- There is no authentication or authorization. Run it only on a trusted private network.
- Nut.js requires permission for Node.js to control the keyboard.
- The server has a single global typing state and is not designed for concurrent jobs.
- The three-second focus countdown is part of the current UX contract.
- Timing is approximate because operating-system scheduling and keyboard automation add overhead.

## Contribution guidance for another LLM

Before changing behavior, inspect `server.js` and preserve these invariants:

- variation is word-level, not per-character speed noise;
- speed `1` must remain extremely fast and must not inherit a hidden 300 ms Nut.js delay;
- all user-controlled numeric settings are validated at the API boundary;
- every manually pressed modifier key must be released even on errors or cancellation;
- Unicode text must not be sent through an unsafe native key mapping;
- pause, resume, stop, and the three-second countdown must remain responsive;
- avoid unrelated rewrites or formatting churn.

Recommended verification after changes:

```bash
node --check server.js
git diff --check
npm start
```

Test manually with short and long words, punctuation, newlines, tabs, emoji, en dashes, `speed: 1`, `variation: 0`, `variation: 100`, pause/resume, stop during countdown, and stop during typing. Confirm that text such as `Rhythm variation is now limited to 0–100.` does not invoke browser save or another shortcut.

## Useful design direction

Future improvements should focus on making the rhythm model configurable and testable without sending real keyboard events. A good separation would be:

```text
request validation → timing profile generation → cancellable typing executor → keyboard adapter
```

The timing-profile generator should be unit-testable with a seeded/randomness-injected generator. The keyboard adapter should be mockable so Unicode fallback, modifier cleanup, pause, stop, and error recovery can be tested safely.
