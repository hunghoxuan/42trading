import { useEffect, useMemo } from "react";
import PageHeader from "../../../shared/components/PageHeader";
import { PaymentFlowBrowser } from "../src/browser/PaymentFlowBrowser";

export default function StudioPage({ authUser = null }) {
  const studioUserId = useMemo(() => {
    return String(
      authUser?.user_id ||
        authUser?.id ||
        authUser?.username ||
        authUser?.name ||
        "anonymous",
    ).trim();
  }, [authUser]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("studio_user_id", studioUserId || "anonymous");
  }, [studioUserId]);

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <PageHeader
        title="Studio"
        actions={(
          <div
            id="studio-page-header-actions"
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          />
        )}
      />

      <div
        className="panel"
        style={{
          padding: 0,
          borderRadius: 20,
          overflow: "hidden",
          minHeight: "calc(100vh - 180px)",
        }}
      >
        <div style={{ width: "100%", height: "calc(100vh - 204px)" }}>
          <PaymentFlowBrowser />
        </div>
      </div>
    </section>
  );
}
