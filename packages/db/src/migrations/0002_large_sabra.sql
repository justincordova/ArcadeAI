ALTER TABLE `user` ADD `lifetime_generations_used` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `lifetime_refinements_used` integer DEFAULT 0 NOT NULL;