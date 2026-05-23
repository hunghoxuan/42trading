import { useEffect, useState } from "react";
import { api } from "../../api";
import { normalizeDisplayTimezone } from "../../utils/format";

const DISPLAY_TIMEZONE_OPTIONS = [
  { value: "Local", label: "Local (Browser)" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York (America/New_York)" },
];

function isSystemRole(user) {
  return (
    String(user?.role || "")
      .trim()
      .toLowerCase() === "system"
  );
}

function buildInitialForm(user) {
  return {
    name: String(user?.name || ""),
    email: String(user?.email || ""),
  };
}

function buildInitialMetadata(user) {
  const meta = user?.metadata?.settings || {};
  return {
    language: meta.language || "English",
    display_timezone: normalizeDisplayTimezone(meta.display_timezone || "Local"),
    market_data_cron: meta.market_data_cron !== false,
    ai_analysis_cron: meta.ai_analysis_cron !== false,
    snapshots_cron: meta.snapshots_cron !== false,
  };
}

export default function ProfilePage({ authUser, onUserUpdate }) {
  const [profileLoading, setProfileLoading] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [profileForm, setProfileForm] = useState(() =>
    buildInitialForm(authUser),
  );
  const [metadataForm, setMetadataForm] = useState(() =>
    buildInitialMetadata(authUser),
  );

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dataLoaded, setDataLoaded] = useState(false);

  // ---------- load profile on mount ----------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      // If authUser already has name+email, use it — but still
      // call authProfile to get up-to-date metadata.
      try {
        const prof = await api.authProfile();
        if (cancelled) return;
        if (prof?.user) {
          setProfileForm(buildInitialForm(prof.user));
          setMetadataForm(buildInitialMetadata(prof.user));
          // sync display_timezone into localStorage so the rest of the UI
          // picks it up
          const tz = normalizeDisplayTimezone(
            prof.user.metadata?.settings?.display_timezone || "Local",
          );
          localStorage.setItem("ui_display_timezone", tz);
        }
      } catch (err) {
        if (cancelled) return;
        // If authProfile fails, fall back to whatever authUser provides
        if (authUser) {
          setProfileForm(buildInitialForm(authUser));
          setMetadataForm(buildInitialMetadata(authUser));
        }
        if (err.message !== "Not found") {
          setMsg(err.message);
        }
      } finally {
        if (!cancelled) setDataLoaded(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [authUser?.user_id]);

  // ---------- save profile ----------
  async function saveProfile() {
    const name = String(profileForm.name || "").trim();
    const email = String(profileForm.email || "").trim();
    if (!name || !email) {
      setMsg("Name and email are required.");
      return;
    }
    setProfileLoading(true);
    try {
      await api.updateAuthProfile(name, email);
      if (onUserUpdate) {
        onUserUpdate({ ...authUser, name, email });
      }
      setMsg("Profile updated.");
    } catch (err) {
      setMsg(err?.message || "Failed to update profile.");
    } finally {
      setProfileLoading(false);
      window.setTimeout(() => setMsg(""), 2500);
    }
  }

  // ---------- reset password ----------
  async function resetPassword() {
    if (!currentPassword || !newPassword) {
      setMsg("Enter current and new password.");
      return;
    }
    if (newPassword.length < 4) {
      setMsg("New password must be at least 4 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMsg("New password and confirm password do not match.");
      return;
    }
    setPwdLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMsg("Password updated.");
    } catch (err) {
      setMsg(err?.message || "Failed to update password.");
    } finally {
      setPwdLoading(false);
      window.setTimeout(() => setMsg(""), 2500);
    }
  }

  // ---------- save preferences ----------
  async function savePreferences() {
    setPrefsLoading(true);
    try {
      const normalizedTz = normalizeDisplayTimezone(
        metadataForm.display_timezone,
      );
      const nextSettings = { ...metadataForm, display_timezone: normalizedTz };
      await api.updateMetadata({ settings: nextSettings });
      localStorage.setItem("ui_display_timezone", normalizedTz);
      setMetadataForm(nextSettings);
      if (onUserUpdate) {
        const nextUser = {
          ...authUser,
          metadata: { ...authUser?.metadata, settings: nextSettings },
        };
        onUserUpdate(nextUser);
      }
      setMsg("Preferences saved.");
    } catch (err) {
      setMsg(err?.message || "Failed to save preferences.");
    } finally {
      setPrefsLoading(false);
      window.setTimeout(() => setMsg(""), 2500);
    }
  }

  // ---------- status message helpers ----------
  const busy = profileLoading || pwdLoading || prefsLoading;
  const showMsg = msg && !busy;

  // ---------- render ----------
  return (
    <div className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <h2 className="page-title">Profile</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 32,
        }}
      >
        {/* ===== COLUMN 1: Profile & Security ===== */}
        <div className="stack-layout" style={{ gap: 40 }}>
          {/* --- Profile form --- */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-label">IDENTITY</div>
            <div className="stack-layout" style={{ gap: 10 }}>
              <label
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <span className="minor-text">Name</span>
                <input
                  value={profileForm.name}
                  onChange={(e) =>
                    setProfileForm((p) => ({ ...p, name: e.target.value }))
                  }
                  style={{ width: "100%", maxWidth: 400 }}
                />
              </label>
              <label
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <span className="minor-text">Email</span>
                <input
                  value={profileForm.email}
                  onChange={(e) =>
                    setProfileForm((p) => ({ ...p, email: e.target.value }))
                  }
                  style={{ width: "100%", maxWidth: 400 }}
                />
              </label>
              <button
                type="button"
                className="primary-button"
                onClick={saveProfile}
                disabled={profileLoading}
              >
                {profileLoading ? "SAVING..." : "SAVE CHANGES"}
              </button>
            </div>
          </div>

          {/* --- Password form --- */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-label">SECURITY</div>
            <div className="stack-layout" style={{ gap: 10 }}>
              <label
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <span className="minor-text">Current Password</span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  style={{ width: "100%", maxWidth: 400 }}
                />
              </label>
              <label
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <span className="minor-text">New Password</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={{ width: "100%", maxWidth: 400 }}
                />
              </label>
              <label
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <span className="minor-text">Confirm New Password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ width: "100%", maxWidth: 400 }}
                />
              </label>
              <button
                type="button"
                className="primary-button"
                onClick={resetPassword}
                disabled={pwdLoading}
              >
                {pwdLoading ? "UPDATING..." : "UPDATE PASSWORD"}
              </button>
            </div>
          </div>

          {/* --- Status message --- */}
          {showMsg && (
            <div
              className="fadeIn"
              style={{
                color: "var(--primary)",
                fontSize: 13,
                marginTop: -16,
              }}
            >
              {msg}
            </div>
          )}
        </div>

        {/* ===== COLUMN 2: Preferences ===== */}
        <div className="stack-layout" style={{ gap: 40 }}>
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-label">APP PREFERENCES</div>
            <div className="stack-layout" style={{ gap: 20 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                }}
              >
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <span className="minor-text">Language</span>
                  <select
                    value={metadataForm.language}
                    onChange={(e) =>
                      setMetadataForm((p) => ({
                        ...p,
                        language: e.target.value,
                      }))
                    }
                  >
                    <option value="English">English</option>
                    <option value="Vietnamese">Vietnamese</option>
                    <option value="Deutsch">Deutsch</option>
                  </select>
                </label>
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <span className="minor-text">Display Timezone</span>
                  <select
                    value={metadataForm.display_timezone}
                    onChange={(e) =>
                      setMetadataForm((p) => ({
                        ...p,
                        display_timezone: e.target.value,
                      }))
                    }
                  >
                    {DISPLAY_TIMEZONE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Cron toggles */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 16,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={metadataForm.market_data_cron}
                    onChange={(e) =>
                      setMetadataForm((p) => ({
                        ...p,
                        market_data_cron: e.target.checked,
                      }))
                    }
                  />
                  <span className="minor-text">Market Data Cron</span>
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={metadataForm.ai_analysis_cron}
                    onChange={(e) =>
                      setMetadataForm((p) => ({
                        ...p,
                        ai_analysis_cron: e.target.checked,
                      }))
                    }
                  />
                  <span className="minor-text">AI Analysis Cron</span>
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={metadataForm.snapshots_cron}
                    onChange={(e) =>
                      setMetadataForm((p) => ({
                        ...p,
                        snapshots_cron: e.target.checked,
                      }))
                    }
                  />
                  <span className="minor-text">Snapshots Cron</span>
                </label>
              </div>

              <button
                type="button"
                className="primary-button"
                onClick={savePreferences}
                disabled={prefsLoading}
              >
                {prefsLoading ? "SAVING..." : "SAVE PREFERENCES"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
