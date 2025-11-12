import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

export const config: ApiRouteConfig = {
  name: 'ClearTables',
  type: 'api',
  path: '/api/flights/clear',
  method: 'POST',
  description: 'Clear all flight data from database tables',
  emits: [],
  flows: ['flight-search-flow'],
  bodySchema: z.object({}),
  responseSchema: {
    200: z.object({
      success: z.boolean(),
      message: z.string(),
      deleted: z.object({
        deals: z.number(),
        legs: z.number(),
        trips: z.number(),
        flights: z.number(),
      }),
    }),
    500: z.object({
      success: z.boolean(),
      error: z.string(),
    }),
  }
};

export const handler: Handlers['ClearTables'] = async (req, { logger }) => {
  try {
    logger.info('Clearing all flight tables');

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

    // Get counts before deletion
    const [
      { count: dealsCountBefore, error: dealsCountError },
      { count: legsCountBefore, error: legsCountError },
      { count: tripsCountBefore, error: tripsCountError },
      { count: flightsCountBefore, error: flightsCountError },
    ] = await Promise.all([
      supabase.from('deals').select('*', { count: 'exact', head: true }),
      supabase.from('legs').select('*', { count: 'exact', head: true }),
      supabase.from('trips').select('*', { count: 'exact', head: true }),
      supabase.from('flights').select('*', { count: 'exact', head: true }),
    ]);

    if (dealsCountError || legsCountError || tripsCountError || flightsCountError) {
      logger.error('Failed to get table counts', {
        dealsError: dealsCountError,
        legsError: legsCountError,
        tripsError: tripsCountError,
        flightsError: flightsCountError,
      });
    }

    // Delete in order to respect foreign key constraints
    // Deals -> Legs -> Trips -> Flights
    // Use .neq('id', '') to match all rows with non-empty IDs (all our rows)
    const [
      { error: dealsError },
      { error: legsError },
      { error: tripsError },
      { error: flightsError },
    ] = await Promise.all([
      supabase.from('deals').delete().neq('id', ''),
      supabase.from('legs').delete().neq('id', ''),
      supabase.from('trips').delete().neq('id', ''),
      supabase.from('flights').delete().neq('id', ''),
    ]);

    if (dealsError || legsError || tripsError || flightsError) {
      logger.error('Failed to delete from tables', {
        dealsError,
        legsError,
        tripsError,
        flightsError,
      });
      return {
        status: 500,
        body: {
          success: false,
          error: 'Failed to clear some tables'
        }
      };
    }

    logger.info('Tables cleared', {
      deals: dealsCountBefore || 0,
      legs: legsCountBefore || 0,
      trips: tripsCountBefore || 0,
      flights: flightsCountBefore || 0,
    });

    return {
      status: 200,
      body: {
        success: true,
        message: 'All tables cleared successfully',
        deleted: {
          deals: dealsCountBefore || 0,
          legs: legsCountBefore || 0,
          trips: tripsCountBefore || 0,
          flights: flightsCountBefore || 0,
        },
      },
    };
  } catch (error) {
    logger.error('Failed to clear tables', { error: error instanceof Error ? error.message : String(error) });
    
    return {
      status: 500,
      body: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    };
  }
};

