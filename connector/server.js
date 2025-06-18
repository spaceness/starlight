import { Socket } from "node:net";
import { parseArgs } from "node:util";
import NostrEmitter from "@cmdcode/nostr-emitter";
import { PeersocketServer } from "peersocket-server/server.js";
const NOSTR_DEFAULT = "wss://nostr.spaceness.team";
if (process.argv.includes("--help") || process.argv.includes("-h") || process.argv.includes("help")) {
	console.log(`
✨ Starlight by spaceness
Options:
 --nostr: URL of the nostr relay to use. Env variable: STARLIGHT_NOSTR. Defaults to ${NOSTR_DEFAULT}
 --host: Host to connect to. Env variable: STARLIGHT_HOST. Defaults to localhost
 --port: Port to connect to. Env variable: STARLIGHT_PORT. Defaults to 5901
 --id: Session ID to use. Env variable: STARLIGHT_ID. Defaults to starlight-XXXXXX
`);
	process.exit(0);
}
const peersocket = new PeersocketServer();
const emitter = new NostrEmitter();

const { values } = parseArgs({
	options: {
		nostr: {
			type: "string",
		},
		host: {
			type: "string",
		},
		port: {
			type: "string",
		},
		id: {
			type: "string",
		},
	},
	args: process.argv,
	strict: true,
	allowPositionals: true,
});

// randomly generate a session ID thats 6 digits long
const sessionId = values.id || process.env.STARLIGHT_ID || `starlight-${Math.floor(100000 + Math.random() * 900000)}`;
const nostrUrl = values.nostr || process.env.STARLIGHT_NOSTR || NOSTR_DEFAULT;
const host = values.host || process.env.STARLIGHT_HOST || "localhost";
const port = Number.parseInt(values.port) || Number.parseInt(process.env.STARLIGHT_PORT) || 5901;
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
	socketMap[sessionId].connect(port, host);

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

peersocket.onmessage = (_peer, message, sessionId, _details) => {
	socketMap[sessionId].write(message);
};

peersocket.onerror = (_peer, error, sessionId) => {
	console.error(`Error from ${sessionId}: ${error}`);
};

peersocket.onclose = (_peer, sessionId) => {
	console.log(`Peer ${sessionId} disconnected`);
	socketMap[sessionId].end();
};
