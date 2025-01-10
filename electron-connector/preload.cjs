const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bridge", {
	startServer: () => ipcRenderer.invoke("start-server"),
	stopServer: () => ipcRenderer.invoke("stop-server"),
	getStatus: () => ipcRenderer.invoke("get-status"),
	openUrl: (url) => ipcRenderer.invoke("open-url", url),
	onStatusUpdate: (callback) => {
		const subscription = (_event, data) => callback(data);
		ipcRenderer.on("status-update", subscription);
		return () => {
			ipcRenderer.removeListener("status-update", subscription);
		};
	},
});
