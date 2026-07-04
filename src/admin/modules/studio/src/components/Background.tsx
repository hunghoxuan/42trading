import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const pulse = interpolate(frame, [0, durationInFrames], [0.92, 1.04], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at top left, rgba(90,208,255,0.18), transparent 35%), radial-gradient(circle at top right, rgba(0,118,255,0.16), transparent 28%), linear-gradient(180deg, #f6fbff 0%, #eaf5ff 55%, #edf7ff 100%)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(20,110,180,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(20,110,180,0.04) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
          opacity: 0.85,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 620 * pulse,
          height: 620 * pulse,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(53,202,255,0.22), rgba(53,202,255,0.02) 70%, transparent 75%)",
          left: -150,
          top: 120,
          filter: "blur(10px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 720 * pulse,
          height: 720 * pulse,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,115,255,0.18), rgba(0,115,255,0.03) 70%, transparent 76%)",
          right: -220,
          bottom: -160,
          filter: "blur(14px)",
        }}
      />
    </AbsoluteFill>
  );
};
