import NavDropdown from "./NavDropdown";

export default function AppDownloadsMenu({ language = "Vietnamese" }) {
  const vi = /^viet/i.test(language);
  return (
    <NavDropdown trigger={
      <button type="button" className="secondary-button nav-dropdown-trigger">
        <span className="combo-button-menu-trigger__label">{vi ? "Tải app" : "Download apps"}</span>
        <span aria-hidden="true" className="combo-button-menu-trigger__caret">▾</span>
      </button>
    }>
      <a href="/downloads/pos-android/42trade-pos.apk" download="42trade-pos.apk"
        title={vi ? "Android 8 trở lên" : "Android 8 or later"}>Android · APK</a>
      <a href="/downloads/pos-macos/42trade-pos-macos.zip" download="42trade-pos-macos.zip"
        title={vi ? "macOS 12 trở lên · Apple Silicon và Intel" : "macOS 12 or later · Apple Silicon and Intel"}>macOS · App</a>
      <a href="/downloads/pos-ios/" target="_blank" rel="noopener noreferrer"
        title={vi ? "Cài lên màn hình chính bằng Safari" : "Add to Home Screen using Safari"}>iPhone / iPad · Web app</a>
      <a href="/downloads/pos-android/" target="_blank" rel="noopener noreferrer">
        {vi ? "Hướng dẫn cài Android" : "Android installation guide"}
      </a>
      <a href="/downloads/pos-macos/" target="_blank" rel="noopener noreferrer">
        {vi ? "Hướng dẫn cài macOS" : "macOS installation guide"}
      </a>
    </NavDropdown>
  );
}
