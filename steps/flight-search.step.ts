import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';

const flightSearchSchema = z.object({
  origin: z.string().min(3, 'Origin must be at least 3 characters'),
  destination: z.string().min(3, 'Destination must be at least 3 characters'),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Departure date must be in YYYY-MM-DD format'),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Return date must be in YYYY-MM-DD format').optional(),
});

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
      tripsWithDeals: z.array(z.object({
        tripId: z.number(),
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
          id: z.number(),
          inbound: z.boolean(),
          connectionTime: z.number().nullable(),
          flight: z.object({
            id: z.number(),
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
          id: z.number(),
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

// Mock airlines for variety
const airlines = ['American Airlines', 'Delta', 'United Airlines', 'Southwest', 'JetBlue', 'Alaska Airlines'];

function generateMockFlight(
  id: number,
  origin: string,
  destination: string,
  date: string,
  baseTime: string
) {
  const airline = airlines[Math.floor(Math.random() * airlines.length)];
  const flightNumber = `${airline.substring(0, 2).toUpperCase()}${Math.floor(Math.random() * 9000) + 1000}`;
  
  // Parse base time (HH:MM format)
  const [baseHour, baseMinute] = baseTime.split(':').map(Number);
  
  // Duration in minutes (2-8 hours)
  const durationMinutes = Math.floor(Math.random() * 360) + 120; // 2-8 hours
  
  // Calculate arrival time
  const totalMinutes = baseHour * 60 + baseMinute + durationMinutes;
  const arrivalHour = Math.floor((totalMinutes / 60) % 24);
  const arrivalMinute = totalMinutes % 60;
  
  // Check if arrival is next day
  const arrivalDate = totalMinutes >= 1440 ? 
    new Date(new Date(date).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] : 
    date;
  
  const departureTime = `${String(baseHour).padStart(2, '0')}:${String(baseMinute).padStart(2, '0')}`;
  const arrivalTime = `${String(arrivalHour).padStart(2, '0')}:${String(arrivalMinute).padStart(2, '0')}`;
  
  return {
    id,
    flightNumber,
    airline,
    origin: origin.toUpperCase(),
    destination: destination.toUpperCase(),
    departureDate: date,
    departureTime,
    arrivalDate,
    arrivalTime,
    duration: durationMinutes,
  };
}

export const handler: Handlers['FlightSearch'] = async (req, { logger }) => {
  try {
    const body = flightSearchSchema.parse(req.body);
    const { origin, destination, departureDate, returnDate } = body;

    logger.info('Flight search request', { origin, destination, departureDate, returnDate });

    // Mock deal providers and sources
    const providers = ['Expedia', 'Kayak', 'Priceline', 'Google Flights', 'Skyscanner', 'CheapOair', 'Travelocity', 'Orbitz'];
    const sources = ['email', 'website', 'app', 'newsletter', 'social', 'direct'];

    // Generate 5-10 mock trips with deals
    const numTrips = Math.floor(Math.random() * 6) + 5;
    const basePrice = Math.floor(Math.random() * 500) + 200; // $200-$700 base price
    const baseTripId = Date.now();
    
    const tripsWithDeals = Array.from({ length: numTrips }, (_, tripIndex) => {
      const tripId = baseTripId + tripIndex + 1;
      const stops = Math.random() > 0.5 ? Math.floor(Math.random() * 2) : 0;
      const isRound = !!returnDate;
      
      // Generate trip details
      const departureHour = Math.floor(Math.random() * 16) + 6;
      const departureMinute = Math.floor(Math.random() * 60);
      const departureTime = `${String(departureHour).padStart(2, '0')}:${String(departureMinute).padStart(2, '0')}`;
      
      // Generate legs for the trip
      const legs: Array<{
        id: number;
        inbound: boolean;
        connectionTime: number | null;
        flight: {
          id: number;
          flightNumber: string;
          airline: string;
          origin: string;
          destination: string;
          departureDate: string;
          departureTime: string;
          arrivalDate: string;
          arrivalTime: string;
          duration: number;
        };
      }> = [];
      
      let currentTime = departureTime;
      let currentDate = departureDate;
      let totalDuration = 0;
      
      // Generate outbound legs
      if (stops === 0) {
        // Direct flight
        const flight = generateMockFlight(
          tripId * 1000 + 1,
          origin,
          destination,
          currentDate,
          currentTime
        );
        totalDuration += flight.duration;
        
        legs.push({
          id: tripId * 100 + 1,
          inbound: false,
          connectionTime: null,
          flight,
        });
      } else {
        // Multi-leg flight with stops
        const intermediateAirports = ['ORD', 'DFW', 'DEN', 'ATL', 'PHX'];
        const stopAirport = intermediateAirports[Math.floor(Math.random() * intermediateAirports.length)];
        
        // First leg: origin to stop
        const flight1 = generateMockFlight(
          tripId * 1000 + 1,
          origin,
          stopAirport,
          currentDate,
          currentTime
        );
        totalDuration += flight1.duration;
        legs.push({
          id: tripId * 100 + 1,
          inbound: false,
          connectionTime: null,
          flight: flight1,
        });
        
        // Connection time: wait time between flights (30 minutes to 3 hours)
        const connectionTime = Math.floor(Math.random() * 150) + 30;
        totalDuration += connectionTime;
        
        // Calculate next departure time (arrival time + connection time)
        const [arrHour, arrMin] = flight1.arrivalTime.split(':').map(Number);
        const connMinutes = arrHour * 60 + arrMin + connectionTime;
        const nextHour = Math.floor((connMinutes / 60) % 24);
        const nextMin = connMinutes % 60;
        const nextTime = `${String(nextHour).padStart(2, '0')}:${String(nextMin).padStart(2, '0')}`;
        const nextDate = connMinutes >= 1440 ? 
          new Date(new Date(currentDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] : 
          currentDate;
        
        // Second leg: stop to destination
        const flight2 = generateMockFlight(
          tripId * 1000 + 2,
          stopAirport,
          destination,
          nextDate,
          nextTime
        );
        totalDuration += flight2.duration;
        
        // Store connection time on the first leg
        legs[legs.length - 1].connectionTime = connectionTime;
        
        legs.push({
          id: tripId * 100 + 2,
          inbound: false,
          connectionTime: null,
          flight: flight2,
        });
      }
      
      // Generate return legs if round trip
      let returnTime: string | null = null;
      if (isRound && returnDate) {
        // Return departure time (morning to evening)
        const returnHour = Math.floor(Math.random() * 12) + 8; // 8 AM to 8 PM
        const returnMinute = Math.floor(Math.random() * 60);
        returnTime = `${String(returnHour).padStart(2, '0')}:${String(returnMinute).padStart(2, '0')}`;
        
        const returnStops = Math.random() > 0.5 ? Math.floor(Math.random() * 2) : 0;
        let returnCurrentTime = returnTime;
        let returnCurrentDate = returnDate;
        let returnTotalDuration = 0;
        
        if (returnStops === 0) {
          // Direct return
          const returnFlight = generateMockFlight(
            tripId * 1000 + 10,
            destination,
            origin,
            returnCurrentDate,
            returnCurrentTime
          );
          returnTotalDuration += returnFlight.duration;
          
          legs.push({
            id: tripId * 100 + 10,
            inbound: true,
            connectionTime: null,
            flight: returnFlight,
          });
        } else {
          // Multi-leg return
          const intermediateAirports = ['ORD', 'DFW', 'DEN', 'ATL', 'PHX'];
          const stopAirport = intermediateAirports[Math.floor(Math.random() * intermediateAirports.length)];
          
          // First return leg
          const returnFlight1 = generateMockFlight(
            tripId * 1000 + 10,
            destination,
            stopAirport,
            returnCurrentDate,
            returnCurrentTime
          );
          returnTotalDuration += returnFlight1.duration;
          legs.push({
            id: tripId * 100 + 10,
            inbound: true,
            connectionTime: null,
            flight: returnFlight1,
          });
          
          // Connection time: wait time between return flights
          const returnConnectionTime = Math.floor(Math.random() * 150) + 30;
          returnTotalDuration += returnConnectionTime;
          
          // Calculate next departure time
          const [retArrHour, retArrMin] = returnFlight1.arrivalTime.split(':').map(Number);
          const retConnMinutes = retArrHour * 60 + retArrMin + returnConnectionTime;
          const retNextHour = Math.floor((retConnMinutes / 60) % 24);
          const retNextMin = retConnMinutes % 60;
          const retNextTime = `${String(retNextHour).padStart(2, '0')}:${String(retNextMin).padStart(2, '0')}`;
          const retNextDate = retConnMinutes >= 1440 ? 
            new Date(new Date(returnCurrentDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] : 
            returnCurrentDate;
          
          // Second return leg
          const returnFlight2 = generateMockFlight(
            tripId * 1000 + 11,
            stopAirport,
            origin,
            retNextDate,
            retNextTime
          );
          returnTotalDuration += returnFlight2.duration;
          
          // Store connection time on the first return leg
          legs[legs.length - 1].connectionTime = returnConnectionTime;
          
          legs.push({
            id: tripId * 100 + 11,
            inbound: true,
            connectionTime: null,
            flight: returnFlight2,
          });
        }
        
        totalDuration += returnTotalDuration;
      }
      
      // Generate 3-8 deals per trip
      const numDeals = Math.floor(Math.random() * 6) + 3;
      const tripBasePrice = basePrice + (tripIndex * 50);
      
      const deals = Array.from({ length: numDeals }, (dealIndex) => {
        const provider = providers[Math.floor(Math.random() * providers.length)];
        const source = sources[Math.floor(Math.random() * sources.length)];
        
        // Deals are typically 5-35% cheaper than base price
        const discount = 0.05 + Math.random() * 0.3; // 5-35% discount
        const dealPrice = Math.round(tripBasePrice * (1 - discount));
        
        // Expiry date: 1-7 days from now
        const expiryDays = Math.floor(Math.random() * 7) + 1;
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + expiryDays);
        
        return {
          id: tripId * 1000 + dealIndex + 1,
          source,
          provider,
          price: dealPrice,
          link: `https://${provider.toLowerCase().replace(' ', '')}.com/deal/${tripId}-${dealIndex + 1}`,
          expiryDate: expiryDate.toISOString().split('T')[0],
        };
      }).sort((a, b) => a.price - b.price); // Sort deals by price

      return {
        tripId,
        origin: origin.toUpperCase(),
        destination: destination.toUpperCase(),
        stopCount: stops,
        duration: totalDuration,
        isRound,
        departureDate,
        departureTime,
        returnDate: returnDate || null,
        returnTime,
        legs,
        deals,
      };
    }).sort((a, b) => {
      // Sort trips by lowest deal price
      const minPriceA = Math.min(...a.deals.map(d => d.price));
      const minPriceB = Math.min(...b.deals.map(d => d.price));
      return minPriceA - minPriceB;
    });

    return {
      status: 200,
      body: {
        success: true,
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
