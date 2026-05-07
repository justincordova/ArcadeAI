import { QueryClient, type QueryFunction } from "@tanstack/react-query";
import { fetchMe } from "./auth.js";

// Default queryFn dispatches by queryKey[0]. Several components do
// `useQuery({ queryKey: ['me'] })` without supplying a queryFn — they rely
// on the cache being seeded by `_authed.beforeLoad`'s `ensureQueryData`,
// which works for /authed routes but not for /sign-in or any future route
// that mounts those components without going through the guard. The
// default queryFn handles both cases.
const defaultQueryFn: QueryFunction = async ({ queryKey }) => {
  const key = queryKey[0];
  if (key === "me") return fetchMe();
  throw new Error(`No default queryFn for queryKey: ${JSON.stringify(queryKey)}`);
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { queryFn: defaultQueryFn },
  },
});
