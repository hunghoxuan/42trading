import React from "react";
import {flowFonts, flowTheme} from "./theme";

export type FlowStepCardProps = {
  stepId?: string;
  indexLabel: string;
  title: string;
  subtitle: string;
  isActive?: boolean;
  isCompleted?: boolean;
  background?: string;
  borderColor?: string;
  badgeBackground?: string;
  textColor?: string;
  subtitleColor?: string;
  padding?: string;
  titleSize?: string;
  subtitleSize?: string;
  borderRadius?: string;
  boxShadow?: string;
  titleAlign?: "left" | "center" | "right";
  subtitleAlign?: "left" | "center" | "right";
  titleWeight?: string;
  subtitleWeight?: string;
  showBadge?: boolean;
  showBorder?: boolean;
  showHeader?: boolean;
  showContent?: boolean;
  showIcon?: boolean;
  editable?: boolean;
  backgroundImageUrl?: string;
  imageBackground?: boolean;
  imageFit?: "cover" | "contain";
  imagePosition?: string;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onResizePointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onBadgeDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
  onTitleDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
  onSubtitleDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
  onBadgeBlur?: React.FocusEventHandler<HTMLDivElement>;
  onTitleBlur?: React.FocusEventHandler<HTMLDivElement>;
  onSubtitleBlur?: React.FocusEventHandler<HTMLDivElement>;
  onBadgeKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onTitleKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onSubtitleKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  badgeContentEditable?: boolean;
  titleContentEditable?: boolean;
  subtitleContentEditable?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

export const FlowStepCard: React.FC<FlowStepCardProps> = ({
  stepId,
  indexLabel,
  title,
  subtitle,
  isActive = false,
  isCompleted = false,
  background,
  borderColor,
  badgeBackground,
  textColor,
  subtitleColor,
  padding,
  titleSize,
  subtitleSize,
  borderRadius,
  boxShadow,
  titleAlign,
  subtitleAlign,
  titleWeight,
  subtitleWeight,
  showBadge = true,
  showBorder = true,
  showHeader = true,
  showContent = true,
  showIcon = true,
  editable = false,
  backgroundImageUrl,
  imageBackground = false,
  imageFit = "contain",
  imagePosition = "center",
  onPointerDown,
  onResizePointerDown,
  onBadgeDoubleClick,
  onTitleDoubleClick,
  onSubtitleDoubleClick,
  onBadgeBlur,
  onTitleBlur,
  onSubtitleBlur,
  onBadgeKeyDown,
  onTitleKeyDown,
  onSubtitleKeyDown,
  badgeContentEditable = false,
  titleContentEditable = false,
  subtitleContentEditable = false,
  style,
  children,
}) => {
  const resolvedBorderColor =
    borderColor || (isActive ? flowTheme.colors.selected : flowTheme.colors.cardBorder);
  const shadow = boxShadow || (isActive ? flowTheme.shadows.cardActive : flowTheme.shadows.card);
  const transform = isActive ? "translateY(-2px)" : isCompleted ? "translateY(0)" : "translateY(2px)";

  return (
    <div
      data-step-id={stepId}
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        borderRadius: borderRadius || flowTheme.radii.card,
        padding: padding || "16px 16px 14px 16px",
        boxSizing: "border-box",
        background: background || flowTheme.colors.card,
        border: showBorder ? `${isActive ? 3 : 2}px solid ${resolvedBorderColor}` : "2px solid transparent",
        boxShadow: shadow,
        opacity: isCompleted && !isActive ? 0.84 : 1,
        transform,
        transition: "opacity .35s ease, transform .35s ease, border-color .25s ease, box-shadow .25s ease",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        color: textColor || flowTheme.colors.ink,
        overflow: "hidden",
        ...style,
      }}
    >
      {imageBackground && backgroundImageUrl ? (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url(${backgroundImageUrl})`,
              backgroundSize: imageFit,
              backgroundRepeat: "no-repeat",
              backgroundPosition: imagePosition,
              opacity: 0.24,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(180deg, rgba(255,255,255,.78), rgba(255,255,255,.90))",
              pointerEvents: "none",
            }}
          />
        </>
      ) : null}
      <div>
        {showBadge ? (
          <div
            data-inline-field="badge"
            suppressContentEditableWarning
            contentEditable={badgeContentEditable}
            onDoubleClick={onBadgeDoubleClick}
            onBlur={onBadgeBlur}
            onKeyDown={onBadgeKeyDown}
            style={{
              width: 32,
              height: 32,
              borderRadius: flowTheme.radii.round,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                badgeBackground ||
                `linear-gradient(135deg, ${flowTheme.colors.brand1}, ${flowTheme.colors.brand2})`,
              boxShadow: flowTheme.shadows.badge,
              fontFamily: flowFonts.base,
              fontSize: 12,
              fontWeight: 800,
              color: "#ffffff",
              marginBottom: 12,
              position: "relative",
              zIndex: 1,
            }}
          >
            {indexLabel}
          </div>
        ) : null}
        {showHeader ? (
          <div
            data-inline-field="title"
            suppressContentEditableWarning
            contentEditable={titleContentEditable}
            onDoubleClick={onTitleDoubleClick}
            onBlur={onTitleBlur}
            onKeyDown={onTitleKeyDown}
            style={{
              fontFamily: flowFonts.base,
              fontSize: titleSize || "19px",
              lineHeight: 1.15,
              fontWeight: titleWeight || 800,
              color: textColor || flowTheme.colors.ink,
              marginBottom: showContent ? 8 : 0,
              textAlign: titleAlign || "left",
              position: "relative",
              zIndex: 1,
            }}
          >
            {title}
          </div>
        ) : null}
        {showContent ? (
          <div
            data-inline-field="subtitle"
            suppressContentEditableWarning
            contentEditable={subtitleContentEditable}
            onDoubleClick={onSubtitleDoubleClick}
            onBlur={onSubtitleBlur}
            onKeyDown={onSubtitleKeyDown}
            style={{
              fontFamily: flowFonts.base,
              fontSize: subtitleSize || "13px",
              lineHeight: 1.42,
              color: subtitleColor || flowTheme.colors.sub,
              textAlign: subtitleAlign || "left",
              fontWeight: subtitleWeight || 400,
              position: "relative",
              zIndex: 1,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
      {showIcon ? (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: 82,
            color: flowTheme.colors.accentText,
            fontSize: 48,
            opacity: 0.92,
            position: "relative",
            zIndex: 1,
          }}
        >
          {children}
        </div>
      ) : null}
      {editable ? (
        <div
          onPointerDown={onResizePointerDown}
          style={{
            position: "absolute",
            right: 8,
            bottom: 8,
            width: 14,
            height: 14,
            borderRadius: 4,
            background: "linear-gradient(135deg, #2ba4ff, #5b34ea)",
            boxShadow: "0 6px 14px rgba(8,40,74,.18)",
            cursor: "nwse-resize",
            opacity: 0.92,
            zIndex: 2,
          }}
        />
      ) : null}
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
  onClick?: React.MouseEventHandler<HTMLDivElement>;
};

export const ConnectorLabel: React.FC<ConnectorLabelProps> = ({
  x,
  y,
  direction,
  laneOffset,
  text,
  active = false,
  onClick,
}) => (
  <div
    onClick={onClick}
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
      boxShadow: active
        ? "0 0 0 2px rgba(35,92,255,.12), 0 14px 30px rgba(8,40,74,.10)"
        : direction === "reverse"
          ? "0 8px 18px rgba(8,40,74,.04)"
          : "0 10px 22px rgba(8,40,74,.05)",
      textAlign: "center",
      pointerEvents: onClick ? "auto" : "none",
      cursor: onClick ? "pointer" : "default",
      zIndex: active ? 10 : 3,
      transition: "opacity .28s ease, transform .28s ease, border-color .25s ease, box-shadow .25s ease",
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
      transition: "transform .2s ease, box-shadow .2s ease, background .2s ease, color .2s ease",
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
