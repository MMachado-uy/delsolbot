ALTER TABLE sources
    ADD COLUMN nombre VARCHAR(80);


ALTER TABLE podcasts
    ADD COLUMN file_id VARCHAR(50)
    MODIFY COLUMN obs TEXT;

UPDATE `sources` SET nombre='No Toquen Nada' WHERE channel='@NoToquenNadaTelegram';
UPDATE `sources` SET nombre='Darwin Desbocatti' WHERE channel='@DarwinDesbocattiTelegram';
UPDATE `sources` SET nombre='Quién te Dice?' WHERE channel='@QuienTeDiceTelegram';
UPDATE `sources` SET nombre='La Mesa de los Galanes' WHERE channel='@LaMesaTelegram';
UPDATE `sources` SET nombre='Fácil Desviarse' WHERE channel='@FacilDesviarseTelegram';
UPDATE `sources` SET nombre='Trece a Cero' WHERE channel='@TreceACeroTelegram';
UPDATE `sources` SET nombre='La Venganza Será Terrible' WHERE channel='@LaVenganzaTelegram';
UPDATE `sources` SET nombre='Abran Cancha' WHERE channel='@AbranCanchaTelegram';