CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`parent_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`source_updated_at` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "categories_not_own_parent" CHECK("categories"."parent_id" IS NULL OR "categories"."parent_id" <> "categories"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE TABLE `external_product_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`product_id` text NOT NULL,
	`external_variant_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_product_mappings_provider_external_unique` ON `external_product_mappings` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `external_product_mappings_product_idx` ON `external_product_mappings` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_category` (
	`product_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`product_id`, `category_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_category_category_idx` ON `product_category` (`category_id`);--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`source_url` text NOT NULL,
	`r2_key` text,
	`alt_text` text,
	`position` integer DEFAULT 0 NOT NULL,
	`content_type` text,
	`size_bytes` integer,
	`etag` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_images_size_nonnegative" CHECK("product_images"."size_bytes" IS NULL OR (typeof("product_images"."size_bytes") = 'integer' AND "product_images"."size_bytes" >= 0))
);
--> statement-breakpoint
CREATE INDEX `product_images_product_position_idx` ON `product_images` (`product_id`,`position`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`external_variant_id` text,
	`sku` text,
	`name` text NOT NULL,
	`attributes_json` text,
	`price_minor` integer,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_variants_price_minor_nonnegative" CHECK("product_variants"."price_minor" IS NULL OR (typeof("product_variants"."price_minor") = 'integer' AND "product_variants"."price_minor" >= 0))
);
--> statement-breakpoint
CREATE INDEX `product_variants_product_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`short_description` text,
	`description` text,
	`brand_name` text,
	`price_minor` integer,
	`currency` text DEFAULT 'VND' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`source_updated_at` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "products_price_minor_nonnegative" CHECK("products"."price_minor" IS NULL OR (typeof("products"."price_minor") = 'integer' AND "products"."price_minor" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `products_sku_idx` ON `products` (`sku`);--> statement-breakpoint
CREATE INDEX `products_active_idx` ON `products` (`is_active`);--> statement-breakpoint
CREATE INDEX `products_name_idx` ON `products` (`name`);--> statement-breakpoint
CREATE TABLE `store_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`store_name` text NOT NULL,
	`default_currency` text DEFAULT 'VND' NOT NULL,
	`tiktok_url` text,
	`instagram_url` text,
	`zalo_url` text,
	`messenger_url` text,
	`other_contact_url` text,
	`logo_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_events` (
	`id` text PRIMARY KEY NOT NULL,
	`sync_run_id` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_events_run_idx` ON `sync_events` (`sync_run_id`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`trigger_type` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`created_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`deactivated_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error_summary` text,
	`cursor` text,
	`watermark` text
);
--> statement-breakpoint
CREATE TABLE `website_product_settings` (
	`product_id` text PRIMARY KEY NOT NULL,
	`seo_title` text,
	`seo_description` text,
	`marketing_description` text,
	`is_featured` integer DEFAULT false NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
