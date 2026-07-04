import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const ScanPulse: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame % Math.round(1.8 * fps);
  const lineY = interpolate(local, [0, 1.8 * fps], [8, 62], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ position: "relative", width: 82, height: 82 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 20,
          border: "3px solid rgba(21,116,210,0.75)",
          background:
            "repeating-linear-gradient(90deg, rgba(21,116,210,0.85) 0 6px, transparent 6px 14px)",
          opacity: 0.32,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 8,
          right: 8,
          top: lineY,
          height: 6,
          borderRadius: 999,
          background: "linear-gradient(90deg, rgba(65,244,255,0.2), rgba(65,244,255,1), rgba(65,244,255,0.2))",
          boxShadow: "0 0 16px rgba(65,244,255,0.8)",
        }}
      />
    </div>
  );
};
