CREATE TABLE `admin_login_challenges` (
	`nonce_hash` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL
);
