import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const GatewayPulse: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cycle = frame % Math.round(1.6 * fps);
  const ring = interpolate(cycle, [0, 1.6 * fps], [0.6, 1.4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(cycle, [0, 1.6 * fps], [0.85, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ position: "relative", width: 86, height: 86 }}>
      <div
        style={{
          position: "absolute",
          inset: 22,
          borderRadius: 16,
          background: "linear-gradient(180deg, rgba(50,220,255,0.95), rgba(14,112,255,0.95))",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 8,
          borderRadius: 24,
          border: "3px solid rgba(44,211,255,0.95)",
          transform: `scale(${ring})`,
          opacity,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 14,
          right: 14,
          top: 40,
          height: 6,
          borderRadius: 999,
          background: "rgba(255,255,255,0.9)",
        }}
      />
    </div>
  );
};
