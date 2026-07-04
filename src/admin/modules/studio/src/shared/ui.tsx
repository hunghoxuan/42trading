import React from "react";
import {flowFonts, flowTheme} from "./theme";

export type FlowStepCardProps = {
  indexLabel: string;
  title: string;
  subtitle: string;
  isActive?: boolean;
  isCompleted?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

export const FlowStepCard: React.FC<FlowStepCardProps> = ({
  indexLabel,
  title,
  subtitle,
  isActive = false,
  isCompleted = false,
  style,
  children,
}) => {
  const borderColor = isActive ? flowTheme.colors.selected : flowTheme.colors.cardBorder;
  const shadow = isActive ? flowTheme.shadows.cardActive : flowTheme.shadows.card;

  return (
    <div
      style={{
        position: "absolute",
        borderRadius: flowTheme.radii.card,
        padding: "16px 16px 14px 16px",
        boxSizing: "border-box",
        background: flowTheme.colors.card,
        border: `2px solid ${borderColor}`,
        boxShadow: shadow,
        opacity: isCompleted && !isActive ? 0.84 : 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        color: flowTheme.colors.ink,
        ...style,
      }}
    >
      <div>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: flowTheme.radii.round,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `linear-gradient(135deg, ${flowTheme.colors.brand1}, ${flowTheme.colors.brand2})`,
            boxShadow: flowTheme.shadows.badge,
            fontFamily: flowFonts.base,
            fontSize: 12,
            fontWeight: 800,
            color: "#ffffff",
            marginBottom: 12,
          }}
        >
          {indexLabel}
        </div>
        <div
          style={{
            fontFamily: flowFonts.base,
            fontSize: 19,
            lineHeight: 1.15,
            fontWeight: 800,
            color: flowTheme.colors.ink,
            marginBottom: 8,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: flowFonts.base,
            fontSize: 13,
            lineHeight: 1.42,
            color: flowTheme.colors.sub,
          }}
        >
          {subtitle}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: 58,
          color: flowTheme.colors.accentText,
          fontSize: 36,
          opacity: 0.92,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export type ConnectorLabelProps = {
  x: number;
  y: number;
  direction: "forward" | "reverse";
  laneOffset: number;
  text: string;
  active?: boolean;
};

export const ConnectorLabel: React.FC<ConnectorLabelProps> = ({
  x,
  y,
  direction,
  laneOffset,
  text,
  active = false,
}) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      transform: `translate(-50%, ${laneOffset <= 0.5 ? "calc(-100% - 4px)" : "4px"})`,
      width: direction === "reverse" ? 82 : 92,
      padding: direction === "reverse" ? "4px 6px" : "5px 6px",
      borderRadius: flowTheme.radii.pill,
      background: direction === "reverse" ? "rgba(255,255,255,.90)" : "rgba(255,255,255,.96)",
      border: direction === "reverse" ? "1px dashed rgba(118,170,230,.4)" : "1px solid rgba(118,170,230,.26)",
      boxShadow: direction === "reverse" ? "0 8px 18px rgba(8,40,74,.04)" : "0 10px 22px rgba(8,40,74,.05)",
      textAlign: "center",
      pointerEvents: "none",
      zIndex: active ? 10 : 3,
    }}
  >
    <div
      style={{
        fontSize: direction === "reverse" ? 8 : 9,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: "#7a91aa",
        marginBottom: 3,
        fontFamily: flowFonts.base,
      }}
    >
      {direction === "reverse" ? "Response" : "Request"}
    </div>
    <div
      style={{
        fontSize: direction === "reverse" ? 8 : 9,
        fontWeight: 800,
        lineHeight: 1.25,
        color: direction === "reverse" ? flowTheme.colors.lineReturn : flowTheme.colors.tagText,
        fontFamily: flowFonts.base,
      }}
    >
      {text}
    </div>
  </div>
);

export const TagPill: React.FC<{label: string}> = ({label}) => (
  <span
    style={{
      padding: "7px 10px",
      borderRadius: flowTheme.radii.round,
      background: flowTheme.colors.tagBg,
      color: flowTheme.colors.tagText,
      fontSize: 12,
      fontWeight: 700,
      fontFamily: flowFonts.base,
      display: "inline-flex",
      alignItems: "center",
    }}
  >
    {label}
  </span>
);

export const IconCircleButton: React.FC<{label: string; active?: boolean; primary?: boolean; style?: React.CSSProperties}> = ({
  label,
  active = false,
  primary = false,
  style,
}) => (
  <div
    style={{
      width: 42,
      minWidth: 42,
      height: 42,
      borderRadius: flowTheme.radii.round,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      border: primary ? "0" : "1px solid rgba(118,170,230,.24)",
      background: primary ? "#123f70" : active ? `linear-gradient(135deg, ${flowTheme.colors.brand1}, ${flowTheme.colors.brand2})` : "rgba(255,255,255,.96)",
      color: primary || active ? "#ffffff" : "#0d4f88",
      boxShadow: flowTheme.shadows.button,
      fontWeight: 700,
      fontSize: 16,
      fontFamily: flowFonts.base,
      ...style,
    }}
  >
    {label}
  </div>
);

export const SegmentedToggle: React.FC<{items: Array<{label: string; active?: boolean}>}> = ({items}) => (
  <div
    style={{
      display: "inline-flex",
      padding: 4,
      borderRadius: 14,
      border: "1px solid rgba(118,170,230,.24)",
      background: "rgba(255,255,255,.92)",
      boxShadow: flowTheme.shadows.button,
      gap: 4,
      alignItems: "center",
    }}
  >
    {items.map((item) => (
      <div
        key={item.label}
        style={{
          minWidth: 42,
          height: 34,
          borderRadius: 10,
          padding: "0 12px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: item.active ? `linear-gradient(135deg, ${flowTheme.colors.brand1}, ${flowTheme.colors.brand2})` : "transparent",
          color: item.active ? "#ffffff" : "#0d4f88",
          fontSize: 13,
          fontWeight: 700,
          fontFamily: flowFonts.base,
        }}
      >
        {item.label}
      </div>
    ))}
  </div>
);

export type InfoPanelProps = {
  logoSrc: string;
  kicker: string;
  title: string;
  copy: string;
  tags: string[];
  bullets: string[];
  footer?: React.ReactNode;
};

export const InfoPanel: React.FC<InfoPanelProps> = ({
  logoSrc,
  kicker,
  title,
  copy,
  tags,
  bullets,
  footer,
}) => (
  <div
    style={{
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
    }}
  >
    {/* eslint-disable-next-line @remotion/warn-native-media-tag */}
    <img
      src={logoSrc}
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
    <div style={{fontSize: 12, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: flowTheme.colors.accentText, fontFamily: flowFonts.base}}>
      {kicker}
    </div>
    <div style={{fontSize: 22, lineHeight: 1.12, fontWeight: 900, color: "#09284b", fontFamily: flowFonts.base}}>
      {title}
    </div>
    <div style={{fontSize: 15, lineHeight: 1.5, color: "#5e7793", fontFamily: flowFonts.base}}>
      {copy}
    </div>
    <div style={{display: "flex", flexWrap: "wrap", gap: 8}}>
      {tags.map((tag) => (
        <TagPill key={tag} label={tag} />
      ))}
    </div>
    <ul
      style={{
        margin: 0,
        paddingLeft: 20,
        color: "#5e7793",
        fontSize: 14,
        lineHeight: 1.5,
        fontFamily: flowFonts.base,
      }}
    >
      {bullets.map((bullet) => (
        <li key={bullet}>{bullet}</li>
      ))}
    </ul>
    {footer ? <div style={{marginTop: "auto"}}>{footer}</div> : null}
  </div>
);
