ALTER TABLE `products` ADD `is_trending` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `trending_sort_order` integer DEFAULT 0 NOT NULL;