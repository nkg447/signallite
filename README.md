# Signalite
A lightweight node.js signaling server for WebRTC

## Usage
Run using ```node server.js``` from the terminal

## How to use
JS link - 
```
https://github.com/nkg447/signallite/releases/download/0.3/webrtc-client.js
```

Usage - 
* Peer 1 
```js
import WebRTCClient from '@nkg447/signallite'
const onMessageCallback = (event) => {
    console.log(event.data);
}
const peerConnectCallback = (channel) => {
    channel.send("We are connected now.");
}
const client = new new WebRTCClient(
  "https://signallite.nikunjgupta.dev", // signalling server url
  "some_sample_channel_name_here",
  onMessageCallback,
  peerConnectCallback);
```

* Peer 2
```js
import WebRTCClient from '@nkg447/signallite'
const onMessageCallback = (event) => {
    console.log(event.data);
}
const peerConnectCallback = (channel) => {
    channel.send("We are connected now.");
}
const client = new new WebRTCClient(
  "https://signallite.nikunjgupta.dev", // signalling server url
  "some_sample_channel_name_here",
  onMessageCallback,
  peerConnectCallback);
// this initiates the connection. 
// make sure the peer that joines later should trigger client.createOffer()
client.createOffer();
```

## Demo
A ready-to-use peer-to-peer chat app is included at `chat.html`. Start the server and open [http://localhost:3000/chat.html](http://localhost:3000/chat.html) — share the generated link (or scan the QR code) with another device to connect.