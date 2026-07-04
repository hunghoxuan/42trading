import { useMemo } from "react";
import PageHeader from "../../../shared/components/PageHeader";

const DEFAULT_STUDIO_URL = "http://127.0.0.1:4173/payment-flow.html";

export default function StudioPage({authUser = null}) {
  const studioUrl = useMemo(() => {
    const raw = String(import.meta.env.VITE_STUDIO_URL || DEFAULT_STUDIO_URL).trim();
    if (!raw) return DEFAULT_STUDIO_URL;
    return raw;
  }, []);

  const studioUserId = useMemo(() => {
    return String(
      authUser?.user_id ||
        authUser?.id ||
        authUser?.username ||
        authUser?.name ||
        "anonymous",
    ).trim();
  }, [authUser]);

  const embeddedUrl = useMemo(() => {
    const separator = studioUrl.includes("?") ? "&" : "?";
    return `${studioUrl}${separator}embedded=1&studio_user_id=${encodeURIComponent(studioUserId)}`;
  }, [studioUrl, studioUserId]);

  const standaloneUrl = useMemo(() => {
    const separator = studioUrl.includes("?") ? "&" : "?";
    return `${studioUrl}${separator}studio_user_id=${encodeURIComponent(studioUserId)}`;
  }, [studioUrl, studioUserId]);

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <PageHeader
        title="Studio"
        actions={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a
              href={standaloneUrl}
              target="_blank"
              rel="noreferrer"
              className="secondary-button"
            >
              Open standalone
            </a>
          </div>
        }
      />

      <div
        className="panel"
        style={{
          padding: 12,
          borderRadius: 20,
          overflow: "hidden",
          minHeight: "calc(100vh - 180px)",
        }}
      >
        <iframe
          title="Studio Editor"
          src={embeddedUrl}
          style={{
            width: "100%",
            height: "calc(100vh - 204px)",
            border: "0",
            borderRadius: 16,
            background: "#fff",
          }}
        />
      </div>
    </section>
  );
}
