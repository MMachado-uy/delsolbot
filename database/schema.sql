CREATE TABLE IF NOT EXISTS sources (
    id INT PRIMARY KEY AUTO_INCREMENT,
    url VARCHAR(120) NOT NULL,
    channel VARCHAR(120) NOT NULL,
    nombre VARCHAR(80)
);

CREATE TABLE IF NOT EXISTS podcasts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    archivo VARCHAR(15) NOT NULL,
    title VARCHAR(120),
    caption TEXT,
    url VARCHAR(120),
    obs VARCHAR(255),
    pudo_subir BOOLEAN,
    msg_id VARCHAR(20),
    fecha_procesado TIMESTAMP,
    file_id VARCHAR(120),
    destino INT NOT NULL,
    CONSTRAINT fk_podcasts_1 FOREIGN KEY (destino)
        REFERENCES sources (id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
