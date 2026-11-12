CREATE TABLE `xlsx_product_state` (
	`product_id` text PRIMARY KEY NOT NULL,
	`grouping_model` text NOT NULL,
	`category_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "xlsx_product_state_model_valid" CHECK("xlsx_product_state"."grouping_model" IN ('standalone', 'group'))
);
