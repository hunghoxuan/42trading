import React, {useMemo} from "react";
import {AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {ArrowFlow} from "./components/ArrowFlow";
import {Background} from "./components/Background";
import {StepCard} from "./components/StepCard";
import {AppPulse} from "./components/micro/AppPulse";
import {AuthGlow} from "./components/micro/AuthGlow";
import {GatewayPulse} from "./components/micro/GatewayPulse";
import {ProcessingGear} from "./components/micro/ProcessingGear";
import {ResultPulse} from "./components/micro/ResultPulse";
import {RiskRadar} from "./components/micro/RiskRadar";
import {ScanPulse} from "./components/micro/ScanPulse";
import {PAYMENT_FLOW, type FlowConnector, type FlowStep, type PaymentFlowDocument, type MicroAnimationKind} from "./data/payment-flow";
import {buildPlaybackTimeline} from "./data/playback";
import {
  type StepDefinition,
} from "./data/steps";
import {
  buildStepBoxes,
  computeLayout,
  getConnectorBreakPoint,
  getConnectorLaneOffset,
  hasReverseLane,
  pathForConnector,
} from "./shared/flow-engine";

const renderMicro = (kind: MicroAnimationKind) => {
  switch (kind) {
    case "app":
      return <AppPulse />;
    case "scan":
      return <ScanPulse />;
    case "gateway":
      return <GatewayPulse />;
    case "auth":
      return <AuthGlow />;
    case "risk":
      return <RiskRadar />;
    case "processing":
      return <ProcessingGear />;
    case "result":
      return <ResultPulse />;
    default:
      return null;
  }
};

const shellPaddingX = 20;
const shellPaddingTop = 18;
const shellPaddingBottom = 20;
const slideRailWidth = 60;
const sidePanelWidth = 340;
const contentGap = 16;

export type PaymentFlowVideoProps = {
  flowData?: PaymentFlowDocument;
};

const resolveRenderableFlow = (flowData?: PaymentFlowDocument): PaymentFlowDocument => {
  const baseFlow = flowData && typeof flowData === "object" ? flowData : PAYMENT_FLOW;
  const slides = Array.isArray(baseFlow.slides) ? baseFlow.slides : [];
  if (!slides.length) return baseFlow;
  const activeSlideId = baseFlow.activeSlideId || slides[0]?.id || null;
  const activeSlide =
    slides.find((slide) => slide?.id === activeSlideId) ||
    slides[0] ||
    null;
  if (!activeSlide) return baseFlow;
  return {
    ...baseFlow,
    meta: {
      ...baseFlow.meta,
      ...(activeSlide.meta || {}),
    },
    steps: Array.isArray(activeSlide.steps) ? activeSlide.steps : baseFlow.steps,
    connectors: Array.isArray(activeSlide.connectors) ? activeSlide.connectors : baseFlow.connectors,
    stepLayouts: activeSlide.stepLayouts || baseFlow.stepLayouts || {},
  };
};

export const getPaymentFlowVideoMetadata = (flowData?: PaymentFlowDocument) => {
  const resolvedFlow = resolveRenderableFlow(flowData);
  const timeline = buildPlaybackTimeline(resolvedFlow);
  return {
    flowData: resolvedFlow,
    durationInFrames: Math.max(1, timeline.totalFrames || resolvedFlow.video?.durationInFrames || 1),
    fps: resolvedFlow.video?.fps || PAYMENT_FLOW.video.fps,
    width: resolvedFlow.video?.width || PAYMENT_FLOW.video.width,
    height: resolvedFlow.video?.height || PAYMENT_FLOW.video.height,
  };
};

const labelStyle = (
  x: number,
  y: number,
  direction: "forward" | "reverse",
  laneOffset: number,
  animating: boolean,
): React.CSSProperties => ({
  position: "absolute",
  left: x,
  top: y,
  transform: `translate(-50%, ${laneOffset <= 0.5 ? "calc(-100% - 4px)" : "4px"})`,
  width: direction === "reverse" ? 82 : 92,
  padding: direction === "reverse" ? "4px 6px" : "5px 6px",
  borderRadius: 16,
  background: direction === "reverse" ? "rgba(255,255,255,.90)" : "rgba(255,255,255,.96)",
  border: direction === "reverse" ? "1px dashed rgba(118,170,230,.4)" : "1px solid rgba(118,170,230,.26)",
  boxShadow: direction === "reverse" ? "0 8px 18px rgba(8,40,74,.04)" : "0 10px 22px rgba(8,40,74,.05)",
  textAlign: "center",
  pointerEvents: "none",
  zIndex: animating ? 10 : 3,
});

const audioSourceForStep = (step: typeof orderedSteps[number]) => {
  if (step.audioPath?.trim()) {
    return staticFile(step.audioPath.replace(/^\//, ""));
  }
  return staticFile(`generated-audio/${step.id}.wav`);
};

export const PaymentFlowVideo: React.FC<PaymentFlowVideoProps> = ({flowData}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const resolved = useMemo(() => getPaymentFlowVideoMetadata(flowData), [flowData]);
  const documentData = resolved.flowData;
  const orderedSteps = useMemo(
    () => (documentData.steps || []).slice().sort((a, b) => a.order - b.order),
    [documentData.steps],
  );
  const connectors = useMemo(
    () => (documentData.connectors || []).slice(),
    [documentData.connectors],
  );
  const playbackTimeline = useMemo(
    () => buildPlaybackTimeline(documentData),
    [documentData],
  );
  const remotionStageWidth =
    width -
    shellPaddingX * 2 -
    slideRailWidth -
    sidePanelWidth -
    contentGap * 2;
  const contentHeight = height - shellPaddingTop - shellPaddingBottom;
  const layout = useMemo(
    () =>
      computeLayout({
        viewportWidth: width,
        stageWidth: remotionStageWidth,
        stageAvailableHeight: contentHeight,
        steps: orderedSteps,
        stepLayouts: documentData.stepLayouts || {},
      }),
    [contentHeight, documentData.stepLayouts, orderedSteps, remotionStageWidth, width],
  );
  const stageHeight = layout.stageHeight;
  const stageTopPadding = Math.max(0, (contentHeight - stageHeight) / 2);
  const boxes = useMemo(
    () =>
      buildStepBoxes({
        positions: layout.positions,
        stepLayouts: documentData.stepLayouts || {},
        defaultWidth: layout.cardWidth,
        defaultHeight: layout.cardHeight,
      }) as Record<string, {x: number; y: number; w: number; h: number}>,
    [documentData.stepLayouts, layout.cardHeight, layout.cardWidth, layout.positions],
  );
  const connectorVisuals = useMemo(
    () =>
      connectors.map((connector) => {
        const forwardPath = pathForConnector({
          connector,
          connectors,
          boxes,
          mobile: layout.mobile,
          direction: "forward",
        });
        const reversePath = hasReverseLane(connector)
          ? pathForConnector({
              connector,
              connectors,
              boxes,
              mobile: layout.mobile,
              direction: "reverse",
            })
          : null;
        return {
          connector,
          forwardPath,
          reversePath,
          forwardBreak: getConnectorBreakPoint({
            connector,
            connectors,
            boxes,
            direction: "forward",
          }),
          reverseBreak: reversePath
            ? getConnectorBreakPoint({
                connector,
                connectors,
                boxes,
                direction: "reverse",
              })
            : null,
          forwardOffset: getConnectorLaneOffset({connector, connectors, direction: "forward"}),
          reverseOffset: getConnectorLaneOffset({connector, connectors, direction: "reverse"}),
        };
      }),
    [boxes, connectors, layout.mobile],
  );
  const visualSteps = useMemo(
    () =>
      orderedSteps.map((step, index) => {
        const timing = playbackTimeline.steps[index];
        const box = boxes[step.id] || {
          x: 24,
          y: 24 + index * (layout.cardHeight + 24),
          w: layout.cardWidth,
          h: layout.cardHeight,
        };
        return {
          id: step.id,
          indexLabel: String(step.order),
          title: step.video?.title || step.business.title,
          subtitle: step.video?.subtitle || step.business.subtitle,
          x: box.x,
          y: box.y,
          width: box.w,
          height: box.h,
          startFrame: timing?.narrationStartFrame ?? 0,
          endFrame: timing?.narrationEndFrame ?? 0,
          arrowStartFrame: timing?.forwardStartFrame ?? 0,
          arrowEndFrame: timing?.forwardEndFrame ?? 0,
          micro: step.micro,
        } satisfies StepDefinition & {indexLabel?: string};
      }),
    [boxes, layout.cardHeight, layout.cardWidth, orderedSteps, playbackTimeline.steps],
  );

  const introOpacity = interpolate(frame, [0, 1.4 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  const playbackViewMode =
    frame >= playbackTimeline.learnModeStartFrame
      ? playbackTimeline.config.finalViewMode
      : playbackTimeline.config.initialViewMode;

  const activeStepIndex = Math.max(
    0,
    playbackTimeline.steps.reduce((lastIndex, timing, index) => (
      frame >= timing.narrationStartFrame ? index : lastIndex
    ), 0),
  );
  const currentStep = orderedSteps[activeStepIndex] ?? orderedSteps[0];
  const finalHold = frame >= playbackTimeline.learnModeStartFrame;
  const logoPath = (documentData.presentation?.logoPath || documentData.meta.logoPath || "").replace(/^\/+/, "");

  if (!currentStep) {
    return (
      <AbsoluteFill>
        <Background />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill>
      {orderedSteps.map((step, index) => {
        const timing = playbackTimeline.steps[index];
        if (!timing || !step.narration?.trim()) return null;
        return (
          <Sequence key={`audio-${step.id}`} from={timing.narrationStartFrame}>
            <Audio src={audioSourceForStep(step)} />
          </Sequence>
        );
      })}

      <Background />

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(rgba(223,234,250,1) 1px, transparent 1px) 0 0 / 72px 72px, linear-gradient(90deg, rgba(223,234,250,1) 1px, transparent 1px) 0 0 / 72px 72px, transparent",
          border: "1px solid rgba(118,170,230,.22)",
          boxShadow: "0 28px 70px rgba(8,40,74,.10)",
          overflow: "hidden",
          padding: `${shellPaddingTop}px ${shellPaddingX}px ${shellPaddingBottom}px`,
          display: "flex",
          flexDirection: "column",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: `minmax(0, 1fr) ${sidePanelWidth}px`,
            gap: contentGap,
            alignItems: "stretch",
            flex: 1,
            minHeight: 0,
            opacity: introOpacity,
          }}
        >
          <div style={{display: "flex", flexDirection: "column", minHeight: 0, height: "100%"}}>
            <div
              style={{
                position: "relative",
                height: stageHeight,
                marginTop: stageTopPadding,
                borderRadius: 26,
                background: "linear-gradient(180deg, rgba(255,255,255,.34), rgba(255,255,255,.18))",
                overflow: "hidden",
              }}
            >
              <svg
                width={remotionStageWidth}
                height={stageHeight}
                viewBox={`0 0 ${remotionStageWidth} ${stageHeight}`}
                style={{position: "absolute", inset: 0, overflow: "visible"}}
              >
                <defs>
                  <marker id="arrowBase" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#bfd8ff" />
                  </marker>
                  <marker id="arrowDone" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#1a90ff" />
                  </marker>
                </defs>
              </svg>

              {connectorVisuals.map((visual, index) => {
                const timing = playbackTimeline.steps[index];
                if (!timing) return null;

                const forwardDone = timing.forwardEndFrame !== null && frame >= timing.forwardEndFrame;
                const reverseDone = timing.reverseEndFrame !== null && frame >= timing.reverseEndFrame;
                const forwardAnimating =
                  timing.forwardStartFrame !== null &&
                  timing.forwardEndFrame !== null &&
                  frame >= timing.forwardStartFrame &&
                  frame < timing.forwardEndFrame;
                const reverseAnimating =
                  timing.reverseStartFrame !== null &&
                  timing.reverseEndFrame !== null &&
                  frame >= timing.reverseStartFrame &&
                  frame < timing.reverseEndFrame;

                return (
                  <React.Fragment key={`${visual.connector.from}-${visual.connector.to}`}>
                    {forwardDone || finalHold ? (
                      <svg width={remotionStageWidth} height={stageHeight} style={{position: "absolute", inset: 0, overflow: "visible"}}>
                        <path
                          d={visual.forwardPath}
                          fill="none"
                          stroke="#1a90ff"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          markerEnd="url(#arrowDone)"
                        />
                      </svg>
                    ) : null}
                    {reverseDone || finalHold ? (
                      <svg width={remotionStageWidth} height={stageHeight} style={{position: "absolute", inset: 0, overflow: "visible"}}>
                        <path
                          d={visual.reversePath || ""}
                          fill="none"
                          stroke="#7a5bc2"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeDasharray="5 5 9999"
                          opacity={0.82}
                          markerEnd="url(#arrowBase)"
                        />
                      </svg>
                    ) : null}
                    {forwardAnimating ? (
                      <ArrowFlow
                        pathD={visual.forwardPath}
                        startFrame={timing.forwardStartFrame ?? frame}
                        endFrame={timing.forwardEndFrame ?? frame}
                        stroke="#1a90ff"
                        strokeWidth={2.5}
                        markerId="arrowDone"
                      />
                    ) : null}
                    {reverseAnimating && visual.reversePath ? (
                      <ArrowFlow
                        pathD={visual.reversePath}
                        startFrame={timing.reverseStartFrame ?? frame}
                        endFrame={timing.reverseEndFrame ?? frame}
                        stroke="#7a5bc2"
                        strokeWidth={2.5}
                        dashed
                        opacity={0.82}
                        markerId="arrowBase"
                      />
                    ) : null}

                    {(forwardDone || forwardAnimating || finalHold) ? (
                      <div style={labelStyle(visual.forwardBreak.x, visual.forwardBreak.y, "forward", visual.forwardOffset, forwardAnimating)}>
                        <div style={{fontSize: 9, letterSpacing: 0.4, textTransform: "uppercase", color: "#7a91aa", marginBottom: 3}}>Request</div>
                        <div style={{fontSize: 9, fontWeight: 800, lineHeight: 1.25, color: "#0d5fa8"}}>
                          {playbackViewMode === "business" ? visual.connector.businessReq : visual.connector.technicalReq}
                        </div>
                      </div>
                    ) : null}

                    {(reverseDone || reverseAnimating || finalHold) && visual.reverseBreak ? (
                      <div style={labelStyle(visual.reverseBreak.x, visual.reverseBreak.y, "reverse", visual.reverseOffset, reverseAnimating)}>
                        <div style={{fontSize: 8, letterSpacing: 0.4, textTransform: "uppercase", color: "#7a91aa", marginBottom: 3}}>Response</div>
                        <div style={{fontSize: 8, fontWeight: 800, lineHeight: 1.25, color: "#7a5bc2"}}>
                          {playbackViewMode === "business" ? visual.connector.businessRes : visual.connector.technicalRes}
                        </div>
                      </div>
                    ) : null}
                  </React.Fragment>
                );
              })}

              {visualSteps.map((step, index) => {
                const sourceStep = orderedSteps[index];
                const visible = finalHold || index <= activeStepIndex;
                if (!visible || !sourceStep) return null;

                return (
                  <StepCard
                    key={step.id}
                    step={step}
                    displayTitle={sourceStep[playbackViewMode].title}
                    displaySubtitle={sourceStep[playbackViewMode].subtitle}
                    isActive={index === activeStepIndex}
                    isCompleted={finalHold || index < activeStepIndex}
                  >
                    {renderMicro(step.micro)}
                  </StepCard>
                );
              })}
            </div>
          </div>

          <aside style={{display: "flex", flexDirection: "column", minHeight: 0, height: "100%"}}>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                background: "rgba(255,255,255,.96)",
                border: "1px solid rgba(118,170,230,.22)",
                borderRadius: 22,
                boxShadow: "0 14px 32px rgba(8,40,74,.06)",
                padding: "102px 18px 88px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                position: "relative",
                overflow: "hidden",
              }}
            >
              {logoPath ? (
                <Img
                  src={staticFile(logoPath)}
                  style={{
                    position: "absolute",
                    top: 18,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 108,
                    height: "auto",
                    objectFit: "contain",
                  }}
                />
              ) : null}
              <div style={{fontSize: 12, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: "#1184db"}}>
                {currentStep[playbackViewMode].kicker}
              </div>
              <div style={{fontSize: 22, lineHeight: 1.12, fontWeight: 900, color: "#09284b"}}>
                {currentStep[playbackViewMode].title}
              </div>
              <div style={{fontSize: 15, lineHeight: 1.5, color: "#5e7793"}}>
                {currentStep[playbackViewMode].copy}
              </div>
              <div style={{display: "flex", flexWrap: "wrap", gap: 8}}>
                {currentStep.tags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      padding: "7px 10px",
                      borderRadius: 999,
                      background: "#edf5ff",
                      color: "#0d5fa8",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 20,
                  color: "#5e7793",
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              >
                {currentStep[playbackViewMode].bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </AbsoluteFill>
  );
};
