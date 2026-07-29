import { randomUUID } from "expo-crypto";
import {
  checkoutCopy,
  formatUsd,
  remainingHoldMs,
  useAcceptCheckoutOffer,
  useCheckoutRealtime,
  useCheckoutState,
  usePurchaseCheckout,
  type CheckoutClient,
  type CheckoutClientContext,
  type CheckoutCommandResult,
  type CheckoutSnapshot,
  type CheckoutState,
  type ClockAnchor,
  type RealtimeStatus,
} from "@checkout/sdk";
import { useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  checkoutStatusPresentation,
  realtimeStatusCopy,
  type CheckoutStatusTone,
} from "./checkout-presentation";
import { HoldCountdown } from "./hold-countdown";
import { ScreenShell } from "./screen-shell";
import { styles } from "./theme";

type CheckoutScreenClient = Pick<
  CheckoutClient,
  "acceptOffer" | "leave" | "openEvents" | "purchase"
>;

const statusToneStyles = {
  danger: styles.statusDanger,
  info: styles.statusInfo,
  neutral: styles.statusNeutral,
  success: styles.statusSuccess,
  warning: styles.statusWarning,
} satisfies Record<CheckoutStatusTone, object>;

interface OfferAcceptanceProps {
  client: Pick<CheckoutClient, "acceptOffer">;
  context: CheckoutClientContext;
  currentVersion: number;
}

function OfferAcceptance({
  client,
  context,
  currentVersion,
}: OfferAcceptanceProps) {
  const acceptOffer = useAcceptCheckoutOffer(client, context);

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: acceptOffer.isPending }}
        disabled={acceptOffer.isPending}
        onPress={() => acceptOffer.mutate(currentVersion)}
        style={[
          styles.button,
          acceptOffer.isPending ? styles.buttonDisabled : undefined,
        ]}
      >
        <Text style={styles.buttonText}>
          {acceptOffer.isPending ? "Accepting price…" : "Accept new price"}
        </Text>
      </Pressable>
      {acceptOffer.error ? (
        <Text role="alert" style={styles.error}>
          The current price could not be accepted. Please try again.
        </Text>
      ) : null}
    </View>
  );
}

interface CheckoutActionProps {
  action: "purchase" | "retry_purchase";
  allowedActions: CheckoutSnapshot["allowedActions"];
  client: Pick<CheckoutClient, "purchase">;
  clockAnchor: ClockAnchor;
  context: CheckoutClientContext;
}

function CheckoutAction({
  action,
  allowedActions,
  client,
  clockAnchor,
  context,
}: CheckoutActionProps) {
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
      {purchase.error ? (
        <Text role="alert" style={styles.error}>
          The purchase could not be completed. Please try again.
        </Text>
      ) : null}
    </View>
  );
}

function CheckoutPurchaseProgress() {
  return (
    <View accessibilityLiveRegion="polite" style={styles.section}>
      <View style={[styles.button, styles.buttonDisabled]}>
        <Text style={styles.buttonText}>Completing purchase…</Text>
      </View>
    </View>
  );
}

function CheckoutStatusPanel({
  realtimeStatus,
  status,
}: {
  realtimeStatus: RealtimeStatus;
  status: CheckoutSnapshot["status"];
}) {
  const presentation = checkoutStatusPresentation[status];
  const copy = checkoutCopy[status];

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.statusPanel, statusToneStyles[presentation.tone]]}
    >
      <Text style={styles.statusHeading}>{copy.heading}</Text>
      <Text style={styles.statusBody}>{copy.description}</Text>
      <Text style={styles.statusConnection}>
        {realtimeStatusCopy[realtimeStatus]}
      </Text>
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
            {requiresOfferReview ? (
              <Text
                accessibilityLabel={`Previously accepted price ${formatUsd(offer.acceptedTotalCents)}`}
                style={styles.previousPrice}
              >
                {formatUsd(offer.acceptedTotalCents)}
              </Text>
            ) : null}
            <Text style={styles.price}>
              {formatUsd(offer.currentTotalCents)}
            </Text>
          </View>
        </View>
        {showAcceptOffer ? (
          <OfferAcceptance
            client={client}
            context={context}
            currentVersion={offer.currentVersion}
          />
        ) : null}
        {order === undefined ? null : (
          <Text style={styles.success}>Order {order.id} confirmed</Text>
        )}
      </View>

      <CheckoutStatusPanel
        realtimeStatus={realtimeStatus}
        status={snapshot.status}
      />

      {isTerminal ? null : (
        <View style={[styles.card, styles.actionCard]}>
          <HoldCountdown clockAnchor={clockAnchor} />
          {purchaseAction === undefined ? (
            snapshot.status === "purchase_pending" ? (
              <CheckoutPurchaseProgress />
            ) : null
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
