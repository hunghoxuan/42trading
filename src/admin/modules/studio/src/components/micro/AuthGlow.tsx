import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const AuthGlow: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cycle = frame % Math.round(1.5 * fps);
  const glow = interpolate(cycle, [0, 0.75 * fps, 1.5 * fps], [0.5, 1, 0.55], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ position: "relative", width: 90, height: 90 }}>
      <svg width="90" height="90" viewBox="0 0 90 90">
        <path
          d="M45 10 L70 20 V39 C70 57 58 69 45 77 C32 69 20 57 20 39 V20 Z"
          fill={`rgba(67, 224, 255, ${0.2 + glow * 0.4})`}
          stroke="rgba(16, 122, 242, 0.95)"
          strokeWidth="4"
        />
        <path
          d="M34 45 L42 53 L57 34"
          fill="none"
          stroke="white"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
