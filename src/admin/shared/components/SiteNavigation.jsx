import { Link } from "react-router-dom";
import "./SiteNavigation.css";

export default function SiteNavigation({
  logo = "📈",
  title = "42trade",
  version = "",
  homeTo = "/dashboard",
  onHomeClick,
  brandExtras = null,
  nav = null,
  menus = null,
  utilities = null,
  className = "",
}) {
  return (
    <div
      data-component="SiteNavigation"
      className={["site-navigation", className].filter(Boolean).join(" ")}
    >
      <div data-component="SiteNavigation.Brand" className="site-navigation__brand">
        <Link
          to={homeTo}
          className="site-navigation__brand-link"
          onClick={onHomeClick}
          title="Go to home page"
        >
          <span className="site-navigation__logo" aria-hidden="true">
            {logo}
          </span>
          <span className="site-navigation__title">{title}</span>
          {version ? (
            <span
              data-component="SiteNavigation.Version"
              className="site-navigation__version"
            >
              v{version}
            </span>
          ) : null}
        </Link>
        {brandExtras}
      </div>

      <div data-component="SiteNavigation.Menu" className="site-navigation__menu">
        {nav}
        {menus}
        {utilities}
      </div>
    </div>
  );
}
