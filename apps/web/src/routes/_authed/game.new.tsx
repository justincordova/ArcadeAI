import { createFileRoute } from "@tanstack/react-router";
import { Builder } from "../../components/builder/Builder.js";

export const Route = createFileRoute("/_authed/game/new")({
  component: GameNewPage,
});

function GameNewPage() {
  return <Builder />;
}
