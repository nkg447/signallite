import io from "socket.io-client";

/**
 * WebRTCClient facilitates peer-to-peer WebRTC connections via a signaling server
 *
 * Connection stages:
 * 0 - Not initialized
 * 1 - Socket connected to signaling server
 * 2 - Peer connected (WebRTC connection established)
 * 3 - Signaling disconnected (server connection closed after peer connection)
 * 4 - Peer disconnected (attempting to reconnect to signaling server)
 *
 * @param {string} serverUrl - URL of the signaling server
 * @param {string} channelName - Unique identifier for the communication channel
 * @param {Function} onMessage - Callback for incoming messages
 * @param {Function} peerConnectCallback - Callback when peers successfully connect
 * @param {Function} statusCallback - Optional callback for connection status updates
 */
class WebRTCClient {
  constructor(
    serverUrl,
    channelName,
    onMessage,
    peerConnectCallback,
    statusCallback = null
  ) {
    // Store communication parameters
    this.serverUrl = serverUrl;
    this.channelName = channelName;

    // WebRTC connection components
    this.peerConnection = null;
    this.channel = null;
    this.peerChannel = null;

    // Message and connection callbacks
    this.onMessage = onMessage;
    this.peerConnectCallback = peerConnectCallback;
    this.statusCallback = statusCallback;

    // Track connection establishment stage
    this.stage = 0;

    // Initialize socket connection
    this.connectToSignalingServer();
  }

  // Update current connection stage and notify via callback if provided
  _updateStage(stage) {
    this.stage = stage;
    if (this.statusCallback) {
      this.statusCallback(stage);
    }
    console.log(`Connection stage updated: ${stage}`);
  }

  // Connect to signaling server
  connectToSignalingServer() {
    console.log("Connecting to signaling server...");
    this.socket = io(this.serverUrl);
    this.setupSocketListeners();
  }

  // Disconnect from signaling server
  disconnectFromSignalingServer() {
    if (this.socket && this.socket.connected) {
      console.log("Disconnecting from signaling server");
      this.socket.disconnect();
      this._updateStage(3); // Signaling server disconnected
    }
  }

  // Configure event listeners for socket communication
  setupSocketListeners() {
    // Establish socket connection and join channel
    this.socket.on("connect", () => {
      console.log("Connected to signaling server");
      this.socket.emit("join", this.channelName);
      this._updateStage(1);
    });

    // Handle socket disconnection
    this.socket.on("disconnect", () => {
      console.log("Disconnected from signaling server");
      // Only log as unexpected if we didn't initiate the disconnect
      if (this.stage !== 3) {
        console.log("Unexpected server disconnection");
      }
    });

    // Handle incoming WebRTC offer from remote peer
    this.socket.on("offerReceived", async (offer) => {
      console.log("offerReceived", offer);
      await this.handleRemoteOffer(offer);
    });

    // Handle incoming WebRTC answer from remote peer
    this.socket.on("answerReceived", async (answer) => {
      console.log("answerReceived", answer);
      await this.handleRemoteAnswer(answer);
    });

    // Handle incoming ICE candidates for connection negotiation
    this.socket.on("iceCandidateReceived", async (candidate) => {
      console.log("iceCandidateReceived", candidate);
      await this.addIceCandidate(candidate);
    });
  }

  // Set up WebRTC peer connection with STUN servers
  async initializePeerConnection() {
    // Configure ICE servers for NAT traversal
    const iceConfig = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    };

    // Create peer connection with ICE configuration
    this.peerConnection = new RTCPeerConnection(iceConfig, {
      optional: [{ RtpDataChannels: true }],
    });

    // Create data channel for communication
    this.addDataChannel(this.channelName);

    // Handle incoming data channels from remote peer
    this.peerConnection.ondatachannel = (event) => {
      this.peerChannel = event.channel;

      // Set up event handlers for the peer channel
      this.peerChannel.onmessage = (event) => {
        this.onMessage(event);
      };
      this.peerChannel.onerror = (error) => {
        console.log("Peer channel error:", error);
      };
      this.peerChannel.onclose = () => {
        console.log("Peer channel closed");
        this.handlePeerDisconnection();
      };
      this.peerChannel.onopen = (event) => {
        console.log("Peer channel opened:", event);
      };
    };

    // Send ICE candidates to remote peer
    this.peerConnection.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        this.submitIceCandidate(event.candidate);
      }
    });

    // Monitor connection state
    this.peerConnection.onconnectionstatechange = (event) => {
      console.log(
        "Connection state change:",
        this.peerConnection.connectionState
      );

      if (this.peerConnection.connectionState === "connected") {
        console.log("Peers Connected");
        this._updateStage(2);

        // Delay to ensure channel is ready before callback
        let work = null;
        work = setInterval(() => {
          if (this.peerChannel !== null) {
            clearInterval(work);
            this.peerConnectCallback(this.peerChannel);

            // Disconnect from signaling server after successful peer connection
            setTimeout(() => this.disconnectFromSignalingServer(), 1000);
          }
        }, 200);
      } else if (
        ["disconnected", "failed", "closed"].includes(
          this.peerConnection.connectionState
        )
      ) {
        console.log("Peer connection lost");
        this.handlePeerDisconnection();
      }
    };
  }

  // Handle peer disconnection
  handlePeerDisconnection() {
    // Only handle if we were previously connected
    if (this.stage === 2 || this.stage === 3) {
      console.log("Handling peer disconnection");
      this._updateStage(4);

      // Clean up existing connection
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }
      this.channel = null;
      this.peerChannel = null;

      // Reconnect to signaling server
      this.reconnectToSignalingServer();
    }
  }

  // Reconnect to signaling server
  reconnectToSignalingServer() {
    console.log("Attempting to reconnect to signaling server");
    this.socket.disconnect();
    const client = new WebRTCClient(
      this.serverUrl,
      this.channelName,
      this.onMessage,
      this.peerConnectCallback,
      this.statusCallback
    );
    if (this.offerCreator) {
      // wait sometime for other peer to connect to server first
      setTimeout(() => {
        client.createOffer();
      }, 2000);
    }
  }

  // Initiate WebRTC connection by creating and sending an offer
  createOffer() {
    this.offerCreator = true;
    let work = null;
    work = setInterval(async () => {
      if (this.stage == 1) {
        clearInterval(work);
        await this.initializePeerConnection();

        // Create and send WebRTC offer
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);

        this.socket.emit("submitOffer", {
          channelName: this.channelName,
          offer: JSON.stringify(offer),
        });
      }
    }, 200);
  }

  // Process incoming WebRTC offer from remote peer
  async handleRemoteOffer(offerString) {
    await this.initializePeerConnection();

    // Parse and set remote description
    const offer = JSON.parse(offerString);
    const remoteDesc = new RTCSessionDescription(offer);
    await this.peerConnection.setRemoteDescription(remoteDesc);

    // Create and send answer
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    this.socket.emit("submitAnswer", {
      channelName: this.channelName,
      answer: JSON.stringify(answer),
    });
  }

  // Process incoming WebRTC answer from remote peer
  async handleRemoteAnswer(answerString) {
    const answer = JSON.parse(answerString);
    const remoteDesc = new RTCSessionDescription(answer);
    await this.peerConnection.setRemoteDescription(remoteDesc);
  }

  // Submit ICE candidate to signaling server
  submitIceCandidate(candidate) {
    this.socket.emit("submitIceCandidate", {
      channelName: this.channelName,
      candidate: JSON.stringify(candidate),
    });
  }

  // Add received ICE candidate to peer connection
  async addIceCandidate(candidateString) {
    const candidate = JSON.parse(candidateString);
    await this.peerConnection.addIceCandidate(candidate);
  }

  // Create a reliable data channel for peer communication
  addDataChannel(channelName) {
    this.channel = this.peerConnection.createDataChannel(channelName, {
      reliable: true,
    });

    // Configure channel event handlers
    this.channel.onmessage = (event) => {
      this.onMessage(event);
    };
    this.channel.onerror = (error) => {
      console.log("Data channel error:", error);
    };
    this.channel.onclose = () => {
      console.log("Data channel closed");
    };
    this.channel.onopen = (event) => {
      console.log("Data channel opened:", event);
    };
  }
}

export default WebRTCClient;
