import {
  formatUsd,
  useCheckoutRealtime,
  useCheckoutState,
  type CheckoutClient,
  type CheckoutClientContext,
  type CheckoutCommandResult,
  type CheckoutState,
} from "@checkout/sdk";
import { useNavigation } from "expo-router";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { styles } from "@/theme/styles";
import { CheckoutAction } from "./components/checkout-action";
import { CheckoutStatusPanel } from "./components/checkout-status-panel";
import { HoldCountdown } from "./components/hold-countdown";
import { OfferAcceptance } from "./components/offer-acceptance";

type CheckoutScreenClient = Pick<
  CheckoutClient,
  "acceptOffer" | "leave" | "openEvents" | "purchase"
>;

function CheckoutPurchaseProgress() {
  return (
    <View accessibilityLiveRegion="polite" style={styles.section}>
      <View style={[styles.button, styles.buttonDisabled]}>
        <Text style={styles.buttonText}>Completing purchase…</Text>
      </View>
    </View>
  );
}

function CheckoutContent({
  checkout,
  client,
  context,
}: {
  checkout: CheckoutState;
  client: CheckoutScreenClient;
  context: CheckoutClientContext;
}) {
  const { clockAnchor, snapshot } = checkout;
  const { event, listing, offer, order } = snapshot.session;
  const allowedActions = snapshot.allowedActions;
  const navigation = useNavigation();
  const realtimeStatus = useCheckoutRealtime({ client, context });
  const phaseRef = useRef(snapshot.session.phase);
  phaseRef.current = snapshot.session.phase;
  const requiresOfferReview = offer.currentVersion !== offer.acceptedVersion;
  const purchaseAction = allowedActions.includes("retry_purchase")
    ? "retry_purchase"
    : allowedActions.includes("purchase")
      ? "purchase"
      : undefined;
  const showAcceptOffer = allowedActions.includes("accept_offer");
  const isTerminal =
    snapshot.status === "completed" ||
    snapshot.status === "expired" ||
    snapshot.status === "abandoned";

  useEffect(
    () =>
      navigation.addListener("beforeRemove", () => {
        if (phaseRef.current === "active") {
          void client.leave(context).catch(() => undefined);
        }
      }),
    [client, context, navigation],
  );

  return (
    <ScreenShell>
      <View style={styles.card}>
        <View style={styles.section}>
          <Text style={styles.heading}>{event.name}</Text>
          <Text style={styles.muted}>
            {event.venue} · {event.timeLabel}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.section}>
          <Text style={styles.label}>
            Section {listing.section} · Row {listing.row} · Seat {listing.seat}
          </Text>
          <View style={styles.priceRow}>
            {requiresOfferReview && (
              <Text
                accessibilityLabel={`Previously accepted price ${formatUsd(offer.acceptedTotalCents)}`}
                style={styles.previousPrice}
              >
                {formatUsd(offer.acceptedTotalCents)}
              </Text>
            )}
            <Text style={styles.price}>
              {formatUsd(offer.currentTotalCents)}
            </Text>
          </View>
        </View>
        {showAcceptOffer && (
          <OfferAcceptance
            client={client}
            context={context}
            currentVersion={offer.currentVersion}
          />
        )}
        {order !== undefined && (
          <Text style={styles.success}>Order {order.id} confirmed</Text>
        )}
      </View>

      <CheckoutStatusPanel
        realtimeStatus={realtimeStatus}
        status={snapshot.status}
      />

      {!isTerminal && (
        <View style={[styles.card, styles.actionCard]}>
          <HoldCountdown clockAnchor={clockAnchor} />
          {purchaseAction === undefined ? (
            snapshot.status === "purchase_pending" && (
              <CheckoutPurchaseProgress />
            )
          ) : (
            <CheckoutAction
              action={purchaseAction}
              allowedActions={allowedActions}
              client={client}
              clockAnchor={clockAnchor}
              context={context}
            />
          )}
        </View>
      )}
    </ScreenShell>
  );
}

interface CheckoutScreenProps {
  client: CheckoutScreenClient;
  context: CheckoutClientContext;
  initialResult: CheckoutCommandResult;
}

export function CheckoutScreen({
  client,
  context,
  initialResult,
}: CheckoutScreenProps) {
  const checkout = useCheckoutState(context.sessionId, initialResult);

  return (
    <CheckoutContent checkout={checkout} client={client} context={context} />
  );
}
