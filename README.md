![imagen version node](https://img.shields.io/badge/node-v10.10.0-green.svg "Nodejs")
![imagen version npm](https://img.shields.io/badge/npm-v6.4.1-green.svg "npm")
![GitHub](https://img.shields.io/github/license/mashape/apistatus.svg)



# DELSOLBOT
Cómo no perderse de la radio usando el reproductor de medios integrado en Telegram y publicando utilizando sus canales.

## Disclaimer
Todo el code is en espanglish. Es costumbre. Prometo cambiarlo.


All the code is in a spanish/english mix. Sorry about that.

## Getting started
Instrucciones para clonar y ejecutar este proyecto en tu equipo local.

### Requisitos
- Node 10
- Npm 6.4
- MySql

### Instalar
- Clona este repositorio `$ git clone https://github.com/MMachado-uy/delsolbot.git`
- Dentro de la carpeta del proyecto ejecuta `$ npm install`
- Ejecutar los scripts contenidos en `./database/`
- Crear un archivo _.env_ con los siguientes parametros:
    - DB
    - DB_USER
    - DB_PASS
    - DB_PORT
    - DB_HOST
    - BOT_TOKEN
- En la raíz del proyecto ejecutar `$ node app.js`

***Importante: para ejecuciones en ambiente local, redirigir los posteos al canal @delsoltest***

## Contribuciones
Pull Requests son bienvenidos.
Refactors, bugfixes, todo suma. Pero veámoslo en un Issue primero :)

## Autores
* **Mauricio Machado** - *Trabajo Inicial* - [MMachado-uy](https://github.com/MMachado-uy)

Va tambien la lista de [colaboradores](https://github.com/MMachado-uy/delsolbot/graphs/contributors) que participaron en el proyecto.

## Licencia
Este proyecto está bajo la licencia de código abierto del MIT, ve a  [LICENSE.md](LICENSE.md) por más detalles (en inglés).