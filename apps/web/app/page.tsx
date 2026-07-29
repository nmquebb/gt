import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { ListingList } from "@/components/listing-list";
import { createServerCheckoutClient } from "@/lib/api";
import { createQueryClient, listingsQueryOptions } from "@/lib/query-client";

export const dynamic = "force-dynamic";

async function HomePage() {
  const queryClient = createQueryClient();
  const client = createServerCheckoutClient();

  await queryClient.prefetchQuery(listingsQueryOptions(client));

  return (
    <main className="mx-auto min-h-screen max-w-[720px] px-4 py-10 sm:px-6 sm:py-14">
      <HydrationBoundary state={dehydrate(queryClient)}>
        <ListingList />
      </HydrationBoundary>
    </main>
  );
}

export default HomePage;
