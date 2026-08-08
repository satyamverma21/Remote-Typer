const express = require("express");
const cors = require("cors");
const os = require("os");

const {
    keyboard,
    Key
} = require("@nut-tree-fork/nut-js");

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

async function waitWhilePaused() {
    while (
        typingState.paused &&
        !typingState.stopped
    ) {
        await sleep(100);
    }
}

async function humanType(
    text,
    averageSpeed,
    variation,
    errorRate
) {
    typingState.running = true;

    // Keep a slowly changing tempo. Human typing usually happens in
    // short bursts instead of using a completely independent delay for
    // every character.
    let tempo = 1;
    const pauseScale = clamp(
        averageSpeed / 100,
        0.05,
        1.5
    );
    const effectiveVariation = Math.min(
        variation,
        Math.max(0, averageSpeed * 0.55)
    );

    try {
        for (
            let i = 0;
            i < text.length;
            i++
        ) {
            if (typingState.stopped) {
                break;
            }

            await waitWhilePaused();

            if (typingState.stopped) {
                break;
            }

            const char = text[i];

            // Ignore the carriage-return half of Windows-style newlines.
            if (char === "\r") {
                continue;
            }

            tempo = clamp(
                tempo + randomBetween(-0.018, 0.018),
                0.88,
                1.12
            );

            const jitter = randomBetween(
                -effectiveVariation,
                effectiveVariation
            ) * 0.55;

            let delay = clamp(
                averageSpeed * tempo + jitter,
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

        // newline
        if (char === "\n") {
            await keyboard.pressKey(
                Key.Enter
            );

            await keyboard.releaseKey(
                Key.Enter
            );

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
                await keyboard.pressKey(
                    Key.Tab
                );

                await keyboard.releaseKey(
                    Key.Tab
                );

                await sleep(delay);

                continue;
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

            await keyboard.type(char);

            // A short pause after a word is more natural than a random
            // hesitation on arbitrary characters.
            if (char === " ") {
                delay += randomBetween(
                    20 * pauseScale,
                    70 * pauseScale
                );

                if (Math.random() < 0.08) {
                    delay += randomBetween(
                        100 * pauseScale,
                        300 * pauseScale
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
        errorRate = 1
    } = req.body;

    const parsedSpeed = Number(speed);
    const parsedVariation = Number(variation);
    const parsedErrorRate = Number(errorRate);

    if (typeof text !== "string" || text.length === 0) {
        return res
            .status(400)
            .json({
                error: "Text must be a non-empty string"
            });
    }

    if (
        !Number.isFinite(parsedSpeed) ||
        parsedSpeed < 1 ||
        parsedSpeed > 1000 ||
        !Number.isFinite(parsedVariation) ||
        parsedVariation < 0 ||
        parsedVariation > 500 ||
        !Number.isFinite(parsedErrorRate) ||
        parsedErrorRate < 0 ||
        parsedErrorRate > 20
    ) {
        return res
            .status(400)
            .json({
                error: "Invalid typing settings"
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
        parsedErrorRate
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
