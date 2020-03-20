ALTER TABLE `podcasts` 
    ADD COLUMN `destino` INT NOT NULL AFTER `file_id`,
    ADD INDEX `fk_podcasts_1_idx` (`destino` ASC);
;
ALTER TABLE `podcasts` 
    ADD CONSTRAINT `fk_podcasts_1`
            FOREIGN KEY (`destino`)
            REFERENCES `sources` (`id`)
            ON DELETE RESTRICT
            ON UPDATE CASCADE;
