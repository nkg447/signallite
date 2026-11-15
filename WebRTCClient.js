import io from "socket.io-client";

/**
 * WebRTC data-channel client.
 * Stages: 0 idle, 1 signaling, 2 peer connected, 3 P2P active,
 * 4 reconnecting, 5 retries exhausted.
 *
 * @param {string} serverUrl
 * @param {string} channelName
 * @param {Function} onMessage
 * @param {Function} peerConnectCallback Called with an open channel, including after recovery.
 * @param {Function|null} statusCallback
 * @param {Object} options
 * @param {number} [options.maxReconnectAttempts=5] Use -1 for unlimited retries.
 * @param {number} [options.reconnectBaseDelay=1000] Exponential backoff, capped at 30 seconds.
 * @param {number} [options.reconnectTimeout=15000] Time allowed for each recovery attempt.
 */
class WebRTCClient {
  constructor(
    serverUrl,
    channelName,
    onMessage,
    peerConnectCallback,
    statusCallback = null,
    options = {}
  ) {
    this.serverUrl = serverUrl;
    this.channelName = channelName;
    this.onMessage = onMessage;
    this.peerConnectCallback = peerConnectCallback;
    this.statusCallback = statusCallback;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectBaseDelay = options.reconnectBaseDelay ?? 1000;
    this.reconnectTimeout = options.reconnectTimeout ?? 15000;
    if (!Number.isInteger(this.maxReconnectAttempts) || this.maxReconnectAttempts < -1 ||
        !Number.isFinite(this.reconnectBaseDelay) || this.reconnectBaseDelay <= 0 ||
        !Number.isFinite(this.reconnectTimeout) || this.reconnectTimeout <= 0) {
      throw new RangeError("Invalid reconnect options");
    }

    this.stage = 0;
    this.reconnectAttempts = 0;
    this.offerCreator = false;
    this.socket = null;
    this.peerConnection = null;
    this.channel = null;
    this.peerChannel = null;
    this._pendingCandidates = [];
    this._reconnectTimer = null;
    this._attemptTimer = null;
    this._signalingDisconnectTimer = null;
    this._peerReady = false;
    this._stopped = false;
    this.connectToSignalingServer();
  }

  _updateStage(stage) {
    this.stage = stage;
    console.log(`Connection stage updated: ${stage}`);
    if (this.statusCallback) this.statusCallback(stage);
  }

  _clearTimers() {
    clearTimeout(this._reconnectTimer);
    clearTimeout(this._attemptTimer);
    clearTimeout(this._signalingDisconnectTimer);
    this._reconnectTimer = null;
    this._attemptTimer = null;
    this._signalingDisconnectTimer = null;
  }

  _closeSocket() {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
  }

  _closePeer() {
    const connection = this.peerConnection;
    this.peerConnection = null;
    this._peerReady = false;
    for (const channel of [this.channel, this.peerChannel]) {
      if (!channel) continue;
      channel.onclose = null;
      channel.onopen = null;
      channel.onmessage = null;
      channel.onerror = null;
      channel.close();
    }
    this.channel = null;
    this.peerChannel = null;
    this._pendingCandidates = [];
    if (connection) {
      connection.onconnectionstatechange = null;
      connection.ondatachannel = null;
      connection.close();
    }
  }

  connectToSignalingServer() {
    if (this._stopped) return;
    this._closeSocket();
    // One retry controller owns both signaling and WebRTC recovery.
    this.socket = io(this.serverUrl, { reconnection: false });
    this.setupSocketListeners();
  }

  disconnectFromSignalingServer() {
    if (this.socket?.connected) {
      this._updateStage(3);
      this.socket.disconnect();
    }
  }

  setupSocketListeners() {
    const socket = this.socket;
    socket.on("connect", () => {
      socket.emit("join", this.channelName);
      this._updateStage(1);
      if (this.offerCreator) this.createOffer();
    });
    socket.on("connect_error", (error) => {
      console.error("Signaling connection failed:", error);
      this.handlePeerDisconnection();
    });
    socket.on("disconnect", (reason) => {
      if (this._peerReady || this._stopped) return;
      console.error("Signaling disconnected:", reason);
      this.handlePeerDisconnection();
    });
    for (const [event, handler] of [
      ["offerReceived", (value) => this.handleRemoteOffer(value)],
      ["answerReceived", (value) => this.handleRemoteAnswer(value)],
      ["iceCandidateReceived", (value) => this.addIceCandidate(value)],
    ]) {
      socket.on(event, async (value) => {
        try {
          await handler(value);
        } catch (error) {
          if (this.socket !== socket) return;
          console.error(`Signaling event ${event} failed:`, error);
          this.handlePeerDisconnection();
        }
      });
    }
  }

  async initializePeerConnection() {
    const connection = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    this.peerConnection = connection;
    this.addDataChannel(this.channelName);
    connection.ondatachannel = (event) => {
      if (this.peerConnection !== connection) return;
      this.peerChannel = event.channel;
      this._configureChannel(event.channel, connection);
      this._notifyPeerReady(connection);
    };
    connection.addEventListener("icecandidate", (event) => {
      if (this.peerConnection === connection && event.candidate) {
        this.submitIceCandidate(event.candidate);
      }
    });
    connection.onconnectionstatechange = () => {
      if (this.peerConnection !== connection) return;
      if (connection.connectionState === "connected") {
        this._notifyPeerReady(connection);
      } else if (["disconnected", "failed", "closed"].includes(connection.connectionState)) {
        this.handlePeerDisconnection();
      }
    };
    return connection;
  }

  _configureChannel(channel, connection) {
    channel.onmessage = (event) => this.onMessage(event);
    channel.onerror = (error) => console.error("Data channel error:", error);
    channel.onclose = () => {
      if (this.peerConnection === connection) this.handlePeerDisconnection();
    };
    channel.onopen = () => this._notifyPeerReady(connection);
  }

  _notifyPeerReady(connection) {
    if (this.peerConnection !== connection || this._peerReady ||
        connection.connectionState !== "connected" || this.peerChannel?.readyState !== "open") return;
    this._clearTimers();
    this._peerReady = true;
    this.reconnectAttempts = 0;
    this._updateStage(2);
    this._signalingDisconnectTimer = setTimeout(() => {
      this._signalingDisconnectTimer = null;
      if (this.peerConnection === connection && this._peerReady) {
        this.disconnectFromSignalingServer();
      }
    }, 1000);
    this.peerConnectCallback(this.peerChannel);
  }

  handlePeerDisconnection() {
    if (this._stopped || this.stage === 5 || this._reconnectTimer !== null) return;
    this._clearTimers();
    this._closePeer();
    this._closeSocket();
    this._updateStage(4);
    this.reconnectToSignalingServer();
  }

  reconnectToSignalingServer() {
    if (this._stopped || this._reconnectTimer !== null) return;
    if (this.maxReconnectAttempts !== -1 && this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._updateStage(5);
      return;
    }
    const delay = Math.min(this.reconnectBaseDelay * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts++;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._startReconnectAttempt();
    }, delay);
  }

  _startReconnectAttempt() {
    this._attemptTimer = setTimeout(() => {
      console.error("Peer reconnection timed out");
      this.handlePeerDisconnection();
    }, this.reconnectTimeout);
    this.connectToSignalingServer();
  }

  // Start a fresh retry budget, including after automatic retries are exhausted.
  reconnect() {
    this._clearTimers();
    this._closePeer();
    this._closeSocket();
    this._stopped = false;
    this.reconnectAttempts = 0;
    this._updateStage(4);
    this._startReconnectAttempt();
  }

  disconnect() {
    this._stopped = true;
    this._clearTimers();
    this._closePeer();
    this._closeSocket();
    this._updateStage(0);
  }

  async createOffer() {
    this.offerCreator = true;
    if (this._stopped || !this.socket?.connected || this.peerConnection) return;
    const socket = this.socket;
    let connection;
    try {
      connection = await this.initializePeerConnection();
      const offer = await connection.createOffer();
      if (this.peerConnection !== connection) return;
      await connection.setLocalDescription(offer);
      if (this.peerConnection !== connection) return;
      socket.emit("submitOffer", {
        channelName: this.channelName,
        offer: JSON.stringify(offer),
      });
    } catch (error) {
      if (connection && this.peerConnection !== connection) return;
      console.error("Creating offer failed:", error);
      this.handlePeerDisconnection();
    }
  }

  async handleRemoteOffer(offerString) {
    if (this._stopped || this._peerReady || this.offerCreator) return;
    if (this.peerConnection) this._closePeer();
    const socket = this.socket;
    const connection = await this.initializePeerConnection();
    const offer = new RTCSessionDescription(JSON.parse(offerString));
    await connection.setRemoteDescription(offer);
    if (this.peerConnection !== connection) return;
    await this._flushCandidates(connection);
    const answer = await connection.createAnswer();
    if (this.peerConnection !== connection) return;
    await connection.setLocalDescription(answer);
    if (this.peerConnection !== connection) return;
    socket.emit("submitAnswer", {
      channelName: this.channelName,
      answer: JSON.stringify(answer),
    });
  }

  async handleRemoteAnswer(answerString) {
    const connection = this.peerConnection;
    if (!connection || connection.signalingState !== "have-local-offer") return;
    await connection.setRemoteDescription(new RTCSessionDescription(JSON.parse(answerString)));
    if (this.peerConnection === connection) await this._flushCandidates(connection);
  }

  submitIceCandidate(candidate) {
    this.socket?.emit("submitIceCandidate", {
      channelName: this.channelName,
      candidate: JSON.stringify(candidate),
    });
  }

  async addIceCandidate(candidateString) {
    if (this._stopped || this.stage === 5) return;
    const candidate = JSON.parse(candidateString);
    const connection = this.peerConnection;
    if (!connection?.remoteDescription) {
      this._pendingCandidates.push(candidate);
      return;
    }
    await connection.addIceCandidate(candidate);
  }

  async _flushCandidates(connection) {
    const candidates = this._pendingCandidates.splice(0);
    for (const candidate of candidates) {
      if (this.peerConnection !== connection) return;
      await connection.addIceCandidate(candidate);
    }
  }

  addDataChannel(channelName) {
    this.channel = this.peerConnection.createDataChannel(channelName, { reliable: true });
    this._configureChannel(this.channel, this.peerConnection);
  }
}

export default WebRTCClient;
