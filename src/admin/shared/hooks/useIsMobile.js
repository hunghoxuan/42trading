import { useEffect, useState } from "react";

import {
  getIsMobileViewport,
  getMobileViewportMediaQuery,
} from "../utils/viewport.js";

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(getIsMobileViewport);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia(getMobileViewportMediaQuery());
    const onChange = (event) => setIsMobile(event.matches);
    setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
