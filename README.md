# RN Web Inspector

A lightweight developer tool to inspect network requests, console logs, and more from React Native apps directly in a browser dashboard — no native modules required.

## Features

- 📡 Monitor all network requests (fetch/XMLHttpRequest) with timing, status, headers, and bodies
- 🖥️ View console.log, console.info, console.warn, console.error in real time
- 📱 See connected devices (name, platform, app name) in the dashboard
- 🔍 Filter events by type (network/logs) and search by URL/message
- 📋 Copy request/response/log details to clipboard
- 🚀 Zero native dependencies — pure JavaScript/TypeScript

## How It Works

1. Run the provided Node.js server on your development machine.
2. Insert `RNWebInspector.ts` into your React Native project and initialize it with your machine's LAN IP.
3. The instrumented RN app sends events over WebSocket to the server.
4. The server broadcasts events to any browser dashboard (served from the same server) at `http://localhost:4000`.

## Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd DOc/git   # or whatever the folder name is
```

### 2. Set up the server

```bash
cd server
npm install
```

### 3. Start the server

```bash
npm start
# or: node index.js
```

The server will start on port 4000 (or `$PORT` if set). You should see:

```
rn-web-inspector running:
  Dashboard:  http://localhost:4000
  WS endpoint (for RN client): ws://<your-machine-ip>:4000
```

### 4. Integrate with your React Native project

Copy `RNWebInspector.ts` from the repository root into your RN project (e.g., `src/devtools/RNWebInspector.ts`).

Then, early in your app (e.g., `index.js` or `App.tsx`), initialize it in development mode:

```tsx
import RNWebInspector from './devtools/RNWebInspector';

// ... other imports

if (__DEV__) {
  RNWebInspector.init({
    host: '192.168.1.XX', // <-- Replace with your development machine's LAN IP
    appName: 'MyApp',     // Optional: friendly name shown in dashboard
    // deviceName: 'iPhone 14 Simulator', // Optional: overrides auto-detected device name
    // port: 4000          // Optional: only if you changed the server port
  });
}
```

> **Tip:** To get your machine's LAN IP on macOS: `ipconfig getifaddr en0` (Wi‑Fi) or `en1` (Ethernet). On Linux: `hostname -I | awk '{print $1}'`. On Windows: `ipconfig` and look for IPv4 address under your active adapter.

### 5. Open the dashboard

While your RN app is running (in simulator or device), open a browser on the same network and visit:

```
http://<your-machine-ip>:4000
```

You should see the dashboard listing events from your app.

## Usage

- **Tabs**: Switch between "All", "Network", and "Logs" to filter event types.
- **Search**: Type in the filter box to search URLs or log messages.
- **Clear**: Click the "Clear" button to remove all displayed events.
- **Device bar**: Connected devices appear as pills under the header.
- **Details**: Click any event row to view request/response headers and bodies (or log details) in the right pane.
- **Copy**: Use the "Copy" buttons inside accordions to copy formatted text to clipboard.

## How it works under the hood

- The TypeScript file patches `globalThis.fetch`, `XMLHttpRequest`, and `console.*` methods to capture events and send them via WebSocket.
- The Node.js server (`server/index.js`) accepts WebSocket connections from both RN apps (role=`device`) and browsers (role=`browser`).
- Devices send a `hello` message with metadata; the server tracks them and forwards events to all browser clients.
- The server serves a static dashboard (`server/public/index.html`) that connects via WebSocket, displays events, and provides UI controls.

## Requirements

- Node.js ≥ 14 (for the server)
- React Native project (works with both Expo and bare RN)
- The RN app and the dashboard must be able to reach each other over the local network (no firewall blocking port 4000/WS).

## Troubleshooting

- **No events appear**: Verify the RN app can reach the WS endpoint (`ws://<LAN_IP>:4000`). Check device console for any warnings from the inspector.
- **Dashboard not connecting**: Ensure you are opening `http://<LAN_IP>:4000` (not localhost unless you’re running the dashboard on the same machine).
- **CORS issues**: The server serves the dashboard directly; no CORS problems.
- **Events missing**: The inspector only patches methods after `init()` is called. Make sure to call it early, before any network requests or console logs you want to capture.

## License

ISC

## Acknowledgements

Inspired by tools like Reactotron, Flipper, and react-native-debugger, but aiming for zero‑native‑dependency simplicity.

## Screenshots

![Dashboard overview](screenshots/dashboard.png)
![Network tab](screenshots/network.png)
![Logs tab](screenshots/logs.png)

*Add your screenshots to the `screenshots/` directory and reference them here.*