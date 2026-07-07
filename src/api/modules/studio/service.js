"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  copyFile,
} = require("fs/promises");

const REPO_ROOT = path.resolve(__dirname, "../../../../");
const ADMIN_ROOT = path.join(REPO_ROOT, "src", "admin");
const ADMIN_PUBLIC_ROOT = path.join(ADMIN_ROOT, "public");
const STUDIO_MODULE_ROOT = path.join(ADMIN_ROOT, "modules", "studio");
const STUDIO_MODULE_PUBLIC_ROOT = path.join(STUDIO_MODULE_ROOT, "public");
const DATA_ROOT = path.join(REPO_ROOT, "data");
const STUDIO_ROOT = path.join(DATA_ROOT, "studio");
const STUDIO_USERS_ROOT = path.join(DATA_ROOT, "users");
const PUBLIC_DATA_ROOT = path.join(ADMIN_PUBLIC_ROOT, "data");
const PUBLIC_USERS_ROOT = path.join(PUBLIC_DATA_ROOT, "users");
const STUDIO_MODULE_PUBLIC_DATA_ROOT = path.join(STUDIO_MODULE_PUBLIC_ROOT, "data");
const MIRROR_FLOW_JSON_PATH = path.join(STUDIO_ROOT, "payment-flow.json");
const PUBLIC_FLOW_JSON_PATH = path.join(PUBLIC_DATA_ROOT, "payment-flow.json");
const STUDIO_MODULE_PUBLIC_FLOW_JSON_PATH = path.join(
  STUDIO_MODULE_PUBLIC_DATA_ROOT,
  "payment-flow.json",
);
const LEGACY_DEMO_ROOT = path.join(STUDIO_USERS_ROOT, "demo-user", "studio");
const DEFAULT_USER_ID = "default";
const DEFAULT_PROJECT_SID = "demo-session-001";
const PROJECT_FILE_NAME = "project.json";
const GENERATED_AUDIO_DIR = path.join(ADMIN_PUBLIC_ROOT, "generated-audio");
const STUDIO_MODULE_GENERATED_AUDIO_DIR = path.join(
  STUDIO_MODULE_PUBLIC_ROOT,
  "generated-audio",
);
const REMOTION_ENTRY = path.join(ADMIN_ROOT, "modules", "studio", "src", "index.ts");
const REMOTION_COMPOSITION_ID = "PaymentFlowVideo";
const NARRATION_VOICE = process.env.PAYMENT_FLOW_TTS_VOICE || "Samantha";
const SIZE_PRESETS = {
  fhd: { label: "Full HD", width: 1920, height: 1080, scale: 1 },
  hd: { label: "HD", width: 1280, height: 720, scale: 2 / 3 },
  sd: { label: "SD", width: 960, height: 540, scale: 0.5 },
};
const QUALITY_PRESETS = {
  high: { label: "High", crf: 18 },
  standard: { label: "Standard", crf: 23 },
  draft: { label: "Draft", crf: 28 },
};

function slugify(value, fallback = "studio-session") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function sanitizeSegment(value, fallback = "anonymous") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

async function findLatestVideoForSlideDir(slideDir, slideUrlBase) {
  const entries = await readdir(slideDir, { withFileTypes: true }).catch(() => []);
  const mp4Files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== ".mp4") continue;
    const filePath = path.join(slideDir, entry.name);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) continue;
    mp4Files.push({
      fileName: entry.name,
      updatedAt: fileStat.mtimeMs || 0,
    });
  }
  mp4Files.sort((a, b) => b.updatedAt - a.updatedAt || b.fileName.localeCompare(a.fileName));
  const latestVideo = mp4Files[0] || null;
  if (!latestVideo) return null;
  return {
    fileName: latestVideo.fileName,
    url: `${slideUrlBase}/${latestVideo.fileName}`,
    updatedAt: latestVideo.updatedAt,
  };
}

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveStudioSession(session = {}, flowData = null) {
  const nameSource =
    session?.name ||
    flowData?.presentation?.title ||
    flowData?.meta?.title ||
    "studio-session";
  const sessionName = slugify(nameSource, "studio-session");
  const userId = sanitizeSegment(
    session?.userId || session?.user_id || DEFAULT_USER_ID,
    DEFAULT_USER_ID,
  );
  const sid = sanitizeSegment(
    session?.sid || session?.sessionId || `${sessionName}-${Date.now()}`,
    `${sessionName}-${Date.now()}`,
  );
  return {
    userId,
    sid,
    name: sessionName,
  };
}

function normalizeSlidesForStorage(flowData = {}) {
  if (Array.isArray(flowData.slides) && flowData.slides.length > 0) {
    return flowData.slides.map((slide, index) => ({
      ...slide,
      id: slide?.id || `slide-${index + 1}`,
      folderName: slide?.folderName || undefined,
      urlBase: slide?.urlBase || undefined,
      latestVideo:
        slide?.latestVideo && typeof slide.latestVideo === "object"
          ? slide.latestVideo
          : null,
      meta: {
        eyebrow: slide?.meta?.eyebrow || slide?.title || `Slide ${index + 1}`,
        title:
          slide?.meta?.title ||
          slide?.title ||
          slide?.steps?.[0]?.business?.title ||
          `Slide ${index + 1}`,
        subtitle: slide?.meta?.subtitle || slide?.subtitle || "",
        logoPath: slide?.meta?.logoPath || flowData?.presentation?.logoPath || flowData?.meta?.logoPath || "",
      },
      title:
        slide?.title ||
        slide?.meta?.title ||
        slide?.steps?.[0]?.business?.title ||
        `Slide ${index + 1}`,
      subtitle: slide?.subtitle || slide?.meta?.subtitle || "",
      notes: slide?.notes || "",
      steps: Array.isArray(slide?.steps) ? slide.steps : [],
      connectors: Array.isArray(slide?.connectors) ? slide.connectors : [],
      stepLayouts: slide?.stepLayouts || {},
    }));
  }

  return [{
    id: flowData.activeSlideId || "slide-1",
    title: flowData.meta?.title || "Slide 1",
    subtitle: flowData.meta?.subtitle || "",
    notes: "",
    folderName: flowData.folderName || undefined,
    urlBase: flowData.urlBase || undefined,
    latestVideo:
      flowData.latestVideo && typeof flowData.latestVideo === "object"
        ? flowData.latestVideo
        : null,
    meta: {
      eyebrow: flowData.meta?.eyebrow || "",
      title: flowData.meta?.title || "Slide 1",
      subtitle: flowData.meta?.subtitle || "",
      logoPath: flowData.presentation?.logoPath || flowData.meta?.logoPath || "",
    },
    steps: Array.isArray(flowData.steps) ? flowData.steps : [],
    connectors: Array.isArray(flowData.connectors) ? flowData.connectors : [],
    stepLayouts: flowData.stepLayouts || {},
  }];
}

function getSlideFolderName(slide, index) {
  const title =
    slide?.meta?.title ||
    slide?.title ||
    slide?.steps?.[0]?.business?.title ||
    `slide-${index + 1}`;
  return `${String(index + 1).padStart(3, "0")}-${slugify(title, `slide-${index + 1}`)}`;
}

function getSessionDirs(sessionMeta) {
  const sessionTail = path.join(
    sessionMeta.userId,
    "studio",
    sessionMeta.sid,
  );
  return {
    dataSessionDir: path.join(STUDIO_USERS_ROOT, sessionTail),
    publicSessionDir: path.join(PUBLIC_USERS_ROOT, sessionTail),
    sessionUrlBase: `/data/users/${sessionTail.replace(/\\/g, "/")}`,
  };
}

function buildProjectDocument(flowData, sessionMeta) {
  const slides = normalizeSlidesForStorage(flowData);
  const activeSlideId = flowData.activeSlideId || slides[0]?.id || "slide-1";
  const activeSlide = slides.find((slide) => slide.id === activeSlideId) || slides[0] || null;
  return {
    version: flowData.version || "1.0.0",
    session: sessionMeta,
    activeSlideId,
    presentation: flowData.presentation || {
      title: flowData.meta?.title || "",
      subtitle: flowData.meta?.subtitle || "",
      logoPath: flowData.meta?.logoPath || "",
    },
    meta: flowData.meta || {},
    controls: flowData.controls || {},
    video: flowData.video || {},
    steps: activeSlide?.steps || [],
    connectors: activeSlide?.connectors || [],
    stepLayouts: activeSlide?.stepLayouts || {},
    slides,
  };
}

function projectNeedsSlideRecovery(documentData = {}) {
  const slides = Array.isArray(documentData.slides) ? documentData.slides : [];
  if (slides.length === 0) return true;
  return !slides.some((slide) => {
    const stepCount = Array.isArray(slide?.steps) ? slide.steps.length : 0;
    const connectorCount = Array.isArray(slide?.connectors) ? slide.connectors.length : 0;
    const layoutCount =
      slide?.stepLayouts && typeof slide.stepLayouts === "object"
        ? Object.keys(slide.stepLayouts).length
        : 0;
    return stepCount > 0 || connectorCount > 0 || layoutCount > 0;
  });
}

async function mirrorFlowDocument(flowData) {
  await ensureDir(path.dirname(MIRROR_FLOW_JSON_PATH));
  await ensureDir(path.dirname(PUBLIC_FLOW_JSON_PATH));
  await ensureDir(path.dirname(STUDIO_MODULE_PUBLIC_FLOW_JSON_PATH));
  await writeJson(MIRROR_FLOW_JSON_PATH, flowData);
  await writeJson(PUBLIC_FLOW_JSON_PATH, flowData);
  await writeJson(STUDIO_MODULE_PUBLIC_FLOW_JSON_PATH, flowData);
}

function projectSummaryFromDocument(documentData, sessionMeta, projectPath) {
  const slides = normalizeSlidesForStorage(documentData);
  const activeSlideId = documentData.activeSlideId || slides[0]?.id || "slide-1";
  const activeSlide = slides.find((slide) => slide.id === activeSlideId) || slides[0] || null;
  return {
    sid: sessionMeta.sid,
    userId: sessionMeta.userId,
    name: sessionMeta.name,
    title:
      documentData.presentation?.title ||
      documentData.meta?.title ||
      activeSlide?.meta?.title ||
      sessionMeta.sid,
    subtitle:
      documentData.presentation?.subtitle ||
      documentData.meta?.subtitle ||
      activeSlide?.meta?.subtitle ||
      "",
    activeSlideId,
    slideCount: slides.length,
    projectPath,
  };
}

async function loadLegacyProjectFromDir(projectDir, sessionMeta) {
  const legacyProjectPath = path.join(projectDir, PROJECT_FILE_NAME);
  const summary = (await pathExists(legacyProjectPath))
    ? await readJsonFile(legacyProjectPath)
    : {};

  const summarySlides = Array.isArray(summary.slides) ? summary.slides : [];
  const slideFoldersFromSummary = summarySlides
    .map((slide) => slide?.folderName)
    .filter(Boolean);
  const dirEntries = await readdir(projectDir, { withFileTypes: true }).catch(() => []);
  const slideFoldersFromDir = dirEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const slideFolders = [...new Set([...slideFoldersFromSummary, ...slideFoldersFromDir])]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const slides = [];
  for (const [index, folderName] of slideFolders.entries()) {
    const slidePath = path.join(projectDir, folderName, "slide.json");
    if (!(await pathExists(slidePath))) continue;
    const slide = await readJsonFile(slidePath);
    slides.push({
      ...slide,
      id: slide?.id || `slide-${index + 1}`,
      title:
        slide?.title ||
        slide?.meta?.title ||
        slide?.steps?.[0]?.business?.title ||
        `Slide ${index + 1}`,
      subtitle: slide?.subtitle || slide?.meta?.subtitle || "",
      notes: slide?.notes || "",
      meta: {
        eyebrow: slide?.meta?.eyebrow || slide?.title || `Slide ${index + 1}`,
        title:
          slide?.meta?.title ||
          slide?.title ||
          slide?.steps?.[0]?.business?.title ||
          `Slide ${index + 1}`,
        subtitle: slide?.meta?.subtitle || slide?.subtitle || "",
        logoPath:
          slide?.meta?.logoPath ||
          summary?.presentation?.logoPath ||
          summary?.meta?.logoPath ||
          "",
      },
      steps: Array.isArray(slide?.steps) ? slide.steps : [],
      connectors: Array.isArray(slide?.connectors) ? slide.connectors : [],
      stepLayouts: slide?.stepLayouts || {},
    });
  }

  if (slides.length === 0) {
    throw new Error(`No slide JSON files found in legacy studio project: ${projectDir}`);
  }

  const activeSlideId = summary?.activeSlideId || slides[0]?.id || "slide-1";
  const activeSlide = slides.find((slide) => slide.id === activeSlideId) || slides[0];
  return {
    version: summary?.version || "1.0.0",
    session: sessionMeta,
    activeSlideId,
    presentation: summary?.presentation || {
      title: summary?.meta?.title || activeSlide?.meta?.title || sessionMeta.name,
      subtitle: summary?.meta?.subtitle || activeSlide?.meta?.subtitle || "",
      logoPath: summary?.meta?.logoPath || activeSlide?.meta?.logoPath || "",
    },
    meta: summary?.meta || {
      eyebrow: activeSlide?.meta?.eyebrow || "",
      title: activeSlide?.meta?.title || "",
      subtitle: activeSlide?.meta?.subtitle || "",
      logoPath: activeSlide?.meta?.logoPath || "",
      legendCompleted: "Completed connection",
      legendHelp: "Hover for quick detail, click a step to pin its description, and switch between business and technical language without changing the flow.",
    },
    controls: summary?.controls || {},
    video: summary?.video || {},
    steps: activeSlide?.steps || [],
    connectors: activeSlide?.connectors || [],
    stepLayouts: activeSlide?.stepLayouts || {},
    slides,
  };
}

async function loadTemplateFlow() {
  if (await pathExists(PUBLIC_FLOW_JSON_PATH)) {
    return await readJsonFile(PUBLIC_FLOW_JSON_PATH);
  }
  if (await pathExists(MIRROR_FLOW_JSON_PATH)) {
    return await readJsonFile(MIRROR_FLOW_JSON_PATH);
  }
  throw new Error("Studio template flow JSON not found");
}

async function persistStudioProject(flowData, sessionMeta) {
  const documentData = buildProjectDocument(flowData, sessionMeta);
  const { dataSessionDir, publicSessionDir, sessionUrlBase } = getSessionDirs(sessionMeta);
  await ensureDir(dataSessionDir);
  await ensureDir(publicSessionDir);

  const slides = normalizeSlidesForStorage(documentData);
  const persistedSlides = [];
  const slideEntries = [];
  for (const [index, slide] of slides.entries()) {
    const folderName = getSlideFolderName(slide, index);
    const dataSlideDir = path.join(dataSessionDir, folderName);
    const publicSlideDir = path.join(publicSessionDir, folderName);
    const urlBase = `${sessionUrlBase}/${folderName}`;
    const latestVideo =
      slide?.latestVideo && typeof slide.latestVideo === "object"
        ? slide.latestVideo
        : await findLatestVideoForSlideDir(dataSlideDir, urlBase);
    const persistedSlide = {
      ...slide,
      index: slide?.index || index + 1,
      folderName,
      urlBase,
      latestVideo,
      jsonFile: "slide.json",
    };
    await ensureDir(dataSlideDir);
    await ensureDir(publicSlideDir);
    await writeJson(path.join(dataSlideDir, "slide.json"), persistedSlide);
    await writeJson(path.join(publicSlideDir, "slide.json"), persistedSlide);
    persistedSlides.push(persistedSlide);
    slideEntries.push({
      id: persistedSlide.id || `slide-${index + 1}`,
      index: index + 1,
      title: persistedSlide?.meta?.title || persistedSlide?.title || `Slide ${index + 1}`,
      folderName,
      urlBase,
      latestVideo,
    });
  }

  const activeSlide =
    persistedSlides.find((slide) => slide.id === documentData.activeSlideId) ||
    persistedSlides[0] ||
    null;
  const persistedDocument = {
    ...documentData,
    activeSlideId: activeSlide?.id || documentData.activeSlideId,
    steps: activeSlide?.steps || [],
    connectors: activeSlide?.connectors || [],
    stepLayouts: activeSlide?.stepLayouts || {},
    slides: persistedSlides,
  };

  const dataProjectPath = path.join(dataSessionDir, PROJECT_FILE_NAME);
  const publicProjectPath = path.join(publicSessionDir, PROJECT_FILE_NAME);
  await writeJson(dataProjectPath, persistedDocument);
  await writeJson(publicProjectPath, persistedDocument);

  return {
    sessionMeta,
    dataSessionDir,
    publicSessionDir,
    dataProjectPath,
    publicProjectPath,
    activeSlide:
      slideEntries.find((slide) => slide.id === persistedDocument.activeSlideId) ||
      slideEntries[0] ||
      null,
    slides: slideEntries,
  };
}

async function ensureProjectDocument(sessionMeta, options = {}) {
  const { dataSessionDir, sessionUrlBase } = getSessionDirs(sessionMeta);
  const projectPath = path.join(dataSessionDir, PROJECT_FILE_NAME);
  if (await pathExists(projectPath)) {
    const projectDocument = await readJsonFile(projectPath);
    if (projectNeedsSlideRecovery(projectDocument)) {
      const recovered = await loadLegacyProjectFromDir(dataSessionDir, sessionMeta).catch(() => null);
      if (recovered) {
        await persistStudioProject(recovered, sessionMeta);
        return recovered;
      }
    }
    const slides = Array.isArray(projectDocument.slides) ? projectDocument.slides : [];
    for (const slide of slides) {
      if (!slide?.folderName) continue;
      const urlBase = slide?.urlBase || `${sessionUrlBase}/${slide.folderName}`;
      slide.urlBase = urlBase;
      const latestVideo = await findLatestVideoForSlideDir(
        path.join(dataSessionDir, slide.folderName),
        urlBase,
      );
      slide.latestVideo = latestVideo;
    }
    return projectDocument;
  }

  const migrated = options.migrateLegacy !== false && (await pathExists(dataSessionDir))
    ? await loadLegacyProjectFromDir(dataSessionDir, sessionMeta).catch(() => null)
    : null;
  if (migrated) {
    await persistStudioProject(migrated, sessionMeta);
    return migrated;
  }

  const template = await loadTemplateFlow();
  const seeded = buildProjectDocument(template, sessionMeta);
  await persistStudioProject(seeded, sessionMeta);
  return seeded;
}

async function ensureDefaultLegacyMigration() {
  const targetMeta = resolveStudioSession({
    userId: DEFAULT_USER_ID,
    sid: DEFAULT_PROJECT_SID,
    name: "payhub-demo",
  });
  const { dataSessionDir } = getSessionDirs(targetMeta);
  const targetProjectPath = path.join(dataSessionDir, PROJECT_FILE_NAME);
  if (await pathExists(targetProjectPath)) return;

  const legacyDemoProjectDir = path.join(LEGACY_DEMO_ROOT, DEFAULT_PROJECT_SID);
  if (await pathExists(legacyDemoProjectDir)) {
    const migrated = await loadLegacyProjectFromDir(legacyDemoProjectDir, targetMeta).catch(() => null);
    if (migrated) {
      await persistStudioProject(migrated, targetMeta);
      return;
    }
  }

  const template = await loadTemplateFlow();
  await persistStudioProject(buildProjectDocument(template, targetMeta), targetMeta);
}

async function listStudioProjects(userId = DEFAULT_USER_ID) {
  await ensureDefaultLegacyMigration();
  const studioDir = path.join(STUDIO_USERS_ROOT, sanitizeSegment(userId, DEFAULT_USER_ID), "studio");
  await ensureDir(studioDir);
  const entries = await readdir(studioDir, { withFileTypes: true }).catch(() => []);

  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionMeta = resolveStudioSession({
      userId,
      sid: entry.name,
      name: entry.name,
    });
    const documentData = await ensureProjectDocument(sessionMeta).catch(() => null);
    if (!documentData) continue;
    const projectPath = path.join(studioDir, entry.name, PROJECT_FILE_NAME);
    const projectStat = await stat(projectPath).catch(() => null);
    projects.push({
      ...projectSummaryFromDocument(documentData, sessionMeta, projectPath),
      updatedAt: projectStat?.mtimeMs || 0,
    });
  }

  if (projects.length === 0) {
    const defaultMeta = resolveStudioSession({
      userId,
      sid: DEFAULT_PROJECT_SID,
      name: "payhub-demo",
    });
    const documentData = await ensureProjectDocument(defaultMeta, { migrateLegacy: true });
    const projectPath = path.join(getSessionDirs(defaultMeta).dataSessionDir, PROJECT_FILE_NAME);
    const projectStat = await stat(projectPath).catch(() => null);
    projects.push({
      ...projectSummaryFromDocument(documentData, defaultMeta, projectPath),
      updatedAt: projectStat?.mtimeMs || 0,
    });
  }

  projects.sort((a, b) => {
    if (a.sid === DEFAULT_PROJECT_SID) return -1;
    if (b.sid === DEFAULT_PROJECT_SID) return 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  return projects;
}

async function loadStudioFlowData({ userId = DEFAULT_USER_ID, sid = null } = {}) {
  const studioUserId = sanitizeSegment(userId, DEFAULT_USER_ID);
  const projects = await listStudioProjects(studioUserId);
  const targetProject = sid
    ? projects.find((project) => project.sid === sid) || null
    : projects[0] || null;
  if (!targetProject) {
    throw new Error("No studio projects found");
  }
  const sessionMeta = resolveStudioSession({
    userId: studioUserId,
    sid: targetProject.sid,
    name: targetProject.name,
  });
  const flowData = await ensureProjectDocument(sessionMeta);
  return {
    flowData,
    sessionMeta,
    projectPath: targetProject.projectPath,
    projects,
  };
}

async function getLatestStudioSlideVideo({ userId = DEFAULT_USER_ID, sid = null, slideId = null } = {}) {
  if (!sid) {
    throw new Error("No studio project selected");
  }
  if (!slideId) {
    throw new Error("No studio slide selected");
  }

  const studioUserId = sanitizeSegment(userId, DEFAULT_USER_ID);
  const sessionMeta = resolveStudioSession({
    userId: studioUserId,
    sid,
    name: sid,
  });
  const projectDocument = await ensureProjectDocument(sessionMeta);
  const slides = Array.isArray(projectDocument.slides) ? projectDocument.slides : [];
  const targetSlide = slides.find((slide) => slide?.id === slideId) || null;
  const folderName = targetSlide?.folderName || null;

  if (!folderName) {
    return {
      ok: true,
      activeSlideId: slideId,
      activeSlideFolder: null,
      videoUrl: null,
      videoFileName: null,
    };
  }

  const { dataSessionDir, sessionUrlBase } = getSessionDirs(sessionMeta);
  const slideDir = path.join(dataSessionDir, folderName);
  const entries = await readdir(slideDir, { withFileTypes: true }).catch(() => []);
  const mp4Files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== ".mp4") continue;
    const filePath = path.join(slideDir, entry.name);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) continue;
    mp4Files.push({
      fileName: entry.name,
      updatedAt: fileStat.mtimeMs || 0,
    });
  }
  mp4Files.sort((a, b) => b.updatedAt - a.updatedAt || b.fileName.localeCompare(a.fileName));
  const latestVideo = mp4Files[0] || null;

  return {
    ok: true,
    activeSlideId: targetSlide?.id || slideId,
    activeSlideFolder: folderName,
    videoUrl: latestVideo ? `${sessionUrlBase}/${folderName}/${latestVideo.fileName}` : null,
    videoFileName: latestVideo?.fileName || null,
  };
}

async function createStudioProject({ userId = DEFAULT_USER_ID, name = "New Studio Project", sid = null, templateFlowData = null } = {}) {
  const studioUserId = sanitizeSegment(userId, DEFAULT_USER_ID);
  const sessionMeta = resolveStudioSession({
    userId: studioUserId,
    sid,
    name,
  }, templateFlowData || { presentation: { title: name }, meta: { title: name } });
  const template = templateFlowData ? structuredClone(templateFlowData) : structuredClone(await loadTemplateFlow());
  template.presentation = {
    ...(template.presentation || {}),
    title: name,
  };
  template.meta = {
    ...(template.meta || {}),
    title: name,
  };
  template.activeSlideId =
    template.activeSlideId ||
    (Array.isArray(template.slides) && template.slides[0]?.id) ||
    "slide-1";
  const flowData = buildProjectDocument(template, sessionMeta);
  const persisted = await persistStudioProject(flowData, sessionMeta);
  return {
    flowData,
    sessionMeta,
    projects: await listStudioProjects(studioUserId),
    projectPath: persisted.dataProjectPath,
  };
}

async function runCommand(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ADMIN_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    const logs = [];
    child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
    child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(logs.join(""));
        return;
      }
      reject(new Error(logs.join("") || `${command} failed with exit code ${code}`));
    });
  });
}

async function getAudioDurationMs(filePath) {
  const output = await runCommand("/usr/bin/afinfo", [filePath], { cwd: REPO_ROOT });
  const match = output.match(/estimated duration:\s+([\d.]+)\s+sec/i);
  if (!match) return null;
  return Math.round(Number(match[1]) * 1000);
}

async function generateNarrationAudio(flowData) {
  await rm(GENERATED_AUDIO_DIR, { recursive: true, force: true });
  await rm(STUDIO_MODULE_GENERATED_AUDIO_DIR, { recursive: true, force: true });
  await ensureDir(GENERATED_AUDIO_DIR);
  await ensureDir(STUDIO_MODULE_GENERATED_AUDIO_DIR);
  const nextFlowData = structuredClone(flowData);
  const writeAudioForStep = async (step) => {
    const narration = step?.narration?.trim?.();
    if (!narration) {
      delete step.audioPath;
      delete step.audioDurationMs;
      return;
    }

    const tempAiffPath = path.join(GENERATED_AUDIO_DIR, `${step.id}.aiff`);
    const finalWavPath = path.join(GENERATED_AUDIO_DIR, `${step.id}.wav`);
    const moduleWavPath = path.join(STUDIO_MODULE_GENERATED_AUDIO_DIR, `${step.id}.wav`);

    await runCommand("/usr/bin/say", ["-v", NARRATION_VOICE, "-o", tempAiffPath, narration], { cwd: REPO_ROOT });
    await runCommand("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16", tempAiffPath, finalWavPath], { cwd: REPO_ROOT });
    await copyFile(finalWavPath, moduleWavPath);

    const durationMs = await getAudioDurationMs(finalWavPath);
    step.audioPath = `generated-audio/${step.id}.wav`;
    if (durationMs) {
      step.audioDurationMs = durationMs;
    }

    await rm(tempAiffPath, { force: true });
  };

  const sortedSteps = (nextFlowData.steps || []).slice().sort((a, b) => a.order - b.order);
  for (const step of sortedSteps) {
    await writeAudioForStep(step);
  }

  const slides = Array.isArray(nextFlowData.slides) ? nextFlowData.slides : [];
  for (const slide of slides) {
    const slideSteps = (slide.steps || []).slice().sort((a, b) => a.order - b.order);
    for (const step of slideSteps) {
      await writeAudioForStep(step);
    }
  }

  return nextFlowData;
}

function normalizeRenderOptions(renderOptions) {
  const sizeKey =
    renderOptions?.sizeKey && SIZE_PRESETS[renderOptions.sizeKey]
      ? renderOptions.sizeKey
      : "fhd";
  const qualityKey =
    renderOptions?.qualityKey && QUALITY_PRESETS[renderOptions.qualityKey]
      ? renderOptions.qualityKey
      : "standard";
  return {
    sizeKey,
    qualityKey,
    size: SIZE_PRESETS[sizeKey],
    quality: QUALITY_PRESETS[qualityKey],
  };
}

async function nextStudioVideoTarget(sessionMeta, activeSlideFolderName) {
  const { dataSessionDir, publicSessionDir, sessionUrlBase } = getSessionDirs(sessionMeta);
  const dataSlideDir = path.join(dataSessionDir, activeSlideFolderName);
  const publicSlideDir = path.join(publicSessionDir, activeSlideFolderName);
  await ensureDir(dataSlideDir);
  await ensureDir(publicSlideDir);
  let version = 1;
  while (true) {
    const fileName = `${sessionMeta.name}-${sessionMeta.sid}-v${String(version).padStart(3, "0")}.mp4`;
    const dataPath = path.join(dataSlideDir, fileName);
    if (!(await pathExists(dataPath))) {
      return {
        version,
        fileName,
        dataPath,
        publicPath: path.join(publicSlideDir, fileName),
        url: `${sessionUrlBase}/${activeSlideFolderName}/${fileName}`,
      };
    }
    version += 1;
  }
}

async function renderStudioVideo(flowData, renderOptions, sessionMeta) {
  const normalizedFlow = buildProjectDocument(flowData, sessionMeta);
  const flowWithNarrationAudio = await generateNarrationAudio(normalizedFlow);
  const persisted = await persistStudioProject(flowWithNarrationAudio, sessionMeta);

  const normalizedOptions = normalizeRenderOptions(renderOptions);
  const activeFolderName = persisted.activeSlide?.folderName || "slide-001";
  const archiveTarget = await nextStudioVideoTarget(sessionMeta, activeFolderName);
  const tempOutDir = path.join(STUDIO_ROOT, "out");
  await ensureDir(tempOutDir);
  const tempOutputPath = path.join(
    tempOutDir,
    `payment-flow-preview-${normalizedOptions.size.width}x${normalizedOptions.size.height}-${normalizedOptions.qualityKey}.mp4`,
  );
  const tempPropsPath = path.join(
    tempOutDir,
    `payment-flow-preview-props-${sessionMeta.sid}-${Date.now()}.json`,
  );
  await writeJson(tempPropsPath, {
    flowData: flowWithNarrationAudio,
  });

  const args = [
    "remotion",
    "render",
    REMOTION_ENTRY,
    REMOTION_COMPOSITION_ID,
    tempOutputPath,
    `--props=${tempPropsPath}`,
    "--width",
    String(normalizedOptions.size.width),
    "--height",
    String(normalizedOptions.size.height),
    "--crf",
    String(normalizedOptions.quality.crf),
  ];

  try {
    await runCommand("npx", args, { cwd: ADMIN_ROOT });
    await ensureDir(path.dirname(archiveTarget.dataPath));
    await ensureDir(path.dirname(archiveTarget.publicPath));
    await copyFile(tempOutputPath, archiveTarget.dataPath);
    await copyFile(tempOutputPath, archiveTarget.publicPath);
  } finally {
    await rm(tempPropsPath, { force: true }).catch(() => undefined);
    await rm(tempOutputPath, { force: true }).catch(() => undefined);
  }

  const refreshedProject = await ensureProjectDocument(sessionMeta);
  const refreshedSlides = Array.isArray(refreshedProject.slides) ? refreshedProject.slides : [];
  const refreshedActiveSlide =
    refreshedSlides.find((slide) => slide?.id === (persisted.activeSlide?.id || normalizedFlow.activeSlideId)) ||
    refreshedSlides[0] ||
    null;

  return {
    ok: true,
    activeSlideId: refreshedActiveSlide?.id || persisted.activeSlide?.id || normalizedFlow.activeSlideId || null,
    activeSlideFolder: activeFolderName,
    videoUrl: archiveTarget.url,
    videoFileName: archiveTarget.fileName,
    archiveVersion: archiveTarget.version,
    sizeKey: normalizedOptions.sizeKey,
    qualityKey: normalizedOptions.qualityKey,
    sizeLabel: `${normalizedOptions.size.width}×${normalizedOptions.size.height}`,
    qualityLabel: normalizedOptions.quality.label,
    sessionMeta,
    projectPath: persisted.dataProjectPath,
  };
}

module.exports = {
  createStudioProject,
  getLatestStudioSlideVideo,
  listStudioProjects,
  loadStudioFlowData,
  resolveStudioSession,
  persistStudioProject,
  renderStudioVideo,
};
