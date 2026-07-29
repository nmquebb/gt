"use client";

import { z } from "zod";
import {
  CheckoutClientError,
  CheckoutProvider,
  createCheckoutClient,
  createCheckoutStore,
  hydrateClockHandoff,
  useCheckoutRealtime,
  type CheckoutClient,
  type CheckoutClientContext,
  type CheckoutSnapshot,
  type ClockHandoff,
  type RealtimeStatus,
} from "@checkout/sdk";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityTimeline } from "@/components/activity-timeline";
import { CheckoutExit } from "@/components/checkout-exit";
import { CheckoutSummary } from "@/components/checkout-summary";
import { HoldCountdown } from "@/components/hold-countdown";
import { OpenInAppButton } from "@/components/open-in-app-button";
import { PurchaseAction } from "@/components/purchase-action";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  CheckoutScreenProvider,
  type CheckoutScreenRuntime,
} from "@/lib/checkout-screen-context";
import { getWebDeviceId } from "@/lib/device-id";
import { createBrowserRealtimeEnvironment } from "@/lib/realtime-environment";

const ScenarioControls = dynamic(
  () =>
    import("@/components/scenario-controls").then(
      (module) => module.ScenarioControls,
    ),
  { ssr: false },
);

const tokenSchema = z.string().min(1);

interface CheckoutRealtimeProps {
  client: CheckoutClient;
  context: CheckoutClientContext;
  onStatusChange: (status: RealtimeStatus) => void;
}

function CheckoutRealtime({
  client,
  context,
  onStatusChange,
}: CheckoutRealtimeProps) {
  const [environment] = useState(createBrowserRealtimeEnvironment);
  const status = useCheckoutRealtime({ client, context, environment });

  useEffect(() => {
    onStatusChange(status);
  }, [onStatusChange, status]);

  return null;
}

interface CheckoutDevelopmentBoundaryProps {
  activityTimeline: ReactNode;
  holdCountdown: ReactNode;
  openInAppButton: ReactNode;
  purchaseAction: ReactNode;
  scenarioControls: ReactNode;
}

function CheckoutDevelopmentBoundary({
  activityTimeline,
  holdCountdown,
  openInAppButton,
  purchaseAction,
  scenarioControls,
}: CheckoutDevelopmentBoundaryProps) {
  return (
    <>
      <Card className="space-y-4 p-5 shadow-sm">
        {holdCountdown}
        <div className="flex flex-col gap-3 sm:flex-row">
          {purchaseAction}
          {openInAppButton}
        </div>
      </Card>
      <Separator />
      {activityTimeline}
      {scenarioControls}
    </>
  );
}

function RetryableResume({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="space-y-3">
      <p className="text-sm text-neutral-600" role="alert">
        Unable to connect to checkout. Check your connection and try again.
      </p>
      <Button onClick={onRetry} type="button" variant="outline">
        Retry connection
      </Button>
    </section>
  );
}

function CheckoutLinkError({ kind }: { kind: "not_found" | "unauthorized" }) {
  return (
    <p className="text-sm text-neutral-600">
      {kind === "unauthorized"
        ? "This checkout link is invalid."
        : "This checkout is no longer available."}
    </p>
  );
}

type ResumeState =
  | { kind: "pending" }
  | { kind: "ready"; context: CheckoutClientContext }
  | { kind: "not_found" | "unauthorized" | "error" };

interface CheckoutSubtreeProps {
  apiUrl: string;
  clientOverride?: CheckoutClient;
  clockHandoff: ClockHandoff;
  sessionId: string;
  snapshot: CheckoutSnapshot;
  token: string;
}

function CheckoutSubtree({
  apiUrl,
  clientOverride,
  clockHandoff,
  sessionId,
  snapshot,
  token,
}: CheckoutSubtreeProps) {
  const [store] = useState(() =>
    createCheckoutStore({
      snapshot,
      clockAnchor: hydrateClockHandoff(clockHandoff, performance.now()),
    }),
  );
  const [client] = useState(
    () =>
      clientOverride ??
      createCheckoutClient({
        baseUrl: apiUrl,
        fetch: globalThis.fetch,
        monotonicNow: () => performance.now(),
      }),
  );
  const [resumeState, setResumeState] = useState<ResumeState>({
    kind: "pending",
  });
  const [resumeAttempt, setResumeAttempt] = useState(0);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("idle");
  const [isPurchasePending, setIsPurchasePending] = useState(false);
  const serverRenderContext = useMemo<CheckoutClientContext>(
    () => ({
      deviceId: "server-render",
      resumeToken: token,
      sessionId,
      surface: "web",
    }),
    [sessionId, token],
  );

  useEffect(() => {
    let active = true;
    const context: CheckoutClientContext = {
      deviceId: getWebDeviceId(),
      resumeToken: token,
      sessionId,
      surface: "web",
    };

    void client.resume(context).then(
      (result) => {
        if (!active) {
          return;
        }
        store.getState().applySnapshot(result.snapshot, result.clockAnchor);
        setResumeState({ kind: "ready", context });
      },
      (error: unknown) => {
        if (!active) {
          return;
        }
        if (
          error instanceof CheckoutClientError &&
          error.code === "UNAUTHORIZED_SESSION"
        ) {
          setResumeState({ kind: "unauthorized" });
          return;
        }
        if (
          error instanceof CheckoutClientError &&
          error.code === "CHECKOUT_SESSION_NOT_FOUND"
        ) {
          setResumeState({ kind: "not_found" });
          return;
        }
        setResumeState({ kind: "error" });
      },
    );

    return () => {
      active = false;
    };
  }, [client, resumeAttempt, sessionId, store, token]);

  function retryResume() {
    setRealtimeStatus("idle");
    setResumeState({ kind: "pending" });
    setResumeAttempt((attempt) => attempt + 1);
  }

  if (resumeState.kind === "pending") {
    const runtime: CheckoutScreenRuntime = {
      client,
      context: serverRenderContext,
      isInteractive: false,
      realtimeStatus: "idle",
    };

    return (
      <CheckoutProvider store={store}>
        <CheckoutScreenProvider value={runtime}>
          <section aria-label="Checkout" className="space-y-5">
            <CheckoutExit />
            <CheckoutSummary />
            <Card className="space-y-4 p-5 shadow-sm">
              <HoldCountdown />
            </Card>
          </section>
        </CheckoutScreenProvider>
      </CheckoutProvider>
    );
  }
  if (resumeState.kind === "error") {
    return <RetryableResume onRetry={retryResume} />;
  }
  if (resumeState.kind === "not_found" || resumeState.kind === "unauthorized") {
    return <CheckoutLinkError kind={resumeState.kind} />;
  }
  if (resumeState.kind !== "ready") {
    return null;
  }

  const runtime: CheckoutScreenRuntime = {
    client,
    context: resumeState.context,
    isInteractive: true,
    realtimeStatus,
  };

  return (
    <CheckoutProvider store={store}>
      <CheckoutScreenProvider value={runtime}>
        <CheckoutRealtime
          client={client}
          context={resumeState.context}
          onStatusChange={setRealtimeStatus}
        />
        <section aria-label="Checkout" className="space-y-5">
          <CheckoutExit isPurchasePending={isPurchasePending} />
          <CheckoutSummary />
          <CheckoutDevelopmentBoundary
            activityTimeline={<ActivityTimeline />}
            holdCountdown={<HoldCountdown />}
            openInAppButton={<OpenInAppButton />}
            purchaseAction={
              <PurchaseAction onPendingChange={setIsPurchasePending} />
            }
            scenarioControls={<ScenarioControls />}
          />
        </section>
      </CheckoutScreenProvider>
    </CheckoutProvider>
  );
}

interface CheckoutClientBoundaryProps {
  apiUrl: string;
  client?: CheckoutClient;
  clockHandoff: ClockHandoff;
  sessionId: string;
  snapshot: CheckoutSnapshot;
}

export function CheckoutClientBoundary({
  apiUrl,
  client,
  clockHandoff,
  sessionId,
  snapshot,
}: CheckoutClientBoundaryProps) {
  const searchParams = useSearchParams();
  const token = useMemo(() => {
    const tokens = searchParams.getAll("token");
    if (tokens.length !== 1) {
      return undefined;
    }
    const parsed = tokenSchema.safeParse(tokens[0]);

    return parsed.success ? parsed.data : undefined;
  }, [searchParams]);

  if (token === undefined) {
    return (
      <p className="text-sm text-neutral-600">Checkout link is unavailable.</p>
    );
  }

  return (
    <CheckoutSubtree
      apiUrl={apiUrl}
      {...(client === undefined ? {} : { clientOverride: client })}
      clockHandoff={clockHandoff}
      key={`${sessionId}:${token}`}
      sessionId={sessionId}
      snapshot={snapshot}
      token={token}
    />
  );
}
