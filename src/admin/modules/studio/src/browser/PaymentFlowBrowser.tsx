import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import type {FlowConnector, FlowStep, PaymentFlowDocument} from "../data/payment-flow";
import {PAYMENT_FLOW} from "../data/payment-flow";
import {estimateNarrationMs, getPlaybackConfig, type PlaybackViewMode} from "../data/playback";
import {BrowserMicroIllustration} from "./BrowserMicroIllustration";
import {
  ANCHOR_OPTIONS,
  buildStepBoxes,
  computeLayout,
  getConnectorBreakPoint,
  getConnectorLaneOffset,
  getResolvedAnchors,
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
  title?: string;
  subtitle?: string;
  notes?: string;
  folderName?: string;
  urlBase?: string;
  latestVideo?: {
    fileName?: string;
    url?: string;
    updatedAt?: number;
  } | null;
  meta?: {
    eyebrow?: string;
    title?: string;
    subtitle?: string;
    logoPath?: string;
  };
  steps?: FlowStep[];
  connectors?: FlowConnector[];
  stepLayouts?: Record<string, {x?: number; y?: number; w?: number; h?: number}>;
};

type BrowserFlowDocument = PaymentFlowDocument & {
  session?: StudioSessionMeta;
  activeSlideId?: string;
  presentation?: {
    title?: string;
    subtitle?: string;
    logoPath?: string;
  };
  slides?: SlideLike[];
  stepLayouts?: Record<string, {x?: number; y?: number; w?: number; h?: number}>;
};

type StudioSessionMeta = {
  userId: string;
  sid: string;
  name: string;
};

type StudioProjectSummary = {
  sid: string;
  userId: string;
  name: string;
  title: string;
  subtitle?: string;
  slideCount?: number;
  projectPath?: string;
  updatedAt?: number;
};

type SlideVideoState = {
  sourceUrl: string;
  playbackUrl: string;
  fileName: string;
  renderedAt: number;
};

type PanelMode = "detail" | "json" | "edit" | "video";
type EditTab = "card" | "app";
type DragState = {
  kind: "move" | "resize";
  stepId: string;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originW: number;
  originH: number;
  stageRect: DOMRect;
};
type InlineEditField = "badge" | "title" | "subtitle";

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
const slugify = (value: string, fallback = "studio-session") => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
};
const STORAGE_SESSION_KEY = "studio-session-meta-v1";
const STORAGE_PROJECT_KEY = "studio-project-sid-v1";
const REMOTION_STUDIO_URL = "http://localhost:3004";

const withCacheBust = (value: string, token = Date.now()) => {
  try {
    const nextUrl = new URL(value, window.location.origin);
    nextUrl.searchParams.set("t", String(token));
    return nextUrl.toString();
  } catch {
    const separator = value.includes("?") ? "&" : "?";
    return `${value}${separator}t=${token}`;
  }
};

const fileNameFromUrl = (value: string, fallback = "studio-render.mp4") => {
  try {
    const nextUrl = new URL(value, window.location.origin);
    const segment = nextUrl.pathname.split("/").filter(Boolean).at(-1);
    return segment || fallback;
  } catch {
    const segment = value.split("?")[0]?.split("/").filter(Boolean).at(-1);
    return segment || fallback;
  }
};

const toSlideVideoState = (
  sourceUrl: string,
  fileName?: string | null,
  renderedAt?: number | null,
): SlideVideoState => {
  const resolvedAt = Number.isFinite(renderedAt) ? Number(renderedAt) : Date.now();
  return {
    sourceUrl,
    playbackUrl: withCacheBust(sourceUrl, resolvedAt),
    fileName: fileName || fileNameFromUrl(sourceUrl),
    renderedAt: resolvedAt,
  };
};

const buildSlideVideoMap = (slides: SlideLike[]) => {
  const nextMap: Record<string, SlideVideoState> = {};
  for (const slide of slides) {
    if (!slide?.id || !slide?.latestVideo?.url) continue;
    nextMap[slide.id] = toSlideVideoState(
      slide.latestVideo.url,
      slide.latestVideo.fileName || null,
      slide.latestVideo.updatedAt || null,
    );
  }
  return nextMap;
};

const getStudioUserIdFromBrowser = () => {
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("studio_user_id")?.trim() ||
    window.localStorage.getItem("studio_user_id")?.trim() ||
    "default"
  );
};

const buildStudioSessionMeta = (flowData: BrowserFlowDocument, projectSid?: string | null): StudioSessionMeta => {
  const userId = getStudioUserIdFromBrowser();
  const storedRaw = window.localStorage.getItem(STORAGE_SESSION_KEY);
  let storedSid = "";
  try {
    storedSid = storedRaw ? JSON.parse(storedRaw)?.sid || "" : "";
  } catch {
    storedSid = "";
  }
  const name = slugify(
    flowData.presentation?.title || flowData.meta?.title || "studio-session",
    "studio-session",
  );
  const sid = projectSid || window.localStorage.getItem(STORAGE_PROJECT_KEY)?.trim() || storedSid || `${name}-${Date.now()}`;
  const sessionMeta = {userId, sid, name};
  window.localStorage.setItem("studio_user_id", userId);
  window.localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(sessionMeta));
  window.localStorage.setItem(STORAGE_PROJECT_KEY, sid);
  return sessionMeta;
};

const orderedStepsFrom = (steps: FlowStep[]) => steps.slice().sort((a, b) => a.order - b.order);

const downloadJsonFile = (flowData: PaymentFlowDocument, projectSid?: string | null) => {
  const blob = new Blob([`${JSON.stringify(flowData, null, 2)}\n`], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectSid || "studio-project"}.project.json`;
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
      eyebrow: documentData.meta?.eyebrow || "",
      title: documentData.meta?.title || "",
      subtitle: documentData.meta?.subtitle || "",
    },
    steps: Array.isArray(documentData.steps) ? documentData.steps : [],
    connectors: Array.isArray(documentData.connectors) ? documentData.connectors : [],
  }];
};

const slugifySlide = (input = "") =>
  String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const resolveSlideFromHash = (slides: SlideLike[]) => {
  const raw = (window.location.hash || "").replace(/^#/, "").trim();
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  if (params.has("slide-index")) {
    const index = Number(params.get("slide-index"));
    return Number.isInteger(index) && index > 0 && slides[index - 1] ? slides[index - 1].id : null;
  }
  if (params.has("slide-name")) {
    const target = slugifySlide(decodeURIComponent(params.get("slide-name") || ""));
    return slides.find((slide) => slugifySlide(slide.title || slide.meta?.title || slide.id) === target)?.id || null;
  }
  const directMatch = slides.find((slide) => (
    slide.id === raw || slugifySlide(slide.title || slide.meta?.title || slide.id) === raw
  ));
  if (directMatch) return directMatch.id;
  const shortIndex = Number(raw);
  if (Number.isInteger(shortIndex) && shortIndex > 0 && slides[shortIndex - 1]) {
    return slides[shortIndex - 1].id;
  }
  return null;
};

const resolveProjectSidFromHash = () => {
  const raw = (window.location.hash || "").replace(/^#/, "").trim();
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  return params.get("project-sid")?.trim() || params.get("projectSid")?.trim() || null;
};

const buildSlideHash = (slides: SlideLike[], slideId: string | null, projectSid: string | null) => {
  const slide = slides.find((item) => item.id === slideId) || slides[0];
  if (!slide) return "";
  const index = slides.findIndex((item) => item.id === slide.id);
  const params = new URLSearchParams();
  if (projectSid) params.set("project-sid", projectSid);
  params.set("slide-index", String(Math.max(1, index + 1)));
  params.set("slide-name", slugifySlide(slide.title || slide.meta?.title || slide.id));
  return `#${params.toString()}`;
};

const resolvePreferredSlideId = (
  slides: SlideLike[],
  ...candidates: Array<string | null | undefined>
) => {
  for (const candidate of candidates) {
    if (candidate && slides.some((slide) => slide.id === candidate)) {
      return candidate;
    }
  }
  return slides[0]?.id || "slide-1";
};

const toolButtonStyle: React.CSSProperties = {
  cursor: "pointer",
};

const iconGroupStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  padding: 8,
  borderRadius: 18,
  border: "1px solid rgba(118,170,230,.24)",
  background: "rgba(255,255,255,.96)",
  boxShadow: flowTheme.shadows.button,
};

const videoActionBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  position: "absolute",
  left: 18,
  right: 18,
  bottom: 18,
};

const videoIconButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 999,
  border: "1px solid rgba(118,170,230,.24)",
  background: "#fff",
  color: "#0d4f88",
  boxShadow: flowTheme.shadows.button,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 16,
  fontWeight: 800,
};

const iconButtonResetStyle: React.CSSProperties = {
  border: 0,
  background: "transparent",
  padding: 0,
  margin: 0,
  appearance: "none",
  WebkitAppearance: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
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
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [stageSize, setStageSize] = useState({width: 1200, height: 640});
  const [connectorAnim, setConnectorAnim] = useState<ConnectorAnim | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>("detail");
  const [editTab, setEditTab] = useState<EditTab>("card");
  const [jsonDraft, setJsonDraft] = useState("");
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const [projectSid, setProjectSid] = useState<string | null>(resolveProjectSidFromHash());
  const [projectList, setProjectList] = useState<StudioProjectSummary[]>([]);
  const [selectedConnectorIndex, setSelectedConnectorIndex] = useState<number | null>(null);
  const [latestVideoUrls, setLatestVideoUrls] = useState<Record<string, SlideVideoState>>({});
  const [busyAction, setBusyAction] = useState<"save" | "video" | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [panelMessage, setPanelMessage] = useState<string>("");
  const [inlineEdit, setInlineEdit] = useState<{stepId: string; field: InlineEditField} | null>(null);
  const [infoPanelVisible, setInfoPanelVisible] = useState(true);
  const [renderSizeKey, setRenderSizeKey] = useState<"fhd" | "hd" | "sd">("fhd");
  const [renderQualityKey, setRenderQualityKey] = useState<"high" | "standard" | "draft">("standard");
  const [remotionModalOpen, setRemotionModalOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const playTokenRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const didInitHashRef = useRef(false);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const activeSlideIdRef = useRef<string | null>(activeSlideId);
  const projectSidRef = useRef<string | null>(projectSid);

  useEffect(() => {
    activeSlideIdRef.current = activeSlideId;
  }, [activeSlideId]);

  useEffect(() => {
    projectSidRef.current = projectSid;
  }, [projectSid]);

  const loadProjectData = useCallback(async (requestedProjectSid?: string | null) => {
    const hashProjectSid = requestedProjectSid ?? resolveProjectSidFromHash() ?? projectSidRef.current;
    const query = new URLSearchParams({ t: String(Date.now()) });
    if (hashProjectSid) query.set("projectSid", hashProjectSid);
    const response = await fetch(`/api/studio/flow-data?${query.toString()}`, {cache: "no-store"});
    if (!response.ok) {
      throw new Error("Failed to load studio project");
    }
    const payload = await response.json();
    const nextData = payload?.flowData && typeof payload.flowData === "object"
      ? payload.flowData as BrowserFlowDocument
      : null;
    if (!nextData) {
      throw new Error("Studio project payload missing flowData");
    }
    const nextSlides = normalizeSlides(nextData);
    const nextProjectSid = payload?.sessionMeta?.sid || requestedProjectSid || nextData?.session?.sid || null;
    const nextUserId = payload?.sessionMeta?.userId || getStudioUserIdFromBrowser();
    const hashSlideId = resolveSlideFromHash(nextSlides);
    const nextActiveSlideId = resolvePreferredSlideId(
      nextSlides,
      hashSlideId,
      activeSlideIdRef.current,
      nextData.activeSlideId,
    );
    window.localStorage.setItem("studio_user_id", nextUserId);
    if (nextProjectSid) {
      window.localStorage.setItem(STORAGE_PROJECT_KEY, nextProjectSid);
    }
    setFlowData(nextData);
    setJsonDraft(JSON.stringify(nextData, null, 2));
    setProjectSid(nextProjectSid);
    setProjectList(Array.isArray(payload?.projects) ? payload.projects : []);
    setActiveSlideId(nextActiveSlideId);
    setLatestVideoUrls(buildSlideVideoMap(nextSlides));
    setSelectedConnectorIndex(null);
    setInlineEdit(null);
    return payload;
  }, []);

  useEffect(() => {
    let active = true;
    loadProjectData(resolveProjectSidFromHash())
      .catch(() => fetch(`/data/payment-flow.json?t=${Date.now()}`, {cache: "no-store"}).then((response) => (response.ok ? response.json() : null)))
      .then((payload) => {
        if (!active || !payload || payload.flowData) return;
        const nextData = payload as BrowserFlowDocument | null;
        if (nextData) {
          setFlowData(nextData);
          setJsonDraft(JSON.stringify(nextData, null, 2));
          const nextSlides = normalizeSlides(nextData);
          setActiveSlideId(resolvePreferredSlideId(
            nextSlides,
            resolveSlideFromHash(nextSlides),
            activeSlideId,
            nextData.activeSlideId,
          ));
          setLatestVideoUrls(buildSlideVideoMap(nextSlides));
        }
      })
      .catch((error) => {
        if (active) setPanelMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [loadProjectData]);

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
    if (!slides.length) return;
    if (!didInitHashRef.current) {
      didInitHashRef.current = true;
      const targetSlideId = resolveSlideFromHash(slides);
      const nextSlideId = targetSlideId || activeSlideId || slides[0]?.id || "slide-1";
      if (nextSlideId !== activeSlideId) {
        setActiveSlideId(nextSlideId);
        setCurrent(0);
        setShowAll(true);
      }
      return;
    }

    const hasActiveSlide = !!activeSlideId && slides.some((slide) => slide.id === activeSlideId);
    if (activeSlideId && hasActiveSlide) return;
    if (activeSlideId && !hasActiveSlide && flowData.activeSlideId !== activeSlideId) return;

    const flowActiveSlideId = flowData.activeSlideId;
    const fallbackSlideId =
      (flowActiveSlideId && slides.some((slide) => slide.id === flowActiveSlideId)
        ? flowActiveSlideId
        : null) ||
      slides[0]?.id ||
      "slide-1";
    if (fallbackSlideId !== activeSlideId) {
      setActiveSlideId(fallbackSlideId);
    }
  }, [activeSlideId, flowData.activeSlideId, slides]);

  useEffect(() => {
    if (!slides.length || !activeSlideId) return;
    const nextHash = buildSlideHash(slides, activeSlideId, projectSid);
    if (nextHash && window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }, [activeSlideId, projectSid, slides]);

  useEffect(() => {
    const handleHashChange = () => {
      const targetProjectSid = resolveProjectSidFromHash();
      if (targetProjectSid && targetProjectSid !== projectSid) {
        stopPlayback();
        void loadProjectData(targetProjectSid).catch((error) => {
          setPanelMessage(error instanceof Error ? error.message : String(error));
        });
        return;
      }
      const targetSlideId = resolveSlideFromHash(slides);
      if (!targetSlideId || targetSlideId === activeSlideId) return;
      stopPlayback();
      setActiveSlideId(targetSlideId);
      setCurrent(0);
      setShowAll(true);
      setSelectedConnectorIndex(null);
      setPanelMode("detail");
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [activeSlideId, loadProjectData, projectSid, slides]);

  const activeSlide = useMemo(() => {
    const selectedSlide =
      (activeSlideId ? slides.find((slide) => slide.id === activeSlideId) : null) ||
      (flowData.activeSlideId ? slides.find((slide) => slide.id === flowData.activeSlideId) : null) ||
      slides[0];
    return selectedSlide;
  }, [activeSlideId, flowData.activeSlideId, slides]);

  const activeStepLayouts = useMemo(
    () => activeSlide?.stepLayouts || flowData.stepLayouts || {},
    [activeSlide, flowData.stepLayouts],
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stopPlayback();
        setShowAll(false);
        setCurrent((value) => Math.max(0, value - 1));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        stopPlayback();
        setShowAll(false);
        setCurrent((value) => Math.min(steps.length - 1, value + 1));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (playing) {
          stopPlayback();
        } else {
          stopPlayback();
          setShowAll(false);
          setCurrent((value) => Math.min(steps.length - 1, value + 1));
        }
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        if (playing) {
          stopPlayback();
        } else {
          setCurrent(0);
          void playFromStart();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playing, steps.length]);

  useEffect(() => {
    if (selectedConnectorIndex === null) return;
    if (selectedConnectorIndex > connectors.length - 1) {
      setSelectedConnectorIndex(connectors.length ? connectors.length - 1 : null);
    }
  }, [connectors.length, selectedConnectorIndex]);

  const playbackConfig = useMemo(() => getPlaybackConfig(flowData), [flowData]);

  const layout = useMemo(() => computeLayout({
    viewportWidth: window.innerWidth,
    stageWidth: stageSize.width,
    stageAvailableHeight: stageSize.height,
    steps,
    stepLayouts: activeStepLayouts,
  }), [activeStepLayouts, stageSize.height, stageSize.width, steps]);

  const boxes = useMemo(() => buildStepBoxes({
    positions: layout.positions,
    stepLayouts: activeStepLayouts,
    defaultWidth: layout.cardWidth,
    defaultHeight: layout.cardHeight,
  }) as Record<string, StepBox>, [activeStepLayouts, layout.cardHeight, layout.cardWidth, layout.positions]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      updateFlow((currentFlow) => {
        const nextFlow = structuredClone(currentFlow) as BrowserFlowDocument;
        const nextSlides = normalizeSlides(nextFlow);
        const slide = nextSlides.find((item) => item.id === activeSlideId) || nextSlides[0];
        if (!slide) return nextFlow;
        slide.stepLayouts = slide.stepLayouts || {};
        const activeLayout = slide.stepLayouts[dragState.stepId] || {};
        const defaultBox = boxes[dragState.stepId] || {
          x: dragState.originX,
          y: dragState.originY,
          w: dragState.originW,
          h: dragState.originH,
        };

        if (dragState.kind === "resize") {
          const nextW = dragState.originW + (event.clientX - dragState.startX);
          const nextH = dragState.originH + (event.clientY - dragState.startY);
          activeLayout.w = Math.max(120, Math.round(nextW));
          activeLayout.h = Math.max(120, Math.round(nextH));
        } else {
          const nextX = dragState.originX + (event.clientX - dragState.startX);
          const nextY = dragState.originY + (event.clientY - dragState.startY);
          activeLayout.x = Math.max(8, Math.min(dragState.stageRect.width - defaultBox.w - 8, Math.round(nextX)));
          activeLayout.y = Math.max(8, Math.min(layout.stageHeight - defaultBox.h - 8, Math.round(nextY)));
        }

        slide.stepLayouts[dragState.stepId] = activeLayout;
        nextFlow.stepLayouts = {...(slide.stepLayouts || {})};
        return nextFlow;
      });
    };

    const finishPointerDrag = () => {
      dragStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishPointerDrag);
    window.addEventListener("pointercancel", finishPointerDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishPointerDrag);
      window.removeEventListener("pointercancel", finishPointerDrag);
    };
  }, [activeSlideId, boxes, layout.stageHeight]);

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
  const activeConnector = selectedConnectorIndex !== null ? connectors[selectedConnectorIndex] || null : null;
  const visibleUpTo = showAll ? steps.length - 1 : current;
  const currentSlideVideo = useMemo(() => {
    if (activeSlideId && latestVideoUrls[activeSlideId]) {
      return latestVideoUrls[activeSlideId];
    }
    if (activeSlide?.latestVideo?.url) {
      return toSlideVideoState(
        activeSlide.latestVideo.url,
        activeSlide.latestVideo.fileName || null,
        activeSlide.latestVideo.updatedAt || null,
      );
    }
    return null;
  }, [activeSlide, activeSlideId, latestVideoUrls]);
  const currentSlideVideoUrl = currentSlideVideo?.playbackUrl || null;
  const headerActionsTarget =
    typeof document !== "undefined"
      ? document.getElementById("studio-page-header-actions")
      : null;
  const rightFloatingInset = infoPanelVisible
    ? shellPaddingX + Math.round((flowTheme.spacing.sidePanel - 176) / 2) + 20
    : 38;

  useEffect(() => {
    if (!inlineEdit) return;
    const selector = `[data-step-id="${inlineEdit.stepId}"] [data-inline-field="${inlineEdit.field}"]`;
    const element = stageRef.current?.querySelector(selector) as HTMLElement | null;
    if (!element) return;
    requestAnimationFrame(() => {
      element.focus();
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }, [inlineEdit, current, viewMode]);

  useEffect(() => {
    const videoEl = videoPreviewRef.current;
    if (!videoEl) return;
    videoEl.pause();
    videoEl.currentTime = 0;
    videoEl.load();
  }, [activeSlideId, currentSlideVideoUrl, panelMode]);

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
    timeoutRef.current = window.setTimeout(() => resolve(), Math.max(0, Math.round(ms / playbackSpeed)));
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
      timeoutRef.current = window.setTimeout(() => resolve(), Math.max(0, Math.round(fallbackMs / playbackSpeed)));
      return;
    }

    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(text);
    speechRef.current = utterance;
    utterance.rate = Math.max(0.5, Math.min(2, playbackSpeed));
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });

  const animateConnector = async (index: number, direction: "forward" | "reverse") => {
    const connector = visuals[index];
    const path = direction === "forward" ? connector?.forwardPath : connector?.reversePath;
    if (!path) return;
    const duration = (playbackConfig.connectorDurationMs / playbackSpeed) / 1000;
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
    setShowAll(true);
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
    setSelectedConnectorIndex(null);
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

  const materializeCurrentSlideFlow = useCallback((sourceFlow: BrowserFlowDocument) => {
    if (!activeSlideId) return sourceFlow;
    if (sourceFlow.activeSlideId === activeSlideId) return sourceFlow;
    return {
      ...sourceFlow,
      activeSlideId,
    };
  }, [activeSlideId]);

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

  const updateActiveSlide = (updater: (slide: SlideLike) => SlideLike) => {
    updateFlow((currentFlow) => {
      const nextFlow = structuredClone(currentFlow) as BrowserFlowDocument;
      const nextSlides = normalizeSlides(nextFlow);
      if (Array.isArray(nextFlow.slides) && nextFlow.slides.length > 0) {
        nextFlow.slides = nextSlides.map((slide) => (
          slide.id === activeSlideId ? updater(slide) : slide
        ));
        return nextFlow;
      }
      const nextSlide = updater(nextSlides[0]);
      nextFlow.meta = {
        ...nextFlow.meta,
        eyebrow: nextSlide.meta?.eyebrow || "",
        title: nextSlide.meta?.title || "",
        subtitle: nextSlide.meta?.subtitle || "",
      };
      nextFlow.steps = nextSlide.steps || [];
      nextFlow.connectors = nextSlide.connectors || [];
      nextFlow.stepLayouts = nextSlide.stepLayouts || {};
      return nextFlow;
    });
  };

  const updatePresentation = (patch: Partial<NonNullable<BrowserFlowDocument["presentation"]>>) => {
    updateFlow((currentFlow) => ({
      ...currentFlow,
      presentation: {
        ...(currentFlow.presentation || {}),
        ...patch,
      },
    }));
  };

  const updateActiveSlideMeta = (patch: Partial<NonNullable<SlideLike["meta"]>>) => {
    updateActiveSlide((slide) => ({
      ...slide,
      meta: {
        ...(slide.meta || {}),
        ...patch,
      },
    }));
  };

  const updateActiveStepLayout = (stepId: string, patch: {x?: number; y?: number; w?: number; h?: number}) => {
    updateActiveSlide((slide) => {
      const nextLayouts = {
        ...(slide.stepLayouts || {}),
        [stepId]: {
          ...(slide.stepLayouts?.[stepId] || {}),
          ...patch,
        },
      };
      return {
        ...slide,
        stepLayouts: nextLayouts,
      };
    });
  };

  const updateStepDisplay = (patch: NonNullable<FlowStep["display"]>) => {
    updateActiveStep((step) => ({
      ...step,
      display: {
        ...(step.display || {}),
        ...patch,
      },
    }));
  };

  const updateStepStyle = (patch: NonNullable<FlowStep["style"]>) => {
    updateActiveStep((step) => ({
      ...step,
      style: {
        ...(step.style || {}),
        ...patch,
      },
    }));
  };

  const updateStepMedia = (patch: NonNullable<FlowStep["media"]>) => {
    updateActiveStep((step) => ({
      ...step,
      media: {
        ...(step.media || {}),
        ...patch,
      },
    }));
  };

  const parseCsv = (value: string) =>
    value.split(",").map((item) => item.trim()).filter(Boolean);

  const renumberSteps = (nextSteps: FlowStep[]) => {
    nextSteps.forEach((step, index) => {
      const order = index + 1;
      const businessSuffix = step.business.kicker.split("· ").slice(1).join("· ") || step.business.title;
      const technicalSuffix = step.technical.kicker.split("· ").slice(1).join("· ") || step.technical.title;
      step.order = order;
      step.business.kicker = `Step ${order} · ${businessSuffix}`;
      step.technical.kicker = `Step ${order} · ${technicalSuffix}`;
    });
  };

  const makeDefaultStep = (order: number): FlowStep => ({
    id: `step-${Date.now()}`,
    order,
    icon: "✦",
    micro: "gateway",
    tags: ["New Step"],
    narration: `Step ${order}. Add narration for this step.`,
    business: {
      kicker: `Step ${order} · New Step`,
      title: `New Step ${order}`,
      subtitle: "Edit this subtitle",
      copy: "Describe the business meaning of this step.",
      bullets: ["Add bullet 1", "Add bullet 2", "Add bullet 3"],
    },
    technical: {
      kicker: `Step ${order} · New Step`,
      title: `New Step ${order}`,
      subtitle: "Edit this technical subtitle",
      copy: "Describe the technical meaning of this step.",
      bullets: ["Input: ...", "Output: ...", "API: ..."],
    },
    video: {
      title: `New Step ${order}`,
      subtitle: "Edit video subtitle",
      startFrame: 0,
      endFrame: 0,
      arrowStartFrame: 0,
      arrowEndFrame: 0,
    },
    media: {imageUrl: ""},
    style: {background: "", borderColor: "", badgeColor: ""},
    display: {badge: true, border: true, header: true, content: true, icon: true, imageBackground: false, padding: false},
  });

  const makeConnector = (fromId: string, toId: string): FlowConnector => ({
    from: fromId,
    to: toId,
    anchorMode: "auto",
    businessReq: "New request",
    businessRes: "New response",
    technicalReq: "requestPayload -> service",
    technicalRes: "responsePayload <- service",
    fromAnchor: 6,
    toAnchor: 14,
    returnFromAnchor: 13,
    returnToAnchor: 5,
  });

  const makeDefaultSlide = (index: number): SlideLike => {
    const step = makeDefaultStep(1);
    return {
      id: `slide-${Date.now()}`,
      title: `Slide ${index}`,
      subtitle: "",
      meta: {
        eyebrow: `Slide ${index}`,
        title: `Slide ${index}`,
        subtitle: "",
        logoPath: flowData.presentation?.logoPath || flowData.meta.logoPath,
      },
      steps: [step],
      connectors: [],
      stepLayouts: {
        [step.id]: {x: 24, y: 24, w: 184, h: 215},
      },
    };
  };

  const resetJson = () => {
    const reset = structuredClone(PAYMENT_FLOW as BrowserFlowDocument);
    setFlowData(reset);
    setJsonDraft(JSON.stringify(reset, null, 2));
    const nextSlides = normalizeSlides(reset);
    setActiveSlideId(reset.activeSlideId || nextSlides[0]?.id || "slide-1");
    setSelectedConnectorIndex(null);
    setInlineEdit(null);
    setPanelMessage("JSON reset.");
  };

  const addSlide = () => {
    const nextSlide = makeDefaultSlide(slides.length + 1);
    updateFlow((currentFlow) => {
      const nextFlow = structuredClone(currentFlow) as BrowserFlowDocument;
      const nextSlides = Array.isArray(nextFlow.slides) && nextFlow.slides.length > 0
        ? [...nextFlow.slides]
        : normalizeSlides(nextFlow);
      nextSlides.push(nextSlide);
      nextFlow.slides = nextSlides;
      nextFlow.activeSlideId = nextSlide.id;
      return nextFlow;
    });
    setActiveSlideId(nextSlide.id);
    setSelectedConnectorIndex(null);
    setCurrent(0);
  };

  const duplicateSlide = () => {
    if (!activeSlide) return;
    const cloneId = `slide-${Date.now()}`;
    updateFlow((currentFlow) => {
      const nextFlow = structuredClone(currentFlow) as BrowserFlowDocument;
      const nextSlides = Array.isArray(nextFlow.slides) && nextFlow.slides.length > 0
        ? [...nextFlow.slides]
        : normalizeSlides(nextFlow);
      const clone = structuredClone(activeSlide) as SlideLike;
      clone.id = cloneId;
      clone.title = `${activeSlide.title || activeSlide.meta?.title || "Slide"} Copy`;
      if (clone.meta?.title) clone.meta.title = clone.title;
      nextSlides.push(clone);
      nextFlow.slides = nextSlides;
      nextFlow.activeSlideId = clone.id;
      return nextFlow;
    });
    setActiveSlideId(cloneId);
    setSelectedConnectorIndex(null);
    setCurrent(0);
  };

  const deleteSlide = () => {
    if (!Array.isArray(flowData.slides) || flowData.slides.length <= 1 || !activeSlideId) return;
    updateFlow((currentFlow) => {
      const nextFlow = structuredClone(currentFlow) as BrowserFlowDocument;
      const nextSlides = (nextFlow.slides || []).filter((slide) => slide.id !== activeSlideId);
      nextFlow.slides = nextSlides;
      nextFlow.activeSlideId = nextSlides[0]?.id || null;
      return nextFlow;
    });
    setActiveSlideId((prev) => (prev === activeSlideId ? (slides.find((slide) => slide.id !== activeSlideId)?.id || null) : prev));
    setSelectedConnectorIndex(null);
    setCurrent(0);
  };

  const addStep = () => {
    if (!activeSlide) return;
    updateActiveSlide((slide) => {
      const nextSteps = [...(slide.steps || [])];
      const prevStep = nextSteps.at(-1);
      const nextStep = makeDefaultStep((nextSteps.at(-1)?.order || nextSteps.length) + 1);
      nextSteps.push(nextStep);
      const nextConnectors = [...(slide.connectors || [])];
      if (prevStep) nextConnectors.push(makeConnector(prevStep.id, nextStep.id));
      return {
        ...slide,
        steps: nextSteps,
        connectors: nextConnectors,
        stepLayouts: {
          ...(slide.stepLayouts || {}),
          [nextStep.id]: {
            x: Number.isFinite(prevStep ? (slide.stepLayouts?.[prevStep.id]?.x ?? boxes[prevStep.id]?.x ?? 24) : 24) ? (prevStep ? (slide.stepLayouts?.[prevStep.id]?.x ?? boxes[prevStep.id]?.x ?? 24) : 24) + 36 : 60,
            y: Number.isFinite(prevStep ? (slide.stepLayouts?.[prevStep.id]?.y ?? boxes[prevStep.id]?.y ?? 24) : 24) ? (prevStep ? (slide.stepLayouts?.[prevStep.id]?.y ?? boxes[prevStep.id]?.y ?? 24) : 24) + 36 : 60,
            w: layout.cardWidth,
            h: layout.cardHeight,
          },
        },
      };
    });
    setSelectedConnectorIndex(null);
    setCurrent(steps.length);
  };

  const duplicateCurrentStep = () => {
    if (!activeSlide || !activeStep) return;
    updateActiveSlide((slide) => {
      const nextSteps = structuredClone(slide.steps || []) as FlowStep[];
      const sourceIndex = nextSteps.findIndex((step) => step.id === activeStep.id);
      if (sourceIndex === -1) return slide;
      const clone = structuredClone(nextSteps[sourceIndex]) as FlowStep;
      clone.id = `step-${Date.now()}`;
      nextSteps.splice(sourceIndex + 1, 0, clone);
      renumberSteps(nextSteps);
      const sourceLayout = slide.stepLayouts?.[activeStep.id] || activeLayoutBox;
      return {
        ...slide,
        steps: nextSteps,
        stepLayouts: {
          ...(slide.stepLayouts || {}),
          [clone.id]: {
            x: (Number.isFinite(sourceLayout.x) ? sourceLayout.x : boxes[activeStep.id]?.x ?? 24) + 28,
            y: (Number.isFinite(sourceLayout.y) ? sourceLayout.y : boxes[activeStep.id]?.y ?? 24) + 28,
            w: Number.isFinite(sourceLayout.w) ? sourceLayout.w : layout.cardWidth,
            h: Number.isFinite(sourceLayout.h) ? sourceLayout.h : layout.cardHeight,
          },
        },
      };
    });
    setSelectedConnectorIndex(null);
  };

  const deleteCurrentStep = () => {
    if (!activeSlide || !activeStep || steps.length <= 1) return;
    updateActiveSlide((slide) => {
      const nextSteps = structuredClone(slide.steps || []) as FlowStep[];
      const removedIndex = nextSteps.findIndex((step) => step.id === activeStep.id);
      if (removedIndex === -1) return slide;
      const prevStep = nextSteps[removedIndex - 1] || null;
      const nextStep = nextSteps[removedIndex + 1] || null;
      nextSteps.splice(removedIndex, 1);
      renumberSteps(nextSteps);
      const nextConnectors = (slide.connectors || []).filter((connector) => connector.from !== activeStep.id && connector.to !== activeStep.id);
      if (prevStep && nextStep && !nextConnectors.some((connector) => connector.from === prevStep.id && connector.to === nextStep.id)) {
        nextConnectors.splice(Math.max(0, removedIndex - 1), 0, makeConnector(prevStep.id, nextStep.id));
      }
      const nextLayouts = {...(slide.stepLayouts || {})};
      delete nextLayouts[activeStep.id];
      return {
        ...slide,
        steps: nextSteps,
        connectors: nextConnectors,
        stepLayouts: nextLayouts,
      };
    });
    setSelectedConnectorIndex(null);
    setCurrent((value) => Math.max(0, Math.min(value - 1, steps.length - 2)));
  };

  const addConnector = () => {
    if (!activeSlide || steps.length <= 1) return;
    const fromIndex = Math.max(0, Math.min(current, steps.length - 2));
    const fromStep = steps[fromIndex];
    const toStep = steps[Math.min(fromIndex + 1, steps.length - 1)];
    if (!fromStep || !toStep || fromStep.id === toStep.id) return;
    const existingCount = connectors.filter((connector) => connector.from === fromStep.id && connector.to === toStep.id).length;
    if (existingCount >= 2) return;
    updateActiveSlide((slide) => ({
      ...slide,
      connectors: [...(slide.connectors || []), makeConnector(fromStep.id, toStep.id)],
    }));
    setSelectedConnectorIndex(connectors.length);
  };

  const deleteConnector = () => {
    if (selectedConnectorIndex === null) return;
    updateActiveSlide((slide) => ({
      ...slide,
      connectors: (slide.connectors || []).filter((_, index) => index !== selectedConnectorIndex),
    }));
    setSelectedConnectorIndex(null);
  };

  const updateActiveConnector = (updater: (connector: FlowConnector) => FlowConnector) => {
    if (selectedConnectorIndex === null) return;
    updateActiveSlide((slide) => ({
      ...slide,
      connectors: (slide.connectors || []).map((connector, index) => (
        index === selectedConnectorIndex ? updater(connector) : connector
      )),
    }));
  };

  const beginCardDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    stepId: string,
    kind: "move" | "resize",
  ) => {
    if (panelMode !== "edit") return;
    const stageRect = stageRef.current?.getBoundingClientRect();
    const box = boxes[stepId];
    if (!stageRect || !box) return;
    dragStateRef.current = {
      kind,
      stepId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: box.x,
      originY: box.y,
      originW: box.w,
      originH: box.h,
      stageRect,
    };
    event.preventDefault();
    event.stopPropagation();
  };

  const activeSlideMeta = activeSlide?.meta || {};
  const activeLayoutBox = activeStep ? activeStepLayouts?.[activeStep.id] || {} : {};

  const fieldLabelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    color: "#0d4f88",
  };

  const inputStyle: React.CSSProperties = {
    height: 40,
    borderRadius: 12,
    border: "1px solid rgba(118,170,230,.24)",
    padding: "0 12px",
    fontSize: 14,
  };

  const textAreaStyle: React.CSSProperties = {
    minHeight: 88,
    borderRadius: 12,
    border: "1px solid rgba(118,170,230,.24)",
    padding: 12,
    fontSize: 14,
    resize: "vertical",
  };

  const renderToggleField = (
    label: string,
    checked: boolean,
    onCheckedChange: (value: boolean) => void,
    value: string,
    onValueChange: (value: string) => void,
    placeholder?: string,
  ) => (
    <label style={fieldLabelStyle}>
      <span style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8}}>
        <span>{label}</span>
        <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />
      </span>
      {checked ? (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          style={inputStyle}
        />
      ) : null}
    </label>
  );

  const beginInlineEdit = (stepId: string, field: InlineEditField) => {
    if (panelMode !== "edit") return;
    setInlineEdit({stepId, field});
  };

  const commitInlineEdit = (step: FlowStep, field: InlineEditField, value: string) => {
    const nextValue = value.trim();
    if (field === "badge") {
      const order = Number(nextValue);
      if (Number.isFinite(order) && order > 0) {
        updateActiveStep((currentStep) => currentStep.id === step.id ? {...currentStep, order} : currentStep);
      }
    } else if (field === "title") {
      updateActiveStep((currentStep) => currentStep.id === step.id ? {
        ...currentStep,
        business: {...currentStep.business, title: nextValue || currentStep.business.title},
        technical: {...currentStep.technical, title: nextValue || currentStep.technical.title},
      } : currentStep);
    } else {
      updateActiveStep((currentStep) => currentStep.id === step.id ? {
        ...currentStep,
        [viewMode]: {
          ...currentStep[viewMode],
          subtitle: nextValue,
        },
      } : currentStep);
    }
    setInlineEdit(null);
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft) as BrowserFlowDocument;
      setFlowData(parsed);
      const nextSlides = normalizeSlides(parsed);
      setActiveSlideId(parsed.activeSlideId || nextSlides[0]?.id || "slide-1");
      setSelectedConnectorIndex(null);
      setInlineEdit(null);
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
      const payloadFlow = materializeCurrentSlideFlow(flowData);
      const session = buildStudioSessionMeta(payloadFlow, projectSid);
      const response = await fetch("/api/studio/save-flow", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({flowData: payloadFlow, session}),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Save failed");
      }
      if (Array.isArray(payload.projects)) setProjectList(payload.projects);
      if (payload.sessionMeta?.sid) setProjectSid(payload.sessionMeta.sid);
      setPanelMessage(`Saved ${payload.sessionMeta?.sid || session.sid}.`);
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const renderVideo = async () => {
    if (busyAction === "video") return;
    setBusyAction("video");
    setPanelMessage("");
    try {
      const payloadFlow = materializeCurrentSlideFlow(flowData);
      const session = buildStudioSessionMeta(payloadFlow, projectSid);
      const targetSlideId = activeSlideId || payloadFlow.activeSlideId || normalizeSlides(payloadFlow)[0]?.id || "slide-1";
      const response = await fetch("/api/studio/render-video", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          flowData: payloadFlow,
          session,
          renderOptions: {
            sizeKey: renderSizeKey,
            qualityKey: renderQualityKey,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Render failed");
      }
      if (payload.sessionMeta?.sid) setProjectSid(payload.sessionMeta.sid);
      const responseSlideId = payload.activeSlideId || targetSlideId;
      if (payload.videoUrl) {
        const renderedAt = Date.now();
        setLatestVideoUrls((currentMap) => ({
          ...currentMap,
          [responseSlideId]: toSlideVideoState(
            payload.videoUrl,
            payload.videoFileName || null,
            renderedAt,
          ),
        }));
        setFlowData((currentFlow) => {
          if (!Array.isArray(currentFlow.slides) || currentFlow.slides.length === 0) return currentFlow;
          return {
            ...currentFlow,
            slides: currentFlow.slides.map((slide) => (
              slide.id === responseSlideId
                ? {
                    ...slide,
                    latestVideo: {
                      fileName: payload.videoFileName || fileNameFromUrl(payload.videoUrl),
                      url: payload.videoUrl,
                      updatedAt: renderedAt,
                    },
                  }
                : slide
            )),
          };
        });
      }
      setPanelMessage(`Video rendered v${String(payload.archiveVersion || 1).padStart(3, "0")}.`);
      setPanelMode("video");
      setInfoPanelVisible(true);
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const openLatestVideo = () => {
    setPanelMode("video");
    setInfoPanelVisible(true);
    if (!currentSlideVideoUrl) {
      setPanelMessage("No rendered video found in this slide folder. Click Render Video to create one.");
    } else {
      setPanelMessage("");
    }
  };

  const openCurrentSlideVideo = () => {
    if (!currentSlideVideo) return;
    window.open(currentSlideVideo.playbackUrl, "_blank", "noopener,noreferrer");
  };

  const downloadCurrentSlideVideo = () => {
    if (!currentSlideVideo) return;
    const link = document.createElement("a");
    link.href = currentSlideVideo.sourceUrl;
    link.download = currentSlideVideo.fileName || `studio-render-${renderSizeKey}-${renderQualityKey}.mp4`;
    link.click();
  };

  const buildRemotionStudioUrl = () => {
    const target = new URL(REMOTION_STUDIO_URL);
    if (projectSid) target.searchParams.set("projectSid", projectSid);
    if (activeSlideId) target.searchParams.set("slideId", activeSlideId);
    return target.toString();
  };

  const openRemotionStudio = () => {
    setRemotionModalOpen(true);
  };

  const refreshProjects = useCallback(async () => {
    const response = await fetch(`/api/studio/projects?t=${Date.now()}`, {cache: "no-store"});
    if (!response.ok) throw new Error("Failed to load studio projects");
    const payload = await response.json();
    if (Array.isArray(payload?.projects)) {
      setProjectList(payload.projects);
    }
    return payload;
  }, []);

  useEffect(() => {
    if (!activeSlideId) return;
    if (flowData.activeSlideId === activeSlideId) return;
    setFlowData((currentFlow) => (
      currentFlow.activeSlideId === activeSlideId
        ? currentFlow
        : {
            ...currentFlow,
            activeSlideId,
          }
    ));
  }, [activeSlideId, flowData.activeSlideId]);

  const handleProjectChange = async (nextProjectSid: string) => {
    if (!nextProjectSid || nextProjectSid === projectSid) return;
    setProjectBusy(true);
    setPanelMessage("");
    stopPlayback();
    try {
      await loadProjectData(nextProjectSid);
      setCurrent(0);
      setShowAll(true);
      setPanelMode("detail");
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectBusy(false);
    }
  };

  const handleCreateProject = async () => {
    const title = window.prompt("New project title", "New Studio Project");
    if (!title?.trim()) return;
    setProjectBusy(true);
    setPanelMessage("");
    stopPlayback();
    try {
      const response = await fetch("/api/studio/projects", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({title: title.trim()}),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Create project failed");
      }
      const nextData = payload?.flowData as BrowserFlowDocument | undefined;
      if (nextData) {
        const nextSlides = normalizeSlides(nextData);
        setFlowData(nextData);
        setJsonDraft(JSON.stringify(nextData, null, 2));
        setProjectSid(payload.sessionMeta?.sid || null);
        setProjectList(Array.isArray(payload.projects) ? payload.projects : []);
        setActiveSlideId(nextData.activeSlideId || nextSlides[0]?.id || "slide-1");
        setCurrent(0);
        setShowAll(true);
        setPanelMode("edit");
        setSelectedConnectorIndex(null);
      } else {
        await refreshProjects();
      }
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectBusy(false);
    }
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
  const logoPath = publicPath(flowData.presentation?.logoPath || flowData.meta.logoPath);
  const activeConnectorAnchors = activeConnector
    ? {
        forward: getResolvedAnchors({connector: activeConnector, connectors, boxes, direction: "forward"}),
        reverse: getResolvedAnchors({connector: activeConnector, connectors, boxes, direction: "reverse"}),
      }
    : null;

  return (
    <>
      {headerActionsTarget ? createPortal(
        <div style={{display: "flex", alignItems: "center", gap: 10}}>
          <select
            value={projectSid || ""}
            onChange={(event) => void handleProjectChange(event.target.value)}
            disabled={projectBusy}
            title="Studio project"
            style={{minWidth: 220}}
          >
            {projectList.map((project) => (
              <option key={project.sid} value={project.sid}>
                {project.title || project.sid}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void saveFlow()} title="Save flow JSON">
            {busyAction === "save" ? "…" : "💾"}
          </button>
          <button
            type="button"
            onClick={() => void handleCreateProject()}
            title="Create new project"
          >
            {projectBusy ? "Loading..." : "New"}
          </button>
        </div>,
        headerActionsTarget,
      ) : null}
    <div
      ref={shellRef}
      style={{
        width: "100%",
        height: "100%",
        minHeight: "100%",
        background:
          "radial-gradient(circle at top left, rgba(90,208,255,0.18), transparent 35%), radial-gradient(circle at top right, rgba(0,118,255,0.16), transparent 28%), linear-gradient(180deg, #f6fbff 0%, #eaf5ff 55%, #edf7ff 100%)",
        border: "1px solid rgba(118,170,230,.22)",
        boxShadow: flowTheme.shadows.shell,
        overflow: "hidden",
        padding: `${shellPaddingTop}px ${shellPaddingX}px ${shellPaddingBottom}px`,
        display: "flex",
        flexDirection: "column",
        fontFamily: flowFonts.base,
        position: "relative",
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
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 620,
          height: 620,
          left: -150,
          top: 120,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(53,202,255,0.22), rgba(53,202,255,0.02) 70%, transparent 75%)",
          filter: "blur(10px)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 720,
          height: 720,
          right: -220,
          bottom: -160,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,115,255,0.18), rgba(0,115,255,0.03) 70%, transparent 76%)",
          filter: "blur(14px)",
          pointerEvents: "none",
        }}
      />
      <button
        type="button"
        onClick={() => {
          setInfoPanelVisible((value) => {
            const next = !value;
            if (!next && panelMode === "json") setPanelMode("detail");
            return next;
          });
        }}
        title={infoPanelVisible ? "Hide info panel" : "Show info panel"}
        style={{
          position: "absolute",
          right: 18,
          top: 18,
          width: 42,
          height: 42,
          borderRadius: 999,
          border: "1px solid rgba(118,170,230,.24)",
          background: "rgba(255,255,255,.96)",
          color: "#0d4f88",
          boxShadow: flowTheme.shadows.button,
          zIndex: 100000,
          cursor: "pointer",
          fontWeight: 700,
        }}
      >
        {infoPanelVisible ? "◨" : "◧"}
      </button>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: infoPanelVisible
            ? `${flowTheme.spacing.rail}px minmax(0, 1fr) ${flowTheme.spacing.sidePanel}px`
            : `${flowTheme.spacing.rail}px minmax(0, 1fr) 0px`,
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
                    updateFlow((currentFlow) => (
                      currentFlow.activeSlideId === slide.id
                        ? currentFlow
                        : {
                            ...currentFlow,
                            activeSlideId: slide.id,
                          }
                    ));
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
          {panelMode === "edit" ? (
            <div style={{display: "flex", flexDirection: "column", gap: 8, marginTop: 4}}>
              <div onClick={addSlide} style={toolButtonStyle} title="Add slide"><IconCircleButton label="+" /></div>
              <div onClick={duplicateSlide} style={toolButtonStyle} title="Duplicate slide"><IconCircleButton label="⧉" /></div>
              <div onClick={deleteSlide} style={toolButtonStyle} title="Delete slide"><IconCircleButton label="🗑" /></div>
            </div>
          ) : null}
        </aside>

        <div style={{display: "flex", flexDirection: "column", minHeight: 0, height: "100%"}}>
          <div
            ref={stageRef}
            onClick={(event) => {
              if (event.target === event.currentTarget && panelMode === "edit") {
                setSelectedConnectorIndex(null);
                setInlineEdit(null);
              }
            }}
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
                        stroke="transparent"
                        strokeWidth={18}
                        style={{cursor: panelMode === "edit" ? "pointer" : "default"}}
                        onClick={() => {
                          if (panelMode !== "edit") return;
                          stopPlayback();
                          setSelectedConnectorIndex(index);
                          setPanelMode("edit");
                        }}
                      />
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
                        stroke="transparent"
                        strokeWidth={18}
                        style={{cursor: panelMode === "edit" ? "pointer" : "default"}}
                        onClick={() => {
                          if (panelMode !== "edit") return;
                          stopPlayback();
                          setSelectedConnectorIndex(index);
                          setPanelMode("edit");
                        }}
                      />
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
                      onClick={() => {
                        if (panelMode !== "edit") return;
                        stopPlayback();
                        setSelectedConnectorIndex(index);
                        setPanelMode("edit");
                      }}
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
                      onClick={() => {
                        if (panelMode !== "edit") return;
                        stopPlayback();
                        setSelectedConnectorIndex(index);
                        setPanelMode("edit");
                      }}
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
                  stepId={step.id}
                  indexLabel={String(step.order)}
                  title={step[viewMode].title}
                  subtitle={step[viewMode].subtitle}
                  isActive={index === current}
                  isCompleted={showAll ? index < steps.length - 1 : index < current}
                  background={step.style?.background}
                  borderColor={step.style?.borderColor}
                  badgeBackground={step.style?.badgeColor}
                  textColor={step.style?.textColor}
                  subtitleColor={step.style?.subtitleColor}
                  padding={step.display?.padding === false ? "0" : step.style?.padding}
                  titleSize={step.style?.titleSize}
                  subtitleSize={step.style?.subtitleSize}
                  borderRadius={step.style?.borderRadius}
                  boxShadow={step.style?.boxShadow}
                  titleAlign={step.style?.titleAlign}
                  subtitleAlign={step.style?.subtitleAlign}
                  titleWeight={step.style?.titleWeight}
                  subtitleWeight={step.style?.subtitleWeight}
                  showBadge={step.display?.badge !== false}
                  showBorder={step.display?.border !== false}
                  showHeader={step.display?.header !== false}
                  showContent={step.display?.content !== false}
                  showIcon={step.display?.icon !== false}
                  editable={panelMode === "edit"}
                  badgeContentEditable={inlineEdit?.stepId === step.id && inlineEdit.field === "badge"}
                  titleContentEditable={inlineEdit?.stepId === step.id && inlineEdit.field === "title"}
                  subtitleContentEditable={inlineEdit?.stepId === step.id && inlineEdit.field === "subtitle"}
                  onBadgeDoubleClick={(event) => {
                    event.stopPropagation();
                    beginInlineEdit(step.id, "badge");
                  }}
                  onTitleDoubleClick={(event) => {
                    event.stopPropagation();
                    beginInlineEdit(step.id, "title");
                  }}
                  onSubtitleDoubleClick={(event) => {
                    event.stopPropagation();
                    beginInlineEdit(step.id, "subtitle");
                  }}
                  onBadgeBlur={(event) => commitInlineEdit(step, "badge", event.currentTarget.textContent || "")}
                  onTitleBlur={(event) => commitInlineEdit(step, "title", event.currentTarget.textContent || "")}
                  onSubtitleBlur={(event) => commitInlineEdit(step, "subtitle", event.currentTarget.textContent || "")}
                  onBadgeKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      (event.currentTarget as HTMLDivElement).blur();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setInlineEdit(null);
                    }
                  }}
                  onTitleKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      (event.currentTarget as HTMLDivElement).blur();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setInlineEdit(null);
                    }
                  }}
                  onSubtitleKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      (event.currentTarget as HTMLDivElement).blur();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setInlineEdit(null);
                    }
                  }}
                  backgroundImageUrl={step.media?.imageUrl ? publicPath(step.media.imageUrl) : undefined}
                  imageBackground={step.display?.imageBackground === true}
                  imageFit={step.media?.imageFit}
                  imagePosition={step.media?.imagePosition}
                  onPointerDown={(event) => {
                    beginCardDrag(event, step.id, "move");
                    stopPlayback();
                    setShowAll(false);
                    setCurrent(index);
                    setPanelMode(panelMode === "json" ? "detail" : panelMode);
                  }}
                  onResizePointerDown={(event) => beginCardDrag(event, step.id, "resize")}
                  style={{
                    left: box.x,
                    top: box.y,
                    width: box.w,
                    height: box.h,
                    cursor: panelMode === "edit" ? "grab" : "pointer",
                  }}
                >
                  {step.media?.imageUrl ? (
                    <div
                      onClick={() => {
                        stopPlayback();
                        setShowAll(false);
                        setCurrent(index);
                        setSelectedConnectorIndex(null);
                        setPanelMode((value) => (value === "edit" ? "edit" : "detail"));
                      }}
                      style={{width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center"}}
                    >
                      {/* eslint-disable-next-line @remotion/warn-native-media-tag */}
                      <img
                        src={publicPath(step.media.imageUrl)}
                        alt={step[viewMode].title}
                        style={{
                          maxWidth: "100%",
                          maxHeight: "100%",
                          objectFit: "contain",
                          borderRadius: 12,
                        }}
                      />
                    </div>
                  ) : (
                  <div
                    onClick={() => {
                      stopPlayback();
                      setShowAll(false);
                      setCurrent(index);
                      setSelectedConnectorIndex(null);
                      setPanelMode((value) => (value === "edit" ? "edit" : "detail"));
                    }}
                    style={{width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center"}}
                  >
                    <BrowserMicroIllustration kind={step.micro} fallbackIcon={step.icon} />
                  </div>
                  )}
                </FlowStepCard>
              );
            })}
            {panelMode === "edit" && activeConnector && activeConnectorAnchors ? (
              <>
                {ANCHOR_OPTIONS.map((option) => {
                  const fromBox = boxes[activeConnector.from];
                  const toBox = boxes[activeConnector.to];
                  if (!fromBox || !toBox) return null;
                  const fromPoint = {
                    x: fromBox.x + fromBox.w * ([0,1/3,0.5,2/3,1,1,1,1,1,2/3,0.5,1/3,0,0,0,0][option.value] ?? 0.5),
                    y: fromBox.y + fromBox.h * ([0,0,0,0,0,1/3,0.5,2/3,1,1,1,1,1,2/3,0.5,1/3][option.value] ?? 0.5),
                  };
                  const toPoint = {
                    x: toBox.x + toBox.w * ([0,1/3,0.5,2/3,1,1,1,1,1,2/3,0.5,1/3,0,0,0,0][option.value] ?? 0.5),
                    y: toBox.y + toBox.h * ([0,0,0,0,0,1/3,0.5,2/3,1,1,1,1,1,2/3,0.5,1/3][option.value] ?? 0.5),
                  };
                  return (
                    <React.Fragment key={`anchor-${option.value}`}>
                      <button
                        type="button"
                        title="Click to set source anchor. Alt-click to set return target anchor."
                        onClick={(event) => updateActiveConnector((connector) => ({
                          ...connector,
                          anchorMode: "manual",
                          ...(event.altKey ? {returnToAnchor: option.value} : {fromAnchor: option.value}),
                        }))}
                        style={{
                          position: "absolute",
                          left: fromPoint.x - 6,
                          top: fromPoint.y - 6,
                          width: 12,
                          height: 12,
                          borderRadius: 999,
                          border: option.value === activeConnectorAnchors.forward.fromAnchor ? "2px solid #0b5bd3" : "1px solid rgba(11,91,211,.4)",
                          background: option.value === activeConnectorAnchors.forward.fromAnchor ? "#fff" : "rgba(255,255,255,.9)",
                          zIndex: 12,
                          cursor: "pointer",
                        }}
                      />
                      <button
                        type="button"
                        title="Click to set target anchor. Alt-click to set return source anchor."
                        onClick={(event) => updateActiveConnector((connector) => ({
                          ...connector,
                          anchorMode: "manual",
                          ...(event.altKey ? {returnFromAnchor: option.value} : {toAnchor: option.value}),
                        }))}
                        style={{
                          position: "absolute",
                          left: toPoint.x - 6,
                          top: toPoint.y - 6,
                          width: 12,
                          height: 12,
                          borderRadius: 999,
                          border: option.value === activeConnectorAnchors.forward.toAnchor ? "2px solid #5b34ea" : "1px solid rgba(91,52,234,.4)",
                          background: option.value === activeConnectorAnchors.forward.toAnchor ? "#fff" : "rgba(255,255,255,.9)",
                          zIndex: 12,
                          cursor: "pointer",
                        }}
                      />
                    </React.Fragment>
                  );
                })}
              </>
            ) : null}
          </div>
        </div>

        <aside style={{display: infoPanelVisible ? "flex" : "none", flexDirection: "column", minHeight: 0, height: "100%"}}>
          {panelMode === "video" ? (
            <div style={panelShellStyle}>
              <PanelLogo src={logoPath} />
              <div style={{fontSize: 12, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: flowTheme.colors.accentText}}>
                Video Preview
              </div>
              <div style={{fontSize: 22, lineHeight: 1.12, fontWeight: 900, color: "#09284b"}}>
                Rendered Studio Playback
              </div>
              <div style={{fontSize: 13, lineHeight: 1.5, color: "#5e7793"}}>
                Studio checks the current slide folder for an existing MP4 first. Render is always available to create a new video or re-render this slide.
              </div>
              <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10}}>
                <label style={fieldLabelStyle}>
                  Size
                  <select value={renderSizeKey} onChange={(event) => setRenderSizeKey(event.target.value as "fhd" | "hd" | "sd")} style={inputStyle}>
                    <option value="fhd">1920 × 1080</option>
                    <option value="hd">1280 × 720</option>
                    <option value="sd">960 × 540</option>
                  </select>
                </label>
                <label style={fieldLabelStyle}>
                  Quality
                  <select value={renderQualityKey} onChange={(event) => setRenderQualityKey(event.target.value as "high" | "standard" | "draft")} style={inputStyle}>
                    <option value="high">High</option>
                    <option value="standard">Standard</option>
                    <option value="draft">Draft</option>
                  </select>
                </label>
              </div>
              <div
                style={{
                  flex: 1,
                  minHeight: 220,
                  borderRadius: 18,
                  border: "1px solid rgba(118,170,230,.22)",
                  background: "rgba(247,250,255,.92)",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {currentSlideVideoUrl ? (
                  <video
                    key={`${activeSlideId || "slide"}:${currentSlideVideoUrl}`}
                    ref={videoPreviewRef}
                    controls
                    playsInline
                    preload="metadata"
                    style={{width: "100%", height: "100%", objectFit: "contain", background: "#eaf2ff"}}
                  >
                    <source src={currentSlideVideoUrl} type="video/mp4" />
                  </video>
                ) : (
                  <div style={{padding: 20, textAlign: "center", color: "#5e7793", fontSize: 14, lineHeight: 1.5}}>
                    No rendered video found in this slide folder. Click the render icon to create one.
                  </div>
                )}
              </div>
              <div style={videoActionBarStyle}>
                <button
                  type="button"
                  onClick={() => void renderVideo()}
                  style={{
                    ...iconButtonResetStyle,
                    ...videoIconButtonStyle,
                    border: 0,
                    background: "#123f70",
                    color: "#fff",
                  }}
                  title={currentSlideVideoUrl ? "Re-render current slide video" : "Render current slide video"}
                  aria-label={currentSlideVideoUrl ? "Re-render current slide video" : "Render current slide video"}
                >
                  {busyAction === "video" ? "…" : "↻"}
                </button>
                <button
                  type="button"
                  onClick={openRemotionStudio}
                  style={{...iconButtonResetStyle, ...videoIconButtonStyle}}
                  title="Open Remotion fullscreen"
                  aria-label="Open Remotion fullscreen"
                >
                  ◎
                </button>
                <div style={{display: "inline-flex", alignItems: "center", gap: 10, marginLeft: "auto"}}>
                  {currentSlideVideoUrl ? (
                    <button
                      type="button"
                      onClick={openCurrentSlideVideo}
                      style={{...iconButtonResetStyle, ...videoIconButtonStyle}}
                      title="Open current slide video"
                      aria-label="Open current slide video"
                    >
                      ↗
                    </button>
                  ) : null}
                  {currentSlideVideoUrl ? (
                    <button
                      type="button"
                      onClick={downloadCurrentSlideVideo}
                      style={{...iconButtonResetStyle, ...videoIconButtonStyle}}
                      title="Download current slide video"
                      aria-label="Download current slide video"
                    >
                      ⬇
                    </button>
                  ) : null}
                </div>
              </div>
              {panelMessage ? <div style={{fontSize: 12, color: "#5e7793"}}>{panelMessage}</div> : null}
            </div>
          ) : panelMode === "json" ? (
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
              <div style={videoActionBarStyle}>
                <button type="button" onClick={applyJson} style={iconButtonResetStyle} title="Save JSON" aria-label="Save JSON">
                  <IconCircleButton label="💾" primary />
                </button>
                <button type="button" onClick={() => downloadJsonFile(flowData, projectSid)} style={iconButtonResetStyle} title="Download JSON" aria-label="Download JSON">
                  <IconCircleButton label="⬇" />
                </button>
                <button type="button" onClick={resetJson} style={iconButtonResetStyle} title="Reset JSON" aria-label="Reset JSON">
                  <IconCircleButton label="↺" />
                </button>
              </div>
              {panelMessage ? <div style={{fontSize: 12, color: "#5e7793"}}>{panelMessage}</div> : null}
            </div>
          ) : panelMode === "edit" && activeStep ? (
            <div style={panelShellStyle}>
              <PanelLogo src={logoPath} />
              <div style={{display: "flex", flexDirection: "column", gap: 12, overflow: "auto", paddingRight: 2, paddingBottom: 64}}>
                <div style={{display: "inline-flex", padding: 4, borderRadius: 14, border: "1px solid rgba(118,170,230,.24)", background: "rgba(255,255,255,.92)", gap: 4}}>
                  <button
                    type="button"
                    onClick={() => setEditTab("card")}
                    style={{
                      minWidth: 106,
                      height: 34,
                      borderRadius: 10,
                      border: 0,
                      background: editTab === "card" ? "linear-gradient(135deg, #2ba4ff, #5b34ea)" : "transparent",
                      color: editTab === "card" ? "#fff" : "#0d4f88",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Card Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditTab("app")}
                    style={{
                      minWidth: 126,
                      height: 34,
                      borderRadius: 10,
                      border: 0,
                      background: editTab === "app" ? "linear-gradient(135deg, #2ba4ff, #5b34ea)" : "transparent",
                      color: editTab === "app" ? "#fff" : "#0d4f88",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    App & Slide Edit
                  </button>
                </div>
                {editTab === "card" && activeConnector ? (
                  <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10}}>
                    <div style={{gridColumn: "1 / -1", fontSize: 12, fontWeight: 800, color: "#0d4f88"}}>
                      Connector Editor: {activeConnector.from} → {activeConnector.to}
                    </div>
                    <label style={{...fieldLabelStyle, gridColumn: "1 / -1"}}>
                      Business Request
                      <textarea
                        value={activeConnector.businessReq || ""}
                        onChange={(event) => updateActiveConnector((connector) => ({...connector, businessReq: event.target.value}))}
                        style={textAreaStyle}
                      />
                    </label>
                    <label style={{...fieldLabelStyle, gridColumn: "1 / -1"}}>
                      Business Response
                      <textarea
                        value={activeConnector.businessRes || ""}
                        onChange={(event) => updateActiveConnector((connector) => ({...connector, businessRes: event.target.value}))}
                        style={textAreaStyle}
                      />
                    </label>
                    <label style={{...fieldLabelStyle, gridColumn: "1 / -1"}}>
                      Technical Request
                      <textarea
                        value={activeConnector.technicalReq || ""}
                        onChange={(event) => updateActiveConnector((connector) => ({...connector, technicalReq: event.target.value}))}
                        style={textAreaStyle}
                      />
                    </label>
                    <label style={{...fieldLabelStyle, gridColumn: "1 / -1"}}>
                      Technical Response
                      <textarea
                        value={activeConnector.technicalRes || ""}
                        onChange={(event) => updateActiveConnector((connector) => ({...connector, technicalRes: event.target.value}))}
                        style={textAreaStyle}
                      />
                    </label>
                    {(["fromAnchor", "toAnchor", "returnFromAnchor", "returnToAnchor"] as const).map((field) => {
                      const labels: Record<typeof field, string> = {
                        fromAnchor: "From Anchor",
                        toAnchor: "To Anchor",
                        returnFromAnchor: "Return From",
                        returnToAnchor: "Return To",
                      };
                      const resolved = getResolvedAnchors({connector: activeConnector, connectors, boxes, direction: field.startsWith("return") ? "reverse" : "forward"});
                      const fallback = field === "fromAnchor"
                        ? resolved.fromAnchor
                        : field === "toAnchor"
                          ? resolved.toAnchor
                          : field === "returnFromAnchor"
                            ? getResolvedAnchors({connector: activeConnector, connectors, boxes, direction: "reverse"}).fromAnchor
                            : getResolvedAnchors({connector: activeConnector, connectors, boxes, direction: "reverse"}).toAnchor;
                      return (
                        <label key={field} style={fieldLabelStyle}>
                          {labels[field]}
                          <select
                            value={String(activeConnector[field] ?? fallback ?? 6)}
                            onChange={(event) => updateActiveConnector((connector) => ({
                              ...connector,
                              anchorMode: "manual",
                              [field]: Number(event.target.value),
                            }))}
                            style={inputStyle}
                          >
                            {ANCHOR_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                ) : editTab === "card" ? (
                  <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10}}>
                    {renderToggleField(
                      "Card Index",
                      activeStep.display?.badge !== false,
                      (checked) => updateStepDisplay({badge: checked}),
                      String(activeStep.order || ""),
                      (value) => updateActiveStep((step) => ({...step, order: Math.max(1, Number(value) || step.order)})),
                    )}
                    {renderToggleField(
                      "Border",
                      activeStep.display?.border !== false,
                      (checked) => updateStepDisplay({border: checked}),
                      activeStep.style?.borderColor || "",
                      (value) => updateStepStyle({borderColor: value}),
                    )}
                    {renderToggleField(
                      "Header",
                      activeStep.display?.header !== false,
                      (checked) => updateStepDisplay({header: checked}),
                      activeContent?.title || "",
                      (value) => updateActiveStep((step) => ({
                        ...step,
                        [viewMode]: {...step[viewMode], title: value},
                      })),
                    )}
                    {renderToggleField(
                      "Content",
                      activeStep.display?.content !== false,
                      (checked) => updateStepDisplay({content: checked}),
                      activeContent?.subtitle || "",
                      (value) => updateActiveStep((step) => ({
                        ...step,
                        [viewMode]: {...step[viewMode], subtitle: value},
                      })),
                    )}
                    {renderToggleField(
                      "Icon",
                      activeStep.display?.icon !== false,
                      (checked) => updateStepDisplay({icon: checked}),
                      activeStep.icon || "",
                      (value) => updateActiveStep((step) => ({...step, icon: value})),
                    )}
                    {renderToggleField(
                      "Image Background",
                      activeStep.display?.imageBackground === true,
                      (checked) => updateStepDisplay({imageBackground: checked}),
                      activeStep.media?.imageUrl || "",
                      (value) => updateStepMedia({imageUrl: value}),
                    )}
                    {renderToggleField(
                      "Padding",
                      activeStep.display?.padding === true,
                      (checked) => updateStepDisplay({padding: checked}),
                      activeStep.style?.padding || "",
                      (value) => updateStepStyle({padding: value}),
                      "24px 28px 20px 28px",
                    )}
                    <label style={fieldLabelStyle}>
                      Tags
                      <input
                        value={(activeStep.tags || []).join(", ")}
                        onChange={(event) => updateActiveStep((step) => ({...step, tags: parseCsv(event.target.value)}))}
                        style={inputStyle}
                      />
                    </label>
                    <label style={{...fieldLabelStyle, gridColumn: "1 / -1"}}>
                      Narration
                      <textarea
                        value={activeStep.narration || ""}
                        onChange={(event) => updateActiveStep((step) => ({...step, narration: event.target.value}))}
                        style={textAreaStyle}
                      />
                    </label>
                    <label style={{...fieldLabelStyle, gridColumn: "1 / -1"}}>
                      Business Copy
                      <textarea
                        value={activeStep.business.copy || ""}
                        onChange={(event) => updateActiveStep((step) => ({
                          ...step,
                          business: {...step.business, copy: event.target.value},
                        }))}
                        style={textAreaStyle}
                      />
                    </label>
                    <label style={{...fieldLabelStyle, gridColumn: "1 / -1"}}>
                      Technical Copy
                      <textarea
                        value={activeStep.technical.copy || ""}
                        onChange={(event) => updateActiveStep((step) => ({
                          ...step,
                          technical: {...step.technical, copy: event.target.value},
                        }))}
                        style={textAreaStyle}
                      />
                    </label>
                    <label style={fieldLabelStyle}>
                      Background
                      <input value={activeStep.style?.background || ""} onChange={(event) => updateStepStyle({background: event.target.value})} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Badge Color
                      <input value={activeStep.style?.badgeColor || ""} onChange={(event) => updateStepStyle({badgeColor: event.target.value})} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Title Size
                      <input value={activeStep.style?.titleSize || ""} onChange={(event) => updateStepStyle({titleSize: event.target.value})} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Subtitle Size
                      <input value={activeStep.style?.subtitleSize || ""} onChange={(event) => updateStepStyle({subtitleSize: event.target.value})} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Text Color
                      <input value={activeStep.style?.textColor || ""} onChange={(event) => updateStepStyle({textColor: event.target.value})} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Subtitle Color
                      <input value={activeStep.style?.subtitleColor || ""} onChange={(event) => updateStepStyle({subtitleColor: event.target.value})} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Border Radius
                      <input value={activeStep.style?.borderRadius || ""} onChange={(event) => updateStepStyle({borderRadius: event.target.value})} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Box Shadow
                      <input value={activeStep.style?.boxShadow || ""} onChange={(event) => updateStepStyle({boxShadow: event.target.value})} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Card X
                      <input
                        value={activeLayoutBox.x ?? ""}
                        onChange={(event) => updateActiveStepLayout(activeStep.id, {x: Number(event.target.value) || 0})}
                        style={inputStyle}
                      />
                    </label>
                    <label style={fieldLabelStyle}>
                      Card Y
                      <input
                        value={activeLayoutBox.y ?? ""}
                        onChange={(event) => updateActiveStepLayout(activeStep.id, {y: Number(event.target.value) || 0})}
                        style={inputStyle}
                      />
                    </label>
                    <label style={fieldLabelStyle}>
                      Card Width
                      <input
                        value={activeLayoutBox.w ?? ""}
                        onChange={(event) => updateActiveStepLayout(activeStep.id, {w: Number(event.target.value) || 0})}
                        style={inputStyle}
                      />
                    </label>
                    <label style={fieldLabelStyle}>
                      Card Height
                      <input
                        value={activeLayoutBox.h ?? ""}
                        onChange={(event) => updateActiveStepLayout(activeStep.id, {h: Number(event.target.value) || 0})}
                        style={inputStyle}
                      />
                    </label>
                  </div>
                ) : (
                  <div style={{display: "grid", gridTemplateColumns: "1fr", gap: 10}}>
                    <label style={fieldLabelStyle}>
                      Presentation Title
                      <input value={flowData.presentation?.title || ""} onChange={(event) => updatePresentation({title: event.target.value})} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Presentation Subtitle
                      <input value={flowData.presentation?.subtitle || ""} onChange={(event) => updatePresentation({subtitle: event.target.value})} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Logo Path
                      <input value={flowData.presentation?.logoPath || flowData.meta.logoPath || ""} onChange={(event) => updatePresentation({logoPath: event.target.value})} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Slide Eyebrow
                      <input value={activeSlideMeta.eyebrow || ""} onChange={(event) => updateActiveSlideMeta({eyebrow: event.target.value})} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Slide Title
                      <input value={activeSlide?.title || activeSlideMeta.title || ""} onChange={(event) => updateActiveSlide((slide) => ({...slide, title: event.target.value, meta: {...(slide.meta || {}), title: event.target.value}}))} style={inputStyle} />
                    </label>
                    <label style={fieldLabelStyle}>
                      Slide Subtitle
                      <textarea value={activeSlide?.subtitle || activeSlideMeta.subtitle || ""} onChange={(event) => updateActiveSlide((slide) => ({...slide, subtitle: event.target.value, meta: {...(slide.meta || {}), subtitle: event.target.value}}))} style={textAreaStyle} />
                    </label>
                  </div>
                )}
              </div>
              <div style={videoActionBarStyle}>
                <button type="button" onClick={addStep} style={iconButtonResetStyle} title="Add step" aria-label="Add step">
                  <IconCircleButton label="+" />
                </button>
                <button type="button" onClick={duplicateCurrentStep} style={iconButtonResetStyle} title="Duplicate step" aria-label="Duplicate step">
                  <IconCircleButton label="⧉" />
                </button>
                {steps.length > 1 ? (
                  <button type="button" onClick={deleteCurrentStep} style={iconButtonResetStyle} title="Delete step" aria-label="Delete step">
                    <IconCircleButton label="🗑" />
                  </button>
                ) : null}
                {selectedConnectorIndex === null && steps.length > 1 ? (
                  <button type="button" onClick={addConnector} style={iconButtonResetStyle} title="Add connector" aria-label="Add connector">
                    <IconCircleButton label="⛓" />
                  </button>
                ) : null}
                {selectedConnectorIndex !== null ? (
                  <button type="button" onClick={deleteConnector} style={iconButtonResetStyle} title="Delete selected connector" aria-label="Delete selected connector">
                    <IconCircleButton label="✕" />
                  </button>
                ) : null}
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
            width: 74,
            minWidth: 74,
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
          <select
            value={String(playbackSpeed)}
            onChange={(event) => setPlaybackSpeed(Number(event.target.value) || 1)}
            style={{
              width: "100%",
              height: "100%",
              border: 0,
              background: "transparent",
              color: "#0d4f88",
              textAlign: "center",
              fontWeight: 700,
              outline: "none",
              appearance: "none",
              padding: "0 18px 0 12px",
            }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
              <option key={speed} value={speed}>{speed}x</option>
            ))}
          </select>
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
        <div
          onClick={() => {
            stopPlayback();
            setPanelMode("detail");
            setViewMode((value) => (value === "business" ? "technical" : "business"));
          }}
          style={toolButtonStyle}
          title={viewMode === "business" ? "Switch to learn mode" : "Switch to normal mode"}
        >
          <IconCircleButton label={viewMode === "business" ? "👁" : "?"} active />
        </div>
        <div onClick={() => void openLatestVideo()} style={toolButtonStyle} title="Render or open video preview">
          <IconCircleButton label={busyAction === "video" ? "…" : "🎬"} />
        </div>
      </div>

      <div
        style={{
          position: "fixed",
          right: rightFloatingInset,
          bottom: floatingBottom,
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 99999,
        }}
      >
        <div style={iconGroupStyle}>
          <div
            onClick={() => setPanelMode((value) => (value === "edit" ? "detail" : "edit"))}
            style={toolButtonStyle}
            title={panelMode === "edit" ? "Switch to view mode" : "Switch to edit mode"}
          >
            <IconCircleButton label={panelMode === "edit" ? "👁" : "✎"} active={panelMode === "edit"} />
          </div>
          <div onClick={() => setPanelMode((value) => (value === "json" ? "detail" : "json"))} style={toolButtonStyle} title={panelMode === "json" ? "Close JSON editor" : "Open JSON editor"}>
            <IconCircleButton label="{ }" active={panelMode === "json"} />
          </div>
        </div>
      </div>
    </div>
    {remotionModalOpen && typeof document !== "undefined"
      ? createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(5, 15, 30, 0.78)",
            zIndex: 100001,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 16,
              background: "rgba(255,255,255,.96)",
              boxShadow: flowTheme.shadows.button,
            }}
          >
            <div>
              <div style={{fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: flowTheme.colors.accentText}}>
                Remotion Studio
              </div>
              <div style={{fontSize: 18, fontWeight: 800, color: "#09284b"}}>
                Current Slide Renderer
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRemotionModalOpen(false)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                border: "1px solid rgba(118,170,230,.24)",
                background: "#fff",
                color: "#0d4f88",
                fontWeight: 800,
                cursor: "pointer",
              }}
              aria-label="Close Remotion Studio"
              title="Close"
            >
              x
            </button>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              borderRadius: 20,
              overflow: "hidden",
              background: "#020617",
              boxShadow: "0 18px 48px rgba(0,0,0,.35)",
            }}
          >
            <iframe
              title="Remotion Studio"
              src={buildRemotionStudioUrl()}
              style={{width: "100%", height: "100%", border: "none", background: "#020617"}}
            />
          </div>
        </div>,
        document.body,
      )
      : null}
    </>
  );
};
