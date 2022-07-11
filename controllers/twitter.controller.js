require('dotenv').config();

const Twitter = require('twitter');
const fs = require('fs');

module.exports = class TwController {
  constructor () {
    this.TwCli = new Twitter({
      consumer_key: process.env.TWITTER_CONSUMER_KEY,
      consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
      access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
      access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
    });
  }

  /**
     * Maneja la integracion con la Twitter API
     * @param {String} messageId - El id del mensaje, devuelto por la Telegram API
     * @param {String} imagen - URL de la imagen asociada al episodio.
     * @param {String} titulo - El titulo del episodio
     * @param {String} canal - Canal al que corresponde el episodio
     * @returns {Promise}
     */
  tweetit (messageId, imagen, titulo, canal) {
    return new Promise((resolve, reject) => {
      this.subirMedia(imagen)
        .then(res => {
          return this.tweet(res, messageId, titulo, canal);
        })
        .then(res => {
          resolve(res);
        })
        .catch(err => {
          reject(err);
        });
    });
  }

  /**
     * Maneja la subida de imagenes de episodio
     * @param {String} filePath - Ruta local de la imagen asociada al episodio
     * @returns {Promise} - La respuesta a la subida de imagenes
     */
  subirMedia (filePath = '../assets/cover.jpg') {
    const media = fs.readFileSync(filePath);
    const mediaData = fs.readFileSync(filePath, { encoding: 'base64' });

    const payload = {
      media,
      media_data: mediaData
    };

    return this.TwCli.post('media/upload', payload);
  }

  /**
     * Envia el tweet con la referencia al mensaje en el canal de Telegram correspondiente
     * @param {String} imagen - Ubicacion local de la imagen descargada
     * @param {String} messageId - Id del mensaje a referenciar
     * @param {String} titulo - Titulo del episodio
     * @param {String} canal - Nombre del canal asociado al episodio
     */
  tweet (imagen, messageId, titulo, canal) {
    const url = `https://t.me/${canal.substr(1, canal.length)}/${messageId}`;
    const cuerpo = '\n¿Te lo perdiste? Está en Telegram: ';
    const hashtags = '\n#DelSolEnTelegram #DelSol';
    let status = `${titulo}${cuerpo}${url}${hashtags}`;

    if (status.length > 280) {
      // 280 - '\n'.length
      if (titulo.length + url.length + hashtags.length < 278) {
        status = `${titulo}\n${url}${hashtags}`;
      } else {
        // Largo del mensaje
        let n = titulo.length + url.length + hashtags.length + 2;
        n -= 280;
        n = titulo.length - n - 3;

        status = `${titulo.substr(0, n)}...\n${url}${hashtags}`;
      }
    }

    const payload = {
      status,
      media_ids: imagen.media_id_string
    };

    return this.TwCli.post('statuses/update', payload);
  }
};
