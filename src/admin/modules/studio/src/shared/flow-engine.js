/**
 * Shared playback, layout, and connector routing engine used by both the HTML editor
 * and the Remotion renderer.
 */

export const DEFAULT_PLAYBACK_CONFIG = {
  initialViewMode: "business",
  finalViewMode: "technical",
  narrationWordsPerMinute: 150,
  minNarrationMs: 2200,
  connectorDurationMs: 900,
  finalPauseAfterNarrationMs: 2000,
  finalViewHoldMs: 5000,
};

export const ANCHOR_OPTIONS = [
  {value: 0, label: "Top Left"},
  {value: 1, label: "Top 1/3"},
  {value: 2, label: "Top Center"},
  {value: 3, label: "Top 2/3"},
  {value: 4, label: "Top Right"},
  {value: 5, label: "Right 1/3"},
  {value: 6, label: "Right Center"},
  {value: 7, label: "Right 2/3"},
  {value: 8, label: "Bottom Right"},
  {value: 9, label: "Bottom 2/3"},
  {value: 10, label: "Bottom Center"},
  {value: 11, label: "Bottom 1/3"},
  {value: 12, label: "Bottom Left"},
  {value: 13, label: "Left 2/3"},
  {value: 14, label: "Left Center"},
  {value: 15, label: "Left 1/3"},
];

export const getPlaybackConfig = (documentData) => {
  const playback = documentData?.video?.playback || {};
  return {
    initialViewMode: playback.initialViewMode === "technical" ? "technical" : DEFAULT_PLAYBACK_CONFIG.initialViewMode,
    finalViewMode: playback.finalViewMode === "business" ? "business" : DEFAULT_PLAYBACK_CONFIG.finalViewMode,
    narrationWordsPerMinute:
      typeof playback.narrationWordsPerMinute === "number" && playback.narrationWordsPerMinute > 0
        ? playback.narrationWordsPerMinute
        : DEFAULT_PLAYBACK_CONFIG.narrationWordsPerMinute,
    minNarrationMs:
      typeof playback.minNarrationMs === "number" && playback.minNarrationMs >= 0
        ? playback.minNarrationMs
        : DEFAULT_PLAYBACK_CONFIG.minNarrationMs,
    connectorDurationMs:
      typeof playback.connectorDurationMs === "number" && playback.connectorDurationMs >= 0
        ? playback.connectorDurationMs
        : DEFAULT_PLAYBACK_CONFIG.connectorDurationMs,
    finalPauseAfterNarrationMs:
      typeof playback.finalPauseAfterNarrationMs === "number" && playback.finalPauseAfterNarrationMs >= 0
        ? playback.finalPauseAfterNarrationMs
        : DEFAULT_PLAYBACK_CONFIG.finalPauseAfterNarrationMs,
    finalViewHoldMs:
      typeof playback.finalViewHoldMs === "number" && playback.finalViewHoldMs >= 0
        ? playback.finalViewHoldMs
        : DEFAULT_PLAYBACK_CONFIG.finalViewHoldMs,
  };
};

export const estimateNarrationMs = (text, config = DEFAULT_PLAYBACK_CONFIG) => {
  const trimmed = text?.trim?.() ?? "";
  if (!trimmed) {
    return config.minNarrationMs;
  }
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const duration = Math.round((words / config.narrationWordsPerMinute) * 60000);
  return Math.max(config.minNarrationMs, duration);
};

export const buildPlaybackTimeline = (documentData) => {
  const config = getPlaybackConfig(documentData);
  const fps = documentData.video.fps;
  const steps = documentData.steps.slice().sort((a, b) => a.order - b.order);
  const toFrames = (ms) => Math.max(1, Math.round((ms / 1000) * fps));
  const connectorFrames = toFrames(config.connectorDurationMs);
  const finalPauseFrames = toFrames(config.finalPauseAfterNarrationMs);
  const finalHoldFrames = toFrames(config.finalViewHoldMs);

  let cursor = 0;
  const timelineSteps = steps.map((step, index) => {
    const narrationMs =
      typeof step.audioDurationMs === "number" && step.audioDurationMs > 0
        ? step.audioDurationMs
        : estimateNarrationMs(step.narration, config);
    const narrationFrames = toFrames(narrationMs);
    const narrationStartFrame = cursor;
    const narrationEndFrame = narrationStartFrame + narrationFrames;
    const isLast = index === steps.length - 1;
    const forwardStartFrame = isLast ? null : narrationEndFrame;
    const forwardEndFrame = isLast ? null : narrationEndFrame + connectorFrames;
    const reverseStartFrame = isLast ? null : narrationEndFrame + connectorFrames;
    const reverseEndFrame = isLast ? null : narrationEndFrame + connectorFrames * 2;
    cursor = isLast ? narrationEndFrame : narrationEndFrame + connectorFrames * 2;

    return {
      id: step.id,
      index,
      narrationStartFrame,
      narrationEndFrame,
      forwardStartFrame,
      forwardEndFrame,
      reverseStartFrame,
      reverseEndFrame,
    };
  });

  const lastStep = timelineSteps[timelineSteps.length - 1];
  const learnModeStartFrame = (lastStep?.narrationEndFrame ?? 0) + finalPauseFrames;
  const totalFrames = learnModeStartFrame + finalHoldFrames;

  return {
    config,
    steps: timelineSteps,
    learnModeStartFrame,
    totalFrames,
  };
};

export const anchorRatio = (index = 0) => (
  [
    {x: 0, y: 0},
    {x: 1 / 3, y: 0},
    {x: 0.5, y: 0},
    {x: 2 / 3, y: 0},
    {x: 1, y: 0},
    {x: 1, y: 1 / 3},
    {x: 1, y: 0.5},
    {x: 1, y: 2 / 3},
    {x: 1, y: 1},
    {x: 2 / 3, y: 1},
    {x: 0.5, y: 1},
    {x: 1 / 3, y: 1},
    {x: 0, y: 1},
    {x: 0, y: 2 / 3},
    {x: 0, y: 0.5},
    {x: 0, y: 1 / 3},
  ][index] || {x: 0.5, y: 0.5}
);

export const anchorDescriptor = (index = 0) => (
  [
    {side: "top", offset: 0},
    {side: "top", offset: 1 / 3},
    {side: "top", offset: 0.5},
    {side: "top", offset: 2 / 3},
    {side: "top", offset: 1},
    {side: "right", offset: 1 / 3},
    {side: "right", offset: 0.5},
    {side: "right", offset: 2 / 3},
    {side: "bottom", offset: 1},
    {side: "bottom", offset: 2 / 3},
    {side: "bottom", offset: 0.5},
    {side: "bottom", offset: 1 / 3},
    {side: "bottom", offset: 0},
    {side: "left", offset: 2 / 3},
    {side: "left", offset: 0.5},
    {side: "left", offset: 1 / 3},
  ][index] || {side: "center", offset: 0.5}
);

export const quantizeEdgeOffset = (raw = 0.5) => {
  const options = [1 / 3, 0.5, 2 / 3];
  return options.reduce((best, current) => (
    Math.abs(current - raw) < Math.abs(best - raw) ? current : best
  ), options[1]);
};

export const anchorIndexFor = (side, offset = 0.5) => {
  const normalizedOffset = quantizeEdgeOffset(offset);
  if (side === "top") {
    if (normalizedOffset === 1 / 3) return 1;
    if (normalizedOffset === 0.5) return 2;
    return 3;
  }
  if (side === "right") {
    if (normalizedOffset === 1 / 3) return 5;
    if (normalizedOffset === 0.5) return 6;
    return 7;
  }
  if (side === "bottom") {
    if (normalizedOffset === 1 / 3) return 11;
    if (normalizedOffset === 0.5) return 10;
    return 9;
  }
  if (side === "left") {
    if (normalizedOffset === 1 / 3) return 15;
    if (normalizedOffset === 0.5) return 14;
    return 13;
  }
  return 6;
};

export const hasReverseLane = (connector) => Boolean(
  connector?.businessRes?.trim?.() ||
  connector?.technicalRes?.trim?.(),
);

export const connectorGroup = ({connector, connectors}) => {
  const sourceKey = `${connector.from}::${connector.to}`;
  const reverseKey = `${connector.to}::${connector.from}`;
  return connectors
    .map((item, index) => ({item, index}))
    .filter(({item}) => `${item.from}::${item.to}` === sourceKey || `${item.from}::${item.to}` === reverseKey)
    .sort((a, b) => a.index - b.index);
};

export const getConnectorLaneOffset = ({connector, connectors, direction = "forward"}) => {
  if (hasReverseLane(connector)) {
    return direction === "forward" ? 1 / 3 : 2 / 3;
  }
  const group = connectorGroup({connector, connectors});
  if (group.length <= 1) return 0.5;
  const connectorIndex = group.findIndex(({item}) => item === connector);
  if (connectorIndex <= 0) return 1 / 3;
  if (connectorIndex === 1) return 2 / 3;
  return 0.5;
};

export const getConnectorBreakRatio = ({connector, connectors}) => {
  const group = connectorGroup({connector, connectors});
  if (hasReverseLane(connector) || group.length > 1) {
    return 1 / 3;
  }
  return 0.5;
};

export const computeLayout = ({
  viewportWidth,
  stageWidth,
  stageAvailableHeight,
  steps,
  stepLayouts = {},
}) => {
  if (viewportWidth <= 820) {
    const cardWidth = Math.min(220, stageWidth - 72);
    const cardHeight = 128;
    const stepGap = 20;
    const left = Math.max(16, Math.floor((stageWidth - cardWidth) / 2));
    const positions = {};
    steps.forEach((step, index) => {
      positions[step.id] = {x: left, y: 24 + index * (cardHeight + stepGap)};
    });
    Object.entries(stepLayouts).forEach(([stepId, override]) => {
      if (positions[stepId] && override) {
        if (Number.isFinite(override.x)) positions[stepId].x = override.x;
        if (Number.isFinite(override.y)) positions[stepId].y = override.y;
      }
    });
    const lastStep = steps[steps.length - 1];
    const stageHeight = positions[lastStep.id].y + cardHeight + 36;
    return {
      cardWidth,
      cardHeight,
      stageHeight,
      positions,
      mobile: true,
    };
  }

  const topCount = Math.min(4, steps.length);
  const bottomSteps = steps.slice(topCount).reverse();
  const sidePad = viewportWidth <= 1280 ? 10 : 14;
  const minGap = viewportWidth <= 1280 ? 6 : 10;
  const cardWidth = Math.max(
    viewportWidth <= 1280 ? 146 : 157,
    Math.min(
      viewportWidth <= 1280 ? 176 : 184,
      Math.floor((stageWidth - sidePad * 2 - minGap * (topCount - 1)) / Math.max(1, topCount)),
    ),
  );
  const cardHeight = viewportWidth <= 1280 ? 194 : 215;
  const topGap = Math.max(
    minGap,
    Math.floor((stageWidth - sidePad * 2 - cardWidth * topCount) / Math.max(1, topCount - 1)),
  );
  const topLeft = sidePad;
  const stageHeight = stageAvailableHeight;
  const topY = viewportWidth <= 1280 ? 18 : 22;
  const positions = {};

  steps.slice(0, topCount).forEach((step, index) => {
    positions[step.id] = {x: topLeft + index * (cardWidth + topGap), y: topY};
  });

  const bottomCount = bottomSteps.length;
  const verticalGap = Math.max(
    viewportWidth <= 1280 ? 122 : 134,
    Math.min(viewportWidth <= 1280 ? 154 : 170, Math.floor((stageHeight - topY - cardHeight * 2) * 0.56)),
  );
  const bottomY = bottomCount > 0
    ? Math.max(topY + cardHeight + verticalGap, stageHeight - cardHeight - 142)
    : topY;

  if (bottomCount > 0) {
    bottomSteps.forEach((step, index) => {
      const topFrom = positions[steps[index].id];
      const topTo = positions[steps[index + 1].id];
      const midpoint = ((topFrom.x + cardWidth) + topTo.x) / 2;
      positions[step.id] = {
        x: Math.max(sidePad, Math.min(stageWidth - sidePad - cardWidth, Math.floor(midpoint - cardWidth / 2))),
        y: bottomY,
      };
    });
  }

  Object.entries(stepLayouts).forEach(([stepId, override]) => {
    if (positions[stepId] && override) {
      if (Number.isFinite(override.x)) positions[stepId].x = override.x;
      if (Number.isFinite(override.y)) positions[stepId].y = override.y;
    }
  });

  return {
    cardWidth,
    cardHeight,
    stageHeight,
    positions,
    mobile: false,
  };
};

export const buildStepBoxes = ({positions, stepLayouts = {}, defaultWidth, defaultHeight}) => {
  const boxes = {};
  Object.entries(positions).forEach(([stepId, pos]) => {
    const override = stepLayouts[stepId] || {};
    boxes[stepId] = {
      x: pos.x,
      y: pos.y,
      w: Number.isFinite(override.w) ? override.w : defaultWidth,
      h: Number.isFinite(override.h) ? override.h : defaultHeight,
    };
  });
  return boxes;
};

export const edgePointFromBox = (box, side, offset = 0.5) => {
  if (side === "top") {
    return {x: box.x + box.w * offset, y: box.y};
  }
  if (side === "right") {
    return {x: box.x + box.w, y: box.y + box.h * offset};
  }
  if (side === "bottom") {
    return {x: box.x + box.w * offset, y: box.y + box.h};
  }
  if (side === "left") {
    return {x: box.x, y: box.y + box.h * offset};
  }
  return {x: box.x + box.w / 2, y: box.y + box.h / 2};
};

export const anchorPointFor = ({stepId, anchorIndex, boxes}) => {
  const box = boxes[stepId];
  const ratio = anchorRatio(anchorIndex);
  return {
    x: box.x + box.w * ratio.x,
    y: box.y + box.h * ratio.y,
  };
};

export const getAutoConnectorAnchors = ({connector, connectors, boxes, direction = "forward"}) => {
  const startStepId = direction === "forward" ? connector.from : connector.to;
  const endStepId = direction === "forward" ? connector.to : connector.from;
  const startBox = boxes[startStepId];
  const endBox = boxes[endStepId];
  const startCenter = {x: startBox.x + startBox.w / 2, y: startBox.y + startBox.h / 2};
  const endCenter = {x: endBox.x + endBox.w / 2, y: endBox.y + endBox.h / 2};
  const dx = endCenter.x - startCenter.x;
  const dy = endCenter.y - startCenter.y;
  const sharedOffset = getConnectorLaneOffset({connector, connectors, direction});

  if (Math.abs(dx) >= Math.abs(dy)) {
    const startSide = dx >= 0 ? "right" : "left";
    const endSide = dx >= 0 ? "left" : "right";
    return {
      fromAnchor: anchorIndexFor(startSide, sharedOffset),
      toAnchor: anchorIndexFor(endSide, sharedOffset),
    };
  }

  const startSide = dy >= 0 ? "bottom" : "top";
  const endSide = dy >= 0 ? "top" : "bottom";
  return {
    fromAnchor: anchorIndexFor(startSide, sharedOffset),
    toAnchor: anchorIndexFor(endSide, sharedOffset),
  };
};

export const getResolvedAnchors = ({connector, connectors, boxes, direction = "forward"}) => {
  const autoAnchors = getAutoConnectorAnchors({connector, connectors, boxes, direction});
  return {
    fromAnchor: connector.anchorMode === "manual"
      ? (direction === "forward" ? connector.fromAnchor : connector.returnFromAnchor)
      : autoAnchors.fromAnchor,
    toAnchor: connector.anchorMode === "manual"
      ? (direction === "forward" ? connector.toAnchor : connector.returnToAnchor)
      : autoAnchors.toAnchor,
  };
};

export const getConnectorBreakPoint = ({connector, connectors, boxes, direction = "forward"}) => {
  const startStepId = direction === "forward" ? connector.from : connector.to;
  const endStepId = direction === "forward" ? connector.to : connector.from;
  const {fromAnchor, toAnchor} = getResolvedAnchors({connector, connectors, boxes, direction});
  const start = anchorPointFor({stepId: startStepId, anchorIndex: fromAnchor, boxes});
  const end = anchorPointFor({stepId: endStepId, anchorIndex: toAnchor, boxes});
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const ratio = getConnectorBreakRatio({connector, connectors});

  if (Math.abs(dx) < 6 || Math.abs(dy) < 6) {
    return {
      x: start.x + dx * 0.5,
      y: start.y + dy * 0.5,
      straight: true,
    };
  }

  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      x: start.x + dx * ratio,
      y: start.y,
      straight: false,
      orientation: "horizontal",
    };
  }

  return {
    x: start.x,
    y: start.y + dy * ratio,
    straight: false,
    orientation: "vertical",
  };
};

export const getVerticalLaneX = ({fromBox, toBox, direction, cardWidth}) => {
  const outerRight = Math.max(fromBox.x, toBox.x) + cardWidth;
  return outerRight + (direction === "forward" ? 120 : 82);
};

export const pathForConnector = ({connector, connectors, boxes, mobile, direction = "forward"}) => {
  const dualLane = hasReverseLane(connector);
  const from = boxes[connector.from];
  const to = boxes[connector.to];
  const {fromAnchor: explicitFromAnchor, toAnchor: explicitToAnchor} = getResolvedAnchors({
    connector,
    connectors,
    boxes,
    direction,
  });

  if (Number.isInteger(explicitFromAnchor) && Number.isInteger(explicitToAnchor)) {
    const startStepId = direction === "forward" ? connector.from : connector.to;
    const endStepId = direction === "forward" ? connector.to : connector.from;
    const startDesc = anchorDescriptor(explicitFromAnchor);
    const endDesc = anchorDescriptor(explicitToAnchor);
    let start = anchorPointFor({stepId: startStepId, anchorIndex: explicitFromAnchor, boxes});
    let end = anchorPointFor({stepId: endStepId, anchorIndex: explicitToAnchor, boxes});

    const horizontalPair = (
      ((startDesc.side === "right" && endDesc.side === "left") || (startDesc.side === "left" && endDesc.side === "right"))
    );
    const verticalPair = (
      ((startDesc.side === "top" && endDesc.side === "bottom") || (startDesc.side === "bottom" && endDesc.side === "top"))
    );

    if (horizontalPair) {
      const sharedOffset = startDesc.offset ?? endDesc.offset ?? 0.5;
      start = edgePointFromBox(boxes[startStepId], startDesc.side, sharedOffset);
      end = edgePointFromBox(boxes[endStepId], endDesc.side, sharedOffset);
    } else if (verticalPair) {
      const sharedOffset = startDesc.offset ?? endDesc.offset ?? 0.5;
      start = edgePointFromBox(boxes[startStepId], startDesc.side, sharedOffset);
      end = edgePointFromBox(boxes[endStepId], endDesc.side, sharedOffset);
    }

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const ratio = getConnectorBreakRatio({connector, connectors});
    if (Math.abs(dx) < 6 || Math.abs(dy) < 6) {
      return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      const bendX = start.x + dx * ratio;
      return `M ${start.x} ${start.y} L ${bendX} ${start.y} L ${bendX} ${end.y} L ${end.x} ${end.y}`;
    }
    const bendY = start.y + dy * ratio;
    return `M ${start.x} ${start.y} L ${start.x} ${bendY} L ${end.x} ${bendY} L ${end.x} ${end.y}`;
  }

  const startNode = direction === "forward" ? from : to;
  const endNode = direction === "forward" ? to : from;
  const laneFactor = !dualLane ? 0.5 : (direction === "forward" ? 0.25 : 0.75);
  if (mobile) {
    const shorten = direction === "forward" ? 5 : 0;
    const startX = startNode.x + startNode.w / 2 + (direction === "forward" ? -shorten : 0);
    const startY = startNode.y + startNode.h * laneFactor;
    const endX = endNode.x + endNode.w / 2 + (direction === "forward" ? shorten : 0);
    const endY = endNode.y + endNode.h * laneFactor;
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }
  if (startNode.y === endNode.y) {
    const laneY = startNode.y + startNode.h * laneFactor;
    const shorten = direction === "forward" ? 5 : 0;
    if (startNode.x < endNode.x) {
      return `M ${startNode.x + startNode.w} ${laneY} L ${endNode.x - shorten} ${laneY}`;
    }
    return `M ${startNode.x + shorten} ${laneY} L ${endNode.x + endNode.w} ${laneY}`;
  }
  if (startNode.x < endNode.x) {
    const startX = startNode.x + startNode.w;
    const startY = startNode.y + startNode.h * laneFactor;
    const endX = getVerticalLaneX({fromBox: from, toBox: to, direction, cardWidth: startNode.w});
    const endY = direction === "forward"
      ? endNode.y + endNode.h * laneFactor
      : endNode.y + endNode.h + 18;
    if (direction === "reverse") {
      const dropY = startY + Math.max(48, (endY - startY) * 0.18);
      return `M ${startX} ${startY} L ${startX + 22} ${startY} L ${startX + 22} ${dropY} L ${endX} ${dropY} L ${endX} ${endY}`;
    }
    return `M ${startX} ${startY} L ${endX - 5} ${startY} L ${endX - 5} ${endY}`;
  }
  const laneX = getVerticalLaneX({fromBox: from, toBox: to, direction, cardWidth: Math.max(from.w, to.w)});
  const startX = direction === "forward" ? startNode.x + startNode.w : startNode.x;
  const startY = startNode.y + startNode.h * laneFactor;
  const endX = direction === "forward" ? endNode.x + endNode.w : endNode.x;
  const endY = direction === "forward"
    ? endNode.y + endNode.h * laneFactor
    : endNode.y + endNode.h + 18;
  if (direction === "reverse") {
    const jogY = startY + Math.max(42, (endY - startY) * 0.2);
    return `M ${startX} ${startY} L ${laneX - 24} ${startY} L ${laneX - 24} ${jogY} L ${laneX} ${jogY} L ${laneX} ${endY} L ${endX} ${endY}`;
  }
  return `M ${startX} ${startY} L ${laneX} ${startY} L ${laneX} ${endY} L ${endX} ${endY}`;
};
