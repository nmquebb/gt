import {
  useAcceptCheckoutOffer,
  type CheckoutClient,
  type CheckoutClientContext,
} from "@checkout/sdk";
import { Pressable, Text, View } from "react-native";
import { styles } from "@/theme/styles";

export function OfferAcceptance({
  client,
  context,
  currentVersion,
}: {
  client: Pick<CheckoutClient, "acceptOffer">;
  context: CheckoutClientContext;
  currentVersion: number;
}) {
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
