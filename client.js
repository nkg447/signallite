class WebRTCClient {
  constructor(serverUrl, channelName, onMessage) {
    this.socket = io(serverUrl);
    this.channelName = channelName;
    this.peerConnection = null;
    this.channel = null;
    this.peerChannel = null;
    this.onMessage = onMessage;
    this.setupSocketListeners();
  }

  setupSocketListeners() {
    this.socket.on("connect", () => {
      this.socket.emit("join", this.channelName);
    });

    this.socket.on("offerReceived", async (offer) => {
      console.log("offerReceived", offer);
      await this.handleRemoteOffer(offer);
    });

    this.socket.on("answerReceived", async (answer) => {
      console.log("answerReceived", answer);
      await this.handleRemoteAnswer(answer);
    });

    this.socket.on("iceCandidateReceived", async (candidate) => {
      console.log("iceCandidateReceived", candidate);
      await this.addIceCandidate(candidate);
    });
  }

  async initializePeerConnection() {
    const iceConfig = {
      iceServers: [{ urls: "stun:stun2.1.google.com:19302" }],
    };
    this.peerConnection = new RTCPeerConnection(iceConfig, {
      optional: [{ RtpDataChannels: true }],
    });
    this.addDataChannel(this.channelName);

    this.peerConnection.ondatachannel = (event) => {
      this.peerChannel = event.channel;
    };

    this.peerConnection.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        this.submitIceCandidate(event.candidate);
      }
    });

    this.peerConnection.onconnectionstatechange = (event) => {
      console.log(event);
      if (this.peerConnection.connectionState === "connected") {
        console.log("Peers Connected");
      }
    };
  }

  async createOffer() {
    await this.initializePeerConnection();
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    this.socket.emit("submitOffer", {
      channelName: this.channelName,
      offer: JSON.stringify(offer),
    });

    return offer;
  }

  async handleRemoteOffer(offerString) {
    await this.initializePeerConnection();
    const offer = JSON.parse(offerString);
    const remoteDesc = new RTCSessionDescription(offer);
    await this.peerConnection.setRemoteDescription(remoteDesc);

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    this.socket.emit("submitAnswer", {
      channelName: this.channelName,
      answer: JSON.stringify(answer),
    });
  }

  async handleRemoteAnswer(answerString) {
    const answer = JSON.parse(answerString);
    const remoteDesc = new RTCSessionDescription(answer);
    await this.peerConnection.setRemoteDescription(remoteDesc);
  }

  submitIceCandidate(candidate) {
    this.socket.emit("submitIceCandidate", {
      channelName: this.channelName,
      candidate: JSON.stringify(candidate),
    });
  }

  async addIceCandidate(candidateString) {
    const candidate = JSON.parse(candidateString);
    await this.peerConnection.addIceCandidate(candidate);
  }

  // Method to add data channel or media tracks
  addDataChannel(channelName) {
    this.channel = this.peerConnection.createDataChannel(channelName, {
      reliable: true,
    });

    this.channel.onmessage = (event) => {
      this.onMessage(event);
    };
    this.channel.onerror = console.log;
    this.channel.onclose = console.log;
    this.channel.onopen = (event) => {
      console.log(event, "chanel opened");
      this.channel.send("Chal GAYA");
    };
  }
}
