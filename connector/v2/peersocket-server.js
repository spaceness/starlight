import Peer from 'simple-peer';
import nodeDatachannelPolyfill from 'node-datachannel/polyfill';

export class PeersocketServer {
    constructor() {
        this.peers = {};

        this.onopen = (peer, sessionId, details) => { };
        this.onmessage = (peer, message, sessionId, details) => { };
        this.onerror = (peer, error, sessionId, details) => { };
        this.onclose = (peer, sessionId, details) => { };
    }

    async createOffer(details) {
        try {
            const peer = new Peer({ initiator: true, trickle: false, wrtc: nodeDatachannelPolyfill });
            const offer = await new Promise((resolve, reject) => {
                peer.on('signal', resolve);
                peer.on('error', reject);
            });

            const sessionId = Math.random().toString(36).substr(2, 9);
            this.peers[sessionId] = {
                connected: false,
                peer,
                details
            };

            return { sessionId, offer, details };
        } catch (error) {
            this.onerror(null, error, null, null);
            throw error;
        }
    }

    async handleAnswer(sessionId, answer) {
        try {
            if (!this.peers[sessionId]) {
                throw new Error('No such session');
            }
            const peer = this.peers[sessionId].peer;
            const details = this.peers[sessionId].details;

            peer.on('connect', () => {
                try {
                    this.peers[sessionId].connected = true;
                    this.onopen(peer, sessionId, details);

                    peer.on('data', (data) => {
                        try {
                            this.onmessage(peer, data, sessionId, details);
                        } catch (error) {
                            this.onerror(peer, error, sessionId, details);
                        }
                    });

                    peer.on('error', (error) => {
                        this.onerror(peer, error, sessionId, details);
                        delete this.peers[sessionId];
                    });

                    peer.on('close', () => {
                        try {
                            this.onclose(peer, sessionId, details);
                            delete this.peers[sessionId];
                        } catch (error) {
                            this.onerror(peer, error, sessionId, details);
                        }
                    });
                } catch (error) {
                    this.onerror(peer, error, sessionId, details);
                }
            });

            peer.signal(answer);
            return true;
        } catch (error) {
            const details = this.peers[sessionId]?.details;
            this.onerror(null, error, sessionId, details);
            throw error;
        }
    }

    async send(sessionId, data) {
        try {
            if (!this.peers[sessionId]) {
                throw new Error('No such session');
            }
            this.peers[sessionId].peer.send(data);
        } catch (error) {
            this.onerror(this.peers[sessionId]?.peer, error, sessionId);
            throw error;
        }
    }

    async close(sessionId) {
        try {
            if (!this.peers[sessionId]) {
                throw new Error('No such session');
            }
            this.peers[sessionId].peer.destroy();
            delete this.peers[sessionId];
        } catch (error) {
            this.onerror(this.peers[sessionId]?.peer, error, sessionId);
            throw error;
        }
    }

    async closeAll() {
        try {
            for (const sessionId in this.peers) {
                await this.close(sessionId);
            }
        } catch (error) {
            this.onerror(null, error, null);
            throw error;
        }
    }

    async sendToAll(data) {
        try {
            for (const sessionId in this.peers) {
                await this.send(sessionId, data);
            }
        } catch (error) {
            this.onerror(null, error, null);
            throw error;
        }
    }
}