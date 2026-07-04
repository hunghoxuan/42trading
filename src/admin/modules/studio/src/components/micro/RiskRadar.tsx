import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const RiskRadar: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const angle = ((frame % Math.round(2 * fps)) / (2 * fps)) * 360;
  const pulse = interpolate(frame % Math.round(1.6 * fps), [0, 1.6 * fps], [0.2, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ position: "relative", width: 92, height: 92 }}>
      <div style={{ position: "absolute", inset: 10, borderRadius: "50%", border: "2px solid rgba(20,130,222,0.45)" }} />
      <div style={{ position: "absolute", inset: 22, borderRadius: "50%", border: "2px solid rgba(20,130,222,0.3)" }} />
      <div
        style={{
          position: "absolute",
          inset: 4,
          borderRadius: "50%",
          border: `3px solid rgba(73, 230, 255, ${0.15 + pulse * 0.28})`,
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
          transform: `rotate(${angle}deg)`,
          background: "linear-gradient(90deg, rgba(69,232,255,0.25), rgba(69,232,255,1))",
          boxShadow: "0 0 12px rgba(69,232,255,0.8)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 43,
          top: 42,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "rgba(14,112,255,1)",
        }}
      />
    </div>
  );
};
