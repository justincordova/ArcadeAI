import { Builder } from "@/components/builder/Builder.js";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/game/new")({
  component: GameNewPage,
});

function GameNewPage() {
  return <Builder />;
}
