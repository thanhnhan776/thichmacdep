CREATE TABLE `xlsx_product_images` (
	`product_id` text NOT NULL,
	`source_url` text NOT NULL,
	`image_id` text NOT NULL,
	`position` integer NOT NULL,
	`created_by_xlsx` integer NOT NULL,
	PRIMARY KEY(`product_id`, `source_url`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `product_images`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "xlsx_product_images_owned_valid" CHECK("xlsx_product_images"."created_by_xlsx" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `xlsx_product_images_image_idx` ON `xlsx_product_images` (`image_id`);