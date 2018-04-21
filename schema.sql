CREATE TABLE podcasts (
	id INT PRIMARY KEY AUTO_INCREMENT,
    archivo VARCHAR(15) NOT NULL,
    obs VARCHAR(120),
    pudo_subir BOOLEAN,
    fecha_procesado TIMESTAMP
);

CREATE TABLE sources (
	id INT PRIMARY KEY AUTO_INCREMENT,
    url VARCHAR(120)
);

