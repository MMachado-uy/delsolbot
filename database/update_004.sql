ALTER TABLE `podcasts`
    ADD COLUMN `title` VARCHAR(120) AFTER `archivo`,
    ADD COLUMN `caption` TEXT AFTER `title`,
    ADD COLUMN `url` VARCHAR(120) AFTER `caption`,
    ADD COLUMN `msg_id` VARCHAR(20) AFTER `pudo_subir`;