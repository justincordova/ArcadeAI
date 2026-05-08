ALTER TABLE `games` ADD `is_public` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `public_slug` text;--> statement-breakpoint
ALTER TABLE `games` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `remixed_from_game_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `games_public_slug_unique` ON `games` (`public_slug`);