import { Socket } from "node:net";
import NostrEmitter from "@cmdcode/nostr-emitter";
import { PeersocketServer } from "peersocket-server/server.js";

const peersocket = new PeersocketServer();
const emitter = new NostrEmitter();

// randomly generate a session ID thats 6 digits long
const sessionId = `starlight-${Math.floor(100000 + Math.random() * 900000)}`;
const nostrUrl = process.env.NOSTR_URL || "wss://nostr.grooveix.com";
await emitter.connect(nostrUrl, sessionId);

console.log(`✨ [Starlight] Connected to ${nostrUrl} with session ID: ${sessionId}`);

// send a message to "keepalive" every 10 seconds
setInterval(() => {
	emitter.publish("keepalive", "ping");
}, 10000);

const socketMap = {};

// handle incoming offer requests
emitter.on("requestOffer", async (reqID) => {
	console.log(`Offer requested with reqID: ${reqID}`);
	const { sessionId, offer } = await peersocket.createOffer();
	emitter.publish("offer", { reqID, sessionId, offer });
});

// handle incoming answers
emitter.on("answer", async (data) => {
	console.log(`Answer received for ${data.sessionId}`);
	await peersocket.handleAnswer(data.sessionId, data.answer);
});

peersocket.onopen = (peer, sessionId) => {
	console.log(`Peer ${sessionId} connected`);
	socketMap[sessionId] = new Socket();
	socketMap[sessionId].connect(5901, "localhost");

	socketMap[sessionId].on("data", (data) => {
		peer.send(data);
	});

	socketMap[sessionId].on("error", (error) => {
		console.error(`Socket error: ${error}`);
		peer.destroy();
	});

	socketMap[sessionId].on("close", () => {
		console.log("Socket closed");
		peer.destroy();
	});
};

peersocket.onmessage = (peer, message, sessionId, details) => {
	socketMap[sessionId].write(message);
};

peersocket.onerror = (peer, error, sessionId) => {
	console.error(`Error from ${sessionId}: ${error}`);
};

peersocket.onclose = (peer, sessionId) => {
	console.log(`Peer ${sessionId} disconnected`);
	socketMap[sessionId].end();
};