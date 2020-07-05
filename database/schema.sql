CREATE TABLE IF NOT EXISTS podcasts (
	id INT PRIMARY KEY AUTO_INCREMENT,
    archivo VARCHAR(15) NOT NULL,
    obs VARCHAR(120),
    pudo_subir BOOLEAN,
    fecha_procesado TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sources (
	id INT PRIMARY KEY AUTO_INCREMENT,
    url VARCHAR(120) NOT NULL,
    channel varchar(120) NOT NULL
);

