import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const ResultPulse: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cycle = frame % Math.round(1.8 * fps);
  const scale = interpolate(cycle, [0, 0.9 * fps, 1.8 * fps], [0.92, 1.08, 0.98], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ position: "relative", width: 96, height: 88 }}>
      <div
        style={{
          position: "absolute",
          left: 2,
          top: 14,
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: "rgba(42, 215, 128, 0.18)",
          border: "3px solid rgba(42, 215, 128, 0.95)",
          transform: `scale(${scale})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 14,
          top: 26,
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
          right: 12,
          top: 12,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "rgba(255, 162, 0, 0.95)",
          boxShadow: "0 0 12px rgba(255, 162, 0, 0.45)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 4,
          bottom: 10,
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: "3px solid rgba(62, 171, 255, 0.95)",
        }}
      />
    </div>
  );
};
