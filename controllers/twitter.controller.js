const env = require('dotenv').config().parsed;

const Twitter = require('twitter');
var fs = require('fs');

module.exports = class TwController {

    constructor() {
        this.TwCli = new Twitter({
            consumer_key: process.env.TWITTER_CONSUMER_KEY,
            consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
            access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
            access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRETt
        })
    }

    /**
     * Maneja la integracion con la Twitter API
     * @param {String} message_id - El id del mensaje, devuelto por la Telegram API
     * @param {String} imagen - URL de la imagen asociada al episodio.
     * @param {String} titulo - El titulo del episodio
     * @param {String} canal - Canal al que corresponde el episodio
     * @returns {Promise}
     */
    tweetit(message_id, imagen, titulo, canal) {
        return new Promise((resolve, reject) => {
            this.subirMedia(imagen)
            .then(res => {
                return this.tweet(res, message_id, titulo, canal)
            })
            .then(res => {
                resolve(res)
            })
            .catch(err => {
                reject(err)
            })
        })
    }

    /**
     * Maneja la subida de imagenes de episodio
     * @param {String} filePath - Ruta local de la imagen asociada al episodio
     * @returns {Promise} - La respuesta a la subida de imagenes
     */
    subirMedia(filePath = 'cover.jpg') {

        let media = fs.readFileSync(filePath);
        let media_data = fs.readFileSync(filePath, {encoding: 'base64'});

        let payload = {
            media,
            media_data
        };

        return this.TwCli.post('media/upload', payload);
    }

    /**
     * Envia el tweet con la referencia al mensaje en el canal de Telegram correspondiente
     * @param {String} imagen - Ubicacion local de la imagen descargada
     * @param {String} message_id - Id del mensaje a referenciar
     * @param {String} titulo - Titulo del episodio
     * @param {String} canal - Nombre del canal asociado al episodio
     */
    tweet(imagen, message_id, titulo, canal) {
        canal = canal.substr(1, canal.length)
        let url = `https://t.me/${canal}/${message_id}`
        let cuerpo = `\n¿Te lo perdiste? Está en Telegram: `
        let hashtags = `\n#DelSolEnTelegram #DelSol`
        let status = `${titulo}${cuerpo}${url}${hashtags}`

        if (status.length > 280) {
            if (titulo.length + url.length + hashtags.length < 278) { // 280 - '\n'.length
                status = `${titulo}\n${url}${hashtags}`
            } else {
                let n = titulo.length + url.length + hashtags.length + 2 // Largo del mensaje
                n = n - 280 // Sobrante del maximo
                n = titulo.length - n - 3

                titulo = titulo.substr(0, n)
                titulo += '...'

                status = `${titulo}\n${url}${hashtags}`
            }
        }

        let payload = {
            status,
            media_ids: imagen.media_id_string
        }
        return this.TwCli.post('statuses/update', payload)
    }
}