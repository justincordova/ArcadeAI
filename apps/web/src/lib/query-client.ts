import { QueryClient } from "@tanstack/react-query";

// Every useQuery call site is required to pass an explicit queryFn. The old
// default that dispatched on queryKey[0] === "me" was a footgun: any
// useQuery({ queryKey: ['me'] }) would silently work in the right places and
// silently fail elsewhere depending on whether the cache had been seeded.
// Explicit fns make the contract obvious at the call site.
export const queryClient = new QueryClient();
