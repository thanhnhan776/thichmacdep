CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_token_hash_unique` ON `admin_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `admin_sessions_user_idx` ON `admin_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `admin_sessions_expires_idx` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`google_sub` text,
	`role` text DEFAULT 'user' NOT NULL,
	`is_enabled` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "admin_users_email_normalized" CHECK("admin_users"."email" = lower(trim("admin_users"."email")) AND "admin_users"."email" GLOB '*@gmail.com' AND length("admin_users"."email") > length('@gmail.com') AND instr("admin_users"."email", '@') = length("admin_users"."email") - length('@gmail.com') + 1),
	CONSTRAINT "admin_users_role_valid" CHECK("admin_users"."role" IN ('admin', 'user')),
	CONSTRAINT "admin_users_enabled_valid" CHECK("admin_users"."is_enabled" IN (0, 1)),
	CONSTRAINT "admin_users_google_sub_nonempty" CHECK("admin_users"."google_sub" IS NULL OR length("admin_users"."google_sub") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_unique` ON `admin_users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_google_sub_unique` ON `admin_users` (`google_sub`);