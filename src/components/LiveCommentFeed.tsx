"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes stored comments only; never calls the sports provider. */
export function LiveCommentFeed({ live }: { live: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [live, router]);
  return null;
}
