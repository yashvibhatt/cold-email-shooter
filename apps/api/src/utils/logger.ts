import winston from 'winston';
import { env } from '../config/env';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    json()
  ),
  defaultMeta: { service: 'ces-api' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

if (env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: combine(colorize(), simple()),
    })
  );
}
