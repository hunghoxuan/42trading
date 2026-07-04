import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createRealtimeSocketServer,
} = require("../../../../modules/42trade/realtime/realtimeSocketServer.js");

export class SocketIoStreamingProvider {
  constructor({ pubsub } = {}) {
    this.pubsub = pubsub;
    this.attached = false;
  }

  attach(serverContext = {}) {
    const registerStreamSink =
      typeof serverContext.registerStreamSink === "function"
        ? serverContext.registerStreamSink
        : this.pubsub?.registerStreamSink?.bind(this.pubsub);

    const server = createRealtimeSocketServer({
      ...serverContext,
      registerStreamSink,
    });
    this.attached = true;
    return server;
  }

  getStatus() {
    return {
      id: "socketio",
      ready: this.attached,
    };
  }
}
