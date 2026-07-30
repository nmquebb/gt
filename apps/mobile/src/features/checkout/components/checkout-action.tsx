import { randomUUID } from "expo-crypto";
import {
  remainingHoldMs,
  usePurchaseCheckout,
  type CheckoutClient,
  type CheckoutClientContext,
  type CheckoutSnapshot,
  type ClockAnchor,
} from "@checkout/sdk";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { styles } from "@/theme/styles";

export function CheckoutAction({
  action,
  allowedActions,
  client,
  clockAnchor,
  context,
}: {
  action: "purchase" | "retry_purchase";
  allowedActions: CheckoutSnapshot["allowedActions"];
  client: Pick<CheckoutClient, "purchase">;
  clockAnchor: ClockAnchor;
  context: CheckoutClientContext;
}) {
  const purchase = usePurchaseCheckout(client, context, randomUUID);
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

  const enabled =
    allowedActions.includes(action) && remainingMs > 0 && !purchase.isPending;
  const label = purchase.isPending
    ? "Completing purchase…"
    : action === "retry_purchase"
      ? "Retry purchase"
      : "Purchase";

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !enabled }}
        disabled={!enabled}
        onPress={() => purchase.mutate()}
        style={[styles.button, enabled ? undefined : styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>{label}</Text>
      </Pressable>
      {Boolean(purchase.error) && (
        <Text role="alert" style={styles.error}>
          The purchase could not be completed. Please try again.
        </Text>
      )}
    </View>
  );
}
