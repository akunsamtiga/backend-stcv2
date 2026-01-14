// src/common/utils/timezone.util.ts
export class TimezoneUtil {
  static getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  static getCurrentDate(): Date {
    return new Date();
  }

  static toISOString(date: Date = new Date()): string {
    return date.toISOString();
  }

  static formatDateTime(date: Date = new Date()): string {
    const jakartaDate = new Date(date.toLocaleString('en-US', { 
      timeZone: 'Asia/Jakarta' 
    }));
    
    const year = jakartaDate.getFullYear();
    const month = String(jakartaDate.getMonth() + 1).padStart(2, '0');
    const day = String(jakartaDate.getDate()).padStart(2, '0');
    const hours = String(jakartaDate.getHours()).padStart(2, '0');
    const minutes = String(jakartaDate.getMinutes()).padStart(2, '0');
    const seconds = String(jakartaDate.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  static fromTimestamp(timestamp: number): Date {
    return new Date(timestamp * 1000);
  }

  static toTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }

  static addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }

  static isSameSecond(timestamp1: number, timestamp2: number): boolean {
    return timestamp1 === timestamp2;
  }

  static isExpired(expiryTimestamp: number): boolean {
    return this.getCurrentTimestamp() >= expiryTimestamp;
  }

  static getDifferenceInSeconds(timestamp1: number, timestamp2: number): number {
    return Math.abs(timestamp1 - timestamp2);
  }

  static formatTimestamp(timestamp: number): string {
    const date = this.fromTimestamp(timestamp);
    return this.formatDateTime(date);
  }

  static getDateTimeInfo(date: Date = new Date()): {
    datetime: string;
    datetime_iso: string;
    timestamp: number;
    timezone: string;
  } {
    return {
      datetime: this.formatDateTime(date),
      datetime_iso: this.toISOString(date),
      timestamp: this.toTimestamp(date),
      timezone: 'Asia/Jakarta',
    };
  }

  static isValidTimestamp(timestamp: number): boolean {
    const now = this.getCurrentTimestamp();
    const diff = Math.abs(now - timestamp);
    
    return diff <= 3600;
  }

  static getStartOfDay(date: Date = new Date()): number {
    const jakartaDate = new Date(date.toLocaleString('en-US', { 
      timeZone: 'Asia/Jakarta' 
    }));
    
    jakartaDate.setHours(0, 0, 0, 0);
    return this.toTimestamp(jakartaDate);
  }

  static getEndOfDay(date: Date = new Date()): number {
    const jakartaDate = new Date(date.toLocaleString('en-US', { 
      timeZone: 'Asia/Jakarta' 
    }));
    
    jakartaDate.setHours(23, 59, 59, 999);
    return this.toTimestamp(jakartaDate);
  }

  static formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  static isWithinTradingHours(date: Date = new Date()): boolean {
    const jakartaDate = new Date(date.toLocaleString('en-US', { 
      timeZone: 'Asia/Jakarta' 
    }));
    
    const hour = jakartaDate.getHours();
    const day = jakartaDate.getDay();
    
    if (day === 0 || day === 6) {
      return false;
    }
    
    return hour >= 9 && hour < 16;
  }
}

export default TimezoneUtil;