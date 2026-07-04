import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const AppPulse: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pulse = interpolate(frame % Math.round(1.4 * fps), [0, 0.7 * fps, 1.4 * fps], [1, 1.08, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
  });

  return (
    <div style={{ position: "relative", width: 72, height: 96 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 18,
          border: "4px solid rgba(14,104,197,0.9)",
          background: "linear-gradient(180deg, rgba(255,255,255,0.95), rgba(223,244,255,0.9))",
          transform: `scale(${pulse})`,
          boxShadow: "0 10px 24px rgba(14,104,197,0.14)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 14,
          right: 14,
          top: 18,
          bottom: 18,
          borderRadius: 12,
          background: "linear-gradient(180deg, rgba(97,225,255,0.95), rgba(6,119,255,0.9))",
        }}
      />
    </div>
  );
};
