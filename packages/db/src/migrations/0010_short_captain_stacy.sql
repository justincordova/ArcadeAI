CREATE INDEX `idx_verification_identifier_created` ON `verification` (`identifier`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_verification_expires_at` ON `verification` (`expires_at`);