# Signalite
A lightweight node.js signaling server for WebRTC

## Usage
Run using ```node server.js``` from the terminal

## How to use
JS link - 
```
https://github.com/nkg447/signallite/releases/download/0.0.2/webrtc-client0.0.2.js
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