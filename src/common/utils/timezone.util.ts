// src/common/utils/timezone.util.ts
// ✅ FIXED VERSION - No typos

export class TimezoneUtil {
  /**
   * Get current timestamp in seconds (Unix timestamp)
   * Sama dengan simulator: Math.floor(Date.now() / 1000)
   */
  static getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Get current date in Asia/Jakarta timezone
   */
  static getCurrentDate(): Date {
    return new Date();
  }

  /**
   * Format date to ISO string (sama dengan simulator)
   * Format: YYYY-MM-DDTHH:mm:ss.sssZ
   */
  static toISOString(date: Date = new Date()): string {
    return date.toISOString();
  }

  /**
   * Format date to readable string (sama dengan simulator)
   * Format: YYYY-MM-DD HH:mm:ss
   * Timezone: Asia/Jakarta (WIB = UTC+7)
   */
  static formatDateTime(date: Date = new Date()): string {
    // Convert to Indonesia timezone (WIB = UTC+7)
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

  /**
   * Parse timestamp to Date object
   */
  static fromTimestamp(timestamp: number): Date {
    return new Date(timestamp * 1000);
  }

  /**
   * Get timestamp from Date object
   */
  static toTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }

  /**
   * Add minutes to current date
   */
  static addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }

  /**
   * Check if two timestamps are in the same second
   */
  static isSameSecond(timestamp1: number, timestamp2: number): boolean {
    return timestamp1 === timestamp2;
  }

  /**
   * Check if timestamp has expired
   */
  static isExpired(expiryTimestamp: number): boolean {
    return this.getCurrentTimestamp() >= expiryTimestamp;
  }

  /**
   * Get time difference in seconds
   */
  static getDifferenceInSeconds(timestamp1: number, timestamp2: number): number {
    return Math.abs(timestamp1 - timestamp2);
  }

  /**
   * Format timestamp to readable datetime string
   */
  static formatTimestamp(timestamp: number): string {
    const date = this.fromTimestamp(timestamp);
    return this.formatDateTime(date);
  }

  /**
   * Get formatted datetime info (sama dengan simulator)
   */
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

  /**
   * Validate if timestamp is reasonable (not too old or future)
   */
  static isValidTimestamp(timestamp: number): boolean {
    const now = this.getCurrentTimestamp();
    const diff = Math.abs(now - timestamp);
    
    // Allow timestamps within ±1 hour
    return diff <= 3600;
  }

  /**
   * Get start of day timestamp (00:00:00)
   */
  static getStartOfDay(date: Date = new Date()): number {
    const jakartaDate = new Date(date.toLocaleString('en-US', { 
      timeZone: 'Asia/Jakarta' 
    }));
    
    jakartaDate.setHours(0, 0, 0, 0);
    return this.toTimestamp(jakartaDate);
  }

  /**
   * Get end of day timestamp (23:59:59)
   */
  static getEndOfDay(date: Date = new Date()): number {
    const jakartaDate = new Date(date.toLocaleString('en-US', { 
      timeZone: 'Asia/Jakarta' 
    }));
    
    jakartaDate.setHours(23, 59, 59, 999);
    return this.toTimestamp(jakartaDate);
  }

  /**
   * Format duration in human readable format
   */
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

  /**
   * Check if it's within trading hours (example: 09:00 - 16:00 WIB)
   * Customize this based on your trading schedule
   */
  static isWithinTradingHours(date: Date = new Date()): boolean {
    const jakartaDate = new Date(date.toLocaleString('en-US', { 
      timeZone: 'Asia/Jakarta' 
    }));
    
    const hour = jakartaDate.getHours();
    const day = jakartaDate.getDay(); // 0 = Sunday, 6 = Saturday
    
    // Skip weekends
    if (day === 0 || day === 6) {
      return false;
    }
    
    // Trading hours: 09:00 - 16:00 WIB
    return hour >= 9 && hour < 16;
  }
}

// Export default for convenience
export default TimezoneUtil;