import { z } from "zod";
import { CheckoutClientError, createClockHandoff } from "@checkout/sdk";
import { CheckoutClientBoundary } from "./checkout-client-boundary";
import { createServerCheckoutClient, publicApiUrl } from "@/lib/api";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const requestSchema = z.object({
  sessionId: z.string().min(1),
  token: z.string().min(1),
});

interface CheckoutErrorProps {
  children: string;
}

function CheckoutError({ children }: CheckoutErrorProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-[640px] items-center px-4 py-10 sm:px-6">
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Checkout unavailable</h1>
        <p className="text-sm text-neutral-600">{children}</p>
      </section>
    </main>
  );
}

interface CheckoutPageProps {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function CheckoutPage({ params, searchParams }: CheckoutPageProps) {
  const [routeParams, query] = await Promise.all([params, searchParams]);
  const token = query.token;
  const validated = requestSchema.safeParse({
    sessionId: routeParams.sessionId,
    token: typeof token === "string" ? token : undefined,
  });

  if (!validated.success) {
    return <CheckoutError>This checkout link is invalid.</CheckoutError>;
  }

  const client = createServerCheckoutClient();
  let checkout;
  try {
    checkout = await client.getCheckout({
      sessionId: validated.data.sessionId,
      resumeToken: validated.data.token,
      surface: "web",
      deviceId: "server-render",
    });
  } catch (error) {
    const message =
      error instanceof CheckoutClientError &&
      (error.code === "UNAUTHORIZED_SESSION" ||
        error.code === "CHECKOUT_SESSION_NOT_FOUND")
        ? "This checkout link is invalid or no longer available."
        : "We could not load this checkout. Please try again.";

    return <CheckoutError>{message}</CheckoutError>;
  }

  return (
    <main className="mx-auto min-h-screen max-w-[640px] px-4 py-8 sm:px-6 sm:py-12">
      <CheckoutClientBoundary
        apiUrl={publicApiUrl}
        clockHandoff={createClockHandoff(
          checkout.clockAnchor,
          performance.now(),
        )}
        sessionId={validated.data.sessionId}
        snapshot={checkout.snapshot}
      />
    </main>
  );
}

export default CheckoutPage;
