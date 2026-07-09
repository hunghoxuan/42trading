export default function ListItems({
  children,
  className = "",
  style = {},
  ...rest
}) {
  return (
    <div
      className={["list-items", className].filter(Boolean).join(" ")}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}
