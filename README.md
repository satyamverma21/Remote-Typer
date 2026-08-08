# Remote Typer

Remote Typer sends text from one computer to another and types it using the receiver computer's keyboard.

## Requirements

- Node.js 18 or newer
- Both computers connected to the same network
- Permission for Node.js to control the receiver computer's keyboard

## Installation

From the project directory, install the dependencies:

```bash
npm install
```

## Running the receiver

On the computer where the text should be typed, run:

```bash
npm start
```

The terminal prints the receiver's local IP address, for example:

```text
URL: http://192.168.1.12:5000
```

Keep this terminal running.

## Using the controller

1. Open `index.html` in a browser on the controller computer.
2. Enter the receiver computer's IP address in the IP field.
3. Paste text into **Text To Type**.
4. Set the average delay in milliseconds per character.
5. Click **SEND**.
6. Focus the destination application during the three-second countdown.

Lower speed values type faster. For example, `50` is faster than `100`, and `1` is the fastest requested setting. Actual timing can be slower because of operating-system and keyboard-event overhead.

The **Scratch Pad** is local only and is never sent automatically.

## Controls

- **SEND** starts typing the selected text.
- **PAUSE** temporarily pauses typing.
- **RESUME** continues typing.
- **STOP** cancels the current typing operation.

## API

The receiver listens on port `5000` and provides these endpoints:

### Start typing

```http
POST /type
Content-Type: application/json
```

Example request:

```json
{
  "text": "Hello from Remote Typer!",
  "speed": 100,
  "variation": 40,
  "errorRate": 1
}
```

Settings:

- `text`: non-empty string to type
- `speed`: `1`–`1000` milliseconds per character; lower is faster
- `variation`: `0`–`500` milliseconds of timing variation
- `errorRate`: `0`–`20` percent simulated typing errors

### Other endpoints

```text
POST /pause
POST /resume
POST /stop
GET  /status
```

## Security warning

The receiver listens on all network interfaces and currently has no authentication. Anyone who can reach the receiver's port may be able to control its keyboard.

Use this only on a trusted private network. Do not expose port `5000` to the public internet. Authentication and restricted network access should be added before using this outside a trusted environment.

## Troubleshooting

- Confirm both computers are on the same network.
- Check that the controller uses the receiver's current IP address.
- Allow Node.js through the receiver computer's firewall for private networks.
- Make sure the destination application is focused before typing begins.
- If keyboard control is blocked, grant the required accessibility or input-control permission to Node.js.
