import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { io } from "socket.io-client";
import WebRTCClient from "./WebRTCClient.js";

class FakeChannel {
  readyState = "connecting";
  send(data) {
    assert.equal(this.readyState, "open");
    this.remote?.onmessage?.({ data });
  }
  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.();
    this.remote?.close();
  }
}

class FakePeerConnection {
  static connections = [];
  connectionState = "new";
  signalingState = "stable";
  remoteDescription = null;
  candidates = [];
  constructor() {
    this.id = FakePeerConnection.connections.push(this);
  }
  createDataChannel() {
    this.channel = new FakeChannel();
    return this.channel;
  }
  addEventListener() {}
  async createOffer() {
    return { type: "offer", id: this.id };
  }
  async createAnswer() {
    return { type: "answer", id: this.id };
  }
  async setLocalDescription(description) {
    this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(description) {
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
    if (description.type === "answer") {
      const peer = FakePeerConnection.connections[description.id - 1];
      setImmediate(() => {
        if (this.connectionState === "closed" || peer.connectionState === "closed") return;
        for (const [source, target] of [[this, peer], [peer, this]]) {
          const incoming = new FakeChannel();
          incoming.remote = source.channel;
          source.channel.remote = incoming;
          target.ondatachannel?.({ channel: incoming });
        }
        for (const connection of [this, peer]) {
          connection.connectionState = "connected";
          connection.onconnectionstatechange?.();
        }
        for (const channel of [this.channel, peer.channel, this.channel.remote, peer.channel.remote]) {
          channel.readyState = "open";
          channel.onopen?.();
        }
      });
    }
  }
  async addIceCandidate(candidate) {
    assert.ok(this.remoteDescription);
    this.candidates.push(candidate);
  }
  close() {
    this.connectionState = "closed";
    this.onconnectionstatechange?.();
  }
}

const originalPeerConnection = globalThis.RTCPeerConnection;
const originalSessionDescription = globalThis.RTCSessionDescription;
let server;
let serverUrl;
let nextRoom = 0;
const clients = [];
const sockets = [];

async function waitFor(condition, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function client(room, options = {}, onConnected = () => {}) {
  const instance = new WebRTCClient(serverUrl, room, () => {}, onConnected, null, {
    reconnectBaseDelay: 10,
    reconnectTimeout: 200,
    ...options,
  });
  clients.push(instance);
  return instance;
}

before(async () => {
  globalThis.RTCPeerConnection = FakePeerConnection;
  globalThis.RTCSessionDescription = class {
    constructor(description) { Object.assign(this, description); }
  };
  server = spawn(process.execPath, ["server.js"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk;
    const port = output.match(/running on port (\d+)/);
    if (port) serverUrl = `http://127.0.0.1:${port[1]}`;
  });
  server.stderr.on("data", (chunk) => { output += chunk; });
  await waitFor(() => serverUrl || server.exitCode !== null);
  assert.ok(serverUrl, output);
});

afterEach(() => {
  for (const instance of clients.splice(0)) instance.disconnect();
  for (const socket of sockets.splice(0)) socket.disconnect();
});

after(async () => {
  globalThis.RTCPeerConnection = originalPeerConnection;
  globalThis.RTCSessionDescription = originalSessionDescription;
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
});

test("reconnects both peers after channel loss and replaces usable channels", async () => {
  const room = `recovery-${nextRoom++}`;
  const channels = [];
  const initiator = client(room, {}, (channel) => channels.push(channel));
  const receiver = client(room);
  await initiator.createOffer();
  await waitFor(() => initiator.stage === 2 && receiver.stage === 2);
  const oldConnection = initiator.peerConnection;
  const oldChannel = channels[0];
  assert.equal(oldChannel.readyState, "open");
  oldChannel.close();
  await waitFor(() => channels.length === 2 && receiver.stage === 2);
  assert.notEqual(initiator.peerConnection, oldConnection);
  assert.notEqual(channels[1], oldChannel);
  assert.equal(oldConnection.connectionState, "closed");
  assert.equal(initiator.reconnectAttempts, 0);
  assert.equal(receiver.reconnectAttempts, 0);
  const received = [];
  receiver.onMessage = (event) => received.push(event.data);
  channels[1].send("after recovery");
  assert.deepEqual(received, ["after recovery"]);
});

test("recovers after signaling has intentionally disconnected", async () => {
  const room = `p2p-${nextRoom++}`;
  const initiator = client(room);
  const receiver = client(room);
  initiator.createOffer();
  await waitFor(() => initiator.stage === 3 && receiver.stage === 3);
  initiator.peerChannel.close();
  await waitFor(() => initiator.stage === 2 && receiver.stage === 2);
  assert.equal(initiator.peerChannel.readyState, "open");
});

test("counts full negotiation timeouts and supports manual retry after exhaustion", async () => {
  const room = `timeout-${nextRoom++}`;
  const initiator = client(room, { maxReconnectAttempts: 2, reconnectTimeout: 30 });
  initiator.createOffer();
  await waitFor(() => initiator.peerConnection);
  initiator.peerConnection.connectionState = "failed";
  initiator.peerConnection.onconnectionstatechange();
  await waitFor(() => initiator.stage === 5);
  assert.equal(initiator.reconnectAttempts, 2);
  assert.equal(initiator.peerConnection, null);
  assert.equal(initiator.socket, null);
  const receiver = client(room);
  initiator.reconnect();
  await waitFor(() => initiator.stage === 2 && receiver.stage === 2);
  assert.equal(initiator.reconnectAttempts, 0);
});

test("retries signaling failures with the configured finite budget", async () => {
  const instance = new WebRTCClient("http://127.0.0.1:1", "offline", () => {}, () => {}, null, {
    maxReconnectAttempts: 2,
    reconnectBaseDelay: 5,
    reconnectTimeout: 100,
  });
  clients.push(instance);
  await waitFor(() => instance.stage === 5);
  assert.equal(instance.reconnectAttempts, 2);
  assert.equal(instance.socket, null);
});

test("unlimited retries continue until explicitly disconnected", async () => {
  const instance = client(`unlimited-${nextRoom++}`, {
    maxReconnectAttempts: -1,
    reconnectBaseDelay: 1,
    reconnectTimeout: 10,
  });
  instance.reconnect();
  await waitFor(() => instance.reconnectAttempts >= 7);
  instance.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(instance.stage, 0);
  assert.equal(instance.socket, null);
  assert.equal(instance._reconnectTimer, null);
  assert.equal(instance._attemptTimer, null);
});

test("does not duplicate retries and respects a zero retry budget", () => {
  const instance = client(`none-${nextRoom++}`, { maxReconnectAttempts: 0 });
  instance.handlePeerDisconnection();
  instance.handlePeerDisconnection();
  assert.equal(instance.stage, 5);
  assert.equal(instance.reconnectAttempts, 0);
  const retrying = client(`dedup-${nextRoom++}`);
  retrying.handlePeerDisconnection();
  const timer = retrying._reconnectTimer;
  retrying.handlePeerDisconnection();
  assert.equal(retrying._reconnectTimer, timer);
  assert.equal(retrying.reconnectAttempts, 1);
});

test("manual reconnect works when automatic retries are disabled", async () => {
  const room = `manual-${nextRoom++}`;
  const initiator = client(room, { maxReconnectAttempts: 0 });
  const receiver = client(room);
  initiator.createOffer();
  await waitFor(() => initiator.stage === 2 && receiver.stage === 2);
  initiator.peerChannel.close();
  assert.equal(initiator.stage, 5);
  initiator.reconnect();
  await waitFor(() => initiator.stage === 2 && receiver.stage === 2);
  assert.equal(initiator.reconnectAttempts, 0);
});

test("queues ICE until a remote description is installed", async () => {
  const instance = client(`ice-${nextRoom++}`);
  await instance.addIceCandidate(JSON.stringify({ candidate: "early" }));
  const connection = await instance.initializePeerConnection();
  await connection.setRemoteDescription({ type: "offer", id: 0 });
  await instance._flushCandidates(connection);
  assert.deepEqual(connection.candidates, [{ candidate: "early" }]);
  assert.deepEqual(instance._pendingCandidates, []);
});

test("late joiners receive cached offer and ICE, but not a disconnected owner's offer", async () => {
  const room = `cache-${nextRoom++}`;
  async function socketClient() {
    const socket = io(serverUrl, { reconnection: false });
    sockets.push(socket);
    await once(socket, "connect");
    return socket;
  }
  const owner = await socketClient();
  owner.emit("join", room);
  owner.emit("submitOffer", { channelName: room, offer: "fresh-offer" });
  await once(owner, "offerSubmitted");
  owner.emit("submitIceCandidate", { channelName: room, candidate: "early-ice" });
  await once(owner, "iceCandidateSubmitted");
  const joiner = await socketClient();
  const offer = once(joiner, "offerReceived");
  const candidate = once(joiner, "iceCandidateReceived");
  joiner.emit("join", room);
  assert.deepEqual(await offer, ["fresh-offer"]);
  assert.deepEqual(await candidate, ["early-ice"]);
  owner.disconnect();
  // A fresh transport connection follows the owner's disconnect on the server.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const lateJoiner = await socketClient();
  lateJoiner.emit("getOffer", { channelName: room });
  const [retrieved] = await once(lateJoiner, "offerRetrieved");
  assert.equal(retrieved.offer, undefined);
});

test("rejects invalid retry configuration", () => {
  for (const options of [
    { maxReconnectAttempts: -2 },
    { maxReconnectAttempts: 1.5 },
    { reconnectBaseDelay: 0 },
    { reconnectTimeout: NaN },
  ]) {
    assert.throws(() => client("invalid", options), RangeError);
  }
});
