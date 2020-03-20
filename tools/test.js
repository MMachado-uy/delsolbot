const axios = require('axios');
const requestP = require('request-promise-native');
const fs = require('fs');
const path = './coso.mp3';

const getFile = async () => {
    const stream = fs.createWriteStream(path);
    const response = await axios.get('https://cdn.dl.uy/solmp3/17069.mp3', {responseType: 'stream'});
    response.data.pipe(stream);    
    
    return new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);        
    });
}

const sendFile = () => {
        const connectcionUrl = 'https://api.telegram.org/bot309354292:AAFszR4i7um_3tsVk8Ea9FkHa1HqoGx-QU4/sendAudio';

        const stream = fs.createReadStream(path);

        const payload = {
            audio: stream,
            disable_notification: 'true',
            parse_mode: 'html',
            caption: 'Mensaje de prueba',
            chat_id: '@pHJWbiFfZ1iY',
            performer: 'Mauricio',
            title: 'Audio de Prueba'
        }

        // const formHeaders = form.getHeaders();

        return requestP.post({
            url: connectcionUrl,
            formData: payload,
            json: true
        })
        // .then((res) => {
        //     fs.unlink(episodePath, err => {
        //         if (err) {
        //             reject([`${performer} - ${title} sendEpisodeToChannel`, err])
        //         } else {
        //             resolve({ file_id: res.result.audio.file_id, message_id: res.result.message_id })
        //         }
        //     })
        // }).catch(err => {
        //     fs.unlinkSync(episodePath)
        //     reject([`${performer} - ${title} sendEpisodeToChannel`, err.message])
        // })

        // axios.post(connectcionUrl, form, { headers: {...formHeaders}})
        // .then(result => {
        //   resolve(result);
        //   console.log(result.data);
        // }).catch(err => reject(err));
}

const main = async () => {
    try{
        await getFile();
        console.log('got the file');
    } catch(err) {
        console.log('error getting the file: ', err);
    } finally {
        console.log('finally got the file');
    }

    try {
        const sent = await sendFile();
        console.log('sent the file: ', sent);
    } catch(err) {
        console.log('error sending the file: ', err);
    } finally {
        console.log('finally after sent');
    }
}

main();