const { createLogger, format, transports } = require('winston');
const { DEBUG } = require('./config');

const logger = createLogger({
    level: DEBUG ? 'debug' : 'info',
    format: format.combine(
        format.timestamp({ format: 'yyyyMMdd-HH:mm:ssZZZZ' }),
        format.printf(({ timestamp, message }) => `[${timestamp}] ${message}`)
    ),
    transports: [new transports.Console()]
});

module.exports = {
    log: (...msg) => logger.info(msg.join(' ')),
    logError: (...msg) => logger.error(msg.join(' ')),
    debug: (...msg) => logger.debug(msg.join(' '))
};
