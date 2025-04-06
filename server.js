/**
 * WebRTC Signaling Server
 * 
 * This server facilitates WebRTC connections between peers by:
 * - Managing offer/answer exchange between clients
 * - Handling ICE candidate sharing
 * - Supporting multiple channels for different peer groups
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// Initialize Express and Socket.io
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins (should be restricted in production)
    methods: ["GET", "POST"],
  },
});

/**
 * Data storage for WebRTC signaling
 * Using Maps to store channel-specific information
 */
const channels = {
  offers: new Map(),        // Stores SDP offers by channel name
  answers: new Map(),       // Stores SDP answers by channel name
  iceCandidates: new Map(), // Stores ICE candidates by channel name
};

/**
 * Clears all data for a specific channel
 * @param {string} channelName - Name of the channel to clear
 */
const clearChannelData = (channelName) => {
  console.log(`Clearing channel data for: ${channelName}`);
  console.log(`Current channel count before clearing: ${channels.offers.size}`);
  
  channels.offers.delete(channelName);
  channels.answers.delete(channelName);
  channels.iceCandidates.delete(channelName);
};

// Socket.io connection handler
io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);
  
  /**
   * Event handlers for WebRTC signaling
   */
  
  // Handle channel joining
  socket.on("join", (channelName) => {
    console.log(`Client ${socket.id} joined channel: ${channelName}`);
    socket.join(channelName);
  });

  // Handle SDP offer submission
  socket.on("submitOffer", ({ channelName, offer }) => {
    console.log(`Offer received for channel: ${channelName}`);
    
    // Store the offer
    channels.offers.set(channelName, offer);
    
    // Broadcast to others in the channel
    socket.to(channelName).emit("offerReceived", offer);
    
    // Confirm receipt to sender
    socket.emit("offerSubmitted", { channelName });
  });

  // Handle SDP offer retrieval
  socket.on("getOffer", ({ channelName }) => {
    const offer = channels.offers.get(channelName);
    console.log(`Offer requested for channel: ${channelName}, exists: ${Boolean(offer)}`);
    
    socket.emit("offerRetrieved", {
      channelName,
      offer,
    });
  });

  // Handle SDP answer submission
  socket.on("submitAnswer", ({ channelName, answer }) => {
    console.log(`Answer received for channel: ${channelName}`);
    
    // Store the answer
    channels.answers.set(channelName, answer);
    
    // Broadcast to others in the channel
    socket.to(channelName).emit("answerReceived", answer);
    
    // Confirm receipt to sender
    socket.emit("answerSubmitted", { channelName });
  });

  // Handle ICE candidate submission
  socket.on("submitIceCandidate", ({ channelName, candidate }) => {
    console.log(`ICE candidate received for channel: ${channelName}`);
    
    // Initialize array for this channel if needed
    if (!channels.iceCandidates.has(channelName)) {
      channels.iceCandidates.set(channelName, []);
    }
    
    // Store the candidate
    channels.iceCandidates.get(channelName).push(candidate);
    
    // Broadcast to others in the channel
    socket.to(channelName).emit("iceCandidateReceived", candidate);
    
    // Confirm receipt to sender
    socket.emit("iceCandidateSubmitted", { channelName });
    
    // Clean up channel data after ICE candidates are shared
    // Note: This may need adjustment based on your specific requirements
    // as it might be premature to clear data at this point
    clearChannelData(channelName);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    // Additional cleanup could be added here if needed
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WebRTC signaling server running on port ${PORT}`);
});