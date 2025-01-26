const { spawn } = require('child_process');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');

const { logError, log, debug } = require('./helpers');

const execPromise = util.promisify(exec);

const MAX_DISTANCE_FROM_MID_FOR_SILENCE = 300;

/**
 * Get the duration of an audio file (in seconds) using ffprobe.
 * @param {string} filePath The path to the mp3 file.
 * @returns {Promise<number>} The duration in seconds (float).
 */
async function getAudioDuration(filePath) {
    const cmd = `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`;
    const { stdout } = await execPromise(cmd);
    
    return parseFloat(stdout.trim());
}

/**
 * Analyze the MP3 and find silent segments using ffmpeg silencedetect.
 * @param {string} filePath The path to the mp3 file.
 * @param {number} silenceThreshold The silence threshold in dB (e.g., -50).
 * @param {number} minSilenceDuration The minimum silence duration in seconds (e.g., 1.0).
 * @returns {Promise<Array<{ start: number, end: number }>>}
 * Returns an array of silent segments (start/end times in seconds).
 */
async function findSilences(filePath, silenceThreshold = -30, minSilenceDuration = 0.5) {
    return new Promise((resolve, reject) => {
        const ffmpegArgs = [
        '-i', filePath,
        '-af', `silencedetect=n=${silenceThreshold}dB:d=${minSilenceDuration}`,
        '-f', 'null',
        '-'
        ];

        const ffmpegProc = spawn('ffmpeg', ffmpegArgs);
        let stderrData = '';

        ffmpegProc.stderr.on('data', (chunk) => {
            stderrData += chunk;
        });

        ffmpegProc.on('error', (err) => {
            reject(new Error(`Failed to run ffmpeg: ${err.message}`));
        });

        ffmpegProc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`FFmpeg exited with code ${code}. Full log:\n${stderrData}`));
            } else {
                const silenceSegments = [];
                let currentStart = null;
    
                const lines = stderrData.split('\n');
                for (const line of lines) {
                    const silenceStartMatch = line.match(/silence_start:\s+(\d+(\.\d+)?)/u);
                    const silenceEndMatch   = line.match(/silence_end:\s+(\d+(\.\d+)?)/u);
    
                    if (silenceStartMatch) currentStart = parseFloat(silenceStartMatch[1]);
    
                    if (silenceEndMatch && currentStart !== null) {
                        const end = parseFloat(silenceEndMatch[1]);
                        silenceSegments.push({ start: currentStart, end });
                        currentStart = null;
                    }
                }
    
                resolve(silenceSegments);
            }
        });
    });
}

/**
 * Find a silent moment close to the midpoint, or return the midpoint if none found (or not close enough).
 * @param {string} filePath Path to the MP3 file.
 * @returns {Promise<number>} The chosen split time (in seconds).
 */
async function findSplitTimeOrMidpoint(filePath) {
    try {
        const duration = await getAudioDuration(filePath);
        const midpoint = duration / 2;

        const silentSegments = await findSilences(filePath);

        if (silentSegments.length === 0) {
            return midpoint;
        }

        let closestSegment = null;
        let closestDistance = Infinity;
        
        for (const seg of silentSegments) {
            const segMid = (seg.start + seg.end) / 2;
            const dist = Math.abs(segMid - midpoint);
            
            if (dist < closestDistance) {
                closestDistance = dist;
                closestSegment = seg;
            }
        }

        if (!closestSegment) return midpoint;

        if (closestDistance > MAX_DISTANCE_FROM_MID_FOR_SILENCE) return midpoint;

        return (closestSegment.start + closestSegment.end) / 2;
    } catch (error) {
        logError(error);

        return null;
    }
}

/**
 * Split the audio file into two parts at the given time.
 * @param {string} filePath   Path to the input MP3 file.
 * @param {number} splitTime  Time in seconds where the file will be split.
 * @param {string} outputBase Base filename for the two output parts (without extension).
 * @returns {Promise<String[]>}
 */
async function splitAudioFileAt(filePath, splitTime, outputBase = 'output') {
    const dirName = path.dirname(filePath);

    const part1File = path.join(dirName, `${outputBase}_(parte_1).mp3`);
    const part2File = path.join(dirName, `${outputBase}_(parte_2).mp3`);

    const cmdPart1 = `ffmpeg -y -i "${filePath}" -map_metadata 0 -c copy -to ${splitTime} "${part1File}"`;
    const cmdPart2 = `ffmpeg -y -i "${filePath}" -map_metadata 0 -c copy -ss ${splitTime} "${part2File}"`;

    log(`Splitting file at ~${splitTime.toFixed(2)}s...`);
    try {
        await execPromise(cmdPart1);
        await execPromise(cmdPart2);

        debug('Split complete!');
        debug('Part1:', part1File);
        debug('Part2:', part2File);

        return [part1File, part2File];
    } catch (err) {
        throw new Error(`Error splitting file: ${err.message}`);
    }
}

const splitEpisode = async (fileName, sourceDir) => {
    try {
        const filePath = path.join(sourceDir, fileName);

        const chosenSplitTime = await findSplitTimeOrMidpoint(filePath);

        if (chosenSplitTime === null) {
            const duration = await getAudioDuration(filePath);
            debug('Could not find silence. Using midpoint as fallback.');
            
            return splitAudioFileAt(filePath, duration / 2, fileName.replace('.mp3', ''));
        }

        debug(`Splitting at time: ${chosenSplitTime} of ${await getAudioDuration(filePath)} total duration`);

        return splitAudioFileAt(filePath, chosenSplitTime, fileName.replace('.mp3', ''));
    } catch (error) {
        logError('Error:', error);

        return null;
    }
}

module.exports = { splitEpisode }
