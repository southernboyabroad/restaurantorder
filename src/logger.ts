import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      const stackStr = stack ? `\n${stack}` : '';
      return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}${stackStr}`;
    }),
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log', maxsize: 5_000_000, maxFiles: 3 }),
  ],
});

export default logger;
