export const GENRE_BUCKETS = [
  "paddle",
  "snake",
  "flappy",
  "shooter",
  "platformer",
  "puzzle",
  "runner",
  "other",
] as const;

export type GenreBucket = (typeof GENRE_BUCKETS)[number];
