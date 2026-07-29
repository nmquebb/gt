import { remainingHoldMs, type ClockAnchor } from "@checkout/sdk";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { styles } from "./theme";

function formatRemaining(remainingMs: number): string {
  const remainingSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function HoldCountdown({ clockAnchor }: { clockAnchor: ClockAnchor }) {
  const [remainingMs, setRemainingMs] = useState(() =>
    remainingHoldMs(clockAnchor, performance.now()),
  );

  useEffect(() => {
    function update() {
      setRemainingMs(remainingHoldMs(clockAnchor, performance.now()));
    }

    update();
    const interval = globalThis.setInterval(update, 1_000);

    return () => globalThis.clearInterval(interval);
  }, [clockAnchor]);

  return (
    <View style={styles.section}>
      <Text style={styles.muted}>
        {remainingMs === 0
          ? "Hold expires now"
          : `Hold expires in ${formatRemaining(remainingMs)}`}
      </Text>
    </View>
  );
}
