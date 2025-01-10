import { Socket, createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import NostrEmitter from "@cmdcode/nostr-emitter";
import { BrowserWindow, Menu, Tray, app, dialog, ipcMain, shell } from "electron";
import Store from "electron-store";
import { PeersocketServer } from "./peersocket-server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const store = new Store();
let tray = null;
let mainWindow = null;
let isServerRunning = false;

let emitter;
let peersocket;

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 400,
		height: 600,
		resizable: false, // Disable resizing
		autoHideMenuBar: true, // Hide menu bar
		icon: `${__dirname}/icon.png`, // Set the icon
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: join(__dirname, "preload.cjs"),
		},
	});

	mainWindow.loadFile("index.html");

	mainWindow.on("close", (event) => {
		if (!app.isQuitting) {
			event.preventDefault();
			mainWindow.hide();
		}
	});
}

function checkPort(port) {
	return new Promise((resolve) => {
		const tester = createServer();
		tester.once("error", () => resolve(true));
		tester.once("listening", () => {
			tester.close();
			resolve(false);
		});
		tester.listen(port, "127.0.0.1");
	});
}

async function startServer() {
	if (isServerRunning) {
		dialog.showMessageBox({
			type: "info",
			message: "Server is already running",
		});
		return false;
	}

	const portAvailable = await checkPort(5900);
	if (portAvailable) {
		dialog.showMessageBox({
			type: "error",
			message: "Port 5900 is available. Make sure VNC server is running.",
		});
		return false;
	}

	try {
		peersocket = new PeersocketServer();
		emitter = new NostrEmitter();

		let sessionId = store.get("sessionId");
		if (!sessionId) {
			sessionId = `starlight-001${Math.floor(100000 + Math.random() * 900000)}`;
			store.set("sessionId", sessionId);
		}

		await emitter.connect("wss://nostr.grooveix.com", sessionId);
		isServerRunning = true;

		const connectionUrl = `https://starlight-client.surge.sh/vnc.html?host=nostr.grooveix.com&path=${sessionId}&port=443&encrypt=1&autoconnect=true`;

		// Update UI via IPC
		mainWindow.webContents.send("status-update", {
			isRunning: true,
			sessionId,
			connectionUrl,
		});

		// Update tray
		tray.setToolTip(`Starlight Connector - Connected\nSession: ${sessionId}`);
		updateTrayMenu(connectionUrl);

		const socketMap = {};

		setInterval(() => {
			emitter.publish("keepalive", "ping");
		}, 10000);

		emitter.on("requestOffer", async (reqID) => {
			console.log(`Offer requested with reqID: ${reqID}`);
			const { sessionId, offer } = await peersocket.createOffer();
			emitter.publish("offer", { reqID, sessionId, offer });
		});

		emitter.on("answer", async (data) => {
			console.log(`Answer received for ${data.sessionId}`);
			await peersocket.handleAnswer(data.sessionId, data.answer);
		});

		// Set up peersocket handlers
		peersocket.onopen = (peer, sessionId) => {
			console.log(`Peer ${sessionId} connected`);
			socketMap[sessionId] = new Socket();
			socketMap[sessionId].connect(5900, "localhost");

			socketMap[sessionId].on("data", (data) => {
				try {
					peer.send(data);
				} catch (error) {
					console.error(`Error sending data to ${sessionId}: ${error}`);
				}
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

		peersocket.onmessage = (peer, message, sessionId) => {
			socketMap[sessionId].write(message);
		};

		peersocket.onerror = (peer, error, sessionId) => {
			console.error(`Error from ${sessionId}: ${error}`);
		};

		peersocket.onclose = (peer, sessionId) => {
			console.log(`Peer ${sessionId} disconnected`);
			socketMap[sessionId].end();
		};

		return true;
	} catch (error) {
		dialog.showErrorBox("Connection Error", `Failed to start server: ${error.message}`);
		isServerRunning = false;
		return false;
	}
}

function stopServer() {
	if (!isServerRunning) return false;

	emitter.close();
	peersocket.closeAll();

	emitter = null;
	peersocket = null;

	isServerRunning = false;

	// Update UI via IPC
	mainWindow.webContents.send("status-update", {
		isRunning: false,
		sessionId: null,
		connectionUrl: null,
	});

	tray.setToolTip("Starlight Connector - Stopped");
	updateTrayMenu();

	return true;
}

// Set up IPC handlers
ipcMain.handle("start-server", startServer);
ipcMain.handle("stop-server", stopServer);
ipcMain.handle("get-status", () => ({
	isRunning: isServerRunning,
	sessionId: store.get("sessionId"),
	connectionUrl: isServerRunning
		? `https://starlight-client.surge.sh/vnc.html?host=nostr.grooveix.com&path=${store.get("sessionId")}&port=443&encrypt=1&autoconnect=true`
		: null,
}));
ipcMain.handle("open-url", (event, link) => {
	shell.openExternal(link);
});

function updateTrayMenu(connectionUrl = null) {
	const contextMenu = Menu.buildFromTemplate([
		{
			label: `Connection ID: ${
				isServerRunning
					? store
							.get("sessionId", "Not Connected")
							.split("-")[1]
							?.replace(/(\d{3})(?=\d)/g, "$1-")
					: "Not Connected"
			}`,
			enabled: false,
		},
		{ type: "separator" },
		{
			label: "Connect to Starlight",
			enabled: !isServerRunning,
			click: startServer,
		},
		{
			label: "Disconnect from Starlight",
			enabled: isServerRunning,
			click: stopServer,
		},
		{ type: "separator" },
		{
			label: "Reset Connection ID",
			click: () => {
				store.delete("sessionId");
				app.relaunch();
				app.exit();
			},
		},
		{ type: "separator" },
		{
			label: "Open App",
			click: () => mainWindow.show(),
		},
		{
			label: "Quit",
			click: () => {
				app.isQuitting = true;
				stopServer();
				app.quit();
			},
		},
	]);

	tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
	tray = new Tray(join(__dirname, "icon.png"));
	tray.setToolTip("Starlight Connector");
	updateTrayMenu();

	createWindow();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});
