CREATE TABLE `product_variant_images` (
	`variant_id` text NOT NULL,
	`image_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`variant_id`, `image_id`),
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `product_images`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_variant_images_position_nonnegative" CHECK(typeof("product_variant_images"."position") = 'integer' AND "product_variant_images"."position" >= 0)
);
--> statement-breakpoint
CREATE INDEX `product_variant_images_order_idx` ON `product_variant_images` (`variant_id`,`position`);