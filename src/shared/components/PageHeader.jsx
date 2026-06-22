import "./PageHeader.css";

export default function PageHeader({
  title,
  actions = null,
  className = "",
  style = {},
  titleTag: TitleTag = "h2",
}) {
  return (
    <div
      data-component="PageHeader"
      className={["page-header", className].filter(Boolean).join(" ")}
      style={style}
    >
      <div data-component="PageHeader.Title" className="page-header__title">
        <TitleTag className="page-title" style={{ margin: 0 }}>
          {title}
        </TitleTag>
      </div>
      <div
        data-component="PageHeader.Actions"
        className="page-header__actions"
      >
        {actions}
      </div>
    </div>
  );
}
