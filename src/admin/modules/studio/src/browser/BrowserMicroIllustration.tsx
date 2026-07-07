import React from "react";
import type {MicroAnimationKind} from "../data/payment-flow";

const animationStyles = `
@keyframes studio-browser-pulse {
  0%, 100% { transform: scale(1); opacity: 0.92; }
  50% { transform: scale(1.06); opacity: 1; }
}

@keyframes studio-browser-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes studio-browser-sweep {
  0% { transform: translateY(-18px); opacity: 0; }
  20% { opacity: 1; }
  100% { transform: translateY(32px); opacity: 0; }
}

@keyframes studio-browser-radar {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`;

const frameStyle: React.CSSProperties = {
  position: "relative",
  width: 92,
  height: 92,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const AppMicro = () => (
  <div style={{...frameStyle, width: 88, height: 108}}>
    <div
      style={{
        position: "absolute",
        inset: "4px 10px 4px 10px",
        borderRadius: 22,
        border: "4px solid rgba(14,104,197,0.88)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(223,244,255,0.94))",
        boxShadow: "0 16px 36px rgba(14,104,197,0.16)",
        animation: "studio-browser-pulse 1.8s ease-in-out infinite",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 24,
        right: 24,
        top: 24,
        bottom: 24,
        borderRadius: 14,
        background: "linear-gradient(180deg, rgba(97,225,255,0.96), rgba(6,119,255,0.92))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
      }}
    />
  </div>
);

const ScanMicro = () => (
  <div style={frameStyle}>
    <div
      style={{
        position: "absolute",
        inset: 6,
        borderRadius: 20,
        border: "3px solid rgba(21,116,210,0.78)",
        background:
          "repeating-linear-gradient(90deg, rgba(21,116,210,0.88) 0 6px, transparent 6px 14px)",
        opacity: 0.3,
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        top: 24,
        height: 7,
        borderRadius: 999,
        background: "linear-gradient(90deg, rgba(65,244,255,0.1), rgba(65,244,255,1), rgba(65,244,255,0.1))",
        boxShadow: "0 0 18px rgba(65,244,255,0.7)",
        animation: "studio-browser-sweep 1.7s linear infinite",
      }}
    />
  </div>
);

const GatewayMicro = () => (
  <div style={frameStyle}>
    <div
      style={{
        position: "absolute",
        inset: 10,
        borderRadius: 26,
        border: "3px solid rgba(44,211,255,0.82)",
        animation: "studio-browser-pulse 1.8s ease-out infinite",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 24,
        borderRadius: 18,
        background: "linear-gradient(180deg, rgba(50,220,255,0.95), rgba(14,112,255,0.95))",
        boxShadow: "0 12px 28px rgba(10,124,255,0.18)",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 18,
        right: 18,
        top: 44,
        height: 7,
        borderRadius: 999,
        background: "rgba(255,255,255,0.92)",
      }}
    />
  </div>
);

const AuthMicro = () => (
  <div style={frameStyle}>
    <svg width="92" height="92" viewBox="0 0 92 92" style={{filter: "drop-shadow(0 10px 18px rgba(24,133,255,0.18))"}}>
      <path
        d="M46 10 L72 21 V40 C72 58 59 71 46 80 C33 71 20 58 20 40 V21 Z"
        fill="rgba(67,224,255,0.32)"
        stroke="rgba(16,122,242,0.95)"
        strokeWidth="4"
      />
      <path
        d="M35 46 L43 54 L58 35"
        fill="none"
        stroke="white"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </div>
);

const RiskMicro = () => (
  <div style={frameStyle}>
    <div style={{position: "absolute", inset: 10, borderRadius: "50%", border: "2px solid rgba(20,130,222,0.45)"}} />
    <div style={{position: "absolute", inset: 22, borderRadius: "50%", border: "2px solid rgba(20,130,222,0.3)"}} />
    <div
      style={{
        position: "absolute",
        inset: 4,
        borderRadius: "50%",
        border: "3px solid rgba(73,230,255,0.3)",
        boxShadow: "0 0 24px rgba(73,230,255,0.18)",
      }}
    />
    <div
      style={{
        position: "absolute",
        width: 38,
        height: 2,
        left: 46,
        top: 45,
        transformOrigin: "0 50%",
        background: "linear-gradient(90deg, rgba(69,232,255,0.25), rgba(69,232,255,1))",
        boxShadow: "0 0 12px rgba(69,232,255,0.8)",
        animation: "studio-browser-radar 2.1s linear infinite",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 42,
        top: 41,
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: "rgba(14,112,255,1)",
      }}
    />
  </div>
);

const ProcessingMicro = () => (
  <div style={frameStyle}>
    <div
      style={{
        position: "absolute",
        inset: 10,
        borderRadius: "50%",
        border: "8px solid rgba(19,134,224,0.88)",
        boxSizing: "border-box",
        animation: "studio-browser-rotate 3.4s linear infinite",
      }}
    />
    {new Array(8).fill(null).map((_, index) => {
      const angle = index * 45;
      return (
        <div
          key={angle}
          style={{
            position: "absolute",
            left: 40,
            top: 0,
            width: 12,
            height: 22,
            borderRadius: 6,
            background: "rgba(64,228,255,0.98)",
            transformOrigin: "6px 46px",
            transform: `rotate(${angle}deg)`,
            animation: "studio-browser-rotate 3.4s linear infinite",
          }}
        />
      );
    })}
    <div
      style={{
        position: "absolute",
        inset: 30,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.94)",
      }}
    />
  </div>
);

const ResultMicro = () => (
  <div style={{...frameStyle, width: 104, height: 92}}>
    <div
      style={{
        position: "absolute",
        left: 4,
        top: 18,
        width: 42,
        height: 42,
        borderRadius: "50%",
        background: "rgba(42,215,128,0.18)",
        border: "3px solid rgba(42,215,128,0.95)",
        animation: "studio-browser-pulse 1.9s ease-in-out infinite",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 17,
        top: 31,
        width: 14,
        height: 8,
        borderLeft: "5px solid white",
        borderBottom: "5px solid white",
        transform: "rotate(-45deg)",
      }}
    />
    <div
      style={{
        position: "absolute",
        right: 14,
        top: 12,
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: "rgba(255,162,0,0.95)",
        boxShadow: "0 0 12px rgba(255,162,0,0.45)",
      }}
    />
    <div
      style={{
        position: "absolute",
        right: 6,
        bottom: 10,
        width: 18,
        height: 18,
        borderRadius: "50%",
        border: "3px solid rgba(62,171,255,0.95)",
      }}
    />
  </div>
);

const FALLBACK_ICON_BY_KIND: Record<MicroAnimationKind, string> = {
  app: "📱",
  scan: "🔎",
  gateway: "🌐",
  auth: "🛡️",
  risk: "📡",
  processing: "⚙️",
  result: "✅",
};

export const BrowserMicroIllustration: React.FC<{
  kind?: MicroAnimationKind;
  fallbackIcon?: string;
}> = ({kind, fallbackIcon}) => {
  const resolvedKind = kind || "gateway";

  let content: React.ReactNode;
  switch (resolvedKind) {
    case "app":
      content = <AppMicro />;
      break;
    case "scan":
      content = <ScanMicro />;
      break;
    case "gateway":
      content = <GatewayMicro />;
      break;
    case "auth":
      content = <AuthMicro />;
      break;
    case "risk":
      content = <RiskMicro />;
      break;
    case "processing":
      content = <ProcessingMicro />;
      break;
    case "result":
      content = <ResultMicro />;
      break;
    default:
      content = (
        <div style={{fontSize: 52, lineHeight: 1, filter: "drop-shadow(0 8px 20px rgba(8,40,74,0.14))"}}>
          {fallbackIcon || FALLBACK_ICON_BY_KIND.gateway}
        </div>
      );
  }

  return (
    <>
      <style>{animationStyles}</style>
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {content}
      </div>
    </>
  );
};
