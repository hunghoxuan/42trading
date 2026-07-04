export class RealtimeTransportProvider {
  subscribe() {
    throw new Error("subscribe() must be implemented by a realtime transport provider");
  }

  disconnectTopic() {
    throw new Error("disconnectTopic() must be implemented by a realtime transport provider");
  }

  disconnectAll() {
    throw new Error("disconnectAll() must be implemented by a realtime transport provider");
  }
}
