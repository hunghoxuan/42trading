import { api } from "../../../app/api";
import { RealtimeClient } from "./core/RealtimeClient";
import { ChartStreamStore } from "./stores/ChartStreamStore";
import { SocketIoTransportProvider } from "./transport/SocketIoTransportProvider";

const chartStreamStore = new ChartStreamStore();

const realtimeTransport = new SocketIoTransportProvider({
  getConnectionOptions: () => api.realtimeSocketOptions(),
});

const realtimeClient = new RealtimeClient(realtimeTransport);

export { chartStreamStore, realtimeClient, realtimeTransport };
