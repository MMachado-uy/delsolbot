-- Widen podcasts columns that were close to (or below) the real data sizes.
-- A too-narrow column truncates silently (or, under STRICT sql_mode, errors the
-- INSERT) — corrupting the `archivo` dedupe key or losing long episode URLs.
ALTER TABLE `podcasts`
    MODIFY COLUMN `archivo` VARCHAR(64) NOT NULL,
    MODIFY COLUMN `title` VARCHAR(255),
    MODIFY COLUMN `url` VARCHAR(512);
