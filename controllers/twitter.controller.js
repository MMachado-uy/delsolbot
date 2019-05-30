const Twitter = require('twitter')

module.exports = class TwController {

    constructor(key, secret, token_key, token_secret) {
        this.TwCli = new Twitter({
            consumer_key: key,
            consumer_secret: secret,
            access_token_key: token_key,
            access_token_secret: token_secret
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
            subirMedia(imagen)
            .then(res => {
                return tweet(res, message_id, titulo, canal)
            })
            .then(res => {
                resolve()
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

        let media = fs.readFileSync(filePath)
        let media_data = new Buffer(media).toString('base64')

        let payload = {
            media,
            media_data
        }

        return this.TwCli.post('media/upload', payload)
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
        let cuerpo = `\nTe lo perdiste? Está en Telegram: `
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