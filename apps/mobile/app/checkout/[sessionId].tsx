import * as Linking from "expo-linking";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  CheckoutClientError,
  createCheckoutClient,
  type CheckoutClientContext,
  type CheckoutCommandResult,
} from "@checkout/sdk";
import {
  parseCheckoutDeepLink,
  type CheckoutRouteContext,
} from "../../src/checkout-route";
import { CheckoutScreen } from "../../src/checkout-screen";
import { getMobileDeviceId } from "@/lib/device-id";
import { ScreenShell } from "@/components/screen-shell";
import { styles } from "@/theme/styles";

const apiUrl = "http://127.0.0.1:3000";

type ResumeFailure = "unauthorized" | "not-found" | "offline" | "error";

function CheckoutBootstrap({ sessionId, token }: CheckoutRouteContext) {
  const [client] = useState(() =>
    createCheckoutClient({
      baseUrl: apiUrl,
      fetch: globalThis.fetch,
      monotonicNow: () => performance.now(),
    }),
  );
  const [context, setContext] = useState<CheckoutClientContext>();
  const [result, setResult] = useState<CheckoutCommandResult>();
  const [failure, setFailure] = useState<ResumeFailure>();
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setContext(undefined);
    setResult(undefined);
    setFailure(undefined);

    async function resume() {
      const nextContext: CheckoutClientContext = {
        deviceId: await getMobileDeviceId(),
        resumeToken: token,
        sessionId,
        surface: "mobile",
      };

      try {
        const resumed = await client.resume(nextContext);
        if (active) {
          setContext(nextContext);
          setResult(resumed);
        }
      } catch (error) {
        if (!active) {
          return;
        }
        if (
          error instanceof CheckoutClientError &&
          error.code === "UNAUTHORIZED_SESSION"
        ) {
          setFailure("unauthorized");
        } else if (
          error instanceof CheckoutClientError &&
          error.code === "CHECKOUT_SESSION_NOT_FOUND"
        ) {
          setFailure("not-found");
        } else if (
          error instanceof CheckoutClientError &&
          error.code === "NETWORK_UNAVAILABLE"
        ) {
          setFailure("offline");
        } else {
          setFailure("error");
        }
      }
    }

    void resume();

    return () => {
      active = false;
    };
  }, [client, retryAttempt, sessionId, token]);

  if (context !== undefined && result !== undefined) {
    return (
      <CheckoutScreen
        client={client}
        context={context}
        initialResult={result}
      />
    );
  }

  const presentation =
    failure === undefined
      ? {
          heading: "Loading checkout",
          message: "Connecting to your checkout session…",
        }
      : failure === "unauthorized"
        ? {
            heading: "Checkout unavailable",
            message: "This checkout link is no longer authorized.",
          }
        : failure === "not-found"
          ? {
              heading: "Checkout unavailable",
              message: "This checkout session could not be found.",
            }
          : failure === "offline"
            ? {
                heading: "You’re offline",
                message: "Reconnect to the internet, then try again.",
              }
            : {
                heading: "Checkout unavailable",
                message: "Checkout could not be loaded.",
              };

  return (
    <ScreenShell>
      <View style={styles.card}>
        <Text style={styles.heading}>{presentation.heading}</Text>
        <Text
          role={failure === "error" ? "alert" : undefined}
          style={failure === "error" ? styles.error : styles.muted}
        >
          {presentation.message}
        </Text>
        {failure === "offline" ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setRetryAttempt((attempt) => attempt + 1)}
            style={[styles.button, styles.outlineButton]}
          >
            <Text style={[styles.buttonText, styles.outlineButtonText]}>
              Retry
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScreenShell>
  );
}

export default function MobileCheckoutRoute() {
  const incomingUrl = Linking.useLinkingURL();
  const route = useMemo(
    () => parseCheckoutDeepLink(incomingUrl),
    [incomingUrl],
  );

  if (route === undefined) {
    return (
      <ScreenShell>
        <View style={styles.card}>
          <Text style={styles.heading}>Checkout unavailable</Text>
          <Text role="alert" style={styles.error}>
            Checkout link is invalid.
          </Text>
        </View>
      </ScreenShell>
    );
  }

  return (
    <CheckoutBootstrap key={`${route.sessionId}:${route.token}`} {...route} />
  );
}
