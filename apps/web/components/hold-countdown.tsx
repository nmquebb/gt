"use client";

import { remainingHoldMs, useCheckoutStore } from "@checkout/sdk";
import { useEffect, useState } from "react";

function formatRemaining(remainingMs: number): string {
  const remainingSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function HoldCountdown() {
  const clockAnchor = useCheckoutStore((state) => state.clockAnchor);
  const [remainingMs, setRemainingMs] = useState(() =>
    remainingHoldMs(clockAnchor, performance.now()),
  );

  useEffect(() => {
    function update() {
      setRemainingMs(remainingHoldMs(clockAnchor, performance.now()));
    }

    update();
    const interval = window.setInterval(update, 1_000);

    return () => window.clearInterval(interval);
  }, [clockAnchor]);

  return (
    <p className="text-sm text-neutral-600">
      {remainingMs === 0
        ? "Hold expires now"
        : `Hold expires in ${formatRemaining(remainingMs)}`}
    </p>
  );
}
