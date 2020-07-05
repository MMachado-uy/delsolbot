# DELSOLBOT

![imagen version node](https://img.shields.io/badge/node-v10.10.0-green.svg "Nodejs")
![imagen version npm](https://img.shields.io/badge/npm-v6.4.1-green.svg "npm")
![GitHub](https://img.shields.io/github/license/mashape/apistatus.svg)

[ES]
Cómo no perderse de la radio usando el reproductor de medios integrado en Telegram.

[EN]
How not to miss your radio shows using Telegram's integrated media player.

## Que es esto? / What is this?

[ES]
Este script corre un cron job, que en cada ejecución, busca en las fuentes RSS detalladas en la base de datos, busca episodios nuevos y los publica en un canal de Telegram por cada fuente RSS, luego de agregar la metadata correspondiente a cada episodio. Una vez terminado, publica un Tweet con los detalles de lo publicado y un link al audio en Telegram.

[EN]
This script runs a cronjob that looks for new episodes in the RSS sources detailed in a database, and then publishes them in a Telegram Channel per RSS source, but only after it edits each audio file's metadata. After it's done, publishes a Tweet with details of the episode and a link to the audio in Telegram.

## Disclaimer

Todo el code is en espanglish. Es costumbre. Prometo cambiarlo.

All the code is in a spanish/english mix. Sorry about that.

## Getting started

[ES]
Instrucciones para clonar y ejecutar este proyecto en tu equipo local.
[EN]
Instructions to clone and run this project in a local environment.

### Requisitos / Requirements

- Node 10+
- Npm 6.4+
- MySql

### Instalar / Installing

[ES]

- Clona este repositorio `$ git clone https://github.com/MMachado-uy/delsolbot.git`
- Dentro de la carpeta del proyecto ejecuta `$ npm install`
- Ejecutar los scripts contenidos en `./database/`
- Crear un archivo _.env_ con los siguientes parametros:
  - DB
  - DB_USER
  - DB_PASS
  - DB_PORT
  - DB_HOST
  - TWITTER_CONSUMER_KEY
  - TWITTER_CONSUMER_SECRET
  - TWITTER_ACCESS_TOKEN_KEY
  - TWITTER_ACCESS_TOKEN_SECRET
  - BOT_TOKEN
  - TEST_CHANNEL
  - ENV
  - CRON
- En la raíz del proyecto ejecutar `$ node app.js`

[EN]

- Clone this repo `$ git clone https://github.com/MMachado-uy/delsolbot.git`
- In the project's folder, run `$ npm install`
- Run the sql scripts in `./database/`
- Create a _.env_ file with the following entries:
  - DB
  - DB_USER
  - DB_PASS
  - DB_PORT
  - DB_HOST
  - TWITTER_CONSUMER_KEY
  - TWITTER_CONSUMER_SECRET
  - TWITTER_ACCESS_TOKEN_KEY
  - TWITTER_ACCESS_TOKEN_SECRET
  - BOT_TOKEN
  - TEST_CHANNEL
  - ENV
  - CRON
- To run the script itself, run `$ node app.js`

***Importante: para ejecuciones en ambiente local, redirigir los posteos a un canal de Testing***

***Important: For local runs, always try to hardcode the target channel to a Testing one***

## Contribuciones / Contributions

[ES]
Pull Requests son bienvenidos.
Refactors, bugfixes, todo suma. Pero veámoslo en un Issue primero :)

[EN]
Pull Requests are welcome.
Refactors and bugfixes only help us. But let's discuss them in an open Issue first :)

## Autores / Authors

- **Mauricio Machado** - *Trabajo Inicial* - [MMachado-uy](https://github.com/MMachado-uy)

- **Mauricio Machado** - *Initial Work* - [MMachado-uy](https://github.com/MMachado-uy)

[ES]
Va tambien la lista de [colaboradores](https://github.com/MMachado-uy/delsolbot/graphs/contributors) que participaron en el proyecto.

[EN]
You can find all the collaborators [here](https://github.com/MMachado-uy/delsolbot/graphs/contributors).

## Licencia / License

[ES]
Este proyecto está bajo la licencia de código abierto del MIT, ve a  [LICENSE.md](LICENSE.md) por más detalles (en inglés).

[EN]
This project is under the Open Source MIT License, take a look at [LICENSE.md](LICENSE.md) for more details.
