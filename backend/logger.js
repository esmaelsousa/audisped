const winston = require('winston');
const path = require('path');
const EventEmitter = require('events');

// Emitter para streaming de logs em tempo real
const logEmitter = new EventEmitter();

// Define o formato do log
const logFormat = winston.format.printf(({ level, message, timestamp, stack }) => {
  let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
  if (stack) {
    log += `\n${stack}`;
  }

  // Notifica o emitter para streaming (SSE)
  logEmitter.emit('log', message);

  return log;
});

const logger = winston.createLogger({
  level: 'info', // Nível mínimo de log a ser registrado
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }), // Garante que o stack trace seja incluído
    winston.format.json()
  ),
  transports: [
    // Transporte para salvar os logs em um arquivo
    new winston.transports.File({
      filename: path.join(__dirname, 'audisped-backend.log'),
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
      )
    }),
    // Transporte para exibir os logs no console (terminal)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(), // Adiciona cores no console
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
      )
    })
  ],
  exceptionHandlers: [
    // Captura e registra erros não tratados que poderiam "derrubar" o servidor
    new winston.transports.File({
      filename: path.join(__dirname, 'exceptions.log'),
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
      )
    })
  ]
});

module.exports = logger;
module.exports.logEmitter = logEmitter;