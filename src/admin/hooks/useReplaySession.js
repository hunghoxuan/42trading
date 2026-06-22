import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { realtimeClient } from "../realtime/realtimeClientSingleton";
import { ReplaySessionStore } from "../realtime/stores/ReplaySessionStore";

const replaySessionStore = new ReplaySessionStore();

function buildReplayTopic(sessionId = "") {
  const id = String(sessionId || "").trim();
  return id ? `replay:${id}` : "";
}

export function useReplaySession(sessionId = "", pollMs = 500) {
  const stableSessionId = String(sessionId || "").trim();
  const topic = useMemo(() => buildReplayTopic(stableSessionId), [stableSessionId]);
  const [state, setState] = useState(() =>
    replaySessionStore.getState(stableSessionId),
  );

  useEffect(() => {
    if (!stableSessionId || !topic) return undefined;
    const unsubscribeStore = replaySessionStore.subscribe(stableSessionId, setState);
    replaySessionStore.setConnected(stableSessionId, false);
    let cancelled = false;

    api
      .getReplaySession(stableSessionId)
      .then((response) => {
        if (cancelled || !response?.session) return;
        replaySessionStore.setBootstrap(response.session);
      })
      .catch((error) => {
        if (cancelled) return;
        replaySessionStore.setError(stableSessionId, error?.message || error);
      });

    const unsubscribeRealtime = realtimeClient.subscribe(
      topic,
      { pollMs },
      (envelope) => replaySessionStore.applyEnvelope(envelope),
      {
        onOpen: () => replaySessionStore.setConnected(stableSessionId, true),
        onError: () => {
          replaySessionStore.setConnected(stableSessionId, false);
          replaySessionStore.setError(stableSessionId, "Replay connection lost");
        },
      },
    );

    return () => {
      cancelled = true;
      unsubscribeRealtime();
      unsubscribeStore();
    };
  }, [pollMs, stableSessionId, topic]);

  return state;
}
