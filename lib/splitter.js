const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const { log, logError, debug, getFileSizeInMB } = require('./helpers');

const TELEGRAM_THRESHOLD = 50;
const MAX_DISTANCE_FROM_SILENCE = 10;

/**
 * Divide un archivo de audio en varias partes basándose en su tamaño, ajustando los cortes a puntos de silencio.
 * @param {string} filePath Ruta al archivo de entrada.
 * @param {string} outputBase Nombre base para los archivos de salida.
 * @returns {Promise<string[]>} Rutas a las partes generadas.
 */
const splitEpisode = async (filePath, outputBase = 'output') => {
    const dirName = path.dirname(filePath);
    const fileSize = getFileSizeInMB(filePath);

    if (fileSize <= TELEGRAM_THRESHOLD) {
        return [filePath];
    }

    try {
        log(`El archivo (${fileSize.toFixed(2)} MB) excede el límite. Dividiendo...`);

        const duration = await getAudioDuration(filePath);
        const silentSegments = await findSilences(filePath);
        const numParts = Math.ceil(fileSize / TELEGRAM_THRESHOLD);
        const idealPartDuration = duration / numParts;

        const splitTimes = calculateSplitTimes(idealPartDuration, silentSegments, duration);

        const parts = [];
        for (let i = 0; i < splitTimes.length; i++) {
            const start = splitTimes[i];
            const end = splitTimes[i + 1] || null;

            const outputFile = path.join(dirName, `${outputBase}_(parte_${i + 1}).mp3`);

            await splitPart(filePath, start, end, outputFile);
            parts.push(outputFile);
        }

        log('División completa:', parts);

        return parts;
    } catch (err) {
        logError(`Error al dividir el archivo: ${err.message}`);
        throw err;
    }
};

/**
 * Encuentra los silencios en un archivo de audio.
 * @param {string} filePath Ruta al archivo de entrada.
 * @returns {Promise<Array<{ start: number, end: number }>>} Lista de segmentos de silencio (inicio/fin en segundos).
 */
const findSilences = (filePath) => {
    return new Promise((resolve, reject) => {
        const silenceSegments = [];
        let currentStart = null;

        ffmpeg(filePath)
            .audioFilter('silencedetect=n=-30dB:d=0.5')
            .format('null')
            .on('stderr', (line) => {
                const silenceStartMatch = line.match(/silence_start:\s+(\d+(\.\d+)?)/u);
                const silenceEndMatch = line.match(/silence_end:\s+(\d+(\.\d+)?)/u);

                if (silenceStartMatch) {
                    currentStart = parseFloat(silenceStartMatch[1]);
                }

                if (silenceEndMatch && currentStart !== null) {
                    silenceSegments.push({ start: currentStart, end: parseFloat(silenceEndMatch[1]) });
                    currentStart = null;
                }
            })
            .on('end', () => resolve(silenceSegments))
            .on('error', (err) => reject(new Error(`Error detectando silencios: ${err.message}`)))
            .output('-')
            .run();
    });
};

/**
 * Calcula los tiempos de corte ajustados a los silencios más cercanos.
 * @param {number} idealPartDuration Duración ideal de cada segmento.
 * @param {Array<{ start: number, end: number }>} silentSegments Lista de segmentos de silencio.
 * @param {number} totalDuration Duración total del archivo de audio.
 * @returns {number[]} Lista de tiempos de corte ajustados a los silencios.
 */
const calculateSplitTimes = (idealPartDuration, silentSegments, totalDuration) => {
    const splitTimes = [0];
    const usedSilences = new Set();

    for (let i = 1; i < Math.ceil(totalDuration / idealPartDuration); i++) {
        const idealTime = i * idealPartDuration;

        let closestSilence = null;
        let closestDistance = Infinity;

        for (const segment of silentSegments) {
            const midSilence = (segment.start + segment.end) / 2;

            // Verificar si este silencio ya fue utilizado
            if (usedSilences.has(midSilence)) continue;

            const distance = Math.abs(midSilence - idealTime);

            if (distance < closestDistance && distance <= MAX_DISTANCE_FROM_SILENCE) {
                closestDistance = distance;
                closestSilence = midSilence;
            }
        }

        if (closestSilence !== null) {
            splitTimes.push(closestSilence);
            usedSilences.add(closestSilence);
        } else {
            splitTimes.push(idealTime);
        }
    }

    debug({ splitTimes });

    return splitTimes;
};

/**
 * Genera un segmento del archivo.
 * @param {string} inputFile Ruta del archivo original.
 * @param {number} start Tiempo de inicio del segmento (en segundos).
 * @param {number|null} end Tiempo de fin del segmento (en segundos), o `null` para procesar hasta el final.
 * @param {string} outputFile Ruta del archivo de salida.
 * @returns {Promise<void>}
 */
const splitPart = (inputFile, start, end, outputFile) => {
    debug({inputFile, start, end, outputFile});

    return new Promise((resolve, reject) => {
        const command = ffmpeg(inputFile)
            .output(outputFile)
            .audioCodec('copy')
            .on('end', () => {
                const fileSize = getFileSizeInMB(outputFile);
                if (fileSize < 0.1) {
                    logError(`Archivo generado demasiado pequeño: ${outputFile} (${fileSize} MB)`);

                    reject(new Error(`Archivo resultante corrupto: ${outputFile}`));
                } else {
                    log(`Parte generada correctamente: ${outputFile} (${fileSize.toFixed(2)} MB)`);
                    resolve();
                }
            })
            .on('error', (err) => {
                logError(`Error al procesar ${outputFile}: ${err.message}`);
                reject(err);
            });

        if (start !== null) command.setStartTime(start);
        if (end !== null) command.setDuration(end - start);

        command.run();
    });
};

/**
 * Obtiene la duración de un archivo de audio en segundos.
 * @param {string} filePath Ruta al archivo de entrada.
 * @returns {Promise<number>} La duración del archivo en segundos.
 */
const getAudioDuration = (filePath) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                reject(new Error(`Error obteniendo la duración del audio: ${err.message}`));
            } else {
                resolve(metadata.format.duration);
            }
        });
    });
};

module.exports = { splitEpisode };
