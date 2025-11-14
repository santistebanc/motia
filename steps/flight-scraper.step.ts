import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { generateQueryId } from '../src/utils/query-id';
import { convertDateToYYYYMMDD, parseTimeTo24Hour, parseDurationToMinutes } from '../src/utils/date-time-parsers';
import { getRequest, pollRequest } from '../src/services/flight-scraper-api';
import { extractFlights } from '../src/services/flight-scraper-parser';

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
      
      const pollResult = await pollRequest(dataObject, cookies, extractFlights);
      
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
        const returnFlights: Array<{ id: string; flightNumber: string; airline: string; origin: string; destination: string; departureDate: string; departureTime: string; arrivalDate: string; arrivalTime: string; duration: number; originalLegIndex: number }> = [];
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
              duration: durationMinutes,
              originalLegIndex: i // Store the original leg index
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
        // Outbound legs have order 0, 1, 2, ... (within outbound group)
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
            order: i // Order within outbound group (0, 1, 2, ...)
          });
        }
        
        // Generate return leg IDs and collect leg data
        // Return legs have order 0, 1, 2, ... (within inbound group)
        // Create a map of originalLegIndex to flight for quick lookup
        const returnFlightMap = new Map<number, typeof returnFlights[0]>();
        for (const flight of returnFlights) {
          returnFlightMap.set(flight.originalLegIndex, flight);
        }
        
        // Iterate through ALL returnFlight.legs to ensure we don't miss any, even if validation failed
        if (returnFlight && returnFlight.legs) {
          for (let i = 0; i < returnFlight.legs.length; i++) {
            const leg = returnFlight.legs[i];
            const flight = returnFlightMap.get(i);
            
            // Create leg data for ALL legs, even if flight creation failed
            if (flight) {
              // We have a valid flight, use it
              const connectionTime = leg.connectionTime ? parseDurationToMinutes(leg.connectionTime) : null;
              const legId = `inbound_${flight.id}_${tripId}`;
              legData.push({
                id: legId,
                flight: flight.id,
                inbound: true,
                connectionTime,
                order: i // Order within inbound group (0, 1, 2, ...)
              });
            } else {
              // Flight creation failed, but we still need to create the leg
              // Generate a flight ID even if validation failed, using available data
              const departureTime = parseTimeTo24Hour(leg.departure) || '00:00';
              const returnSectionDate = convertDateToYYYYMMDD(returnFlight.date) || '';
              const flightId = `${leg.flightNumber || 'UNKNOWN'}_${leg.origin || 'XXX'}_${returnSectionDate}_${departureTime}`;
              
              // Create the flight entry even if validation failed
              const durationMinutes = leg.duration ? parseDurationToMinutes(leg.duration) : 0;
              flightsToInsert.set(flightId, {
                id: flightId,
                flight_number: leg.flightNumber || '',
                origin: leg.origin || '',
                destination: leg.destination || '',
                departure_date: returnSectionDate,
                departure_time: departureTime,
                arrival_date: returnSectionDate,
                arrival_time: parseTimeTo24Hour(leg.arrival) || departureTime,
                duration: durationMinutes,
                airline: leg.airline || ''
              });
              
              const connectionTime = leg.connectionTime ? parseDurationToMinutes(leg.connectionTime) : null;
              const legId = `inbound_${flightId}_${tripId}`;
              legData.push({
                id: legId,
                flight: flightId,
                inbound: true,
                connectionTime,
                order: i // Order within inbound group (0, 1, 2, ...)
              });
            }
          }
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

