import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const flightSearchSchema = z.object({
  origin: z.string().min(3, 'Origin must be at least 3 characters'),
  destination: z.string().min(3, 'Destination must be at least 3 characters'),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Departure date must be in YYYY-MM-DD format'),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Return date must be in YYYY-MM-DD format').optional(),
});

// Generate a deterministic ID from search parameters
function generateQueryId(origin: string, destination: string, departureDate: string, returnDate?: string): string {
  const params = `${origin.toUpperCase()}|${destination.toUpperCase()}|${departureDate}|${returnDate || ''}`;
  return createHash('sha256').update(params).digest('hex');
}

export const config: ApiRouteConfig = {
  name: 'FlightSearch',
  type: 'api',
  path: '/api/flights/search',
  method: 'POST',
  description: 'Search for flights based on origin, destination, and dates',
  emits: [],
  flows: ['flight-search-flow'],
  bodySchema: flightSearchSchema,
  responseSchema: {
    200: z.object({
      success: z.boolean(),
      lastFetched: z.string().nullable(),
      tripsWithDeals: z.array(z.object({
        tripId: z.string(),
        origin: z.string(),
        destination: z.string(),
        stopCount: z.number(),
        duration: z.number(),
        isRound: z.boolean(),
        departureDate: z.string(),
        departureTime: z.string(),
        returnDate: z.string().nullable(),
        returnTime: z.string().nullable(),
        legs: z.array(z.object({
          id: z.string(),
          inbound: z.boolean(),
          connectionTime: z.number().nullable(),
          flight: z.object({
            id: z.string(),
            flightNumber: z.string(),
            airline: z.string(),
            origin: z.string(),
            destination: z.string(),
            departureDate: z.string(),
            departureTime: z.string(),
            arrivalDate: z.string(),
            arrivalTime: z.string(),
            duration: z.number(),
          }),
        })),
        deals: z.array(z.object({
          id: z.string(),
          source: z.string(),
          provider: z.string(),
          price: z.number(),
          link: z.string(),
          expiryDate: z.string(),
        })),
      })),
    }),
    400: z.object({
      success: z.boolean(),
      error: z.string(),
    }),
  }
};

export const handler: Handlers['FlightSearch'] = async (req, { logger }) => {
  try {
    const body = flightSearchSchema.parse(req.body);
    const { origin, destination, departureDate, returnDate } = body;

    logger.info('Flight search request', { origin, destination, departureDate, returnDate });

    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      logger.error('Supabase credentials not configured');
      return {
        status: 500,
        body: {
          success: false,
          error: 'Database not configured'
        }
      };
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Query fetchQueries to get last_fetched timestamp
    const queryId = generateQueryId(origin, destination, departureDate, returnDate);
    const { data: fetchQueryData } = await supabase
      .from('fetch_queries')
      .select('last_fetched')
      .eq('id', queryId)
      .single();

    const lastFetched = fetchQueryData?.last_fetched || null;

    // Query deals filtered by search criteria
    let dealsQuery = supabase
      .from('deals')
      .select('*')
      .eq('origin', origin.toUpperCase())
      .eq('destination', destination.toUpperCase())
      .eq('departure_date', departureDate);

    if (returnDate) {
      dealsQuery = dealsQuery.eq('return_date', returnDate);
    } else {
      dealsQuery = dealsQuery.is('return_date', null);
    }

    const { data: dealsData, error: dealsError } = await dealsQuery;

    if (dealsError) {
      logger.error('Failed to query deals', { error: dealsError });
      return {
        status: 500,
        body: {
          success: false,
          error: 'Failed to query database'
        }
      };
    }

    if (!dealsData || dealsData.length === 0) {
      return {
        status: 200,
        body: {
          success: true,
          lastFetched,
          tripsWithDeals: [],
        },
      };
    }

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
        expiryDate: deal.updated_at ? new Date(deal.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      });
    }

    // Fetch legs for all trips
    const tripIds = Array.from(tripsMap.keys());
    const { data: legsData, error: legsError } = await supabase
      .from('legs')
      .select('*')
      .in('trip', tripIds)
      .order('order', { ascending: true });

    if (legsError) {
      logger.error('Failed to query legs', { error: legsError });
      return {
        status: 500,
        body: {
          success: false,
          error: 'Failed to query database'
        }
      };
    }

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
            flightId: leg.flight,
          });
        }
      }
    }

    // Fetch all flights
    const { data: flightsData, error: flightsError } = await supabase
      .from('flights')
      .select('*')
      .in('id', Array.from(flightIds));

    if (flightsError) {
      logger.error('Failed to query flights', { error: flightsError });
      return {
        status: 500,
        body: {
          success: false,
          error: 'Failed to query database'
        }
      };
    }

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
    const tripsWithDeals = Array.from(tripsMap.values()).map(trip => {
      // Sort deals by price
      trip.deals.sort((a: any, b: any) => a.price - b.price);
      
      // Map legs with flight data
      trip.legs = trip.legs.map((leg: any) => {
        const flight = flightsMap.get(leg.flightId);
        if (!flight) {
          return null;
        }
        return {
          id: leg.id,
          inbound: leg.inbound,
          connectionTime: leg.connectionTime,
          flight,
        };
      }).filter((leg: any) => leg !== null);

      return trip;
    }).filter(trip => trip.legs.length > 0)
      .sort((a, b) => {
        // Sort trips by lowest deal price
        const minPriceA = Math.min(...a.deals.map((d: any) => d.price));
        const minPriceB = Math.min(...b.deals.map((d: any) => d.price));
        return minPriceA - minPriceB;
      });

    return {
      status: 200,
      body: {
        success: true,
        lastFetched,
        tripsWithDeals,
      },
    };
  } catch (error) {
    logger.error('Flight search failed', { error: error instanceof Error ? error.message : String(error) });
    
    if (error instanceof z.ZodError) {
      return {
        status: 400,
        body: {
          success: false,
          error: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
        },
      };
    }

    return {
      status: 500,
      body: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
    };
  }
};
