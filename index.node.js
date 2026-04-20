import nodeDatachannel from "node-datachannel/polyfill";

// Register WebRTC globals that WebRTCClient.js expects
globalThis.RTCPeerConnection = nodeDatachannel.RTCPeerConnection;
globalThis.RTCSessionDescription = nodeDatachannel.RTCSessionDescription;
globalThis.RTCIceCandidate = nodeDatachannel.RTCIceCandidate;

// Re-export the client
export { default } from "./WebRTCClient.js";
