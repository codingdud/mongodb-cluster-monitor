// lib/logger.js
// Structured logging utility with colors, timestamps and levels

const levels = {
  DEBUG: 0,
  INFO:  1,
  WARN:  2,
  ERROR: 3
};

const colors = {
  RESET: "\x1b[0m",
  DEBUG: "\x1b[90m", // Gray
  INFO:  "\x1b[32m", // Green
  WARN:  "\x1b[33m", // Yellow
  ERROR: "\x1b[31m"  // Red
};

const LOG_LEVEL = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
const currentLevel = levels[LOG_LEVEL] !== undefined ? levels[LOG_LEVEL] : levels.INFO;

class Logger {
  _getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }

  _log(levelName, message, ...args) {
    if (levels[levelName] < currentLevel) return;

    const timestamp = this._getTimestamp();
    const color = colors[levelName] || colors.RESET;
    const levelBadge = `${color}[${levelName}]${colors.RESET}`;
    
    // Formatting: 2026-03-15 17:48:27 [INFO] My message
    console.log(`${timestamp} ${levelBadge} ${message}`, ...args);
  }

  debug(msg, ...args) { this._log('DEBUG', msg, ...args); }
  info(msg, ...args)  { this._log('INFO',  msg, ...args); }
  warn(msg, ...args)  { this._log('WARN',  msg, ...args); }
  error(msg, ...args) { this._log('ERROR', msg, ...args); }
}

module.exports = new Logger();
