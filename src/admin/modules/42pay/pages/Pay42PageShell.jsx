export default function Pay42PageShell({ children, className = "" }) {
  return (
    <section
      className={`logs-page-container trades-page-container pay42-page-container stack-layout fadeIn ${className}`.trim()}
    >
      {children}
    </section>
  );
}
