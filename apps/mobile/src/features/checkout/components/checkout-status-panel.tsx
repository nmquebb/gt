import {
  checkoutCopy,
  type CheckoutSnapshot,
  type RealtimeStatus,
} from "@checkout/sdk";
import {
  checkoutStatusPresentation,
  realtimeStatusCopy,
  type CheckoutStatusTone,
} from "../checkout-presentation";
import { Text, View } from "react-native";
import { styles } from "@/theme/styles";

const statusToneStyles = {
  danger: styles.statusDanger,
  info: styles.statusInfo,
  neutral: styles.statusNeutral,
  success: styles.statusSuccess,
  warning: styles.statusWarning,
} satisfies Record<CheckoutStatusTone, object>;

export function CheckoutStatusPanel({
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
