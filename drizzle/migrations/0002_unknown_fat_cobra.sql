CREATE TABLE `external_category_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`category_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_category_mappings_provider_external_unique` ON `external_category_mappings` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `external_category_mappings_category_idx` ON `external_category_mappings` (`category_id`);