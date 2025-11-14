import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { generateQueryId } from '../src/utils/query-id';
import { getRequest, pollRequest } from '../src/services/flight-scraper-api';
import { extractFlights } from '../src/services/flight-scraper-parser';
import { convertDateToYYYYMMDD, parseTimeTo24Hour, parseDurationToMinutes } from '../src/utils/date-time-parsers';
import { createHash } from 'crypto';

const scraperRangeSchema = z.object({
  origin: z.string().min(3, 'Origin must be at least 3 characters'),
  destination: z.string().min(3, 'Destination must be at least 3 characters'),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Departure date must be in YYYY-MM-DD format'),
  departureDateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Departure end date must be in YYYY-MM-DD format').optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Return date must be in YYYY-MM-DD format').optional(),
  returnDateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Return end date must be in YYYY-MM-DD format').optional(),
});

// Generate all date combinations from ranges
function generateDateCombinations(
  departureDate: string,
  departureDateEnd: string | undefined,
  returnDate: string | undefined,
  returnDateEnd: string | undefined
): Array<{ departureDate: string; returnDate?: string }> {
  const departureDates: string[] = []
  const returnDates: string[] = []
  
  // Generate departure dates
  if (departureDateEnd) {
    const start = new Date(departureDate)
    const end = new Date(departureDateEnd)
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      departureDates.push(d.toISOString().split('T')[0])
    }
  } else {
    departureDates.push(departureDate)
  }
  
  // Generate return dates (only if round trip)
  if (returnDate) {
    if (returnDateEnd) {
      const start = new Date(returnDate)
      const end = new Date(returnDateEnd)
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        returnDates.push(d.toISOString().split('T')[0])
      }
    } else {
      returnDates.push(returnDate)
    }
  }
  
  // Generate all combinations
  const combinations: Array<{ departureDate: string; returnDate?: string }> = []
  for (const depDate of departureDates) {
    if (returnDates.length > 0) {
      for (const retDate of returnDates) {
        combinations.push({ departureDate: depDate, returnDate: retDate })
      }
    } else {
      combinations.push({ departureDate: depDate })
    }
  }
  
  return combinations
}

export const config: ApiRouteConfig = {
  name: 'FlightScraperRange',
  type: 'api',
  path: '/api/flights/scrape-range',
  method: 'POST',
  description: 'Scrape flights from Skyscanner across date ranges and save to database',
  emits: [],
  flows: ['flight-scraper-range-flow'],
  bodySchema: scraperRangeSchema,
  responseSchema: {
    200: z.object({
      success: z.boolean(),
      message: z.string(),
      tripsScraped: z.number(),
      combinationsProcessed: z.number(),
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

export const handler: Handlers['FlightScraperRange'] = async (req, { logger }) => {
  try {
    const body = scraperRangeSchema.parse(req.body);
    const { origin, destination, departureDate, departureDateEnd, returnDate, returnDateEnd } = body;
    
    logger.info('Starting range flight scraper', { origin, destination, departureDate, departureDateEnd, returnDate, returnDateEnd });
    
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
    
    // Generate all date combinations
    const combinations = generateDateCombinations(departureDate, departureDateEnd, returnDate, returnDateEnd);
    logger.info(`Scraping ${combinations.length} date combinations`);
    
    let totalTripsScraped = 0;
    let successfulCombinations = 0;
    
    // Process each combination
    for (const combo of combinations) {
      try {
        logger.info(`Processing combination: ${combo.departureDate}${combo.returnDate ? ` / ${combo.returnDate}` : ''}`);
        
        // Step 1: Make initial request
        const initialResult = await getRequest({
          originplace: origin,
          destinationplace: destination,
          outbounddate: combo.departureDate,
          inbounddate: combo.returnDate || ''
        });
        
        if (!initialResult.success || !initialResult.data || !initialResult.data['_token']) {
          logger.warn(`Failed to get initial request for ${combo.departureDate}${combo.returnDate ? ` / ${combo.returnDate}` : ''}`);
          continue;
        }
        
        const dataObject = initialResult.data;
        let cookies = initialResult.cookies || '';
        
        // Step 2: Poll until finished
        let finished = false;
        let pollCount = 0;
        const maxPolls = 20;
        const allFlights: any[] = [];
        
        while (!finished && pollCount < maxPolls) {
          pollCount++;
          const pollResult = await pollRequest(dataObject, cookies, extractFlights);
          
          if (!pollResult.success) {
            logger.warn(`Poll failed for ${combo.departureDate}${combo.returnDate ? ` / ${combo.returnDate}` : ''}`);
            break;
          }
          
          if (pollResult.cookies) {
            cookies = pollResult.cookies;
          }
          
          finished = pollResult.finished === true;
          
          if (finished && pollResult.flights && pollResult.flights.length > 0) {
            allFlights.push(...pollResult.flights);
          } else if (!finished) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        if (allFlights.length === 0) {
          logger.info(`No flights found for ${combo.departureDate}${combo.returnDate ? ` / ${combo.returnDate}` : ''}`);
          continue;
        }
        
        // Step 3: Process all flights and collect data for bulk insert
        const isRound = !!combo.returnDate;
        const fetchTimestamp = new Date().toISOString();
        
        // Collections for bulk inserts (using Maps to ensure uniqueness by ID)
        const flightsToInsert = new Map<string, any>();
        const tripsToInsert = new Map<string, any>();
        const legsToInsert = new Map<string, any>();
        const dealsToInsert = new Map<string, any>();
        
        for (const flightData of allFlights) {
          const outbound = flightData.outbound;
          if (!outbound) continue;
          
          const outboundSectionDate = convertDateToYYYYMMDD(outbound.date);
          if (!outboundSectionDate) continue;
          
          const outboundFlights: any[] = [];
          if (outbound.legs && outbound.legs.length > 0) {
            for (let i = 0; i < outbound.legs.length; i++) {
              const leg = outbound.legs[i];
              const departureTime = parseTimeTo24Hour(leg.departure);
              const arrivalTime = parseTimeTo24Hour(leg.arrival);
              
              if (!departureTime || !arrivalTime || !leg.origin || !leg.destination) {
                continue;
              }
              
              const flightId = `${leg.flightNumber || 'UNKNOWN'}_${leg.origin}_${outboundSectionDate}_${departureTime}`;
              const durationMinutes = leg.duration ? parseDurationToMinutes(leg.duration) : 0;
              
              flightsToInsert.set(flightId, {
                id: flightId,
                flight_number: leg.flightNumber || '',
                origin: leg.origin,
                destination: leg.destination,
                departure_date: outboundSectionDate,
                departure_time: departureTime,
                arrival_date: leg.arrivalDate ? convertDateToYYYYMMDD(leg.arrivalDate) || outboundSectionDate : outboundSectionDate,
                arrival_time: arrivalTime,
                duration: durationMinutes,
                airline: leg.airline || ''
              });
              
              outboundFlights.push({
                id: flightId,
                originalLegIndex: i
              });
            }
          } else {
            // Single flight
            const departureTime = parseTimeTo24Hour(outbound.departure);
            const arrivalTime = parseTimeTo24Hour(outbound.arrival);
            
            if (departureTime && arrivalTime && outbound.origin && outbound.destination) {
              const flightId = `${outbound.airline || 'UNKNOWN'}_${outbound.origin}_${outboundSectionDate}_${departureTime}`;
              const durationMinutes = outbound.duration ? parseDurationToMinutes(outbound.duration) : 0;
              
              flightsToInsert.set(flightId, {
                id: flightId,
                flight_number: outbound.airline || '',
                origin: outbound.origin,
                destination: outbound.destination,
                departure_date: outboundSectionDate,
                departure_time: departureTime,
                arrival_date: outboundSectionDate,
                arrival_time: arrivalTime,
                duration: durationMinutes,
                airline: outbound.airline || ''
              });
              
              outboundFlights.push({
                id: flightId,
                originalLegIndex: 0
              });
            }
          }
          
          const returnFlight = flightData.return;
          const returnFlights: any[] = [];
          
          if (returnFlight && isRound) {
            const returnSectionDate = convertDateToYYYYMMDD(returnFlight.date);
            if (returnSectionDate && returnFlight.legs && returnFlight.legs.length > 0) {
              for (let i = 0; i < returnFlight.legs.length; i++) {
                const leg = returnFlight.legs[i];
                const departureTime = parseTimeTo24Hour(leg.departure);
                const arrivalTime = parseTimeTo24Hour(leg.arrival);
                
                if (!departureTime || !arrivalTime || !leg.origin || !leg.destination) {
                  // Create fallback flight entry
                  const fallbackDepartureTime = parseTimeTo24Hour(leg.departure) || '00:00';
                  const flightId = `${leg.flightNumber || 'UNKNOWN'}_${leg.origin || 'XXX'}_${returnSectionDate}_${fallbackDepartureTime}`;
                  const durationMinutes = leg.duration ? parseDurationToMinutes(leg.duration) : 0;
                  
                  flightsToInsert.set(flightId, {
                    id: flightId,
                    flight_number: leg.flightNumber || '',
                    origin: leg.origin || '',
                    destination: leg.destination || '',
                    departure_date: returnSectionDate,
                    departure_time: fallbackDepartureTime,
                    arrival_date: returnSectionDate,
                    arrival_time: parseTimeTo24Hour(leg.arrival) || fallbackDepartureTime,
                    duration: durationMinutes,
                    airline: leg.airline || ''
                  });
                  
                  returnFlights.push({
                    id: flightId,
                    originalLegIndex: i
                  });
                  continue;
                }
                
                const flightId = `${leg.flightNumber || 'UNKNOWN'}_${leg.origin}_${returnSectionDate}_${departureTime}`;
                const durationMinutes = leg.duration ? parseDurationToMinutes(leg.duration) : 0;
                
                flightsToInsert.set(flightId, {
                  id: flightId,
                  flight_number: leg.flightNumber || '',
                  origin: leg.origin,
                  destination: leg.destination,
                  departure_date: returnSectionDate,
                  departure_time: departureTime,
                  arrival_date: leg.arrivalDate ? convertDateToYYYYMMDD(leg.arrivalDate) || returnSectionDate : returnSectionDate,
                  arrival_time: arrivalTime,
                  duration: durationMinutes,
                  airline: leg.airline || ''
                });
                
                returnFlights.push({
                  id: flightId,
                  originalLegIndex: i
                });
              }
            }
          }
          
          // Generate trip ID from all flight IDs
          const allFlightIds = [
            ...outboundFlights.map(f => f.id),
            ...returnFlights.map(f => f.id)
          ].sort().join('|');
          const tripId = createHash('sha256').update(allFlightIds).digest('hex');
          
          tripsToInsert.set(tripId, { id: tripId });
          
          // Generate leg data
          const legData: Array<{ id: string; flight: any; inbound: boolean; connectionTime: number | null; order: number }> = [];
          
          // Outbound legs
          const returnFlightMap = new Map<number, typeof returnFlights[0]>();
          for (const flight of returnFlights) {
            returnFlightMap.set(flight.originalLegIndex, flight);
          }
          
          for (let i = 0; i < outboundFlights.length; i++) {
            const flight = outboundFlights[i];
            const leg = outbound.legs ? outbound.legs[i] : null;
            const connectionTime = leg && leg.connectionTime ? parseDurationToMinutes(leg.connectionTime) : null;
            const legId = `outbound_${flight.id}_${tripId}`;
            legData.push({
              id: legId,
              flight: flight.id,
              inbound: false,
              connectionTime,
              order: i
            });
          }
          
          // Return legs
          if (returnFlight && returnFlight.legs) {
            for (let i = 0; i < returnFlight.legs.length; i++) {
              const leg = returnFlight.legs[i];
              const flight = returnFlightMap.get(i);
              
              if (flight) {
                const connectionTime = leg.connectionTime ? parseDurationToMinutes(leg.connectionTime) : null;
                const legId = `inbound_${flight.id}_${tripId}`;
                legData.push({
                  id: legId,
                  flight: flight.id,
                  inbound: true,
                  connectionTime,
                  order: i
                });
              } else {
                // Flight creation failed, but we still need to create the leg
                const departureTime = parseTimeTo24Hour(leg.departure) || '00:00';
                const returnSectionDate = convertDateToYYYYMMDD(returnFlight.date) || '';
                const flightId = `${leg.flightNumber || 'UNKNOWN'}_${leg.origin || 'XXX'}_${returnSectionDate}_${departureTime}`;
                
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
                  order: i
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
          
          // Process deals
          // Calculate trip metadata for deals
          const firstOutboundFlightId = outboundFlights[0]?.id;
          const lastOutboundFlightId = outboundFlights[outboundFlights.length - 1]?.id;
          const firstOutboundFlightData = firstOutboundFlightId ? flightsToInsert.get(firstOutboundFlightId) : null;
          const lastOutboundFlightData = lastOutboundFlightId ? flightsToInsert.get(lastOutboundFlightId) : null;
          const tripOrigin = firstOutboundFlightData?.origin || origin.toUpperCase();
          const tripDestination = lastOutboundFlightData?.destination || destination.toUpperCase();
          const stopCount = (outbound.legs ? outbound.legs.length - 1 : 0) + (returnFlight && returnFlight.legs ? returnFlight.legs.length - 1 : 0);
          const totalDuration = outboundFlights.reduce((sum: number, f: any) => {
            const flight = flightsToInsert.get(f.id);
            return sum + (flight ? flight.duration : 0);
          }, 0) + returnFlights.reduce((sum: number, f: any) => {
            const flight = flightsToInsert.get(f.id);
            return sum + (flight ? flight.duration : 0);
          }, 0);
          const departureTime = parseTimeTo24Hour(outbound.departure) || '00:00';
          const returnTime = returnFlight ? parseTimeTo24Hour(returnFlight.arrival) : null;
          
          const prices = flightData.prices || [];
          for (const priceData of prices) {
            const priceValue = parseFloat(priceData.price.replace(/,/g, ''));
            if (isNaN(priceValue)) continue;
            
            const dealId = `${tripId}_skyscanner_${priceData.provider}`;
            dealsToInsert.set(dealId, {
              id: dealId,
              trip: tripId,
              origin: tripOrigin.toUpperCase(),
              destination: tripDestination.toUpperCase(),
              stop_count: stopCount,
              duration: totalDuration,
              is_round: isRound,
              departure_date: combo.departureDate,
              departure_time: departureTime,
              return_date: combo.returnDate || null,
              return_time: returnTime,
              source: 'skyscanner',
              provider: priceData.provider,
              price: priceValue,
              link: priceData.link || '',
            });
          }
        }
        
        // Save all results to database immediately after processing this combination
        // Don't proceed to next combination until all data is saved
        
        // Bulk insert flights
        if (flightsToInsert.size > 0) {
          const { error: flightsError } = await supabase
            .from('flights')
            .upsert(Array.from(flightsToInsert.values()), { onConflict: 'id' });
          
          if (flightsError) {
            logger.error(`Error saving flights for ${combo.departureDate}${combo.returnDate ? ` / ${combo.returnDate}` : ''}`, { error: flightsError });
            throw flightsError;
          }
        }
        
        // Bulk insert trips
        if (tripsToInsert.size > 0) {
          const { error: tripsError } = await supabase
            .from('trips')
            .upsert(Array.from(tripsToInsert.values()), { onConflict: 'id' });
          
          if (tripsError) {
            logger.error(`Error saving trips for ${combo.departureDate}${combo.returnDate ? ` / ${combo.returnDate}` : ''}`, { error: tripsError });
            throw tripsError;
          }
        }
        
        // Bulk insert legs
        if (legsToInsert.size > 0) {
          const { error: legsError } = await supabase
            .from('legs')
            .upsert(Array.from(legsToInsert.values()), { onConflict: 'id' });
          
          if (legsError) {
            logger.error(`Error saving legs for ${combo.departureDate}${combo.returnDate ? ` / ${combo.returnDate}` : ''}`, { error: legsError });
            throw legsError;
          }
        }
        
        // Bulk insert deals
        if (dealsToInsert.size > 0) {
          const { error: dealsError } = await supabase
            .from('deals')
            .upsert(Array.from(dealsToInsert.values()), { onConflict: 'id' });
          
          if (dealsError) {
            logger.error(`Error saving deals for ${combo.departureDate}${combo.returnDate ? ` / ${combo.returnDate}` : ''}`, { error: dealsError });
            throw dealsError;
          }
        }
        
        // Create or update fetchQueries entry
        const queryId = generateQueryId(origin, destination, combo.departureDate, combo.returnDate);
        const { error: fetchQueryError } = await supabase
          .from('fetch_queries')
          .upsert({
            id: queryId,
            origin: origin.toUpperCase(),
            destination: destination.toUpperCase(),
            departure_date: combo.departureDate,
            return_date: combo.returnDate || null,
            last_fetched: fetchTimestamp,
            updated_at: fetchTimestamp,
          }, {
            onConflict: 'id',
          });
        
        if (fetchQueryError) {
          logger.error(`Error saving fetch query for ${combo.departureDate}${combo.returnDate ? ` / ${combo.returnDate}` : ''}`, { error: fetchQueryError });
          throw fetchQueryError;
        }
        
        // All data saved successfully - now we can proceed
        totalTripsScraped += tripsToInsert.size;
        successfulCombinations++;
        
        logger.info(`Successfully scraped and saved ${tripsToInsert.size} trips for ${combo.departureDate}${combo.returnDate ? ` / ${combo.returnDate}` : ''}`);
        
        // Add a small delay between combinations to avoid rate limiting
        if (combinations.indexOf(combo) < combinations.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        logger.error(`Error processing combination ${combo.departureDate}${combo.returnDate ? ` / ${combo.returnDate}` : ''}`, { error });
        // Continue with next combination
      }
    }
    
    logger.info(`Range scraping completed: ${successfulCombinations}/${combinations.length} combinations successful, ${totalTripsScraped} total trips scraped`);
    
    return {
      status: 200,
      body: {
        success: true,
        message: `Scraped ${totalTripsScraped} trips across ${successfulCombinations} date combinations`,
        tripsScraped: totalTripsScraped,
        combinationsProcessed: successfulCombinations,
      },
    };
  } catch (error) {
    logger.error('Error in range flight scraper', { error });
    return {
      status: 500,
      body: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    };
  }
};

