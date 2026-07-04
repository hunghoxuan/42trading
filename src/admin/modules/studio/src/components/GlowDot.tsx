import React from "react";

type GlowDotProps = {
  x: number;
  y: number;
  radius?: number;
  opacity?: number;
};

export const GlowDot: React.FC<GlowDotProps> = ({ x, y, radius = 10, opacity = 1 }) => {
  return (
    <div
      style={{
        position: "absolute",
        left: x - radius,
        top: y - radius,
        width: radius * 2,
        height: radius * 2,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(77,223,255,1) 36%, rgba(9,157,255,0.25) 72%, rgba(9,157,255,0) 100%)",
        boxShadow: "0 0 18px rgba(77,223,255,0.9), 0 0 32px rgba(9,157,255,0.5)",
        opacity,
      }}
    />
  );
};
