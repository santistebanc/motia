import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

export const config: ApiRouteConfig = {
  name: 'SupabaseRandom',
  type: 'api',
  path: '/api/supabase-random',
  method: 'POST',
  description: 'Inserts a random number (0-100) into Supabase table',
  emits: [],
  flows: ['supabase-flow'],
  responseSchema: {
    200: z.object({
      success: z.boolean(),
      randomNumber: z.number(),
      id: z.string().optional(),
      message: z.string()
    }),
    500: z.object({
      success: z.boolean(),
      error: z.string()
    })
  }
};

export const handler: Handlers['SupabaseRandom'] = async (_, { logger }) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    // For backend operations, service role key is recommended (bypasses RLS)
    // Anon key is meant for frontend use and may not work correctly from backend
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    const tableName = process.env.SUPABASE_TABLE_NAME || 'random_numbers';

    if (!supabaseUrl || !supabaseKey) {
      logger.error('Supabase credentials not configured', {
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseKey
      });
      return {
        status: 500,
        body: {
          success: false,
          error: 'Supabase credentials not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (recommended for backend) or SUPABASE_ANON_KEY environment variables.'
        }
      };
    }

    // Create Supabase client (service role key recommended for backend operations)
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const randomNumber = Math.floor(Math.random() * 101); // 0 to 100

    logger.info('Inserting random number to Supabase', { randomNumber, tableName });

    // Insert random number (created_at has a default, so we don't need to provide it)
    const { data, error } = await supabase
      .from(tableName)
      .insert({ value: randomNumber })
      .select()
      .single();

    if (error) {
      logger.error('Supabase insertion failed', { error: error.message, randomNumber });
      return {
        status: 500,
        body: {
          success: false,
          error: error.message
        }
      };
    }

    logger.info('Successfully inserted random number', { id: data?.id, randomNumber });

    return {
      status: 200,
      body: {
        success: true,
        randomNumber,
        id: data?.id,
        message: `Successfully inserted random number ${randomNumber}`
      }
    };
  } catch (error) {
    logger.error('Unexpected error in SupabaseRandom handler', { error: error instanceof Error ? error.message : String(error) });
    return {
      status: 500,
      body: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    };
  }
};

