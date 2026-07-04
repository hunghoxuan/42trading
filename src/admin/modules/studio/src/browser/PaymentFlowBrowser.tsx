import React, {useEffect, useMemo, useRef, useState} from "react";
import type {FlowConnector, FlowStep, PaymentFlowDocument} from "../data/payment-flow";
import {PAYMENT_FLOW} from "../data/payment-flow";
import {estimateNarrationMs, getPlaybackConfig, type PlaybackViewMode} from "../data/playback";
import {
  buildStepBoxes,
  computeLayout,
  getConnectorBreakPoint,
  getConnectorLaneOffset,
  hasReverseLane,
  pathForConnector,
} from "../shared/flow-engine";
import {flowFonts, flowTheme} from "../shared/theme";
import {ConnectorLabel, FlowStepCard, IconCircleButton} from "../shared/ui";

type StepBox = {x: number; y: number; w: number; h: number};

type ConnectorAnim = {
  index: number;
  direction: "forward" | "reverse";
  progress: number;
};

type SlideLike = {
  id: string;
  meta?: {
    eyebrow?: string;
    title?: string;
    subtitle?: string;
  };
  steps?: FlowStep[];
  connectors?: FlowConnector[];
};

type BrowserFlowDocument = PaymentFlowDocument & {
  activeSlideId?: string;
  presentation?: {
    title?: string;
    subtitle?: string;
    logoPath?: string;
  };
  slides?: SlideLike[];
  stepLayouts?: Record<string, {x?: number; y?: number; w?: number; h?: number}>;
};

type PanelMode = "detail" | "json" | "edit";

const shellPaddingX = flowTheme.spacing.shellX;
const shellPaddingTop = flowTheme.spacing.shellTop;
const shellPaddingBottom = flowTheme.spacing.shellBottom;
const floatingBottom = 18;

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

const publicPath = (value: string) => (value.startsWith("/") ? value : `/${value}`);

const orderedStepsFrom = (steps: FlowStep[]) => steps.slice().sort((a, b) => a.order - b.order);

const downloadJsonFile = (flowData: PaymentFlowDocument) => {
  const blob = new Blob([`${JSON.stringify(flowData, null, 2)}\n`], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "payment-flow.json";
  link.click();
  URL.revokeObjectURL(url);
};

const normalizeSlides = (documentData: BrowserFlowDocument) => {
  if (Array.isArray(documentData.slides) && documentData.slides.length > 0) {
    return documentData.slides;
  }

  return [{
    id: "slide-1",
    meta: {
      eyebrow: documentData.meta.eyebrow,
      title: documentData.meta.title,
      subtitle: documentData.meta.subtitle,
    },
    steps: documentData.steps,
    connectors: documentData.connectors,
  }];
};

const toolButtonStyle: React.CSSProperties = {
  cursor: "pointer",
};

const PanelLogo: React.FC<{src: string}> = ({src}) => (
  <>
    {/* eslint-disable-next-line @remotion/warn-native-media-tag */}
    <img
      src={src}
      alt="logo"
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
  </>
);

export const PaymentFlowBrowser: React.FC = () => {
  const [flowData, setFlowData] = useState<BrowserFlowDocument>(PAYMENT_FLOW as BrowserFlowDocument);
  const [current, setCurrent] = useState(0);
  const [viewMode, setViewMode] = useState<PlaybackViewMode>("business");
  const [showAll, setShowAll] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [stageSize, setStageSize] = useState({width: 1200, height: 640});
  const [connectorAnim, setConnectorAnim] = useState<ConnectorAnim | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>("detail");
  const [jsonDraft, setJsonDraft] = useState("");
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const [latestVideoUrl, setLatestVideoUrl] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"save" | "video" | null>(null);
  const [panelMessage, setPanelMessage] = useState<string>("");
  const shellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const playTokenRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/data/payment-flow.json?t=${Date.now()}`, {cache: "no-store"})
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data) {
          setFlowData(data);
          setJsonDraft(JSON.stringify(data, null, 2));
          const nextSlides = normalizeSlides(data);
          setActiveSlideId(data.activeSlideId || nextSlides[0]?.id || "slide-1");
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setJsonDraft(JSON.stringify(flowData, null, 2));
  }, [flowData]);

  useEffect(() => {
    const update = () => {
      const stageEl = stageRef.current;
      const shellEl = shellRef.current;
      if (!stageEl || !shellEl) return;
      setStageSize({
        width: Math.max(360, Math.floor(stageEl.clientWidth)),
        height: Math.max(360, Math.floor(shellEl.clientHeight - shellPaddingTop - shellPaddingBottom)),
      });
    };

    update();
    const observer = new ResizeObserver(update);
    if (stageRef.current) observer.observe(stageRef.current);
    if (shellRef.current) observer.observe(shellRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    window.speechSynthesis?.cancel();
  }, []);

  const slides = useMemo(() => normalizeSlides(flowData), [flowData]);

  useEffect(() => {
    if (!slides.some((slide) => slide.id === activeSlideId)) {
      setActiveSlideId(slides[0]?.id || "slide-1");
    }
  }, [activeSlideId, slides]);

  const activeSlide = useMemo(
    () => slides.find((slide) => slide.id === activeSlideId) || slides[0],
    [activeSlideId, slides],
  );

  const steps = useMemo(
    () => orderedStepsFrom(activeSlide?.steps || flowData.steps),
    [activeSlide, flowData.steps],
  );

  const connectors = useMemo(
    () => activeSlide?.connectors || flowData.connectors,
    [activeSlide, flowData.connectors],
  );

  useEffect(() => {
    setCurrent((value) => Math.min(value, Math.max(0, steps.length - 1)));
  }, [steps.length]);

  const playbackConfig = useMemo(() => getPlaybackConfig(flowData), [flowData]);

  const layout = useMemo(() => computeLayout({
    viewportWidth: window.innerWidth,
    stageWidth: stageSize.width,
    stageAvailableHeight: stageSize.height,
    steps,
    stepLayouts: flowData.stepLayouts || {},
  }), [flowData.stepLayouts, stageSize.height, stageSize.width, steps]);

  const boxes = useMemo(() => buildStepBoxes({
    positions: layout.positions,
    stepLayouts: flowData.stepLayouts || {},
    defaultWidth: layout.cardWidth,
    defaultHeight: layout.cardHeight,
  }) as Record<string, StepBox>, [flowData.stepLayouts, layout.cardHeight, layout.cardWidth, layout.positions]);

  const visuals = useMemo(() => connectors.map((connector) => {
    const forwardPath = pathForConnector({
      connector,
      connectors,
      boxes,
      mobile: layout.mobile,
      direction: "forward",
    });
    const reversePath = hasReverseLane(connector) ? pathForConnector({
      connector,
      connectors,
      boxes,
      mobile: layout.mobile,
      direction: "reverse",
    }) : null;
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
      reverseBreak: reversePath ? getConnectorBreakPoint({
        connector,
        connectors,
        boxes,
        direction: "reverse",
      }) : null,
      forwardOffset: getConnectorLaneOffset({connector, connectors, direction: "forward"}),
      reverseOffset: getConnectorLaneOffset({connector, connectors, direction: "reverse"}),
    };
  }), [boxes, connectors, layout.mobile]);

  const activeStep = steps[current] ?? steps[0];
  const visibleUpTo = showAll ? steps.length - 1 : current;

  const clearTimeoutSafe = () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const stopSpeech = () => {
    window.speechSynthesis?.cancel();
    speechRef.current = null;
  };

  const waitMs = (ms: number) => new Promise<void>((resolve) => {
    clearTimeoutSafe();
    timeoutRef.current = window.setTimeout(() => resolve(), ms);
  });

  const speakStep = (stepIndex: number) => new Promise<void>((resolve) => {
    const step = steps[stepIndex];
    if (!step) {
      resolve();
      return;
    }
    const text = step.narration || step[viewMode].copy;
    const fallbackMs = estimateNarrationMs(text, playbackConfig);
    if (!soundEnabled || !("speechSynthesis" in window) || !text?.trim()) {
      clearTimeoutSafe();
      timeoutRef.current = window.setTimeout(() => resolve(), fallbackMs);
      return;
    }

    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(text);
    speechRef.current = utterance;
    utterance.rate = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });

  const animateConnector = async (index: number, direction: "forward" | "reverse") => {
    const connector = visuals[index];
    const path = direction === "forward" ? connector?.forwardPath : connector?.reversePath;
    if (!path) return;
    const duration = playbackConfig.connectorDurationMs / 1000;
    const start = performance.now();

    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / (duration * 1000));
        setConnectorAnim({index, direction, progress});
        if (progress >= 1) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    setConnectorAnim(null);
  };

  const stopPlayback = () => {
    playTokenRef.current += 1;
    clearTimeoutSafe();
    stopSpeech();
    setPlaying(false);
    setConnectorAnim(null);
  };

  const playFromStart = async () => {
    const token = playTokenRef.current + 1;
    playTokenRef.current = token;
    clearTimeoutSafe();
    stopSpeech();
    setPlaying(true);
    setShowAll(false);
    setViewMode(playbackConfig.initialViewMode);
    setPanelMode("detail");
    setCurrent(0);
    setConnectorAnim(null);

    for (let index = 0; index < steps.length; index += 1) {
      if (playTokenRef.current !== token) return;
      setCurrent(index);
      await speakStep(index);
      if (playTokenRef.current !== token) return;
      if (index < connectors.length) {
        await animateConnector(index, "forward");
        if (playTokenRef.current !== token) return;
        await animateConnector(index, "reverse");
      }
    }

    if (playTokenRef.current !== token) return;
    await waitMs(playbackConfig.finalPauseAfterNarrationMs);
    if (playTokenRef.current !== token) return;
    setViewMode(playbackConfig.finalViewMode);
    setShowAll(true);
    await waitMs(playbackConfig.finalViewHoldMs);
    if (playTokenRef.current !== token) return;
    setPlaying(false);
  };

  const updateFlow = (updater: (currentFlow: BrowserFlowDocument) => BrowserFlowDocument) => {
    setFlowData((currentFlow) => updater(currentFlow));
    setPanelMessage("");
  };

  const updateActiveStep = (updater: (step: FlowStep) => FlowStep) => {
    if (!activeStep) return;
    updateFlow((currentFlow) => {
      const nextFlow = structuredClone(currentFlow) as BrowserFlowDocument;
      if (Array.isArray(nextFlow.slides) && nextFlow.slides.length > 0) {
        const slide = nextFlow.slides.find((item) => item.id === activeSlideId) || nextFlow.slides[0];
        if (!slide?.steps) return nextFlow;
        slide.steps = slide.steps.map((step) => (step.id === activeStep.id ? updater(step) : step));
        return nextFlow;
      }
      nextFlow.steps = nextFlow.steps.map((step) => (step.id === activeStep.id ? updater(step) : step));
      return nextFlow;
    });
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft) as BrowserFlowDocument;
      setFlowData(parsed);
      const nextSlides = normalizeSlides(parsed);
      setActiveSlideId(parsed.activeSlideId || nextSlides[0]?.id || "slide-1");
      setPanelMode("detail");
      setPanelMessage("JSON applied.");
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const saveFlow = async () => {
    setBusyAction("save");
    setPanelMessage("");
    try {
      const response = await fetch("/api/save-flow", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({flowData}),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Save failed");
      }
      setPanelMessage("Saved to payment-flow.json.");
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const renderVideo = async () => {
    setBusyAction("video");
    setPanelMessage("");
    try {
      const response = await fetch("/api/render-video", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({flowData}),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Render failed");
      }
      setLatestVideoUrl(payload.videoUrl);
      setPanelMessage("Video rendered.");
      window.open(payload.videoUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const openLatestVideo = () => {
    if (!latestVideoUrl) {
      void renderVideo();
      return;
    }
    window.open(latestVideoUrl, "_blank", "noopener,noreferrer");
  };

  const panelShellStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    background: flowTheme.colors.panel,
    border: "1px solid rgba(118,170,230,.22)",
    borderRadius: flowTheme.radii.panel,
    boxShadow: flowTheme.shadows.panel,
    padding: "102px 18px 88px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    position: "relative",
    overflow: "hidden",
  };

  const activeContent = activeStep?.[viewMode];
  const logoPath = publicPath(flowData.meta.logoPath);

  return (
    <div
      ref={shellRef}
      style={{
        width: "100vw",
        height: "100vh",
        background:
          "linear-gradient(rgba(223,234,250,1) 1px, transparent 1px) 0 0 / 72px 72px, linear-gradient(90deg, rgba(223,234,250,1) 1px, transparent 1px) 0 0 / 72px 72px, transparent",
        border: "1px solid rgba(118,170,230,.22)",
        boxShadow: flowTheme.shadows.shell,
        overflow: "hidden",
        padding: `${shellPaddingTop}px ${shellPaddingX}px ${shellPaddingBottom}px`,
        display: "flex",
        flexDirection: "column",
        fontFamily: flowFonts.base,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${flowTheme.spacing.rail}px minmax(0, 1fr) ${flowTheme.spacing.sidePanel}px`,
          gap: flowTheme.spacing.gap,
          alignItems: "stretch",
          flex: 1,
          minHeight: 0,
        }}
      >
        <aside style={{display: "flex", flexDirection: "column", gap: 10, height: "100%", padding: "6px 0"}}>
          <div style={{display: "flex", flexDirection: "column", gap: 8}}>
            {slides.map((slide, index) => {
              const active = slide.id === activeSlideId;
              return (
                <button
                  key={slide.id}
                  type="button"
                  title={slide.meta?.title || `Slide ${index + 1}`}
                  onClick={() => {
                    stopPlayback();
                    setActiveSlideId(slide.id);
                    setCurrent(0);
                    setShowAll(true);
                    setPanelMode("detail");
                  }}
                  style={{
                    width: "100%",
                    minHeight: 56,
                    border: active ? "2px solid #235cff" : "1px solid rgba(118,170,230,.24)",
                    borderRadius: 18,
                    background: "rgba(255,255,255,.94)",
                    color: "#0d4f88",
                    boxShadow: flowTheme.shadows.button,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: `linear-gradient(135deg, ${flowTheme.colors.brand1}, ${flowTheme.colors.brand2})`,
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    {index + 1}
                  </div>
                  <div style={{fontSize: 9, lineHeight: 1.15, fontWeight: 700, color: flowTheme.colors.sub}}>
                    Slide
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div style={{display: "flex", flexDirection: "column", minHeight: 0, height: "100%"}}>
          <div
            ref={stageRef}
            style={{
              position: "relative",
              flex: 1,
              minHeight: 0,
              borderRadius: 26,
              background: "linear-gradient(180deg, rgba(255,255,255,.34), rgba(255,255,255,.18))",
              overflow: "hidden",
            }}
          >
            <svg
              width={stageSize.width}
              height={layout.stageHeight}
              viewBox={`0 0 ${stageSize.width} ${layout.stageHeight}`}
              style={{position: "absolute", inset: 0, overflow: "visible"}}
            >
              <defs>
                <marker id="browserArrowBase" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#bfd8ff" />
                </marker>
                <marker id="browserArrowDone" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#1a90ff" />
                </marker>
              </defs>
            </svg>

            {visuals.map((visual, index) => {
              const forwardShown = showAll || index < current;
              const reverseShown = showAll || index < current;
              const forwardAnimating = connectorAnim?.index === index && connectorAnim.direction === "forward";
              const reverseAnimating = connectorAnim?.index === index && connectorAnim.direction === "reverse";
              const forwardLength = getPathLength(visual.forwardPath);
              const reverseLength = visual.reversePath ? getPathLength(visual.reversePath) : 0;
              return (
                <React.Fragment key={`${visual.connector.from}-${visual.connector.to}`}>
                  {forwardShown ? (
                    <svg width={stageSize.width} height={layout.stageHeight} style={{position: "absolute", inset: 0, overflow: "visible"}}>
                      <path
                        d={visual.forwardPath}
                        fill="none"
                        stroke={flowTheme.colors.lineDone}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        markerEnd="url(#browserArrowDone)"
                      />
                    </svg>
                  ) : null}
                  {reverseShown && visual.reversePath ? (
                    <svg width={stageSize.width} height={layout.stageHeight} style={{position: "absolute", inset: 0, overflow: "visible"}}>
                      <path
                        d={visual.reversePath}
                        fill="none"
                        stroke={flowTheme.colors.lineReturn}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray="5 5 9999"
                        opacity={0.82}
                        markerEnd="url(#browserArrowBase)"
                      />
                    </svg>
                  ) : null}
                  {forwardAnimating ? (
                    <svg width={stageSize.width} height={layout.stageHeight} style={{position: "absolute", inset: 0, overflow: "visible"}}>
                      <path
                        d={visual.forwardPath}
                        fill="none"
                        stroke={flowTheme.colors.lineDone}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray={`${forwardLength}`}
                        strokeDashoffset={forwardLength * (1 - (connectorAnim?.progress ?? 0))}
                        markerEnd="url(#browserArrowDone)"
                      />
                    </svg>
                  ) : null}
                  {reverseAnimating && visual.reversePath ? (
                    <svg width={stageSize.width} height={layout.stageHeight} style={{position: "absolute", inset: 0, overflow: "visible"}}>
                      <path
                        d={visual.reversePath}
                        fill="none"
                        stroke={flowTheme.colors.lineReturn}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray={`5 5 ${Math.max(1, reverseLength)}`}
                        strokeDashoffset={reverseLength * (1 - (connectorAnim?.progress ?? 0))}
                        markerEnd="url(#browserArrowBase)"
                      />
                    </svg>
                  ) : null}
                  {(forwardShown || forwardAnimating || showAll) ? (
                    <ConnectorLabel
                      x={visual.forwardBreak.x}
                      y={visual.forwardBreak.y}
                      direction="forward"
                      laneOffset={visual.forwardOffset}
                      text={viewMode === "business" ? visual.connector.businessReq : visual.connector.technicalReq}
                      active={forwardAnimating}
                    />
                  ) : null}
                  {(reverseShown || reverseAnimating || showAll) && visual.reverseBreak ? (
                    <ConnectorLabel
                      x={visual.reverseBreak.x}
                      y={visual.reverseBreak.y}
                      direction="reverse"
                      laneOffset={visual.reverseOffset}
                      text={viewMode === "business" ? visual.connector.businessRes : visual.connector.technicalRes}
                      active={reverseAnimating}
                    />
                  ) : null}
                </React.Fragment>
              );
            })}

            {steps.map((step, index) => {
              const box = boxes[step.id];
              if (!box) return null;
              if (index > visibleUpTo) return null;
              return (
                <FlowStepCard
                  key={step.id}
                  indexLabel={String(step.order)}
                  title={step[viewMode].title}
                  subtitle={step[viewMode].subtitle}
                  isActive={index === current}
                  isCompleted={showAll ? index < steps.length - 1 : index < current}
                  style={{
                    left: box.x,
                    top: box.y,
                    width: box.w,
                    height: box.h,
                    cursor: "pointer",
                  }}
                >
                  <div
                    onClick={() => {
                      stopPlayback();
                      setShowAll(false);
                      setCurrent(index);
                      setPanelMode("detail");
                    }}
                    style={{width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center"}}
                  >
                    <div>{step.icon}</div>
                  </div>
                </FlowStepCard>
              );
            })}
          </div>
        </div>

        <aside style={{display: "flex", flexDirection: "column", minHeight: 0, height: "100%"}}>
          {panelMode === "json" ? (
            <div style={panelShellStyle}>
              <PanelLogo src={logoPath} />
              <div style={{fontSize: 12, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: flowTheme.colors.accentText}}>
                JSON Editor
              </div>
              <textarea
                value={jsonDraft}
                onChange={(event) => setJsonDraft(event.target.value)}
                style={{
                  flex: 1,
                  width: "100%",
                  resize: "none",
                  borderRadius: 18,
                  border: "1px solid rgba(118,170,230,.24)",
                  padding: 14,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: "#123f70",
                  background: "rgba(247,250,255,.96)",
                }}
              />
              <div style={{display: "flex", gap: 10}}>
                <button type="button" onClick={applyJson} style={{flex: 1, height: 42, borderRadius: 14, border: 0, background: "#123f70", color: "#fff", fontWeight: 700, cursor: "pointer"}}>
                  Apply JSON
                </button>
                <button type="button" onClick={() => setPanelMode("detail")} style={{width: 96, height: 42, borderRadius: 14, border: "1px solid rgba(118,170,230,.24)", background: "#fff", color: "#0d4f88", fontWeight: 700, cursor: "pointer"}}>
                  Back
                </button>
              </div>
              {panelMessage ? <div style={{fontSize: 12, color: "#5e7793"}}>{panelMessage}</div> : null}
            </div>
          ) : panelMode === "edit" && activeStep ? (
            <div style={panelShellStyle}>
              <PanelLogo src={logoPath} />
              <div style={{fontSize: 12, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: flowTheme.colors.accentText}}>
                Step Editor
              </div>
              <div style={{display: "flex", flexDirection: "column", gap: 10, overflow: "auto", paddingRight: 2}}>
                <label style={{display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 700, color: "#0d4f88"}}>
                  Title
                  <input
                    value={activeContent?.title || ""}
                    onChange={(event) => updateActiveStep((step) => ({
                      ...step,
                      [viewMode]: {
                        ...step[viewMode],
                        title: event.target.value,
                      },
                    }))}
                    style={{height: 40, borderRadius: 12, border: "1px solid rgba(118,170,230,.24)", padding: "0 12px", fontSize: 14}}
                  />
                </label>
                <label style={{display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 700, color: "#0d4f88"}}>
                  Subtitle
                  <input
                    value={activeContent?.subtitle || ""}
                    onChange={(event) => updateActiveStep((step) => ({
                      ...step,
                      [viewMode]: {
                        ...step[viewMode],
                        subtitle: event.target.value,
                      },
                    }))}
                    style={{height: 40, borderRadius: 12, border: "1px solid rgba(118,170,230,.24)", padding: "0 12px", fontSize: 14}}
                  />
                </label>
                <label style={{display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 700, color: "#0d4f88"}}>
                  Copy
                  <textarea
                    value={activeContent?.copy || ""}
                    onChange={(event) => updateActiveStep((step) => ({
                      ...step,
                      [viewMode]: {
                        ...step[viewMode],
                        copy: event.target.value,
                      },
                    }))}
                    style={{minHeight: 120, borderRadius: 12, border: "1px solid rgba(118,170,230,.24)", padding: 12, fontSize: 14, resize: "vertical"}}
                  />
                </label>
              </div>
              {panelMessage ? <div style={{fontSize: 12, color: "#5e7793"}}>{panelMessage}</div> : null}
            </div>
          ) : (
            <div style={panelShellStyle}>
              <PanelLogo src={logoPath} />
              <div style={{fontSize: 12, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: flowTheme.colors.accentText}}>
                {activeContent?.kicker || flowData.meta.eyebrow}
              </div>
              <div style={{fontSize: 22, lineHeight: 1.12, fontWeight: 900, color: "#09284b"}}>
                {activeContent?.title || flowData.meta.title}
              </div>
              <div style={{fontSize: 15, lineHeight: 1.5, color: "#5e7793"}}>
                {activeContent?.copy || activeSlide?.meta?.subtitle || flowData.meta.subtitle}
              </div>
              <div style={{display: "flex", flexWrap: "wrap", gap: 8}}>
                {(activeStep?.tags || []).map((tag) => (
                  <span
                    key={tag}
                    style={{
                      padding: "7px 10px",
                      borderRadius: flowTheme.radii.round,
                      background: flowTheme.colors.tagBg,
                      color: flowTheme.colors.tagText,
                      fontSize: 12,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <ul style={{margin: 0, paddingLeft: 20, color: "#5e7793", fontSize: 14, lineHeight: 1.5}}>
                {(activeContent?.bullets || []).map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
              {panelMessage ? <div style={{marginTop: "auto", fontSize: 12, color: "#5e7793"}}>{panelMessage}</div> : null}
            </div>
          )}
        </aside>
      </div>

      <div
        style={{
          position: "fixed",
          left: "50%",
          bottom: floatingBottom,
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          zIndex: 99999,
        }}
      >
        <div
          onClick={() => {
            stopPlayback();
            setShowAll(false);
            setCurrent((value) => Math.max(0, value - 1));
            setPanelMode("detail");
          }}
          style={toolButtonStyle}
          title="Previous step"
        >
          <IconCircleButton label="<" />
        </div>
        <div
          onClick={() => {
            stopPlayback();
            setShowAll(false);
            setCurrent((value) => Math.min(steps.length - 1, value + 1));
            setPanelMode("detail");
          }}
          style={toolButtonStyle}
          title="Next step"
        >
          <IconCircleButton label=">" />
        </div>
        <div
          onClick={() => setSoundEnabled((value) => !value)}
          style={toolButtonStyle}
          title={soundEnabled ? "Sound on" : "Sound off"}
        >
          <IconCircleButton label={soundEnabled ? "🔊" : "🔈"} active={soundEnabled} />
        </div>
        <div
          style={{
            width: 58,
            minWidth: 58,
            height: 42,
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid rgba(118,170,230,.24)",
            background: "rgba(255,255,255,.96)",
            color: "#0d4f88",
            boxShadow: flowTheme.shadows.button,
            fontWeight: 700,
            fontSize: 12,
          }}
          title="Playback speed"
        >
          1x
        </div>
        <div
          onClick={() => {
            if (playing) {
              stopPlayback();
              return;
            }
            setCurrent(0);
            void playFromStart();
          }}
          style={toolButtonStyle}
          title={playing ? "Pause playback" : "Play replay mode"}
        >
          <IconCircleButton label={playing ? "❚❚" : "▶"} primary />
        </div>
      </div>

      <div
        style={{
          position: "fixed",
          right: 38,
          bottom: floatingBottom,
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 99999,
        }}
      >
        <div onClick={() => { stopPlayback(); setViewMode("business"); setPanelMode("detail"); }} style={toolButtonStyle} title="Normal mode">
          <IconCircleButton label="👁" active={viewMode === "business"} />
        </div>
        <div onClick={() => { stopPlayback(); setViewMode("technical"); setPanelMode("detail"); }} style={toolButtonStyle} title="Learn mode">
          <IconCircleButton label="?" active={viewMode === "technical"} />
        </div>
        <div onClick={() => setPanelMode("edit")} style={toolButtonStyle} title="Edit active step">
          <IconCircleButton label="✎" active={panelMode === "edit"} />
        </div>
        <div onClick={() => setPanelMode("json")} style={toolButtonStyle} title="Open JSON editor">
          <IconCircleButton label="{ }" active={panelMode === "json"} />
        </div>
        <div onClick={() => void saveFlow()} style={toolButtonStyle} title="Save flow JSON">
          <IconCircleButton label={busyAction === "save" ? "…" : "💾"} />
        </div>
        <div onClick={() => void openLatestVideo()} style={toolButtonStyle} title="Render or open video">
          <IconCircleButton label={busyAction === "video" ? "…" : "🎬"} />
        </div>
        <div onClick={() => downloadJsonFile(flowData)} style={toolButtonStyle} title="Download JSON">
          <IconCircleButton label="⬇" />
        </div>
      </div>
    </div>
  );
};
