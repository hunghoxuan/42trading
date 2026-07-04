import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const ProcessingGear: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rotation = interpolate(frame, [0, 2 * fps], [0, 360], {
    extrapolateLeft: "extend",
    extrapolateRight: "extend",
  });

  return (
    <div style={{ position: "relative", width: 90, height: 90 }}>
      <div
        style={{
          position: "absolute",
          inset: 12,
          borderRadius: "50%",
          border: "8px solid rgba(19,134,224,0.88)",
          boxSizing: "border-box",
          transform: `rotate(${rotation}deg)`,
        }}
      />
      {new Array(8).fill(true).map((_, index) => {
        const angle = index * 45;
        return (
          <div
            key={angle}
            style={{
              position: "absolute",
              left: 39,
              top: 0,
              width: 12,
              height: 22,
              borderRadius: 6,
              background: "rgba(64,228,255,0.98)",
              transformOrigin: "6px 45px",
              transform: `rotate(${angle + rotation}deg)`,
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          inset: 31,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.9)",
        }}
      />
    </div>
  );
};
