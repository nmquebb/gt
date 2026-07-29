import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";

export const unstable_settings = {
  initialRouteName: "index",
};

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 15_000 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Stack>
        <Stack.Screen name="index" options={{ title: "Gametime Checkout" }} />
        <Stack.Screen
          name="checkout/[sessionId]"
          options={{ title: "Checkout" }}
        />
      </Stack>
    </QueryClientProvider>
  );
}
