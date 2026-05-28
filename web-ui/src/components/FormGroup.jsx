/**
 * Consistent form field wrapper. Label above, input below, validation below input.
 *
 * Props:
 *   label      – string (rendered as .panel-label)
 *   error      – string (validation error, shown in red below input)
 *   children   – ReactNode (the input/select/textarea)
 *   required   – boolean (appends * to label)
 *   className  – additional wrapper class
 */
export default function FormGroup({ label, error, children, required, className }) {
  return (
    <div className={className}>
      {label && (
        <label className="panel-label">
          {label}
          {required && " *"}
        </label>
      )}
      {children}
      {error && <div className="field-validation msg-error">{error}</div>}
    </div>
  );
}
