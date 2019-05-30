const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf } = format;

module.exports = class Logger {
    /**
     * Logs the execution of the script
     * @param {boolean} error The execution status
     * @param {string} msg A message to output
     */
    static log(success, msg) {

        const customFormat = printf(options => {
            return `>>>>>>>>>> ${options.timestamp} - ${options.level.toUpperCase()} - ${options.message}`;
        });

        let logger = createLogger({
            format: combine(
                timestamp(),
                customFormat
            ),
            transports: [
                new transports.Console(),
                new transports.File({filename: 'log.log'})
            ]
        });

        if (success || msg === 'Nothing to upload') {
            logger.log('info', msg);
        } else {
            logger.log('warn', msg);
        }
    }
}
