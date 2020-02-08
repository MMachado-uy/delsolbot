const axios = require('axios');
const FormData = require('form-data');
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
    return new Promise((resolve, reject) => {
        const connectcionUrl = 'https://api.telegram.org/bot309354292:AAFszR4i7um_3tsVk8Ea9FkHa1HqoGx-QU4/sendAudio';

        const form = new FormData();
        const stream = fs.createReadStream(path);

        form.append('audio', stream);
        form.append('disable_notification', 'true');
        form.append('parse_mode', 'html');
        form.append('caption', 'Mensaje de prueba');
        form.append('chat_id', '@pHJWbiFfZ1iY');
        form.append('performer', 'Mauricio');
        form.append('title', 'Audio de Prueba');

        const formHeaders = form.getHeaders();

        axios.post(connectcionUrl, form, { headers: {...formHeaders}})
        .then(result => {
          resolve(result);
          console.log(result.data);
        }).catch(err => reject(err));
    })
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