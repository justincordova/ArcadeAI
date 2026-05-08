import { API_BASE } from "./client.js";

const API = API_BASE;

export interface GameSummary {
  id: string;
  title: string;
  thumbnail: string | null;
  updatedAt: number;
}

export const GAMES_QUERY_KEY = ["games"] as const;

export async function listGames(): Promise<GameSummary[]> {
  const res = await fetch(`${API}/api/games`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch games");
  return res.json() as Promise<GameSummary[]>;
}

export async function patchGame(id: string, update: { title: string }): Promise<GameSummary> {
  const res = await fetch(`${API}/api/games/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error("Failed to rename game");
  return res.json() as Promise<GameSummary>;
}

export async function deleteGame(id: string): Promise<void> {
  const res = await fetch(`${API}/api/games/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete game");
}

export async function postThumbnail(id: string, dataUrl: string): Promise<void> {
  const res = await fetch(`${API}/api/games/${id}/thumbnail`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thumbnail: dataUrl }),
  });
  if (!res.ok) throw new Error("Failed to save thumbnail");
}
