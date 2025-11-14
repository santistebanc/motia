import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const flightSearchRangeSchema = z.object({
  origin: z.string().min(3, 'Origin must be at least 3 characters'),
  destination: z.string().min(3, 'Destination must be at least 3 characters'),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Departure date must be in YYYY-MM-DD format'),
  departureDateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Departure end date must be in YYYY-MM-DD format').optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Return date must be in YYYY-MM-DD format').optional(),
  returnDateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Return end date must be in YYYY-MM-DD format').optional(),
});

// Helper function to calculate total trip duration for sorting
function calculateTotalDuration(trip: any): number {
  const outboundLegs = trip.legs.filter((leg: any) => !leg.inbound);
  const returnLegs = trip.legs.filter((leg: any) => leg.inbound);

  const outboundDuration = outboundLegs.reduce((total: number, leg: any) => {
    return total + leg.flight.duration + (leg.connectionTime || 0);
  }, 0);

  const returnDuration = returnLegs.reduce((total: number, leg: any) => {
    return total + leg.flight.duration + (leg.connectionTime || 0);
  }, 0);

  return outboundDuration + returnDuration;
}

export const config: ApiRouteConfig = {
  name: 'FlightSearchRange',
  type: 'api',
  path: '/api/flights/search-range',
  method: 'POST',
  description: 'Search for flights across date ranges and merge results',
  emits: [],
  flows: ['flight-search-range-flow'],
  bodySchema: flightSearchRangeSchema,
  responseSchema: {
    200: z.object({
      success: z.boolean(),
      lastFetched: z.string().nullable(),
      tripsWithDeals: z.array(z.any()),
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

export const handler: Handlers['FlightSearchRange'] = async (req, { logger }) => {
  try {
    const body = flightSearchRangeSchema.parse(req.body);
    const { origin, destination, departureDate, departureDateEnd, returnDate, returnDateEnd } = body;
    
    logger.info('Starting range flight search', { origin, destination, departureDate, departureDateEnd, returnDate, returnDateEnd });
    
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
    
    // Build a single query with date range filters
    logger.info('Building single range query');
    
    // Query deals with date range filters (deals table has origin/destination)
    // Select only needed columns to reduce data transfer
    let dealsQuery = supabase
      .from('deals')
      .select('id, trip, origin, destination, stop_count, duration, is_round, departure_date, departure_time, return_date, return_time, source, provider, price, link')
      .eq('origin', origin.toUpperCase())
      .eq('destination', destination.toUpperCase())
      .gte('departure_date', departureDate);

    // Apply departure date end range if provided
    if (departureDateEnd) {
      dealsQuery = dealsQuery.lte('departure_date', departureDateEnd);
    } else {
      // If no end date, only match exact departure date
      dealsQuery = dealsQuery.eq('departure_date', departureDate);
    }

    // Apply return date filters
    if (returnDate) {
      if (returnDateEnd) {
        // Range: return_date between returnDate and returnDateEnd
        dealsQuery = dealsQuery
          .gte('return_date', returnDate)
          .lte('return_date', returnDateEnd);
      } else {
        // Exact: return_date equals returnDate
        dealsQuery = dealsQuery.eq('return_date', returnDate);
      }
    } else {
      // One-way: return_date must be null
      dealsQuery = dealsQuery.is('return_date', null);
    }

    const { data: dealsData, error: dealsError } = await dealsQuery;

    if (dealsError) {
      logger.error('Error querying deals', { error: dealsError });
      return {
        status: 500,
        body: {
          success: false,
          error: 'Failed to query database'
        }
      };
    }

    if (!dealsData || dealsData.length === 0) {
      logger.info('No deals found in date range');
      return {
        status: 200,
        body: {
          success: true,
          lastFetched: null,
          tripsWithDeals: [],
        },
      };
    }

    logger.info(`Found ${dealsData.length} deals in date range`);

    // Query fetch_queries to get all last_fetched timestamps within the ranges
    let fetchQueriesQuery = supabase
      .from('fetch_queries')
      .select('last_fetched')
      .eq('origin', origin.toUpperCase())
      .eq('destination', destination.toUpperCase())
      .gte('departure_date', departureDate);

    if (departureDateEnd) {
      fetchQueriesQuery = fetchQueriesQuery.lte('departure_date', departureDateEnd);
    } else {
      fetchQueriesQuery = fetchQueriesQuery.eq('departure_date', departureDate);
    }

    if (returnDate) {
      if (returnDateEnd) {
        fetchQueriesQuery = fetchQueriesQuery
          .gte('return_date', returnDate)
          .lte('return_date', returnDateEnd);
      } else {
        fetchQueriesQuery = fetchQueriesQuery.eq('return_date', returnDate);
      }
    } else {
      fetchQueriesQuery = fetchQueriesQuery.is('return_date', null);
    }

    const { data: fetchQueriesData } = await fetchQueriesQuery;
    const allLastFetched = (fetchQueriesData || [])
      .map((q: any) => q.last_fetched)
      .filter((ts: any): ts is string => ts !== null);

    // Group deals by trip ID
    const tripsMap = new Map<string, any>();
    
    for (const deal of dealsData) {
      const tripId = deal.trip;
      
      if (!tripsMap.has(tripId)) {
        tripsMap.set(tripId, {
          tripId,
          origin: deal.origin,
          destination: deal.destination,
          stopCount: deal.stop_count,
          duration: deal.duration,
          isRound: deal.is_round,
          departureDate: deal.departure_date,
          departureTime: deal.departure_time,
          returnDate: deal.return_date,
          returnTime: deal.return_time,
          deals: [],
          legs: [],
        });
      }
      
      // Add deal to trip
      const trip = tripsMap.get(tripId)!;
      trip.deals.push({
        id: deal.id,
        source: deal.source,
        provider: deal.provider,
        price: deal.price,
        link: deal.link,
      });
    }

    // Fetch legs for all trips (batch queries to avoid IN clause limits)
    const tripIds = Array.from(tripsMap.keys());
    const BATCH_SIZE = 100; // Supabase/PostgREST typically limits IN clauses to ~100-200 items
    const allLegsData: any[] = [];
    
    for (let i = 0; i < tripIds.length; i += BATCH_SIZE) {
      const batch = tripIds.slice(i, i + BATCH_SIZE);
      const { data: legsData, error: legsError } = await supabase
        .from('legs')
        .select('*')
        .in('trip', batch)
        .order('order', { ascending: true });

      if (legsError) {
        logger.error('Error querying legs batch', { error: legsError, batchIndex: i, batchSize: batch.length });
        return {
          status: 500,
          body: {
            success: false,
            error: 'Failed to query database'
          }
        };
      }

      if (legsData) {
        allLegsData.push(...legsData);
      }
    }

    const legsData = allLegsData;

    // Group legs by trip and fetch flights
    const flightIds = new Set<string>();
    if (legsData) {
      for (const leg of legsData) {
        flightIds.add(leg.flight);
        const trip = tripsMap.get(leg.trip);
        if (trip) {
          trip.legs.push({
            id: leg.id,
            inbound: leg.inbound,
            connectionTime: leg.connection_time,
            order: leg.order,
            flightId: leg.flight,
          });
        }
      }
    }

    // Fetch all flights (batch queries to avoid IN clause limits)
    const flightIdsArray = Array.from(flightIds);
    const allFlightsData: any[] = [];
    
    for (let i = 0; i < flightIdsArray.length; i += BATCH_SIZE) {
      const batch = flightIdsArray.slice(i, i + BATCH_SIZE);
      const { data: flightsData, error: flightsError } = await supabase
        .from('flights')
        .select('*')
        .in('id', batch);

      if (flightsError) {
        logger.error('Error querying flights batch', { error: flightsError, batchIndex: i, batchSize: batch.length });
        return {
          status: 500,
          body: {
            success: false,
            error: 'Failed to query database'
          }
        };
      }

      if (flightsData) {
        allFlightsData.push(...flightsData);
      }
    }

    const flightsData = allFlightsData;

    // Create flights map for quick lookup
    const flightsMap = new Map<string, any>();
    if (flightsData) {
      for (const flight of flightsData) {
        flightsMap.set(flight.id, {
          id: flight.id,
          flightNumber: flight.flight_number,
          airline: flight.airline,
          origin: flight.origin,
          destination: flight.destination,
          departureDate: flight.departure_date,
          departureTime: flight.departure_time,
          arrivalDate: flight.arrival_date,
          arrivalTime: flight.arrival_time,
          duration: flight.duration,
        });
      }
    }

    // Transform trips with deals and legs
    const allTrips = Array.from(tripsMap.values()).map(trip => {
      // Sort deals by price
      trip.deals.sort((a: any, b: any) => a.price - b.price);
      
      // Map legs with flight data
      trip.legs = trip.legs.map((leg: any) => {
        const flight = flightsMap.get(leg.flightId);
        return {
          id: leg.id,
          inbound: leg.inbound,
          connectionTime: leg.connectionTime,
          order: leg.order,
          flight: flight || {
            id: leg.flightId,
            flightNumber: '',
            airline: '',
            origin: '',
            destination: '',
            departureDate: '',
            departureTime: '',
            arrivalDate: '',
            arrivalTime: '',
            duration: 0,
          }
        };
      });
      
      return trip;
    });
    
    // Filter and sort trips
    const tripsWithDeals = allTrips
      .filter((trip: any) => trip.deals && trip.deals.length > 0)
      .sort((a: any, b: any) => {
        const minPriceA = Math.min(...a.deals.map((d: any) => d.price));
        const minPriceB = Math.min(...b.deals.map((d: any) => d.price));

        if (minPriceA === minPriceB) {
          const totalDurationA = calculateTotalDuration(a);
          const totalDurationB = calculateTotalDuration(b);
          return totalDurationA - totalDurationB;
        }

        return minPriceA - minPriceB;
      });
    
    // Find oldest last_fetched (earliest timestamp that's not null)
    let oldestLastFetched: string | null = null;
    if (allLastFetched.length > 0) {
      allLastFetched.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      oldestLastFetched = allLastFetched[0];
    }
    
    logger.info(`Found ${tripsWithDeals.length} unique trips in date range`);
    
    return {
      status: 200,
      body: {
        success: true,
        lastFetched: oldestLastFetched,
        tripsWithDeals,
      },
    };
  } catch (error) {
    logger.error('Error in range flight search', { error });
    return {
      status: 500,
      body: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    };
  }
};

