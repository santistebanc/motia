import { createHash } from 'crypto';

// Generate a deterministic ID from search parameters
export function generateQueryId(origin: string, destination: string, departureDate: string, returnDate?: string): string {
  const params = `${origin.toUpperCase()}|${destination.toUpperCase()}|${departureDate}|${returnDate || ''}`;
  return createHash('sha256').update(params).digest('hex');
}

