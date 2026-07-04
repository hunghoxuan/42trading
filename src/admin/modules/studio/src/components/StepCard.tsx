import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import type { StepDefinition } from "../data/steps";
import { FlowStepCard } from "../shared/ui";

type StepCardProps = {
  step: StepDefinition;
  displayTitle: string;
  displaySubtitle: string;
  isActive: boolean;
  isCompleted: boolean;
  children: React.ReactNode;
};

export const StepCard: React.FC<StepCardProps> = ({
  step,
  displayTitle,
  displaySubtitle,
  isActive,
  isCompleted,
  children,
}) => {
  const frame = useCurrentFrame();

  if (frame < step.startFrame) {
    return null;
  }

  const introDuration = 18;
  const opacity = interpolate(frame, [step.startFrame, step.startFrame + introDuration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const translateY = interpolate(frame, [step.startFrame, step.startFrame + introDuration], [42, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const scale = interpolate(frame, [step.startFrame, step.startFrame + introDuration], [0.94, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <FlowStepCard
      indexLabel={step.id.replace("step-", "")}
      title={displayTitle}
      subtitle={displaySubtitle}
      isActive={isActive}
      isCompleted={isCompleted}
      style={{
        left: step.x,
        top: step.y + translateY,
        width: step.width,
        height: step.height,
        opacity: isCompleted && !isActive ? opacity * 0.82 : opacity,
        transform: `scale(${scale})`,
      }}
    >
      {children}
    </FlowStepCard>
  );
};
