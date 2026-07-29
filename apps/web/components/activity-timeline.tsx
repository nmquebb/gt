"use client";

import { useQuery } from "@tanstack/react-query";
import { useCheckoutScreen } from "@/lib/checkout-screen-context";

function toLabel(type: string) {
  return type
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export function ActivityTimeline() {
  const { client, context } = useCheckoutScreen();
  const activity = useQuery({
    queryKey: ["checkout-activity", context.sessionId],
    queryFn: () => client.activity(context),
  });

  if (activity.error) {
    return <p className="text-sm text-neutral-600">Activity is unavailable.</p>;
  }
  if (activity.data === undefined) {
    return null;
  }

  return (
    <section
      aria-labelledby="activity-heading"
      className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
    >
      <h2 className="text-sm font-medium" id="activity-heading">
        Activity
      </h2>
      <ol className="space-y-2 text-sm text-neutral-500">
        {activity.data.map((entry) => (
          <li key={entry.id}>{toLabel(entry.type)}</li>
        ))}
      </ol>
    </section>
  );
}
