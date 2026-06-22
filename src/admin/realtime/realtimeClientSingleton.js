import { api } from "../api";
import { RealtimeClient } from "./core/RealtimeClient";
import { ChartStreamStore } from "./stores/ChartStreamStore";
import { SseTransportProvider } from "./transport/SseTransportProvider";

const chartStreamStore = new ChartStreamStore();

const realtimeClient = new RealtimeClient(
  new SseTransportProvider({
    buildUrl: (topic, params = {}) => api.realtimeStreamUrl(topic, params),
  }),
);

export { chartStreamStore, realtimeClient };
