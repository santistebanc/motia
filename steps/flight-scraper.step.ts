import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { createHash } from 'crypto';

// Generate a deterministic ID from search parameters
function generateQueryId(origin: string, destination: string, departureDate: string, returnDate?: string): string {
  const params = `${origin.toUpperCase()}|${destination.toUpperCase()}|${departureDate}|${returnDate || ''}`;
  return createHash('sha256').update(params).digest('hex');
}

const scraperSchema = z.object({
  origin: z.string().min(3, 'Origin must be at least 3 characters'),
  destination: z.string().min(3, 'Destination must be at least 3 characters'),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Departure date must be in YYYY-MM-DD format'),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Return date must be in YYYY-MM-DD format').optional(),
});

export const config: ApiRouteConfig = {
  name: 'FlightScraper',
  type: 'api',
  path: '/api/flights/scrape',
  method: 'POST',
  description: 'Scrape flights from Skyscanner and save to database',
  emits: [],
  flows: ['flight-scraper-flow'],
  bodySchema: scraperSchema,
  responseSchema: {
    200: z.object({
      success: z.boolean(),
      message: z.string(),
      tripsScraped: z.number(),
    }),
    400: z.object({
      success: z.boolean(),
      error: z.string(),
    }),
    500: z.object({
      success: z.boolean(),
      error: z.string(),
    }),
  }
};

// Helper functions from skyscanner-scraper.ts
function convertDateToYYYYMMDD(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const dateMatch = dateStr.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/);
  if (!dateMatch) return null;
  const day = dateMatch[1].padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = (monthNames.indexOf(dateMatch[2]) + 1).toString().padStart(2, '0');
  const year = dateMatch[3];
  return `${year}-${month}-${day}`;
}

function parseTimeTo24Hour(timeStr: string | null): string | null {
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

function parseDurationToMinutes(durationStr: string): number {
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

async function getRequest(params: { originplace?: string; destinationplace?: string; outbounddate?: string; inbounddate?: string }) {
  const originplace = params.originplace || 'SLP';
  const destinationplace = params.destinationplace || 'BER';
  const outbounddate = params.outbounddate || '2026-01-19';
  const inbounddate = params.inbounddate || '';
  
  const queryParams = new URLSearchParams({
    originplace,
    destinationplace,
    outbounddate,
    inbounddate,
    cabinclass: 'Economy',
    adults: '1',
    children: '0',
    infants: '0',
    currency: 'EUR'
  });
  
  const url = `https://www.flightsfinder.com/portal/sky?${queryParams.toString()}`;
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
  };
  
  try {
    const response = await fetch(url, { method: 'GET', headers });
    const result = await response.text();
    const setCookieHeader = response.headers.get('set-cookie');
    let cookies = '';
    if (setCookieHeader) {
      const cookieArray = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      cookies = cookieArray.map(cookie => cookie.split(';')[0].trim()).join('; ');
    }
    
    let dataObject: any = null;
    const dataIndex = result.indexOf('data:');
    if (dataIndex !== -1) {
      let braceStart = result.indexOf('{', dataIndex);
      if (braceStart !== -1) {
        let braceCount = 0;
        let braceEnd = -1;
        for (let i = braceStart; i < result.length; i++) {
          if (result[i] === '{') braceCount++;
          else if (result[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              braceEnd = i;
              break;
            }
          }
        }
        if (braceEnd !== -1) {
          const dataString = result.substring(braceStart, braceEnd + 1);
          try {
            const timestamp = Date.now();
            let processedString = dataString.replace(/\$\.now\(\)/g, timestamp.toString());
            processedString = processedString.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');
            dataObject = JSON.parse(processedString);
          } catch (e) {
            try {
              const timestamp = Date.now();
              let processedString = dataString.replace(/\$\.now\(\)/g, timestamp.toString());
              dataObject = new Function('return ' + processedString)();
            } catch (evalError) {
              dataObject = null;
            }
          }
        }
      }
    }
    
    return { status: response.status, body: result, cookies, data: dataObject, url, success: true };
  } catch (error) {
    return { status: 0, statusText: 'Error', body: error instanceof Error ? error.message : 'Unknown error', cookies: '', data: null, success: false };
  }
}

async function pollRequest(data: any, cookies: string = '', refererUrl?: string) {
  const url = 'https://www.flightsfinder.com/portal/sky/poll';
  const headers: { [key: string]: string } = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Connection': 'keep-alive',
  };
  if (cookies) headers['cookie'] = cookies;
  
  if (!data || !data['_token']) {
    throw new Error('Invalid data object: _token is required');
  }
  
  const dataWithUpdatedNoc = { ...data };
  dataWithUpdatedNoc['noc'] = Date.now().toString();
  const requestBody = Object.entries(dataWithUpdatedNoc)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  
  try {
    const response = await fetch(url, { method: 'POST', headers, body: requestBody });
    const responseText = await response.text();
    
    if (response.status === 504 || responseText.includes('504 Gateway Time-out')) {
      return { status: response.status, finished: false, count: 0, flights: [], cookies, success: true };
    }
    
    const parts = responseText.split('|');
    const finished = parts.length > 0 && parts[0] === 'Y';
    const count = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
    let body = parts.length > 6 ? parts[6] : '';
    if (body && body.includes('%')) {
      try {
        body = decodeURIComponent(body);
      } catch (e) {
        // Use original body
      }
    }
    
    let flights: any[] = [];
    if (finished) {
      flights = extractFlights(body);
    }
    
    return { status: response.status, finished, count, flights, cookies, success: true };
  } catch (error) {
    return { status: 0, finished: false, count: 0, flights: [], cookies, success: false };
  }
}

function extractFlights(body: string): any[] {
  const flights: any[] = [];
  if (!body || body.trim().length === 0) return [];
  
  try {
    const $ = cheerio.load(body);
    const searchModals = $('div.search_modal');
    if (searchModals.length === 0) return [];
    
    searchModals.each((index, element) => {
      const $searchModal = $(element);
      try {
        const flight = extractFlightFromSearchModal($, $searchModal);
        if (flight && flight.price) {
          flights.push(flight);
        }
      } catch (e) {
        // Skip this flight
      }
    });
  } catch (e) {
    // Return empty array
  }
  
  return flights;
}

function extractFlightFromSearchModal($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): any {
  const headings = $el.find('p._heading');
  const outboundHeading = headings.filter((i, el) => {
    const text = $(el).text();
    return text.includes('Outbound') && !text.includes('Return') && !text.includes('Book Your Ticket');
  }).first();
  const returnHeading = headings.filter((i, el) => {
    const text = $(el).text();
    return text.includes('Return') && !text.includes('Book Your Ticket');
  }).first();
  
  const outboundFlight = extractFlightFromSection($, $el, outboundHeading, 'outbound');
  if (!outboundFlight) return null;
  
  let returnFlight = null;
  if (returnHeading.length > 0) {
    returnFlight = extractFlightFromSection($, $el, returnHeading, 'return');
  }
  
  const prices = extractPricesFromSimilar($, $el);
  const priceValues = prices
    .map(p => {
      const numValue = parseFloat(p.price.replace(/,/g, ''));
      return { ...p, numValue };
    })
    .sort((a, b) => a.numValue - b.numValue)
    .map(p => p.price);
  
  const price = priceValues.length > 0 ? priceValues[0] : null;
  if (!price) return null;
  
  return {
    date: outboundFlight.date,
    price,
    prices: prices.length > 0 ? prices : undefined,
    outbound: outboundFlight,
    return: returnFlight || undefined,
  };
}

function extractFlightFromSection($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>, heading: cheerio.Cheerio<any>, type: 'outbound' | 'return'): any {
  if (heading.length === 0) return null;
  
  const dateText = heading.text();
  const dateMatch = dateText.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{4})/);
  const date = dateMatch ? `${dateMatch[2]} ${dateMatch[3]} ${dateMatch[4]}` : null;
  
  const panel = heading.nextAll('div._panel').first();
  if (panel.length === 0) return null;
  
  const panelHeading = panel.find('div._panel_heading').first();
  const airlineName = panelHeading.find('p._ahn').first().text().trim();
  const flightName = panelHeading.find('p._flight_name').first().text().trim();
  
  const tripSection = panelHeading.find('div.trip').first();
  const departureTimeEl = tripSection.find('p.time').first();
  const departureTime = departureTimeEl.clone().children().remove().end().text().trim();
  const departureAirport = departureTimeEl.find('span').first().text().trim();
  
  const arrivalTimeEl = tripSection.find('p.time').last();
  const arrivalTime = arrivalTimeEl.clone().children().remove().end().text().trim();
  const arrivalAirport = arrivalTimeEl.find('span').first().text().trim();
  
  const stopsSection = tripSection.find('div._stops').first();
  const totalDuration = stopsSection.find('p.time').first().text().trim();
  const stopCountText = stopsSection.find('p.stop').first().text().trim();
  const stopCountMatch = stopCountText.match(/(\d+)\s*stop/);
  const stopCount = stopCountMatch ? parseInt(stopCountMatch[1], 10) : 0;
  
  const legs: any[] = [];
  panel.find('div._panel_body').each((index, legElement) => {
    const $leg = $(legElement);
    const flightInfoText = $leg.find('div._head small').first().text().trim();
    const flightInfoParts = flightInfoText.split(/\s+/);
    const flightNumber = flightInfoParts.length > 0 ? flightInfoParts[flightInfoParts.length - 1] : null;
    const airlineNameLeg = flightInfoParts.length > 1 ? flightInfoParts.slice(0, -1).join(' ') : null;
    const legDuration = $leg.find('div.c1 p').first().text().trim();
    const timesEl = $leg.find('div.c3');
    const departureTimeLeg = timesEl.find('p').first().text().trim();
    const arrivalTimeLeg = timesEl.find('p').last().text().trim();
    const airportsEl = $leg.find('div.c4');
    const originAirportFull = airportsEl.find('p').first().text().trim();
    const destinationAirportFull = airportsEl.find('p').last().text().trim();
    const originCodeMatch = originAirportFull.match(/^([A-Z]{3})\s/);
    const destinationCodeMatch = destinationAirportFull.match(/^([A-Z]{3})\s/);
    const originCode = originCodeMatch ? originCodeMatch[1] : null;
    const destinationCode = destinationCodeMatch ? destinationCodeMatch[1] : null;
    const connectEl = $leg.find('p.connect_airport');
    const connectionTime = connectEl.length > 0 ? connectEl.find('span').first().text().trim() : null;
    const summaryEl = $leg.find('p._summary');
    let arrivalDateText = null;
    if (summaryEl.length > 0) {
      const summaryText = summaryEl.text();
      const dateMatch = summaryText.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{4})/);
      if (dateMatch) {
        arrivalDateText = `${dateMatch[1]}, ${dateMatch[2]} ${dateMatch[3]} ${dateMatch[4]}`;
      }
    }
    
    if (departureTimeLeg && arrivalTimeLeg && originCode && destinationCode) {
      legs.push({
        flightNumber: flightNumber || null,
        airline: airlineNameLeg || null,
        departure: departureTimeLeg,
        arrival: arrivalTimeLeg,
        origin: originCode,
        destination: destinationCode,
        originFull: originAirportFull,
        destinationFull: destinationAirportFull,
        duration: legDuration || null,
        connectionTime: connectionTime || null,
        arrivalDate: arrivalDateText || null,
      });
    }
  });
  
  return {
    date,
    departure: departureTime,
    arrival: arrivalTime,
    origin: departureAirport,
    destination: arrivalAirport,
    duration: totalDuration,
    airline: airlineName || flightName || null,
    stopCount,
    legs: legs.length > 0 ? legs : undefined,
  };
}

function extractPricesFromSimilar($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): Array<{ provider: string; price: string; link?: string }> {
  const prices: Array<{ provider: string; price: string; link?: string }> = [];
  $el.find('div._similar > div').each((index, priceElement) => {
    const $priceEl = $(priceElement);
    const providerName = $priceEl.find('p').first().text().trim();
    const priceP = $priceEl.find('p').eq(1);
    const priceText = priceP.text().trim();
    const fullLink = priceP.find('a').attr('href');
    let selectLink: string | undefined = undefined;
    if (fullLink) {
      const uIndex = fullLink.indexOf('u=');
      if (uIndex !== -1) {
        const uSubstring = fullLink.substring(uIndex + 2);
        const endIndex = uSubstring.indexOf('&');
        const uValue = endIndex !== -1 ? uSubstring.substring(0, endIndex) : uSubstring;
        try {
          selectLink = decodeURIComponent(uValue);
        } catch (e) {
          selectLink = uValue;
        }
      }
    }
    const priceMatch = priceText.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/);
    if (priceMatch) {
      prices.push({
        provider: providerName,
        price: priceMatch[1],
        link: selectLink
      });
    }
  });
  return prices;
}

export const handler: Handlers['FlightScraper'] = async (req, { logger }) => {
  try {
    const body = scraperSchema.parse(req.body);
    const { origin, destination, departureDate, returnDate } = body;
    
    logger.info('Starting flight scraper', { origin, destination, departureDate, returnDate });
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      logger.error('Supabase credentials not configured');
      return {
        status: 500,
        body: {
          success: false,
          error: 'Supabase credentials not configured'
        }
      };
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    // Step 1: Make initial request
    const initialResult = await getRequest({
      originplace: origin,
      destinationplace: destination,
      outbounddate: departureDate,
      inbounddate: returnDate || ''
    });
    
    if (!initialResult.success || !initialResult.data || !initialResult.data['_token']) {
      return {
        status: 500,
        body: {
          success: false,
          error: 'Failed to get initial request or token'
        }
      };
    }
    
    const dataObject = initialResult.data;
    let cookies = initialResult.cookies || '';
    const refererUrl = initialResult.url;
    
    // Step 2: Poll until finished
    let finished = false;
    let pollCount = 0;
    const maxPolls = 20;
    const allFlights: any[] = [];
    
    while (!finished && pollCount < maxPolls) {
      pollCount++;
      logger.info(`Poll attempt ${pollCount}`);
      
      const pollResult = await pollRequest(dataObject, cookies, refererUrl);
      
      if (!pollResult.success) {
        logger.error(`Poll ${pollCount} failed`);
        break;
      }
      
      if (pollResult.cookies) {
        cookies = pollResult.cookies;
      }
      
      finished = pollResult.finished === true;
      
      if (finished && pollResult.flights && pollResult.flights.length > 0) {
        allFlights.push(...pollResult.flights);
        logger.info(`Extracted ${pollResult.flights.length} flights`);
      } else if (!finished) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    if (allFlights.length === 0) {
      return {
        status: 200,
        body: {
          success: true,
          message: 'No flights found',
          tripsScraped: 0
        }
      };
    }
    
    // Step 3: Process all flights and collect data for bulk insert
    const isRound = !!returnDate;
    const now = new Date();
    
    // Collections for bulk inserts (using Maps to ensure uniqueness by ID)
    const flightsToInsert = new Map<string, any>();
    const tripsToInsert = new Map<string, any>();
    const legsToInsert = new Map<string, any>();
    const dealsToInsert = new Map<string, any>();
    
    // Process all flights and collect data
    for (const flightData of allFlights) {
      try {
        const outbound = flightData.outbound;
        const returnFlight = flightData.return;
        const prices = flightData.prices || [];
        
        if (!outbound || !outbound.legs || outbound.legs.length === 0) continue;
        
        // Process outbound flights
        const outboundFlights: Array<{ id: string; flightNumber: string; airline: string; origin: string; destination: string; departureDate: string; departureTime: string; arrivalDate: string; arrivalTime: string; duration: number }> = [];
        const sectionDate = convertDateToYYYYMMDD(outbound.date);
        
        for (let i = 0; i < outbound.legs.length; i++) {
          const leg = outbound.legs[i];
          const departureTime = parseTimeTo24Hour(leg.departure);
          const arrivalTime = parseTimeTo24Hour(leg.arrival);
          if (!departureTime || !sectionDate) continue;
          
          let arrivalDate = sectionDate;
          if (leg.arrivalDate) {
            const convertedArrivalDate = convertDateToYYYYMMDD(leg.arrivalDate);
            if (convertedArrivalDate) arrivalDate = convertedArrivalDate;
          }
          
          // Parse duration to integer minutes
          const durationMinutes = leg.duration ? parseDurationToMinutes(leg.duration) : 0;
          // Flight ID format: <flightNumber>_<origin>_<departureDate>_<departureTime>
          const flightId = `${leg.flightNumber}_${leg.origin}_${sectionDate}_${departureTime}`;
          
          // Add to flights collection (Map ensures uniqueness by ID)
          flightsToInsert.set(flightId, {
            id: flightId,
            flight_number: leg.flightNumber,
            origin: leg.origin,
            destination: leg.destination,
            departure_date: sectionDate,
            departure_time: departureTime,
            arrival_date: arrivalDate,
            arrival_time: arrivalTime || departureTime,
            duration: durationMinutes, // Integer minutes
            airline: leg.airline || ''
          });
          
          outboundFlights.push({
            id: flightId,
            flightNumber: leg.flightNumber,
            airline: leg.airline || '',
            origin: leg.origin,
            destination: leg.destination,
            departureDate: sectionDate,
            departureTime,
            arrivalDate,
            arrivalTime: arrivalTime || departureTime,
            duration: durationMinutes
          });
        }
        
        // Process return flights if round trip
        const returnFlights: Array<{ id: string; flightNumber: string; airline: string; origin: string; destination: string; departureDate: string; departureTime: string; arrivalDate: string; arrivalTime: string; duration: number }> = [];
        if (returnFlight && returnFlight.legs && returnFlight.legs.length > 0) {
          const returnSectionDate = convertDateToYYYYMMDD(returnFlight.date);
          for (let i = 0; i < returnFlight.legs.length; i++) {
            const leg = returnFlight.legs[i];
            const departureTime = parseTimeTo24Hour(leg.departure);
            const arrivalTime = parseTimeTo24Hour(leg.arrival);
            if (!departureTime || !returnSectionDate) continue;
            
            let arrivalDate = returnSectionDate;
            if (leg.arrivalDate) {
              const convertedArrivalDate = convertDateToYYYYMMDD(leg.arrivalDate);
              if (convertedArrivalDate) arrivalDate = convertedArrivalDate;
            }
            
            // Parse duration to integer minutes
            const durationMinutes = leg.duration ? parseDurationToMinutes(leg.duration) : 0;
            // Flight ID format: <flightNumber>_<origin>_<departureDate>_<departureTime>
            const returnFlightId = `${leg.flightNumber}_${leg.origin}_${returnSectionDate}_${departureTime}`;
            
            // Add to flights collection
            flightsToInsert.set(returnFlightId, {
              id: returnFlightId,
              flight_number: leg.flightNumber,
              origin: leg.origin,
              destination: leg.destination,
              departure_date: returnSectionDate,
              departure_time: departureTime,
              arrival_date: arrivalDate,
              arrival_time: arrivalTime || departureTime,
              duration: durationMinutes, // Integer minutes
              airline: leg.airline || ''
            });
            
            returnFlights.push({
              id: returnFlightId,
              flightNumber: leg.flightNumber,
              airline: leg.airline || '',
              origin: leg.origin,
              destination: leg.destination,
              departureDate: returnSectionDate,
              departureTime,
              arrivalDate,
              arrivalTime: arrivalTime || departureTime,
              duration: durationMinutes
            });
          }
        }
        
        if (outboundFlights.length === 0) continue;
        
        // Create trip data
        const firstOutboundFlight = outboundFlights[0];
        const lastOutboundFlight = outboundFlights[outboundFlights.length - 1];
        
        const tripOrigin = firstOutboundFlight.origin;
        // For round trips, destination is the outbound destination (not the return destination)
        // For one-way trips, destination is the last outbound flight's destination
        const tripDestination = lastOutboundFlight.destination;
        
        // Calculate total duration as integer minutes (sum of all flight durations)
        const totalDuration = outboundFlights.reduce((sum, f) => sum + f.duration, 0) +
          returnFlights.reduce((sum, f) => sum + f.duration, 0);
        const stopCount = (outbound.legs.length - 1) + (returnFlight ? (returnFlight.legs.length - 1) : 0);
        
        // Generate trip ID from all flight IDs (sorted to ensure consistency)
        // Use SHA-256 hash to create a fixed-length (64 chars), collision-resistant ID
        const allFlightIds = [
          ...outboundFlights.map(f => f.id),
          ...returnFlights.map(f => f.id)
        ].sort().join('|');
        const tripId = createHash('sha256').update(allFlightIds).digest('hex');
        
        // Add trip to collection
        tripsToInsert.set(tripId, { id: tripId });
        
        // Generate leg IDs and add legs to collection
        const legData: Array<{ id: string; flight: any; inbound: boolean; connectionTime: number | null; order: number }> = [];
        
        // Generate outbound leg IDs and collect leg data
        // Outbound legs have order 0, 1, 2, ... (increasing)
        for (let i = 0; i < outboundFlights.length; i++) {
          const flight = outboundFlights[i];
          const leg = outbound.legs[i];
          // Parse connection time to integer minutes (or null)
          const connectionTime = leg.connectionTime ? parseDurationToMinutes(leg.connectionTime) : null;
          // Leg ID format: outbound_<flightId>_<tripId>
          const legId = `outbound_${flight.id}_${tripId}`;
          legData.push({
            id: legId,
            flight: flight.id,
            inbound: false,
            connectionTime,
            order: i // Outbound legs start at 0
          });
        }
        
        // Generate return leg IDs and collect leg data
        // Return legs continue the order sequence after outbound legs
        for (let i = 0; i < returnFlights.length; i++) {
          const flight = returnFlights[i];
          const leg = returnFlight!.legs[i];
          // Parse connection time to integer minutes (or null)
          const connectionTime = leg.connectionTime ? parseDurationToMinutes(leg.connectionTime) : null;
          // Leg ID format: inbound_<flightId>_<tripId>
          const legId = `inbound_${flight.id}_${tripId}`;
          legData.push({
            id: legId,
            flight: flight.id,
            inbound: true,
            connectionTime,
            order: outboundFlights.length + i // Return legs continue after outbound
          });
        }
        
        // Add legs to collection (Map ensures uniqueness by ID)
        for (const leg of legData) {
          legsToInsert.set(leg.id, {
            id: leg.id,
            trip: tripId,
            flight: leg.flight,
            inbound: leg.inbound,
            connection_time: leg.connectionTime, // Already integer or null
            order: leg.order
          });
        }
        
        // Add deals to collection (Map ensures uniqueness by ID and allows updating price/link)
        const departureTime = parseTimeTo24Hour(outbound.departure);
        const returnTime = returnFlight ? parseTimeTo24Hour(returnFlight.departure) : null;
        
        for (const priceInfo of prices) {
          const priceValue = parseFloat(priceInfo.price.replace(/,/g, ''));
          const dealId = `${tripId}_skyscanner_${priceInfo.provider}`;
          
          // Use set to ensure uniqueness - if same deal exists, it will be updated with latest price/link
          dealsToInsert.set(dealId, {
            id: dealId,
            trip: tripId,
            origin: tripOrigin,
            destination: tripDestination,
            stop_count: stopCount,
            duration: totalDuration, // Integer minutes (sum of integer flight durations)
            is_round: isRound,
            departure_date: sectionDate!,
            departure_time: departureTime || '00:00',
            return_date: returnDate || null,
            return_time: returnTime,
            source: 'skyscanner',
            provider: priceInfo.provider,
            price: priceValue,
            link: priceInfo.link || '',
            updated_at: now.toISOString()
          });
        }
      } catch (error) {
        logger.error('Error processing flight', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    // Step 4: Bulk insert all data
    logger.info('Starting bulk inserts', {
      flights: flightsToInsert.size,
      trips: tripsToInsert.size,
      legs: legsToInsert.size,
      deals: dealsToInsert.size
    });
    
    // Bulk insert flights
    if (flightsToInsert.size > 0) {
      const flightsArray = Array.from(flightsToInsert.values());
      const { error: flightsError } = await supabase
        .from('flights')
        .upsert(flightsArray, { onConflict: 'id' });
      
      if (flightsError) {
        logger.error('Failed to bulk upsert flights', { error: flightsError });
      } else {
        logger.info(`Successfully bulk upserted ${flightsArray.length} flights`);
      }
    }
    
    // Bulk insert trips
    if (tripsToInsert.size > 0) {
      const tripsArray = Array.from(tripsToInsert.values());
      const { error: tripsError } = await supabase
        .from('trips')
        .upsert(tripsArray, { onConflict: 'id' });
      
      if (tripsError) {
        logger.error('Failed to bulk upsert trips', { error: tripsError });
      } else {
        logger.info(`Successfully bulk upserted ${tripsArray.length} trips`);
      }
    }
    
    // Bulk insert legs
    if (legsToInsert.size > 0) {
      const legsArray = Array.from(legsToInsert.values());
      const { error: legsError } = await supabase
        .from('legs')
        .upsert(legsArray, { onConflict: 'id' });
      
      if (legsError) {
        logger.error('Failed to bulk upsert legs', { error: legsError });
      } else {
        logger.info(`Successfully bulk upserted ${legsArray.length} legs`);
      }
    }
    
    // Bulk insert deals
    if (dealsToInsert.size > 0) {
      const dealsArray = Array.from(dealsToInsert.values());
      const { error: dealsError } = await supabase
        .from('deals')
        .upsert(dealsArray, { onConflict: 'id' });
      
      if (dealsError) {
        logger.error('Failed to bulk upsert deals', { error: dealsError });
      } else {
        logger.info(`Successfully bulk upserted ${dealsArray.length} deals`);
      }
    }
    
    const tripsScraped = tripsToInsert.size;
    
    // Create or update fetchQueries entry
    const queryId = generateQueryId(origin, destination, departureDate, returnDate);
    const fetchTimestamp = new Date().toISOString();
    const { error: fetchQueryError } = await supabase
      .from('fetch_queries')
      .upsert({
        id: queryId,
        origin: origin.toUpperCase(),
        destination: destination.toUpperCase(),
        departure_date: departureDate,
        return_date: returnDate || null,
        last_fetched: fetchTimestamp,
        updated_at: fetchTimestamp,
      }, {
        onConflict: 'id',
      });
    
    if (fetchQueryError) {
      logger.error('Failed to update fetch_queries', { error: fetchQueryError });
    } else {
      logger.info('Updated fetch_queries', { queryId, lastFetched: fetchTimestamp });
    }
    
    logger.info('Scraping complete', { tripsScraped });
    
    return {
      status: 200,
      body: {
        success: true,
        message: `Successfully scraped ${tripsScraped} trips`,
        tripsScraped
      }
    };
  } catch (error) {
    logger.error('Flight scraper failed', { error: error instanceof Error ? error.message : String(error) });
    
    if (error instanceof z.ZodError) {
      return {
        status: 400,
        body: {
          success: false,
          error: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
        }
      };
    }
    
    return {
      status: 500,
      body: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    };
  }
};

