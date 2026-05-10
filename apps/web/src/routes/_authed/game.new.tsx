import { Builder } from "@/components/builder/Builder.js";
import { createFileRoute } from "@tanstack/react-router";

interface NewGameSearch {
  prompt?: string;
}

export const Route = createFileRoute("/_authed/game/new")({
  validateSearch: (search: Record<string, unknown>): NewGameSearch => ({
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
  }),
  component: GameNewPage,
});

function GameNewPage() {
  const { prompt } = Route.useSearch();
  return <Builder initialPrompt={prompt} />;
}
