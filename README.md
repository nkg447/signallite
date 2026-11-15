# Signalite

Signalite's JavaScript client establishes two-peer WebRTC data channels using
a compatible Socket.IO signaling server.

This README describes the current source. Published packages and release
bundles may not yet include every feature described here.

## Install the client

```sh
npm install @nkg447/signallite
```

For Node.js, also install the optional native WebRTC implementation:

```sh
npm install 'node-datachannel@^0.32.2'
```

The Node entry point loads `node-datachannel/polyfill` and registers its WebRTC
globals. Browser applications can use the npm package with a bundler. For a
plain browser script, see [Browser bundle](#browser-bundle) below.

## Connect two peers

Both peers must use the same signaling server URL and channel name. Use a unique
channel name per pair, and call `createOffer()` on **exactly one** peer. The
other peer answers automatically. The offer creator may call `createOffer()`
before the signaling connection is ready; the client sends the offer after
connecting. With the included server, the offer can also be created before the
other peer joins.

The following complete Node.js example works for either peer. Save it as
`peer.mjs`:

```js
import WebRTCClient from "@nkg447/signallite";

const role = process.argv[2]; // "offer" or "answer"
const channelName = process.argv[3];
if (!["offer", "answer"].includes(role) || !channelName) {
  throw new Error("Usage: node peer.mjs <offer|answer> <channel-name>");
}

const serverUrl = "http://localhost:3000";
let channel = null;

const client = new WebRTCClient(
  serverUrl,
  channelName,
  (event) => console.log("Received:", event.data),
  (openChannel) => {
    // Called initially and again whenever the peer connection is restored.
    channel = openChannel;
    channel.send(`Hello from ${role}`);
  },
  (stage) => {
    console.log("Connection stage:", stage);
    if ([0, 1, 4, 5].includes(stage)) channel = null;
  }
);

if (role === "offer") client.createOffer();

// For later sends, use the most recently supplied channel.
function send(message) {
  if (!channel || channel.readyState !== "open") {
    throw new Error("Peer is not connected");
  }
  channel.send(message);
}

// When finished, call client.disconnect().
```

With a compatible signaling server running at the URL in the example, run
these commands in separate terminals:

```sh
node peer.mjs answer my-unique-channel
node peer.mjs offer my-unique-channel
```

Each peer prints the message sent by the other. Replace the server URL with the
address reachable from both peers when running on different machines.

## Browser bundle

To build the client browser bundle from this checkout:

```sh
npm install
npm run build
```

The generated `dist/webrtc-client.js` is a classic script exposing the global
`WebRTCClient`. Host the bundle at `/dist/webrtc-client.js` or change the script
URL below. Use the following code in two pages: set `offerCreator` to `true` in
exactly one page, use the same channel name on both, and replace the example
signaling URL:

```html
<script src="/dist/webrtc-client.js"></script>
<script>
  const offerCreator = false; // Set to true for exactly one peer.
  const client = new WebRTCClient(
    "https://your-signaling-server.example",
    "my-unique-channel",
    (event) => console.log("Received:", event.data),
    (channel) => channel.send("Hello from the browser"),
    (stage) => console.log("Connection stage:", stage)
  );
  if (offerCreator) client.createOffer();
</script>
```

The bundle includes the Socket.IO client.

## Chat demo on GitHub Pages

Publish `chat.html` and `WebRTCClient.js` together on GitHub Pages, then open
`https://<user>.github.io/<repository>/chat.html`. Regardless of where it is
hosted, the chat uses `https://signallite.nikunjgupta.dev` for signaling and
loads Socket.IO and QR code libraries from CDNs. Share its invite link with
another peer. Existing links naming that same server remain valid; links naming
another server show a configuration error.
GitHub Pages hosts only the static page; the signaling server must be reachable
and allow cross-origin Socket.IO connections.

## Client API and connection status

`new WebRTCClient(serverUrl, channelName, onMessage, onConnected, onStatus, options)`
immediately starts connecting to the signaling server.

| Argument | Description |
| --- | --- |
| `serverUrl` | URL of the Socket.IO signaling server. |
| `channelName` | Shared string identifying the peer pair. |
| `onMessage` | Required callback receiving a data-channel message event; read `event.data`. |
| `onConnected` | Required callback receiving an open `RTCDataChannel`. Called again with a replacement channel after recovery. |
| `onStatus` | Optional callback receiving a numeric stage; pass `null` to omit it when specifying options. |
| `options` | Optional reconnection settings described below. |

Store the channel from the latest `onConnected` callback and check its
`readyState` before sending. A channel from a previous connection cannot be
reused. The client does not queue application messages while disconnected.

| Stage | Meaning |
| --- | --- |
| `0` | Idle or explicitly disconnected. |
| `1` | Connected to signaling and joining the channel; also occurs during recovery. |
| `2` | Peer connected and incoming data channel open. `onStatus(2)` runs before `onConnected`. |
| `3` | Signaling disconnected after peer connection; P2P remains active. |
| `4` | Recovering a connection. |
| `5` | Automatic retries exhausted. |

## Reconnecting and stopping

Signaling failures, failed peer connections, and closed data channels trigger
automatic recovery. The original offer creator sends a fresh offer after
rejoining. Both peers must remain running and retrying for recovery to succeed;
if a peer has exhausted its retries, call `reconnect()` on that peer too.

```js
const client = new WebRTCClient(serverUrl, channelName, onMessage, onConnected, onStatus, {
  maxReconnectAttempts: 5, // -1: unlimited; 0: no automatic retries
  reconnectBaseDelay: 1000, // ms; exponential backoff capped at 30000 ms
  reconnectTimeout: 15000, // ms per recovery attempt, including negotiation
});

client.reconnect(); // Immediately start a fresh recovery attempt, even after exhaustion.
client.disconnect(); // Close peer and signaling connections and cancel retries.
```

`maxReconnectAttempts` must be an integer of `-1` or greater. Delays and timeouts
must be positive finite numbers in milliseconds. Successful recovery resets the
retry count. `reconnect()` can also restart a client after `disconnect()`.
The recovery timeout applies to retry attempts, not the initial wait for a peer.

The client uses public Google STUN servers and has no built-in TURN configuration.
Direct connections may fail on networks that require a relay.
