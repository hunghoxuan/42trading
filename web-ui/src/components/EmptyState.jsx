import React from "react";

export default function EmptyState({ children = "No data.", colSpan }) {
  if (colSpan) {
    return (
      <tr>
        <td colSpan={colSpan} className="loading">
          {children}
        </td>
      </tr>
    );
  }
  return <div className="minor-text">{children}</div>;
}
