import { QueryClient } from "@tanstack/react-query";

// Every useQuery call site is required to pass an explicit queryFn. The old
// default that dispatched on queryKey[0] === "me" was a footgun: any
// useQuery({ queryKey: ['me'] }) would silently work in the right places and
// silently fail elsewhere depending on whether the cache had been seeded.
// Explicit fns make the contract obvious at the call site.
//
// Cap query retries at 1 (React Query's default is 3). Most failures here are
// deterministic — a 404 on a deleted/not-owned game, a 401 — and retrying them
// 3x with exponential backoff just shows a ~3s spinner before the inevitable
// error. One retry still absorbs a transient network blip. (A 404-aware
// predicate would be ideal but the fetch wrappers don't surface the status on
// the thrown Error yet.)
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
  },
});
