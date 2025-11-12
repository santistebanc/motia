import * as cheerio from 'cheerio';
import { EventEmitter } from 'events';

// Search parameters interface
export interface SearchParams {
    originplace?: string;
    destinationplace?: string;
    outbounddate?: string;
    inbounddate?: string;
}

// Data model interfaces
export interface DateTime {
    date: string; // YYYY-MM-DD
    time: string; // 24 hour format
}

export interface Airport {
    code: string; // usually three letter airport code
    name: string; // full name of the airport+city
}

export interface Airline {
    name: string;
}

export interface Flight {
    id: string; // unique id formed by flightNumber + departure datetime
    flightNumber: string;
    origin: Airport;
    destination: Airport;
    departure: DateTime;
    arrival: DateTime; // use departure date except if arrivalDate is defined
    duration: string;
    airline: Airline;
    cabinClass: string; // get it from the request params
}

export interface Leg {
    flight: string; // flightId
    connectionTime?: string;
}

export interface Trip {
    id: string; // made with all legs flightIds
    duration: string;
    origin: Airport;
    destination: Airport;
    stopCount: number;
    outboundLegs: Leg[];
    inboundLegs: Leg[];
}

export interface Deal {
    trip: string; // tripId
    price: string;
    provider: string;
    link?: string;
    last_update: string; // ISO timestamp
}

// In-memory database
class InMemoryDB extends EventEmitter {
    flights: Map<string, Flight> = new Map();
    trips: Map<string, Trip> = new Map();
    deals: Map<string, Deal> = new Map();
    
    // Helper to generate flight ID: flightNumber + departure datetime
    generateFlightId(flightNumber: string, departure: DateTime): string {
        return `${flightNumber}_${departure.date}_${departure.time}`;
    }
    
    // Helper to generate trip ID: all legs flightIds
    generateTripId(outboundLegs: Leg[], inboundLegs: Leg[]): string {
        const allFlightIds = [
            ...outboundLegs.map(l => l.flight),
            ...inboundLegs.map(l => l.flight)
        ].sort().join('|');
        return Buffer.from(allFlightIds).toString('base64').replace(/[/+=]/g, '').substring(0, 64);
    }
    
    // Helper to generate deal ID: tripId + provider
    generateDealId(tripId: string, provider: string): string {
        return `${tripId}_${provider}`;
    }
    
    // Add or update flight (no duplicates by id)
    addFlight(flight: Flight): void {
        const isNew = !this.flights.has(flight.id);
        this.flights.set(flight.id, flight);
        if (isNew) {
            this.emit('flight:added', flight);
        }
    }
    
    // Add or update trip (no duplicates by id)
    addTrip(trip: Trip): void {
        const isNew = !this.trips.has(trip.id);
        this.trips.set(trip.id, trip);
        if (isNew) {
            this.emit('trip:added', trip);
        }
    }
    
    // Add or update deal (no duplicates by id)
    addDeal(deal: Deal): void {
        const dealId = this.generateDealId(deal.trip, deal.provider);
        const isNew = !this.deals.has(dealId);
        this.deals.set(dealId, deal);
        if (isNew) {
            this.emit('deal:added', deal);
        }
    }
    
    // Get all flights
    getAllFlights(): Flight[] {
        return Array.from(this.flights.values());
    }
    
    // Get all trips
    getAllTrips(): Trip[] {
        return Array.from(this.trips.values());
    }
    
    // Get all deals
    getAllDeals(): Deal[] {
        return Array.from(this.deals.values());
    }
    
    // Get deals for a specific trip
    getDealsForTrip(tripId: string): Deal[] {
        return Array.from(this.deals.values()).filter(deal => deal.trip === tripId);
    }
    
    // Get trip with all its deals
    getTripWithDeals(tripId: string): { trip: Trip | undefined; deals: Deal[] } {
        return {
            trip: this.trips.get(tripId),
            deals: this.getDealsForTrip(tripId)
        };
    }
    
    // Get all trips with their deals
    getAllTripsWithDeals(): Array<{ trip: Trip; deals: Deal[] }> {
        return Array.from(this.trips.values()).map(trip => ({
            trip,
            deals: this.getDealsForTrip(trip.id)
        }));
    }
    
    // Clear all data
    clear(): void {
        this.flights.clear();
        this.trips.clear();
        this.deals.clear();
        this.emit('db:cleared');
    }
}

// Global in-memory database instance
export const db = new InMemoryDB();

// Helper functions for data conversion
function convertDateToYYYYMMDD(dateStr: string | null): string | null {
    if (!dateStr) return null;
    
    // Parse formats like "11 Dec 2025" or "Mon, 11 Dec 2025"
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
    
    // Remove any whitespace
    const cleaned = timeStr.trim();
    
    // If already in 24-hour format (HH:MM), return as is
    if (/^\d{1,2}:\d{2}$/.test(cleaned)) {
        const [hours, minutes] = cleaned.split(':');
        return `${hours.padStart(2, '0')}:${minutes}`;
    }
    
    // Try to parse 12-hour format (e.g., "10:30 AM" or "2:45 PM")
    const timeMatch = cleaned.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const minutes = timeMatch[2];
        const period = timeMatch[3].toUpperCase();
        
        if (period === 'PM' && hours !== 12) {
            hours += 12;
        } else if (period === 'AM' && hours === 12) {
            hours = 0;
        }
        
        return `${hours.toString().padStart(2, '0')}:${minutes}`;
    }
    
    return cleaned; // Return as-is if we can't parse it
}

// Function to convert extracted leg data to Flight objects and save to DB
function createFlightsFromLegs(legs: any[], sectionDate: string | null, cabinClass: string): Flight[] {
    const flights: Flight[] = [];
    const sectionDateYYYYMMDD = convertDateToYYYYMMDD(sectionDate);
    
    for (const leg of legs) {
        if (!leg.flightNumber || !leg.departure || !leg.origin || !leg.destination) {
            continue;
        }
        
        const departureTime = parseTimeTo24Hour(leg.departure);
        const arrivalTime = parseTimeTo24Hour(leg.arrival);
        
        if (!departureTime || !sectionDateYYYYMMDD) {
            continue;
        }
        
        // Use arrival date if provided, otherwise use departure date
        let arrivalDate = sectionDateYYYYMMDD;
        if (leg.arrivalDate) {
            const convertedArrivalDate = convertDateToYYYYMMDD(leg.arrivalDate);
            if (convertedArrivalDate) {
                arrivalDate = convertedArrivalDate;
            }
        }
        
        const departure: DateTime = {
            date: sectionDateYYYYMMDD,
            time: departureTime
        };
        
        const arrival: DateTime = {
            date: arrivalDate,
            time: arrivalTime || departureTime // Fallback to departure time if arrival time missing
        };
        
        const flightId = db.generateFlightId(leg.flightNumber, departure);
        
        const flight: Flight = {
            id: flightId,
            flightNumber: leg.flightNumber,
            origin: {
                code: leg.origin,
                name: leg.originFull || leg.origin
            },
            destination: {
                code: leg.destination,
                name: leg.destinationFull || leg.destination
            },
            departure: departure,
            arrival: arrival,
            duration: leg.duration || '',
            airline: {
                name: leg.airline || ''
            },
            cabinClass: cabinClass
        };
        
        db.addFlight(flight);
        flights.push(flight);
    }
    
    return flights;
}

// Function to make initial GET request
export async function getRequest(params: SearchParams = {}) {
    // Default values
    const originplace = params.originplace || 'SLP';
    const destinationplace = params.destinationplace || 'BER';
    const outbounddate = params.outbounddate || '2026-01-19';
    const inbounddate = params.inbounddate || '';
    // Hardcoded: adults=1, children=0, infants=0, currency=EUR, cabinclass=Economy
    const adults = 1;
    const children = 0;
    const infants = 0;
    const currency = 'EUR';
    const cabinclass = 'Economy';
    
    // Build URL with parameters
    const queryParams = new URLSearchParams({
        originplace,
        destinationplace,
        outbounddate,
        inbounddate,
        cabinclass,
        adults: adults.toString(),
        children: children.toString(),
        infants: infants.toString(),
        currency
    });
    
    const url = `https://www.flightsfinder.com/portal/sky?${queryParams.toString()}`;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    };

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: headers
        });

        const result = await response.text();

        // Extract cookies from response headers
        const setCookieHeader = response.headers.get('set-cookie');
        let cookies = '';
        if (setCookieHeader) {
            // Parse Set-Cookie header(s) - can be an array or comma-separated
            const cookieArray = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
            cookies = cookieArray
                .map(cookie => {
                    // Extract cookie name and value (before first semicolon)
                    const cookiePart = cookie.split(';')[0].trim();
                    return cookiePart;
                })
                .join('; ');
        }

        // Extract data object from response body
        // Look for data: { ... } pattern - handle nested braces properly
        let dataObject: any = null;

        const dataIndex = result.indexOf('data:');
        if (dataIndex !== -1) {
            // Find the opening brace after "data:"
            let braceStart = result.indexOf('{', dataIndex);
            if (braceStart !== -1) {
                // Find the matching closing brace by counting braces
                let braceCount = 0;
                let braceEnd = -1;
                for (let i = braceStart; i < result.length; i++) {
                    if (result[i] === '{') {
                        braceCount++;
                    } else if (result[i] === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                            braceEnd = i;
                            break;
                        }
                    }
                }

                if (braceEnd !== -1) {
                    // Extract the data object string
                    const dataString = result.substring(braceStart, braceEnd + 1);
                    try {
                        // More careful replacement: only replace single quotes that are property names or string values
                        // First, handle $.now() - replace with current timestamp
                        const timestamp = Date.now();
                        let processedString = dataString.replace(/\$\.now\(\)/g, timestamp.toString());

                        // Replace single quotes with double quotes, but be careful about escaped quotes
                        // This regex handles: 'key': 'value' patterns
                        processedString = processedString.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');

                        dataObject = JSON.parse(processedString);
                    } catch (e) {
                        // If JSON parsing fails, try using eval (less safe but handles JS object notation)
                        try {
                            const timestamp = Date.now();
                            let processedString = dataString.replace(/\$\.now\(\)/g, timestamp.toString());
                            // Use Function constructor to safely evaluate the object
                            dataObject = new Function('return ' + processedString)();
                        } catch (evalError) {
                            console.error('Failed to parse data object:', e);
                            console.error('Eval also failed:', evalError);
                            dataObject = null;
                        }
                    }
                }
            }
        }

        return {
            status: response.status,
            statusText: response.statusText,
            body: result,
            cookies: cookies,
            data: dataObject,
            url: url, // Return the URL used for the request (for referer in poll requests)
            success: true
        };
    } catch (error) {
        return {
            status: 0,
            statusText: 'Error',
            body: error instanceof Error ? error.message : 'Unknown error',
            cookies: '',
            data: null,
            success: false
        };
    }
}

// Function to extract flights from response body and save to database
function extractFlights(body: string, params: SearchParams = {}): any[] {
    const flights: any[] = [];

    if (!body || body.trim().length === 0) {
        console.log('Empty body provided to extractFlights');
        return [];
    }

    try {
        // Load HTML with cheerio
        const $ = cheerio.load(body);

        // Find all divs with class="search_modal" - one per flight route
        const searchModals = $('div.search_modal');
        
        console.log('Found search_modal elements:', searchModals.length);
        
        if (searchModals.length === 0) {
            // Try to see if there's any HTML structure at all
            const allDivs = $('div');
            console.log('Total div elements found:', allDivs.length);
            if (allDivs.length > 0) {
                console.log('First div classes:', allDivs.first().attr('class'));
            }
            return [];
        }

        // Extract flight information from each search_modal and save to DB
        searchModals.each((index, element) => {
            const $searchModal = $(element);
            try {
                const flight = extractFlightFromSearchModal($, $searchModal, params);
                if (flight && flight.price) {
                    flights.push(flight);
                    console.log(`Successfully extracted flight ${index + 1}`);
                } else {
                    console.log(`Flight ${index + 1} extraction failed:`, flight ? 'no price' : 'null flight');
                }
            } catch (e) {
                console.error(`Error extracting flight ${index + 1}:`, e);
            }
        });

    } catch (e) {
        console.error('Error extracting flights:', e);
        if (e instanceof Error) {
            console.error('Error stack:', e.stack);
        }
    }

    return flights;
}

// Helper function to extract flight data from a search_modal (can contain outbound and return)
// and save Flights, Trips, and Deals to the database
function extractFlightFromSearchModal($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>, params: SearchParams = {}): any {
    // Find all headings to determine if there's outbound and return
    // Headings are direct children or descendants of search_modal
    const headings = $el.find('p._heading');
    const outboundHeading = headings.filter((i, el) => {
        const text = $(el).text();
        return text.includes('Outbound') && !text.includes('Return') && !text.includes('Book Your Ticket');
    }).first();
    const returnHeading = headings.filter((i, el) => {
        const text = $(el).text();
        return text.includes('Return') && !text.includes('Book Your Ticket');
    }).first();
    
    // Extract outbound flight
    const outboundFlight = extractFlightFromSection($, $el, outboundHeading, 'outbound');
    
    // If no outbound flight found, return null
    if (!outboundFlight) {
        return null;
    }
    
    // Extract return flight if present
    let returnFlight = null;
    if (returnHeading.length > 0) {
        returnFlight = extractFlightFromSection($, $el, returnHeading, 'return');
    }
    
    // Extract prices from _similar section (shared for both flights)
    const prices = extractPricesFromSimilar($, $el);
    
    // Use the first (lowest) price
    const priceValues = prices
        .map(p => {
            const numValue = parseFloat(p.price.replace(/,/g, ''));
            return { ...p, numValue };
        })
        .sort((a, b) => a.numValue - b.numValue)
        .map(p => p.price);
    
    const price = priceValues.length > 0 ? priceValues[0] : null;
    
    if (!price) {
        return null;
    }
    
    // Hardcoded: cabinclass is always Economy
    const cabinClass = 'Economy';
    
    // Create Flight objects from legs and save to DB
    const outboundFlights: Flight[] = outboundFlight.legs 
        ? createFlightsFromLegs(outboundFlight.legs, outboundFlight.date, cabinClass)
        : [];
    
    const inboundFlights: Flight[] = returnFlight && returnFlight.legs
        ? createFlightsFromLegs(returnFlight.legs, returnFlight.date, cabinClass)
        : [];
    
    // Create Leg objects with flight IDs
    const outboundLegs: Leg[] = outboundFlights.map((flight, index) => {
        const leg: Leg = {
            flight: flight.id
        };
        // Add connection time if not the last leg
        if (index < outboundFlights.length - 1 && outboundFlight.legs && outboundFlight.legs[index]) {
            const connectionTime = outboundFlight.legs[index].connectionTime;
            if (connectionTime) {
                leg.connectionTime = connectionTime;
            }
        }
        return leg;
    });
    
    const inboundLegs: Leg[] = inboundFlights.map((flight, index) => {
        const leg: Leg = {
            flight: flight.id
        };
        // Add connection time if not the last leg
        if (index < inboundFlights.length - 1 && returnFlight && returnFlight.legs && returnFlight.legs[index]) {
            const connectionTime = returnFlight.legs[index].connectionTime;
            if (connectionTime) {
                leg.connectionTime = connectionTime;
            }
        }
        return leg;
    });
    
    // Determine origin and destination airports
    const originAirport: Airport = outboundFlights.length > 0 
        ? outboundFlights[0].origin 
        : { code: '', name: '' };
    const destinationAirport: Airport = inboundFlights.length > 0
        ? inboundFlights[inboundFlights.length - 1].destination
        : outboundFlights.length > 0
            ? outboundFlights[outboundFlights.length - 1].destination
            : { code: '', name: '' };
    
    // Create Trip object
    const tripId = db.generateTripId(outboundLegs, inboundLegs);
    const trip: Trip = {
        id: tripId,
        duration: outboundFlight.duration || '',
        origin: originAirport,
        destination: destinationAirport,
        stopCount: (outboundFlight.stopCount || 0) + (returnFlight?.stopCount || 0),
        outboundLegs: outboundLegs,
        inboundLegs: inboundLegs
    };
    
    db.addTrip(trip);
    
    // Create Deal objects for each price/provider
    const now = new Date().toISOString();
    for (const priceInfo of prices) {
        const deal: Deal = {
            trip: tripId,
            price: priceInfo.price,
            provider: priceInfo.provider,
            link: priceInfo.link,
            last_update: now
        };
        db.addDeal(deal);
    }
    
    // Generate unique ID based on prices and legs (for backward compatibility)
    const uniqueId = generateFlightId(prices, outboundFlight, returnFlight);
    
    return {
        id: uniqueId,
        date: outboundFlight.date,
        price: price,
        prices: prices.length > 0 ? prices : undefined,
        priceValues: priceValues.length > 0 ? priceValues : undefined,
        outbound: outboundFlight,
        return: returnFlight || undefined,
    };
}

// Function to generate a unique ID for a flight based on prices and legs
function generateFlightId(
    prices: Array<{ provider: string; price: string; link?: string }>,
    outboundFlight: any,
    returnFlight: any | null
): string {
    // Create a string from all prices (sorted)
    const priceString = prices
        .map(p => `${p.provider}:${p.price}`)
        .sort()
        .join('|');
    
    // Create a string from outbound legs
    const outboundLegsString = outboundFlight.legs
        ? outboundFlight.legs
            .map((leg: any) => {
                // Use flightNumber, date, and departure time
                const legDate = outboundFlight.date || '';
                const legId = `${leg.flightNumber || ''}_${legDate}_${leg.departure || ''}`;
                return legId;
            })
            .sort()
            .join('||')
        : `${outboundFlight.date || ''}_${outboundFlight.departure || ''}`;
    
    // Create a string from return legs (if present)
    const returnLegsString = returnFlight && returnFlight.legs
        ? returnFlight.legs
            .map((leg: any) => {
                const legDate = returnFlight.date || '';
                const legId = `${leg.flightNumber || ''}_${legDate}_${leg.departure || ''}`;
                return legId;
            })
            .sort()
            .join('||')
        : returnFlight
            ? `${returnFlight.date || ''}_${returnFlight.departure || ''}`
            : '';
    
    // Combine all parts to create unique ID
    const idParts = [priceString, outboundLegsString];
    if (returnLegsString) {
        idParts.push(returnLegsString);
    }
    
    const uniqueId = idParts.join('::');
    
    // Create a hash-like string (simple approach)
    // Use btoa for browser compatibility, or Buffer in Node.js
    let base64Id: string;
    if (typeof Buffer !== 'undefined') {
        // Node.js environment
        base64Id = Buffer.from(uniqueId).toString('base64');
    } else {
        // Browser environment
        base64Id = btoa(unescape(encodeURIComponent(uniqueId)));
    }
    return base64Id.replace(/[/+=]/g, '').substring(0, 64);
}

// Helper function to extract flight data from a section (outbound or return)
function extractFlightFromSection($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>, heading: cheerio.Cheerio<any>, type: 'outbound' | 'return'): any {
    if (heading.length === 0) {
        return null;
    }
    
    // Extract date from heading
    const dateText = heading.text();
    const dateMatch = dateText.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{4})/);
    const date = dateMatch ? `${dateMatch[2]} ${dateMatch[3]} ${dateMatch[4]}` : null;
    
    // Find the panel that comes immediately after this heading as a sibling
    // The structure is: p._heading followed by div._panel
    // Both are children of search_modal, so we need to find the next sibling
    const panel = heading.nextAll('div._panel').first();
    
    if (panel.length === 0) {
        return null;
    }
    
    const panelToUse = panel;
    
    // Extract overall flight info from panel_heading
    const panelHeading = panelToUse.find('div._panel_heading').first();
    
    // Extract airline name from p._ahn
    const airlineName = panelHeading.find('p._ahn').first().text().trim();
    
    // Extract flight name (may include multiple airlines) from p._flight_name
    const flightName = panelHeading.find('p._flight_name').first().text().trim();
    
    // Extract departure time and airport from trip section
    const tripSection = panelHeading.find('div.trip').first();
    const departureTimeEl = tripSection.find('p.time').first();
    // Get time text without the airport code span
    const departureTime = departureTimeEl.clone().children().remove().end().text().trim();
    const departureAirport = departureTimeEl.find('span').first().text().trim();
    
    // Extract arrival time and airport (last p.time in trip section)
    const arrivalTimeEl = tripSection.find('p.time').last();
    // Get time text without the airport code span and superscript
    const arrivalTime = arrivalTimeEl.clone().children().remove().end().text().trim();
    const arrivalAirport = arrivalTimeEl.find('span').first().text().trim();
    
    // Extract total duration from stops section (p.time in div._stops)
    const stopsSection = tripSection.find('div._stops').first();
    const totalDuration = stopsSection.find('p.time').first().text().trim();
    
    // Extract stop count from p.stop in div._stops
    const stopCountText = stopsSection.find('p.stop').first().text().trim();
    const stopCountMatch = stopCountText.match(/(\d+)\s*stop/);
    const stopCount = stopCountMatch ? parseInt(stopCountMatch[1], 10) : 0;
    
    // Extract all legs from _panel_body sections within this panel
    const legs: any[] = [];
    panelToUse.find('div._panel_body').each((index, legElement) => {
        const $leg = $(legElement);
        
        // Extract flight number and airline from small tag in div._head
        // Format: "AirlineName FlightNumber" - split by spaces, last item is flight number
        const flightInfoText = $leg.find('div._head small').first().text().trim();
        const flightInfoParts = flightInfoText.split(/\s+/);
        const flightNumber = flightInfoParts.length > 0 ? flightInfoParts[flightInfoParts.length - 1] : null;
        const airlineNameLeg = flightInfoParts.length > 1 ? flightInfoParts.slice(0, -1).join(' ') : null;
        
        // Extract duration from div.c1 > p
        const legDuration = $leg.find('div.c1 p').first().text().trim();
        
        // Extract times from div.c3 > p (first is departure, last is arrival)
        const timesEl = $leg.find('div.c3');
        const departureTimeLeg = timesEl.find('p').first().text().trim();
        const arrivalTimeLeg = timesEl.find('p').last().text().trim();
        
        // Extract airports from div.c4 > p (first is origin, last is destination)
        const airportsEl = $leg.find('div.c4');
        const originAirportFull = airportsEl.find('p').first().text().trim();
        const destinationAirportFull = airportsEl.find('p').last().text().trim();
        
        // Extract airport codes (3-letter codes at the start of the full name)
        const originCodeMatch = originAirportFull.match(/^([A-Z]{3})\s/);
        const destinationCodeMatch = destinationAirportFull.match(/^([A-Z]{3})\s/);
        const originCode = originCodeMatch ? originCodeMatch[1] : null;
        const destinationCode = destinationCodeMatch ? destinationCodeMatch[1] : null;
        
        // Extract connection time if present (p.connect_airport > span)
        const connectEl = $leg.find('p.connect_airport');
        const connectionTime = connectEl.length > 0 ? connectEl.find('span').first().text().trim() : null;
        
        // Extract arrival date if present in summary (p._summary > span, first span)
        // Only the last leg typically has this
        const summaryEl = $leg.find('p._summary');
        let arrivalDateText = null;
        if (summaryEl.length > 0) {
            // Look for date pattern in the summary
            const summaryText = summaryEl.text();
            const dateMatch = summaryText.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{4})/);
            if (dateMatch) {
                arrivalDateText = `${dateMatch[1]}, ${dateMatch[2]} ${dateMatch[3]} ${dateMatch[4]}`;
            }
        }
        
        // Only add leg if we have essential information
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
        date: date,
        departure: departureTime,
        arrival: arrivalTime,
        origin: departureAirport,
        destination: arrivalAirport,
        duration: totalDuration,
        airline: airlineName || flightName || null,
        flightName: flightName || null,
        stopCount: stopCount,
        legs: legs.length > 0 ? legs : undefined,
    };
}

// Helper function to extract prices from _similar section
function extractPricesFromSimilar($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): Array<{ provider: string; price: string; link?: string }> {
    const prices: Array<{ provider: string; price: string; link?: string }> = [];
    
    // Structure: div._similar > div > p (provider name) + p (price with Select link)
    $el.find('div._similar > div').each((index, priceElement) => {
        const $priceEl = $(priceElement);
        const providerName = $priceEl.find('p').first().text().trim();
        const priceP = $priceEl.find('p').eq(1); // Second p contains the price
        const priceText = priceP.text().trim();
        
        // Extract reservation link from the "Select" button (a tag in the price p)
        // Get the substring starting at u=, then URL decode it
        const fullLink = priceP.find('a').attr('href');
        let selectLink: string | undefined = undefined;
        if (fullLink) {
            const uIndex = fullLink.indexOf('u=');
            if (uIndex !== -1) {
                // Extract substring starting at u=
                const uSubstring = fullLink.substring(uIndex + 2); // +2 to skip "u="
                // Extract until next & or end of string
                const endIndex = uSubstring.indexOf('&');
                const uValue = endIndex !== -1 ? uSubstring.substring(0, endIndex) : uSubstring;
                try {
                    selectLink = decodeURIComponent(uValue);
                } catch (e) {
                    // If decoding fails, use the original value
                    selectLink = uValue;
                }
            }
        }
        
        // Extract numeric price value, ignoring all non-numeric characters (currency symbols, etc.)
        // Matches: digits with optional thousands separators (comma or period) and optional decimal part
        // Examples: "€1,234.56" -> "1,234.56", "$500" -> "500", "£2,000" -> "2,000"
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

// Function to make poll request with token
export async function pollRequest(data: any, cookies: string = '', refererUrl?: string, params: SearchParams = {}) {
    const url = 'https://www.flightsfinder.com/portal/sky/poll';

    const headers: { [key: string]: string } = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    };

    // Add cookies if provided
    if (cookies) {
        headers['cookie'] = cookies;
    }

    // Build the form data from the data object as-is
    if (!data || !data['_token']) {
        throw new Error('Invalid data object: _token is required');
    }

    // Update 'noc' parameter with current timestamp (browser updates this on each poll)
    const dataWithUpdatedNoc = { ...data };
    dataWithUpdatedNoc['noc'] = Date.now().toString();

    // Build URL-encoded form data directly from the data object
    const requestBody = Object.entries(dataWithUpdatedNoc)
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join('&');

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: requestBody
        });

        const responseText = await response.text();

        // Extract cookies from response headers and merge with existing cookies
        const setCookieHeader = response.headers.get('set-cookie');
        let updatedCookies = cookies;
        if (setCookieHeader) {
            const cookieArray = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
            const newCookies = cookieArray
                .map(cookie => {
                    // Extract cookie name and value (before first semicolon)
                    const cookiePart = cookie.split(';')[0].trim();
                    return cookiePart;
                })
                .join('; ');
            
            // Merge with existing cookies
            if (newCookies) {
                if (updatedCookies) {
                    // Combine cookies, avoiding duplicates
                    const existingCookieMap = new Map<string, string>();
                    updatedCookies.split(';').forEach(c => {
                        const [name, ...valueParts] = c.trim().split('=');
                        if (name) {
                            existingCookieMap.set(name, valueParts.join('='));
                        }
                    });
                    
                    // Add new cookies, overwriting existing ones
                    newCookies.split(';').forEach(c => {
                        const [name, ...valueParts] = c.trim().split('=');
                        if (name) {
                            existingCookieMap.set(name, valueParts.join('='));
                        }
                    });
                    
                    // Rebuild cookie string
                    updatedCookies = Array.from(existingCookieMap.entries())
                        .map(([name, value]) => `${name}=${value}`)
                        .join('; ');
                } else {
                    updatedCookies = newCookies;
                }
            }
        }

        // Check for 504 Gateway Time-out or other error pages
        if (response.status === 504 || responseText.includes('504 Gateway Time-out') || responseText.includes('<title>504 Gateway Time-out</title>')) {
            console.warn('504 Gateway Time-out received, treating as non-finished poll');
            return {
                status: response.status,
                statusText: '504 Gateway Time-out',
                finished: false,
                count: 0,
                body: '',
                flights: [],
                cookies: updatedCookies,
                success: true // Still return success=true so polling can continue
            };
        }

        // Check for Page Not Found errors
        if (response.status === 404 || responseText.includes('Page Not Found') || responseText.includes('<title>Page Not Found')) {
            console.warn('Page Not Found received, treating as non-finished poll');
            return {
                status: response.status || 404,
                statusText: 'Page Not Found',
                finished: false,
                count: 0,
                body: '',
                flights: [],
                cookies: updatedCookies,
                success: true // Still return success=true so polling can continue
            };
        }

        // Split the response by '|'
        const parts = responseText.split('|');

        // Extract finished: true if first item is 'Y', false if 'N'
        const finished = parts.length > 0 && parts[0] === 'Y';

        // Extract count: number from second item
        const count = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;

        // Extract body: string from seventh item (index 6)
        let body = parts.length > 6 ? parts[6] : '';
        
        // Try URL decoding if the body looks encoded
        if (body && body.includes('%')) {
            try {
                body = decodeURIComponent(body);
            } catch (e) {
                // If decoding fails, use original body
                console.log('URL decoding failed, using original body');
            }
        }
        
        // Log for debugging
        console.log('Response parts count:', parts.length);
        console.log('Body length:', body.length);
        console.log('Body preview (first 200 chars):', body.substring(0, 200));
        if (parts.length > 0) {
            console.log('First part (finished):', parts[0]);
        }
        if (parts.length > 1) {
            console.log('Second part (count):', parts[1]);
        }
        if (parts.length > 6) {
            console.log('Seventh part (body) length:', parts[6].length);
        }

        // Only extract flights if finished is true (Y)
        let flights: any[] = [];
        if (finished) {
            console.log('Finished is Y, extracting flights...');
            flights = extractFlights(body, params);
            console.log('Extracted flights count:', flights.length);
        } else {
            console.log('Finished is N, skipping flight extraction');
        }

        return {
            status: response.status,
            statusText: response.statusText,
            finished: finished,
            count: count,
            body: body,
            flights: flights,
            cookies: updatedCookies,
            success: true
        };
    } catch (error) {
        return {
            status: 0,
            statusText: 'Error',
            finished: false,
            count: 0,
            body: error instanceof Error ? error.message : 'Unknown error',
            flights: [],
            cookies: cookies, // Return existing cookies on error
            success: false
        };
    }
}

// Function to fetch all flights from Skyscanner by polling until finished
export async function fetchSkyscanner(params: SearchParams = {}): Promise<{ flights: any[]; success: boolean; error?: string }> {
    const allFlights: any[] = [];
    
    try {
        // Step 1: Make initial request to get data object and cookies
        console.log('Step 1: Making initial getRequest...');
        const initialResult = await getRequest(params);
        
        if (!initialResult.success) {
            return {
                flights: [],
                success: false,
                error: `Initial request failed: ${initialResult.statusText}`
            };
        }
        
        if (!initialResult.data || !initialResult.data['_token']) {
            return {
                flights: [],
                success: false,
                error: 'No data object or token found in initial response'
            };
        }
        
        const dataObject = initialResult.data;
        let cookies = initialResult.cookies || '';
        const refererUrl = initialResult.url; // Get the initial request URL for referer header
        
        console.log('Initial request successful, token obtained. Starting polling...');
        console.log('Using referer URL:', refererUrl);
        
        // Step 2: Poll repeatedly until finished
        let finished = false;
        let pollCount = 0;
        const maxPolls = 20; // Safety limit to prevent infinite loops
        
        while (!finished && pollCount < maxPolls) {
            pollCount++;
            console.log(`Poll attempt ${pollCount}...`);
            
            const pollResult = await pollRequest(dataObject, cookies, refererUrl, params);
            
            if (!pollResult.success) {
                console.error(`Poll ${pollCount} failed:`, pollResult.statusText);
                break;
            }
            
            // Update cookies from the poll response for next iteration
            if (pollResult.cookies) {
                cookies = pollResult.cookies;
                console.log(`Poll ${pollCount}: Updated cookies for next request`);
            }
            
            // Check if finished
            finished = pollResult.finished === true;
            
            if (finished) {
                // Only extract flights from the final response (when finished is Y)
                if (pollResult.flights && pollResult.flights.length > 0) {
                    allFlights.push(...pollResult.flights);
                    console.log(`Poll ${pollCount}: Extracted ${pollResult.flights.length} flights from final response`);
                } else {
                    console.log(`Poll ${pollCount}: No flights extracted from final response`);
                }
                console.log(`Polling complete after ${pollCount} attempts. Total flights: ${allFlights.length}`);
            } else {
                // Skip flights from intermediate responses (N)
                console.log(`Poll ${pollCount}: Not finished yet (N), skipping flight extraction`);
                // Wait a bit before next poll to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        if (pollCount >= maxPolls && !finished) {
            console.warn(`Reached max poll limit (${maxPolls}) without finishing`);
        }
        
        return {
            flights: allFlights,
            success: true
        };
        
    } catch (error) {
        console.error('Error in fetchSkyscanner:', error);
        return {
            flights: allFlights,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

