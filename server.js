const express = require("express");
const cors = require("cors");
const os = require("os");

const {
    keyboard,
    clipboard,
    Key,
    providerRegistry
} = require("@nut-tree-fork/nut-js");

// Nut.js defaults to 300 ms before every keyboard event. The application
// already controls timing, so leave both Nut.js delay layers disabled.
keyboard.config.autoDelayMs = 0;

if (providerRegistry.hasKeyboard()) {
    providerRegistry
        .getKeyboard()
        .setKeyboardDelay(0);
}

const app = express();

app.use(cors());
app.use(express.json());

let typingState = {
    running: false,
    paused: false,
    stopped: false
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getLocalIP() {
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (
                net.family === "IPv4" &&
                !net.internal
            ) {
                return net.address;
            }
        }
    }

    return "localhost";
}

function getWrongCharacter(char) {
    const keyboardMap = {
        a: "qwsz",
        b: "vghn",
        c: "xdfv",
        d: "ersfcx",
        e: "wsdr",
        f: "rtgdvc",
        g: "tyfhvb",
        h: "yugjbn",
        i: "ujko",
        j: "uikhmn",
        k: "ioljm",
        l: "opk",
        m: "njk",
        n: "bhjm",
        o: "iklp",
        p: "ol",
        q: "wa",
        r: "edft",
        s: "awedxz",
        t: "rfgy",
        u: "yhji",
        v: "cfgb",
        w: "qase",
        x: "zsdc",
        y: "tghu",
        z: "asx"
    };

    const lower = char.toLowerCase();

    if (keyboardMap[lower]) {
        const options = keyboardMap[lower];

        const wrong =
            options[
                Math.floor(
                    Math.random() * options.length
                )
            ];

        return char === char.toUpperCase()
            ? wrong.toUpperCase()
            : wrong;
    }

    if (/[0-9]/.test(char)) {
        const numbers = "0123456789";

        let wrong;

        do {
            wrong =
                numbers[
                    Math.floor(
                        Math.random() *
                        numbers.length
                    )
                ];
        } while (wrong === char);

        return wrong;
    }

    return char;
}

function isNativeKeyboardCharacter(char) {
    if (char.length !== 1) {
        return false;
    }

    const code = char.charCodeAt(0);

    // libnut reliably maps printable ASCII. Other Unicode characters can
    // produce malformed native key events on some platforms/layouts.
    return code >= 0x20 && code <= 0x7e;
}

async function typeUnicodeCharacter(char) {
    await clipboard.setContent(char);

    let controlIsDown = false;

    try {
        await keyboard.pressKey(Key.LeftControl);
        controlIsDown = true;
        await keyboard.type("v");
    } finally {
        if (controlIsDown) {
            await keyboard.releaseKey(Key.LeftControl);
        }
    }
}

async function tapKey(key) {
    let keyIsDown = false;

    try {
        keyIsDown = true;
        await keyboard.pressKey(key);
    } finally {
        if (keyIsDown) {
            await keyboard.releaseKey(key);
        }
    }
}

async function selectFromIndentationToLineStart() {
    let shiftIsDown = false;

    try {
        shiftIsDown = true;
        await keyboard.pressKey(Key.LeftShift);
        await tapKey(Key.Home);
    } finally {
        if (shiftIsDown) {
            await keyboard.releaseKey(Key.LeftShift);
        }
    }
}

const disabledCodeMode = Object.freeze({
    enabled: false,
    autoIndent: false,
    dismissAutocomplete: false,
    autoCloseTypeOver: false,
    bracketSkipStack: false,
    quoteSkipStack: false,
    verifiedMode: false
});

function parseCodeMode(value) {
    if (value === undefined) {
        return { value: disabledCodeMode };
    }

    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        return { error: "codeMode must be an object" };
    }

    const fields = [
        "enabled",
        "autoIndent",
        "dismissAutocomplete",
        "autoCloseTypeOver",
        "bracketSkipStack",
        "quoteSkipStack",
        "verifiedMode"
    ];

    for (const field of fields) {
        if (value[field] !== undefined && typeof value[field] !== "boolean") {
            return { error: `codeMode.${field} must be a boolean` };
        }
    }

    if (value.enabled !== true) {
        return { value: disabledCodeMode };
    }

    const parsed = {
        enabled: true,
        autoIndent: value.autoIndent ?? true,
        dismissAutocomplete: value.dismissAutocomplete ?? true,
        autoCloseTypeOver: value.autoCloseTypeOver ?? true,
        bracketSkipStack: value.bracketSkipStack ?? false,
        quoteSkipStack: value.quoteSkipStack ?? false,
        verifiedMode: value.verifiedMode ?? false
    };

    if (!parsed.autoIndent) {
        return { error: "codeMode.autoIndent must be true when Code Mode is enabled" };
    }

    if (parsed.autoCloseTypeOver && parsed.bracketSkipStack) {
        return {
            error: "codeMode.autoCloseTypeOver and codeMode.bracketSkipStack cannot both be true"
        };
    }

    if (parsed.quoteSkipStack && !parsed.bracketSkipStack) {
        return {
            error: "codeMode.quoteSkipStack requires codeMode.bracketSkipStack"
        };
    }

    if (parsed.verifiedMode) {
        return {
            error: "codeMode.verifiedMode is not implemented yet"
        };
    }

    return { value: parsed };
}

function isEscapedCharacter(text, index) {
    let backslashes = 0;

    for (let position = index - 1; position >= 0 && text[position] === "\\"; position--) {
        backslashes++;
    }

    return backslashes % 2 === 1;
}

async function waitWhilePaused() {
    while (
        typingState.paused &&
        !typingState.stopped
    ) {
        await sleep(100);
    }
}

function isWordCharacter(char) {
    return /[\p{L}\p{N}]/u.test(char);
}

function isVowel(char) {
    return /[aeiouy]/i.test(char);
}

const qwertyKeys = {
    q: { hand: "left", finger: "pinky", row: 0 },
    a: { hand: "left", finger: "pinky", row: 1 },
    z: { hand: "left", finger: "pinky", row: 2 },
    w: { hand: "left", finger: "ring", row: 0 },
    s: { hand: "left", finger: "ring", row: 1 },
    x: { hand: "left", finger: "ring", row: 2 },
    e: { hand: "left", finger: "middle", row: 0 },
    d: { hand: "left", finger: "middle", row: 1 },
    c: { hand: "left", finger: "middle", row: 2 },
    r: { hand: "left", finger: "index", row: 0 },
    f: { hand: "left", finger: "index", row: 1 },
    v: { hand: "left", finger: "index", row: 2 },
    t: { hand: "left", finger: "index", row: 0 },
    g: { hand: "left", finger: "index", row: 1 },
    b: { hand: "left", finger: "index", row: 2 },
    y: { hand: "right", finger: "index", row: 0 },
    h: { hand: "right", finger: "index", row: 1 },
    n: { hand: "right", finger: "index", row: 2 },
    u: { hand: "right", finger: "index", row: 0 },
    j: { hand: "right", finger: "index", row: 1 },
    m: { hand: "right", finger: "index", row: 2 },
    i: { hand: "right", finger: "middle", row: 0 },
    k: { hand: "right", finger: "middle", row: 1 },
    o: { hand: "right", finger: "ring", row: 0 },
    l: { hand: "right", finger: "ring", row: 1 },
    p: { hand: "right", finger: "pinky", row: 0 }
};

function getDigraphMultiplier(previous, current) {
    const first = qwertyKeys[previous.toLowerCase()];
    const second = qwertyKeys[current.toLowerCase()];

    if (!first || !second) {
        return 1;
    }

    if (previous.toLowerCase() === current.toLowerCase()) {
        return 0.9;
    }

    if (first.hand !== second.hand) {
        return 0.86;
    }

    if (first.finger === second.finger) {
        return 1.42;
    }

    return Math.abs(first.row - second.row) > 0 ? 1.16 : 1.04;
}

function getWordPlanningDelay(word, followsSentenceEnd, averageSpeed) {
    const lengthCost = clamp(Math.max(0, word.length - 4) * 2.5, 0, 24);
    const rareLetters = (word.match(/[qxzj]/gi) || []).length;
    const rarityCost = clamp(rareLetters * 8 + (word.length > 8 ? 10 : 0), 0, 30);
    const sentenceCost = followsSentenceEnd ? 18 : 0;
    const scale = clamp(averageSpeed / 100, 0.45, 1.5);

    return (lengthCost + rarityCost + sentenceCost) * scale;
}

function randomExponential(mean) {
    return -Math.log(Math.max(Number.EPSILON, Math.random())) * mean;
}

function getChunkBoundaries(word) {
    if (word.length < 8) {
        return [];
    }

    const candidates = [];

    for (let i = 2; i < word.length - 2; i++) {
        if (isVowel(word[i]) !== isVowel(word[i + 1])) {
            candidates.push(i);
        }
    }

    const selected = [];
    const maxBoundaries = word.length >= 12 ? 2 : 1;

    while (selected.length < maxBoundaries && candidates.length > 0) {
        const candidateIndex = Math.floor(Math.random() * candidates.length);
        const boundary = candidates.splice(candidateIndex, 1)[0];

        if (selected.every(existing => Math.abs(existing - boundary) > 2)) {
            selected.push(boundary);
        }
    }

    return selected;
}

function chooseRhythmState(previousState) {
    const roll = Math.random();

    if (previousState === "fast") {
        return roll < 0.35 ? "fast" : roll < 0.85 ? "normal" : "slow";
    }

    if (previousState === "slow") {
        return roll < 0.15 ? "fast" : roll < 0.7 ? "normal" : "slow";
    }

    return roll < 0.3 ? "fast" : roll < 0.7 ? "normal" : "slow";
}

function buildTimingProfile(text, averageSpeed, variation) {
    const delays = Array.from({ length: text.length }, () => averageSpeed);
    const wordGapFactors = Array.from({ length: text.length }, () => 1);
    const wordVariation = clamp(variation / 100, 0, 1);
    let tempo = 1;
    let longRangeDrift = 1;
    let rhythmState = "normal";
    let index = 0;
    let followsSentenceEnd = false;

    while (index < text.length) {
        if (!isWordCharacter(text[index])) {
            if (/[.!?]/.test(text[index])) {
                followsSentenceEnd = true;
            }
            index++;
            continue;
        }

        const start = index;
        while (index < text.length && isWordCharacter(text[index])) {
            index++;
        }

        const word = text.slice(start, index);
        rhythmState = chooseRhythmState(rhythmState);
        tempo = clamp(
            tempo + randomBetween(-0.08, 0.08) * wordVariation,
            0.78,
            1.22
        );
        longRangeDrift = clamp(
            longRangeDrift +
                randomBetween(-0.025, 0.035) * wordVariation,
            0.88,
            1.16
        );
        const stateTargets = {
            fast: 0.75,
            normal: 1,
            slow: 1.45
        };
        const stateMultiplier = 1 +
            (stateTargets[rhythmState] - 1) * wordVariation;
        const wordTempo = clamp(
            tempo * longRangeDrift * stateMultiplier,
            0.5,
            1.8
        );
        for (let position = start; position < index; position++) {
            const current = text[position];
            const digraphMultiplier = position === start
                ? 1
                : getDigraphMultiplier(text[position - 1], current);
            const rightSkewedTail = randomExponential(
                clamp(averageSpeed * 0.035, 0.15, 8)
            );
            const shiftLatency = /[A-Z]/.test(current)
                ? clamp(averageSpeed * 0.08, 1, 12)
                : 0;

            delays[position] = clamp(
                averageSpeed * wordTempo * digraphMultiplier +
                    rightSkewedTail +
                    shiftLatency,
                1,
                5000
            );

            if (position === start) {
                delays[position] += getWordPlanningDelay(
                    word,
                    followsSentenceEnd,
                    averageSpeed
                );
            }
        }

        for (const boundary of getChunkBoundaries(word)) {
            if (Math.random() < 0.38) {
                delays[start + boundary] += randomBetween(35, 110) *
                    clamp(averageSpeed / 100, 0.6, 1.5);
            }
        }

        if (text[index] === " ") {
            const gapTargets = {
                fast: 0.45,
                normal: 1,
                slow: 2.2
            };

            wordGapFactors[index] = 1 +
                (gapTargets[rhythmState] - 1) * wordVariation;
        }

        followsSentenceEnd = false;
    }

    return {
        delays,
        wordGapFactors,
        variationStrength: wordVariation
    };
}

async function humanType(
    text,
    averageSpeed,
    variation,
    errorRate,
    codeMode = disabledCodeMode
) {
    typingState.running = true;

    const pauseScale = clamp(
        averageSpeed / 100,
        0.05,
        1.5
    );
    const wordGapBase = clamp(
        averageSpeed * 0.45,
        25,
        120
    );
    const hesitationScale = clamp(
        averageSpeed / 100,
        0.5,
        1.5
    );
    const timingProfile = buildTimingProfile(text, averageSpeed, variation);
    const {
        delays,
        wordGapFactors,
        variationStrength
    } = timingProfile;
    const closerStack = [];
    let mustCompleteCodeSequence = false;

    try {
        for (
            let i = 0;
            i < text.length;
            i++
        ) {
            if (!mustCompleteCodeSequence) {
                if (typingState.stopped) {
                    break;
                }

                await waitWhilePaused();

                if (typingState.stopped) {
                    break;
                }
            }

            const characterIndex = i;
            const codePoint = text.codePointAt(i);
            const char = String.fromCodePoint(codePoint);
            const characterLength = char.length;

            // A supplementary Unicode character occupies two UTF-16 code
            // units, but must be inserted as one clipboard value.
            i += characterLength - 1;

            // Ignore the carriage-return half of Windows-style newlines.
            if (char === "\r") {
                continue;
            }

            let delay = clamp(
                delays[characterIndex],
                1,
                5000
            );

            // punctuation pauses
            if (
                char === "," ||
                char === ";"
            ) {
                delay += randomBetween(
                    70 * pauseScale,
                    180 * pauseScale
                );
            }

            if (
                char === "." ||
                char === "!" ||
                char === "?"
            ) {
                delay += randomBetween(
                    180 * pauseScale,
                    420 * pauseScale
                );
            }

            // Escape dismisses GUI-editor completion popups. It must be
            // disabled for Vim/Neovim because Escape exits insert mode.
            if (char === "\n") {
                if (codeMode.enabled && codeMode.dismissAutocomplete) {
                    await tapKey(Key.Escape);
                }

                await tapKey(Key.Enter);

                if (codeMode.enabled && codeMode.autoIndent) {
                    // Select any editor-generated indentation. The first
                    // source character on the next line types over it; no
                    // Backspace/Delete is safe here because selection may be empty.
                    await selectFromIndentationToLineStart();
                    mustCompleteCodeSequence = true;
                } else {
                    mustCompleteCodeSequence = false;
                }

                await sleep(
                    delay +
                        randomBetween(
                            120 * pauseScale,
                            280 * pauseScale
                        )
                );

                continue;
            }

            // tab
            if (char === "\t") {
                if (codeMode.enabled && codeMode.dismissAutocomplete) {
                    await tapKey(Key.Escape);
                }

                await tapKey(Key.Tab);
                mustCompleteCodeSequence = false;

                await sleep(delay);

                continue;
            }

            if (codeMode.enabled && codeMode.bracketSkipStack) {
                const expectedCloser = closerStack[closerStack.length - 1];
                const isQuote = char === "\"" || char === "'" || char === "`";
                const canSkipQuote = codeMode.quoteSkipStack &&
                    isQuote &&
                    !isEscapedCharacter(text, characterIndex);
                const canSkipBracket = /[)\]}]/.test(char);

                if (
                    char === expectedCloser &&
                    (canSkipBracket || canSkipQuote)
                ) {
                    closerStack.pop();
                    await tapKey(Key.Right);
                    mustCompleteCodeSequence = false;
                    await sleep(delay);
                    continue;
                }
            }

            const shouldMakeError =
                /[a-z0-9]/i.test(char) &&
                Math.random() <
                    errorRate / 100;

            if (shouldMakeError) {
                const wrongChar =
                    getWrongCharacter(char);

                await keyboard.type(
                    wrongChar
                );

                // notices typo
                await sleep(
                    randomBetween(
                        180 * pauseScale,
                        420 * pauseScale
                    )
                );

                await keyboard.pressKey(
                    Key.Backspace
                );

                await keyboard.releaseKey(
                    Key.Backspace
                );

                await sleep(
                    randomBetween(
                        70 * pauseScale,
                        180 * pauseScale
                    )
                );
            }

            if (isNativeKeyboardCharacter(char)) {
                await keyboard.type(char);
            } else {
                await typeUnicodeCharacter(char);
            }

            if (codeMode.enabled && codeMode.bracketSkipStack) {
                const bracketPairs = {
                    "(": ")",
                    "[": "]",
                    "{": "}"
                };
                const isQuote = char === "\"" || char === "'" || char === "`";

                if (bracketPairs[char]) {
                    closerStack.push(bracketPairs[char]);
                } else if (
                    codeMode.quoteSkipStack &&
                    isQuote &&
                    !isEscapedCharacter(text, characterIndex)
                ) {
                    closerStack.push(char);
                }
            }

            // If Shift+Home selected editor indentation, this character has
            // now safely replaced that selection. Pause/stop may resume.
            mustCompleteCodeSequence = false;

            // A short pause after a word is more natural than a random
            // hesitation on arbitrary characters.
            if (char === " ") {
                delay += wordGapBase * wordGapFactors[characterIndex];

                if (Math.random() < 0.08 * variationStrength) {
                    delay += randomBetween(
                        100 * hesitationScale,
                        300 * hesitationScale
                    );
                }
            }

            await sleep(delay);
        }
    } finally {
        typingState.running = false;
        typingState.paused = false;
        typingState.stopped = false;
    }
}

app.post("/type", async (req, res) => {
    if (typingState.running) {
        return res
            .status(409)
            .json({
                error: "Already typing"
            });
    }

    const {
        text,
        speed = 100,
        variation = 40,
        errorRate = 1,
        codeMode
    } = req.body;

    const parsedSpeed = Number(speed);
    const parsedVariation = Number(variation);
    const parsedErrorRate = Number(errorRate);
    const parsedCodeMode = parseCodeMode(codeMode);

    if (typeof text !== "string" || text.length === 0) {
        return res
            .status(400)
            .json({
                error: "Text must be a non-empty string"
            });
    }

    if (parsedCodeMode.error) {
        return res
            .status(400)
            .json({
                error: parsedCodeMode.error
            });
    }

    if (
        !Number.isFinite(parsedSpeed) ||
        parsedSpeed < 1 ||
        parsedSpeed > 150 ||
        !Number.isFinite(parsedVariation) ||
        parsedVariation < 0 ||
        parsedVariation > 100 ||
        !Number.isFinite(parsedErrorRate) ||
        parsedErrorRate < 0 ||
        parsedErrorRate > 20
    ) {
        return res
            .status(400)
            .json({
                error: "Invalid typing settings. Speed must be 1-150, rhythm variation 0-100, and error rate 0-20."
            });
    }

    typingState.running = true;
    typingState.paused = false;
    typingState.stopped = false;

    res.json({
        success: true,
        status: "started"
    });

    // time to focus destination
    await sleep(3000);

    if (typingState.stopped) {
        typingState.running = false;
        typingState.stopped = false;
        return;
    }

    await humanType(
        text,
        parsedSpeed,
        parsedVariation,
        parsedErrorRate,
        parsedCodeMode.value
    );
});

app.post("/pause", (req, res) => {
    if (!typingState.running) {
        return res.json({
            success: false,
            status: "idle"
        });
    }

    typingState.paused = true;

    res.json({
        success: true,
        status: "paused"
    });
});

app.post("/resume", (req, res) => {
    if (!typingState.running) {
        return res.json({
            success: false,
            status: "idle"
        });
    }

    typingState.paused = false;

    res.json({
        success: true,
        status: "typing"
    });
});

app.post("/stop", (req, res) => {
    typingState.stopped = true;
    typingState.paused = false;

    res.json({
        success: true,
        status: "stopping"
    });
});

app.get("/status", (req, res) => {
    let status = "idle";

    if (typingState.running) {
        status = "typing";
    }

    if (
        typingState.running &&
        typingState.paused
    ) {
        status = "paused";
    }

    res.json({
        status
    });
});

const PORT = 5000;

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        const ip = getLocalIP();

        console.log("");
        console.log(
            "Remote Typer Receiver"
        );
        console.log(
            "---------------------"
        );
        console.log(
            `IP:  ${ip}`
        );
        console.log(
            `URL: http://${ip}:${PORT}`
        );
        console.log("");
    }
);
