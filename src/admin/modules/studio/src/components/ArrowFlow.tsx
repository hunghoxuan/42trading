import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

type ArrowFlowProps = {
  pathD: string;
  startFrame: number;
  endFrame: number;
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
  opacity?: number;
  markerId?: string;
};

const getPathLength = (pathD: string) => {
  const matches = [...pathD.matchAll(/[ML]\s*([-\d.]+)\s+([-\d.]+)/g)];
  let total = 0;
  for (let index = 1; index < matches.length; index += 1) {
    const prev = matches[index - 1];
    const current = matches[index];
    const dx = Number(current[1]) - Number(prev[1]);
    const dy = Number(current[2]) - Number(prev[2]);
    total += Math.hypot(dx, dy);
  }
  return Math.max(1, total);
};

export const ArrowFlow: React.FC<ArrowFlowProps> = ({
  pathD,
  startFrame,
  endFrame,
  stroke = "#1a90ff",
  strokeWidth = 2.5,
  dashed = false,
  opacity = 1,
  markerId = "arrowDone",
}) => {
  const frame = useCurrentFrame();

  if (frame < startFrame) {
    return null;
  }

  const progress = interpolate(frame, [startFrame, endFrame], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  const totalLength = getPathLength(pathD);
  const dashOffset = totalLength * (1 - progress);

  return (
    <AbsoluteFill>
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <path
          d={pathD}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={opacity}
          strokeDasharray={dashed ? `5 5 ${Math.max(1, totalLength)}` : `${totalLength}`}
          strokeDashoffset={dashOffset}
          markerEnd={`url(#${markerId})`}
        />
      </svg>
    </AbsoluteFill>
  );
};
