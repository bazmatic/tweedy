import chalk from 'chalk';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  error(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.ERROR) {
      console.error(chalk.red('ERROR:'), message, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.WARN) {
      console.warn(chalk.yellow('WARN:'), message, ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.INFO) {
      console.info(chalk.blue('INFO:'), message, ...args);
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.debug(chalk.gray('DEBUG:'), message, ...args);
    }
  }

  success(message: string, ...args: any[]): void {
    console.log(chalk.green('✓'), message, ...args);
  }

  progress(message: string, ...args: any[]): void {
    console.log(chalk.cyan('→'), message, ...args);
  }
}

export const logger = new Logger();
