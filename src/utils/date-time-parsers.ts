// Date and time parsing utilities for flight scraper

export function convertDateToYYYYMMDD(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const dateMatch = dateStr.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/);
  if (!dateMatch) return null;
  const day = dateMatch[1].padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = (monthNames.indexOf(dateMatch[2]) + 1).toString().padStart(2, '0');
  const year = dateMatch[3];
  return `${year}-${month}-${day}`;
}

export function parseTimeTo24Hour(timeStr: string | null): string | null {
  if (!timeStr) return null;
  const cleaned = timeStr.trim();
  // Handle 24-hour format with optional seconds: "HH:MM" or "HH:MM:SS"
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(cleaned)) {
    const parts = cleaned.split(':');
    const hours = parts[0].padStart(2, '0');
    const minutes = parts[1];
    const seconds = parts[2] || '00'; // Preserve seconds if present, default to '00'
    return `${hours}:${minutes}:${seconds}`;
  }
  // Handle 12-hour format with optional seconds: "H:MM AM/PM" or "H:MM:SS AM/PM"
  const timeMatch = cleaned.match(/(\d{1,2}):(\d{2})(:(\d{2}))?\s*(AM|PM)/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2];
    const seconds = timeMatch[4] || '00'; // Preserve seconds if present, default to '00'
    const period = timeMatch[5].toUpperCase();
    if (period === 'PM' && hours !== 12) {
      hours += 12;
    } else if (period === 'AM' && hours === 12) {
      hours = 0;
    }
    return `${hours.toString().padStart(2, '0')}:${minutes}:${seconds}`;
  }
  return cleaned;
}

export function parseDurationToMinutes(durationStr: string): number {
  if (!durationStr) return 0;
  
  // Parse formats like "5h 30m", "2h", "45m", "5h 30m 45s", "1h50m", "1h50", "1:50", etc.
  // Preserve exact precision - only use whole minutes and hours, ignore seconds to avoid rounding
  
  const cleaned = durationStr.trim();
  
  // Try format with 'h' and 'm' (with or without spaces): "1h 50m", "1h50m", "50m", "2h"
  const hoursMatch = cleaned.match(/(\d+)h/i);
  const minutesMatch = cleaned.match(/(\d+)m/i);
  
  // If we have 'h' but no 'm', check if minutes follow directly: "1h50" or "1h 50" (no 'm' suffix)
  if (hoursMatch && !minutesMatch) {
    // Try to find minutes immediately after 'h' without 'm': "1h50", "1h 50"
    const afterHours = cleaned.substring(hoursMatch.index! + hoursMatch[0].length).trim();
    // Match 1-2 digits that could be minutes (0-59)
    const minutesOnlyMatch = afterHours.match(/^(\d{1,2})(?:\s|$|m)/i);
    if (minutesOnlyMatch) {
      const hours = parseInt(hoursMatch[1], 10);
      const minutes = parseInt(minutesOnlyMatch[1], 10);
      // Only use if minutes is reasonable (0-59)
      if (minutes < 60) {
        return hours * 60 + minutes;
      }
    }
  }
  
  // If no 'h' or 'm' found, try time format "H:MM" or "HH:MM"
  if (!hoursMatch && !minutesMatch) {
    const timeMatch = cleaned.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      return hours * 60 + minutes;
    }
  }
  
  const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
  const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
  
  // Only use whole hours and minutes, don't round seconds
  // Returns integer minutes (hours * 60 + minutes is already integer)
  return hours * 60 + minutes;
}

