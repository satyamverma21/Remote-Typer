const express = require("express");
const cors = require("cors");
const { keyboard } = require("@nut-tree-fork/nut-js");

const app = express();

app.use(cors());
app.use(express.json());

app.post("/type", async (req, res) => {
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ error: "No text" });
    }

    // Give you 3 seconds to focus the destination
    await new Promise(resolve => setTimeout(resolve, 3000));

    keyboard.config.autoDelayMs = 20;

    await keyboard.type(text);

    res.json({ success: true });
});

app.listen(5000, "0.0.0.0", () => {
    console.log("Remote Typer running on port 5000");
});