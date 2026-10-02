"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { unreadNotificationCount } from "@/app/mon-compte/notifications/actions";

/**
 * Badge du nombre de notifications non lues (WP10d).
 *
 * Le compteur est relu **à chaque navigation** via une Server Action, sans
 * requête périodique ni canal permanent : le composant ne fait rien tant que
 * l'URL ne change pas. Le badge disparaît lorsque le compte tombe à zéro.
 */
export function NotificationBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    unreadNotificationCount()
      .then((value) => {
        if (active) setCount(value);
      })
      .catch(() => {
        // Un compteur indisponible ne doit rien casser dans la navigation.
        if (active) setCount(null);
      });

    return () => {
      active = false;
    };
  }, [pathname]);

  if (!count || count <= 0) {
    return null;
  }

  const label = `${count} notification${count > 1 ? "s" : ""} non lue${count > 1 ? "s" : ""}`;

  return (
    <span
      className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-danger-600 px-1.5 py-0.5 text-[10px] font-bold text-white"
      title={label}
      aria-label={label}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
