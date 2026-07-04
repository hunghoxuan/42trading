import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export default function AuthProbePage({ authUser = null }) {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const parentOrigin = String(searchParams.get("parent_origin") || "*").trim() || "*";
    try {
      window.parent?.postMessage(
        {
          source: "42trade-auth-probe",
          ok: !!authUser,
          user: authUser
            ? {
                user_id: authUser.user_id || "",
                roles: Array.isArray(authUser.roles) ? authUser.roles : [],
              }
            : null,
        },
        parentOrigin,
      );
    } catch {}
  }, [authUser, searchParams]);

  return null;
}
