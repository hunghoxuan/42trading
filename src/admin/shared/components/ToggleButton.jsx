function IconFrame({ children, color }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        border: `1.5px solid ${color}`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color,
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

function PauseIcon({ color = "var(--muted)" }) {
  return (
    <IconFrame color={color}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
        }}
      >
        <span
          style={{
            width: 3,
            height: 9,
            borderRadius: 2,
            background: "currentColor",
            display: "inline-block",
          }}
        />
        <span
          style={{
            width: 3,
            height: 9,
            borderRadius: 2,
            background: "currentColor",
            display: "inline-block",
          }}
        />
      </span>
    </IconFrame>
  );
}

function PlayIcon({ color = "var(--success)" }) {
  return (
    <IconFrame color={color}>
      <span
        aria-hidden="true"
        style={{
          width: 0,
          height: 0,
          borderTop: "5px solid transparent",
          borderBottom: "5px solid transparent",
          borderLeft: "8px solid currentColor",
          display: "inline-block",
          marginLeft: 1,
        }}
      />
    </IconFrame>
  );
}

export default function ToggleButton({
  onClick,
  labelActive = "Pause",
  labelInActive = "Play",
  active = false,
  classActive = "danger-button",
  classInActive = "primary-button",
  type = "button",
  style = {},
  disabled = false,
  title,
  colorActive = null,
  colorInActive = null,
}) {
  const stateColor = active ? colorActive : colorInActive;
  return (
    <>
      {/* <!-- COMPONENT: ToggleButton --> */}
      <button
        type={type}
        className={active ? classActive : classInActive}
        data-component="ToggleButton"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          ...(stateColor
            ? {
                color: stateColor,
              }
            : {}),
          ...style,
        }}
        onClick={onClick}
        disabled={disabled}
        title={title}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            ...(stateColor ? { color: stateColor } : {}),
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: stateColor || "currentColor",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <span>{active ? labelActive : labelInActive}</span>
        </span>
        {active ? (
          <PauseIcon color={colorActive || "var(--muted)"} />
        ) : (
          <PlayIcon color={colorInActive || "var(--success)"} />
        )}
      </button>
      {/* <!-- /COMPONENT: ToggleButton --> */}
    </>
  );
}
