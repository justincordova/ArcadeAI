CREATE TABLE `game_likes` (
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_game_likes_unique` ON `game_likes` (`game_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_game_likes_user` ON `game_likes` (`user_id`);--> statement-breakpoint
ALTER TABLE `games` ADD `play_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `like_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_games_public_published` ON `games` (`is_public`,`published_at`);