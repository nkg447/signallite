/**
 * WebRTCClient facilitates peer-to-peer WebRTC connections via a signaling server
 * 
 * Connection stages:
 * 0 - Not initialized
 * 1 - Socket connected
 * 2 - Peer connected
 * 
 * @param {string} serverUrl - URL of the signaling server
 * @param {string} channelName - Unique identifier for the communication channel
 * @param {Function} onMessage - Callback for incoming messages
 * @param {Function} peerConnectCallback - Callback when peers successfully connect
 */
class WebRTCClient {
  constructor(serverUrl, channelName, onMessage, peerConnectCallback) {
    // Initialize socket connection to signaling server
    this.socket = io(serverUrl);
    
    // Store communication parameters
    this.channelName = channelName;
    
    // WebRTC connection components
    this.peerConnection = null;
    this.channel = null;
    this.peerChannel = null;
    
    // Message and connection callbacks
    this.onMessage = onMessage;
    this.peerConnectCallback = peerConnectCallback;
    
    // Track connection establishment stage
    this.stage = 0;
    
    // Set up socket event listeners
    this.setupSocketListeners();
  }

  // Update current connection stage
  _updateStage(stage) {
    this.stage = stage;
  }

  // Configure event listeners for socket communication
  setupSocketListeners() {
    // Establish socket connection and join channel
    this.socket.on("connect", () => {
      this.socket.emit("join", this.channelName);
      this._updateStage(1);
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
    };

    // Send ICE candidates to remote peer
    this.peerConnection.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        this.submitIceCandidate(event.candidate);
      }
    });

    // Monitor connection state
    this.peerConnection.onconnectionstatechange = (event) => {
      console.log(event);
      if (this.peerConnection.connectionState === "connected") {
        console.log("Peers Connected");
        this._updateStage(2);
        
        // Delay to ensure channel is ready before callback
        let work = null;
        work = setTimeout(() => {
          if (this.peerChannel !== null) {
            clearTimeout(work);
            this.peerConnectCallback();
          }
        }, 200);
      }
    };
  }

  // Initiate WebRTC connection by creating and sending an offer
  createOffer() {
    let work = null;
    work = setTimeout(async () => {
      if (this.stage == 1) {
        clearTimeout(work);
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
    this.channel.onerror = console.log;
    this.channel.onclose = console.log;
    this.channel.onopen = (event) => {
      console.log(event, "channel opened");
    };
  }
}