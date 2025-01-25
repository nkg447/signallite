const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Adjust in production
    methods: ["GET", "POST"],
  },
});

// Store offers and answers for each channel
const channelOffers = new Map();
const channelAnswers = new Map();
const channelIceCandidates = new Map();

io.on("connection", (socket) => {
  // Submit Offer
  socket.on("submitOffer", (data) => {
    const { channelName, offer } = data;

    // Store the offer for this channel
    channelOffers.set(channelName, offer);

    // Broadcast offer to other clients in the channel
    socket.to(channelName).emit("offerReceived", offer);

    // Acknowledge offer submission
    socket.emit("offerSubmitted", { channelName });
  });

  // Get Offer
  socket.on("getOffer", (data) => {
    const { channelName } = data;
    const offer = channelOffers.get(channelName);

    socket.emit("offerRetrieved", {
      channelName,
      offer,
    });
  });

  // Submit Answer
  socket.on("submitAnswer", (data) => {
    const { channelName, answer } = data;

    // Store the answer for this channel
    channelAnswers.set(channelName, answer);

    // Broadcast answer to other clients in the channel
    socket.to(channelName).emit("answerReceived", answer);

    // Acknowledge answer submission
    socket.emit("answerSubmitted", { channelName });
  });

  // Submit ICE Candidate
  socket.on("submitIceCandidate", (data) => {
    const { channelName, candidate } = data;

    // Add or create ICE candidates for this channel
    if (!channelIceCandidates.has(channelName)) {
      channelIceCandidates.set(channelName, []);
    }
    channelIceCandidates.get(channelName).push(candidate);

    // Broadcast ICE candidate to other clients in the channel
    socket.to(channelName).emit("iceCandidateReceived", candidate);

    // Acknowledge ICE candidate submission
    socket.emit("iceCandidateSubmitted", { channelName });
  });

  // Join a specific channel
  socket.on("join", (channelName) => {
    console.log("joined", channelName);

    socket.join(channelName);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
